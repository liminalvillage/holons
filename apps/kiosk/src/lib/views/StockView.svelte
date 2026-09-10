<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The Stock board: what the place keeps, in quantity.
  //
  // Three layouts behind the pills band (see `stockViewMode`):
  //   shelf   — one row per item the holon keeps, grouped by category, with
  //             the level folded from REA stock events; tap a row for its
  //             story and to record a movement (use / add / count). Each row
  //             (and the card) carries a − / + stepper: taps coalesce into one
  //             ±n event once they go quiet ($lib/stocklink `mergeTap`).
  //             A `?item=<id>` on the stock route opens the card on boot, so a
  //             link or a QR on the bin lands on it (`$lib/stocklink`).
  //   reorder — what to buy to bring every item back to its restock level;
  //             one tap writes it into the shared shopping checklist.
  //   moves   — shortages against open needs, and the transfers the
  //             federation could make from partner surpluses, nearest
  //             partnership first (core's transport plan); a tap records one.
  //
  // Meaning lives in `@holons/core/inventory`; $lib/stock arranges it for the
  // screen. Data rules inherited from Flows: `rea_events` is read one-shot
  // with a retry backoff and a periodic refresh, never subscribed; every
  // await is followed by a holon-identity check. The `stock` lens (item
  // specs) is small and streams in through the shell (`rawStock`).
  import { onMount, tick } from "svelte";
  import { get } from "svelte/store";
  import {
    holonId,
    rawStock,
    rawQuests,
    partnerNames,
    rotationHold,
    scope,
    searchQuery,
    stockViewMode,
    showNotice,
  } from "$lib/stores";
  import { currentUser, loginOpen } from "$lib/auth";
  import {
    getHolosphere,
    getReaStore,
    getChecklistStore,
    getLensStore,
  } from "$lib/holosphere";
  import { t, locale, type MessageKey } from "$lib/i18n";
  import type { HoloSphere } from "holosphere";
  import { getFederationSnapshot } from "@holons/core/federation";
  import { REAEventStore } from "@holons/core/rea";
  import {
    STOCK_LENS,
    buildStockEvent,
    buildStockTransfer,
    correctionKind,
    createStockItemSpec,
    publishStockAggregate,
    readStockItemSpecs,
    stockItemId,
    syncReorderToShopping,
    updateStockItemSpec,
    type StockEventLike,
    type StockItemSpecRecord,
    type StockTransfer,
  } from "@holons/core/inventory";
  import { syncSurplusFromShelf } from "@holons/core/offers";
  import {
    buildStockBoard,
    filterReorder,
    filterShelf,
    fmtQty,
    groupShelf,
    historyOf,
    shelfRows,
    splitSpecs,
    type PartnerStock,
    type ShelfRow,
  } from "$lib/stock";
  import {
    mergeTap,
    stockItemFromSearch,
    stockItemUrl,
    withoutStockItem,
  } from "$lib/stocklink";
  import { segmentFor } from "$lib/dock";
  import Modal from "$lib/components/Modal.svelte";
  import VoiceButtons from "$lib/components/VoiceButtons.svelte";

  // ── Data ────────────────────────────────────────────────────────────────
  let hid: string | null = null;
  let hsRef: HoloSphere | null = null;
  let events: StockEventLike[] = [];
  let federated: string[] = [];
  let partners: PartnerStock[] = [];
  let loading = true;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let loadingFallbackTimer: ReturnType<typeof setTimeout> | null = null;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  onMount(() => {
    const unsub = holonId.subscribe((h) => {
      if (h !== hid) void bind(h);
    });
    return () => {
      unsub();
      teardown();
      rotationHold.set(false);
    };
  });

  function teardown() {
    void flushTaps();
    hid = null;
    hsRef = null;
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    if (loadingFallbackTimer) clearTimeout(loadingFallbackTimer);
    loadingFallbackTimer = null;
  }

  async function bind(holon: string | null) {
    teardown();
    hid = holon;
    events = [];
    federated = [];
    partners = [];
    loading = true;
    if (!holon) {
      loading = false;
      return;
    }
    loadingFallbackTimer = setTimeout(() => {
      loading = false;
    }, 9000);
    let hs: HoloSphere;
    try {
      hs = await getHolosphere();
    } catch (err) {
      console.error("[kiosk] stock: failed to connect", err);
      loading = false;
      return;
    }
    if (hid !== holon) return;
    hsRef = hs;
    void refreshEvents(hs, holon);
    void loadFederation(hs, holon);
    refreshTimer = setInterval(() => {
      if (hid !== holon) return;
      void readEvents(hs, holon);
      void loadPartnerEvents(hs, holon);
    }, 30_000);
  }

  /** One read of our REA events; empty is a real answer once the retries are done. */
  async function readEvents(hs: HoloSphere, holon: string): Promise<boolean> {
    try {
      const all = (await hs.getAll(holon, "rea_events")) as StockEventLike[];
      if (hid !== holon) return false;
      if (Array.isArray(all) && all.length) {
        events = all;
        return true;
      }
    } catch (err) {
      console.error("[kiosk] stock: failed to read rea_events", err);
    }
    return false;
  }

  async function refreshEvents(hs: HoloSphere, holon: string) {
    let found = false;
    for (const delay of [0, 600, 1500, 3000]) {
      if (delay) await sleep(delay);
      if (hid !== holon) return;
      if ((found = await readEvents(hs, holon))) break;
    }
    if (hid !== holon) return;
    loading = false;
    if (found) catchUpSurplus(hs, holon);
  }

  /**
   * A shelf filled elsewhere (MCP, Telegram, the web) or before the offers
   * existed has no kiosk write behind it to sync from, and the Offers tab
   * only appears once the holon has an offer of its own — so the shelf
   * lists its surplus on open. Grow-only: a cold read never pulls an offer;
   * idempotent: in step already, it writes nothing. Needs someone to sign as.
   */
  function catchUpSurplus(hs: HoloSphere, holon: string) {
    const user = get(currentUser);
    if (!user) return;
    void syncSurplusFromShelf(hs, holon, {
      initiator: {
        id: user.id,
        username: user.username ?? String(user.id),
        firstName: user.first_name,
        lastName: user.last_name,
      },
      growOnly: true,
    }).then((out) => {
      if (out.errors.length)
        console.warn("[kiosk] stock: surplus catch-up", out.errors);
    });
  }

  /** Partners: their shelves are public to the federation, so read them directly. */
  async function loadFederation(hs: HoloSphere, holon: string) {
    try {
      const snapshot = await getFederationSnapshot(hs, holon);
      if (hid !== holon) return;
      federated = snapshot.federated ?? [];
      if (Object.keys(snapshot.partnerNames ?? {}).length)
        partnerNames.update((m) => ({ ...snapshot.partnerNames, ...m }));
    } catch (err) {
      console.warn("[kiosk] stock: federation load failed", err);
    }
    await loadPartnerEvents(hs, holon);
  }

  async function loadPartnerEvents(hs: HoloSphere, holon: string) {
    const ids = federated.filter((id) => id && id !== holon);
    const next = await Promise.all(
      ids.map(async (id): Promise<PartnerStock> => {
        let evs: StockEventLike[] = [];
        let specs: StockItemSpecRecord[] = [];
        let fed: string[] = [];
        try {
          evs = ((await hs.getAll(id, "rea_events")) ?? []) as StockEventLike[];
        } catch (err) {
          console.warn("[kiosk] stock: partner events failed", id, err);
        }
        // Their specs, read straight from their lens: stock is public to
        // the federation, and the federated copy of the lens may lag or be
        // switched off on this screen.
        try {
          specs = readStockItemSpecs(
            ((await hs.getAll(id, STOCK_LENS)) ?? []) as unknown[],
          );
        } catch (err) {
          console.warn("[kiosk] stock: partner specs failed", id, err);
        }
        try {
          fed = (await getFederationSnapshot(hs, id)).federated ?? [];
        } catch {
          fed = [holon];
        }
        return { id, name: "", specs, events: evs, federated: fed };
      }),
    );
    if (hid !== holon) return;
    partners = next;
  }

  // ── Derivations ─────────────────────────────────────────────────────────
  $: sets = splitSpecs($rawStock);
  $: needs = $rawQuests.filter((q) => (q as { type?: string }).type === "need");
  $: partnersWithSpecs = partners.map((p) => ({
    ...p,
    name: $partnerNames[p.id] ?? p.id,
    specs: p.specs.length ? p.specs : (sets.partners[p.id] ?? []),
  }));
  $: board = hid
    ? buildStockBoard({
        holonId: hid,
        specs: sets.own,
        events,
        needs,
        federated,
        partners: partnersWithSpecs,
      })
    : null;
  $: rows = board ? shelfRows(sets.own, board.levels) : [];
  // The header search bar narrows the shelf by item name and/or category
  // (every term must hit); `rows` stays the full shelf so a deep link or an
  // open card is never hidden by whatever was typed.
  $: shelf = filterShelf(rows, $searchQuery);
  $: groups = groupShelf(shelf);
  $: reorder = board ? filterReorder(board.reorder, $searchQuery) : [];
  $: filtering = $searchQuery.trim().length > 0;
  // Partner shelves come along only in the networked scope, like every board.
  $: partnerShelves =
    $scope === "networked" && board
      ? partnersWithSpecs
          .map((p) => ({
            id: p.id,
            name: p.name,
            rows: filterShelf(
              shelfRows(p.specs, board!.partnerLevels[p.id] ?? []),
              $searchQuery,
            ),
          }))
          .filter((p) => p.rows.length)
      : [];
  $: hasTargets = sets.own.some((s) => (s.target ?? 0) > 0);
  $: nameOf = (id: string) =>
    id === hid ? $t("stock.here") : ($partnerNames[id] ?? id);

  $: rotationHold.set(
    openItemId != null ||
      formOpen ||
      confirmDelete ||
      moveOpen != null ||
      Object.keys(taps).length > 0,
  );

  /**
   * After a write, push the holon's per-category totals to its home hex
   * cell (and up the parents) so the map can sum stock at any zoom. Fires
   * only from a write, never from a read, and never blocks the UI.
   */
  function publishTotals(holon: string) {
    const hs = hsRef;
    if (!hs || !board) return;
    const levels = board.levels;
    const specs = sets.own;
    void publishStockAggregate(hs, { holonId: holon, levels, specs }).catch(
      (err) => console.warn("[kiosk] stock: cell publish failed", err),
    );
    // The shelf's surplus is a standing offer (@holons/core/offers):
    // automatic, with a per-holon switch on the Offers board.
    const user = get(currentUser);
    if (!user) return;
    void syncSurplusFromShelf(hs, holon, {
      initiator: {
        id: user.id,
        username: user.username ?? String(user.id),
        firstName: user.first_name,
        lastName: user.last_name,
      },
    }).then((out) => {
      if (out.errors.length)
        console.warn("[kiosk] stock: surplus sync", out.errors);
    });
  }

  // ── Login gate ──────────────────────────────────────────────────────────
  function requireUser() {
    if (get(currentUser)) return true;
    loginOpen.set(true);
    return false;
  }
  const isDenied = (err: unknown) => {
    const e = err as { name?: string; message?: string } | null;
    return (
      e?.name === "AuthorizationError" ||
      /denied|unauthori[sz]ed|permission/i.test(String(e?.message ?? ""))
    );
  };
  function fail(err: unknown, key: MessageKey) {
    console.error("[kiosk] stock:", err);
    showNotice($t(isDenied(err) ? "stock.denied" : key));
  }

  // ── Item form (add / edit) ──────────────────────────────────────────────
  const UNITS: { id: string; key: MessageKey }[] = [
    { id: "one", key: "stock.unit.one" },
    { id: "kg", key: "stock.unit.kg" },
    { id: "l", key: "stock.unit.l" },
    { id: "m", key: "stock.unit.m" },
    { id: "pack", key: "stock.unit.pack" },
  ];
  let formOpen = false;
  let editing: StockItemSpecRecord | null = null;
  let fName = "";
  let fCategory = "";
  let fUnit = "one";
  let fTarget: string | number = "";
  let fMin: string | number = "";
  let saving = false;

  function openAdd() {
    if (!requireUser()) return;
    editing = null;
    fName = "";
    fCategory = "";
    fUnit = "one";
    fTarget = "";
    fMin = "";
    formOpen = true;
  }
  function openEdit(spec: StockItemSpecRecord) {
    if (!requireUser()) return;
    editing = spec;
    fName = spec.name;
    fCategory = spec.category === "general" ? "" : spec.category;
    fUnit = spec.unit;
    fTarget = spec.target != null ? String(spec.target) : "";
    fMin = spec.min != null ? String(spec.min) : "";
    formOpen = true;
  }
  // Number inputs bind a number (or null when cleared); text ones a string.
  const num = (raw: string | number | null | undefined): number | null => {
    if (raw == null) return null;
    const text = String(raw).trim().replace(",", ".");
    if (text === "") return null;
    const v = Number(text);
    return Number.isFinite(v) && v >= 0 ? v : null;
  };

  async function saveSpec() {
    const holon = hid;
    const user = get(currentUser);
    if (!holon || !user || !fName.trim()) return;
    saving = true;
    try {
      const store = await getLensStore();
      let record: StockItemSpecRecord;
      if (editing) {
        record = updateStockItemSpec(editing, {
          name: fName,
          category: fCategory,
          unit: fUnit,
          target: num(fTarget),
          min: num(fMin),
        });
      } else {
        const id = stockItemId(fName);
        if (sets.own.some((s) => s.id === id)) {
          showNotice($t("stock.nameTaken"));
          return;
        }
        record = createStockItemSpec({
          name: fName,
          category: fCategory,
          unit: fUnit,
          target: num(fTarget) ?? undefined,
          min: num(fMin) ?? undefined,
          createdBy: user.id,
        });
      }
      await store.put(holon, STOCK_LENS, record);
      // Optimistic: the lens echo follows, but the row should not blink in late.
      rawStock.update((items) => [
        ...items.filter(
          (r) =>
            (r as { id?: string; _federation?: unknown })?.id !== record.id ||
            (r as { _federation?: { origin?: string } })?._federation?.origin,
        ),
        record,
      ]);
      formOpen = false;
      if (editing && openItemId === editing.id) openItemId = record.id;
      // Keep-back (min / target) moved: the auto offers follow the spec too.
      await tick();
      publishTotals(holon);
    } catch (err) {
      fail(err, "stock.saveFailed");
    } finally {
      saving = false;
    }
  }

  let confirmDelete = false;
  async function deleteSpec(spec: StockItemSpecRecord) {
    const holon = hid;
    if (!holon || !requireUser()) return;
    saving = true;
    try {
      const store = await getLensStore();
      await store.delete(holon, STOCK_LENS, spec.id);
      rawStock.update((items) =>
        items.filter(
          (r) =>
            (r as { id?: string })?.id !== spec.id ||
            (r as { _federation?: { origin?: string } })?._federation?.origin,
        ),
      );
      confirmDelete = false;
      openItemId = null;
      // The item left the shelf: its auto offer is withdrawn with it.
      await tick();
      publishTotals(holon);
    } catch (err) {
      fail(err, "stock.deleteFailed");
    } finally {
      saving = false;
    }
  }

  // ── Item sheet + movements ──────────────────────────────────────────────
  let openItemId: string | null = null;
  $: openRow = rows.find((r) => r.spec.id === openItemId) ?? null;

  // A deep link (`/<holon>/stock?item=<id>`) opens the card as soon as the
  // shelf knows the item; the pointer is honoured once per boot and dropped
  // from the address bar when the card closes, so a reload shows the shelf.
  let linkedItem: string | null =
    typeof location !== "undefined"
      ? stockItemFromSearch(location.search)
      : null;
  $: if (linkedItem && rows.some((r) => r.spec.id === linkedItem)) {
    openItemId = linkedItem;
    linkedItem = null;
  }
  function closeSheet() {
    openItemId = null;
    moveOpen = null;
    confirmDelete = false;
    if (
      typeof location === "undefined" ||
      !stockItemFromSearch(location.search)
    )
      return;
    try {
      window.history.replaceState(
        window.history.state,
        "",
        location.pathname + withoutStockItem(location.search) + location.hash,
      );
    } catch {
      /* the address bar is cosmetic here */
    }
  }

  /** The shareable link to this item's card, from wherever the board is served. */
  const linkFor = (itemId: string) =>
    hid ? stockItemUrl(location.origin, segmentFor(hid), itemId) : "";
  let copied = false;
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  async function copyLink(itemId: string) {
    const url = linkFor(itemId);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 1800);
    } catch {
      showNotice($t("clipboard.writeFailed"));
    }
  }

  // ── Quick taps: − / + one unit ──────────────────────────────────────────
  // Every tap moves the shown level at once; the event is written when the
  // taps go quiet (or the view leaves), one ±n movement per burst. The
  // pending delta per item is what the row shows on top of the folded level.
  const TAP_QUIET_MS = 900;
  let taps: Record<string, number> = {};
  let tapTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  $: shown = (row: ShelfRow) => row.onhand + (taps[row.spec.id] ?? 0);

  function tap(row: ShelfRow, delta: 1 | -1) {
    if (!requireUser()) return;
    const id = row.spec.id;
    taps = { ...taps, [id]: mergeTap(taps[id] ?? 0, delta, row.onhand) };
    if (tapTimers[id]) clearTimeout(tapTimers[id]);
    tapTimers[id] = setTimeout(() => void flushTap(id), TAP_QUIET_MS);
  }

  async function flushTap(id: string) {
    if (tapTimers[id]) clearTimeout(tapTimers[id]);
    delete tapTimers[id];
    const delta = taps[id] ?? 0;
    const holon = hid;
    const user = get(currentUser);
    const row = rows.find((r) => r.spec.id === id);
    if (!holon || !user || !row) {
      const { [id]: _drop, ...rest } = taps;
      taps = rest;
      return;
    }
    if (Math.abs(delta) < 0.0005) {
      const { [id]: _drop, ...rest } = taps;
      taps = rest;
      return;
    }
    try {
      const event = buildStockEvent({
        holonId: holon,
        kind: delta > 0 ? "stock:produced" : "stock:consumed",
        itemId: id,
        quantity: Math.abs(delta),
        unit: row.spec.unit,
        actor: user,
        note: null,
      });
      const store = await getReaStore();
      await new REAEventStore(store as never).put(holon, event);
      if (hid !== holon) return;
      // The fold now carries the movement; the optimistic offset steps aside
      // in the same tick so the number does not jump twice.
      events = [...events, event];
      const { [id]: _drop, ...rest } = taps;
      taps = rest;
      showNotice($t("stock.recorded"));
      await tick();
      publishTotals(holon);
    } catch (err) {
      const { [id]: _drop, ...rest } = taps;
      taps = rest;
      fail(err, "stock.recordFailed");
    }
  }

  async function flushTaps() {
    await Promise.all(Object.keys(tapTimers).map((id) => flushTap(id)));
  }
  $: history = openRow && hid ? historyOf(events, hid, openRow.spec.id) : [];

  type MoveKind = "use" | "add" | "count";
  let moveOpen: MoveKind | null = null;
  let mQty: string | number = "";
  let mNote = "";
  let recording = false;

  function openMove(kind: MoveKind) {
    if (!requireUser()) return;
    moveOpen = kind;
    mQty = kind === "count" && openRow ? String(openRow.onhand) : "";
    mNote = "";
  }

  const MOVE_LEAD: Record<MoveKind, MessageKey> = {
    use: "stock.useLead",
    add: "stock.addQtyLead",
    count: "stock.countLead",
  };

  async function recordMove() {
    const holon = hid;
    const user = get(currentUser);
    const row = openRow;
    const kind = moveOpen;
    if (!holon || !user || !row || !kind) return;
    const q = num(mQty);
    if (q == null) return;
    let eventKind:
      | "stock:produced"
      | "stock:consumed"
      | "stock:raised"
      | "stock:lowered";
    let quantity = q;
    if (kind === "add") eventKind = "stock:produced";
    else if (kind === "use") eventKind = "stock:consumed";
    else {
      const delta = q - row.onhand;
      if (Math.abs(delta) < 0.0005) {
        showNotice($t("stock.countSame"));
        moveOpen = null;
        return;
      }
      eventKind = correctionKind(delta);
      quantity = Math.abs(delta);
    }
    if (quantity <= 0) return;
    recording = true;
    try {
      const event = buildStockEvent({
        holonId: holon,
        kind: eventKind,
        itemId: row.spec.id,
        quantity,
        unit: row.spec.unit,
        actor: user,
        note: mNote.trim() || null,
      });
      const store = await getReaStore();
      await new REAEventStore(store as never).put(holon, event);
      if (hid !== holon) return;
      events = [...events, event];
      moveOpen = null;
      showNotice($t("stock.recorded"));
      await tick();
      publishTotals(holon);
      if (hsRef) {
        await sleep(1500);
        if (hid === holon) void readEvents(hsRef, holon);
      }
    } catch (err) {
      fail(err, "stock.recordFailed");
    } finally {
      recording = false;
    }
  }

  // ── Reorder → shopping list ─────────────────────────────────────────────
  let shopping = false;
  async function addToShopping() {
    const holon = hid;
    const user = get(currentUser);
    if (!holon || !board || !requireUser() || !user) return;
    shopping = true;
    try {
      const store = await getChecklistStore();
      const changed = await syncReorderToShopping(store, holon, board.reorder, {
        creator: user.id,
      });
      showNotice(
        changed
          ? $t("stock.shoppingUpdated", { n: changed })
          : $t("stock.shoppingSame"),
      );
    } catch (err) {
      fail(err, "stock.shoppingFailed");
    } finally {
      shopping = false;
    }
  }

  // ── Moves → record a transfer ───────────────────────────────────────────
  let transferring: string | null = null;
  const legKey = (leg: StockTransfer) =>
    `${leg.category}:${leg.from}:${leg.to}`;

  /** The item the leg is about: the sender's item in that category, by our name for it. */
  function itemForLeg(leg: StockTransfer): StockItemSpecRecord | null {
    const from = leg.from === hid ? sets.own : (sets.partners[leg.from] ?? []);
    const to = leg.to === hid ? sets.own : (sets.partners[leg.to] ?? []);
    const inCategory = (s: StockItemSpecRecord) => s.category === leg.category;
    return (
      to.find(inCategory) ??
      from.find(inCategory) ??
      sets.own.find(inCategory) ??
      null
    );
  }

  async function recordTransfer(leg: StockTransfer) {
    const holon = hid;
    const user = get(currentUser);
    if (!holon || !requireUser() || !user) return;
    const item = itemForLeg(leg);
    if (!item) return;
    transferring = legKey(leg);
    try {
      const event = buildStockTransfer({
        fromHolonId: leg.from,
        toHolonId: leg.to,
        itemId: item.id,
        quantity: leg.quantity,
        unit: item.unit,
        actor: user,
      });
      const store = new REAEventStore((await getReaStore()) as never);
      // Our side first — that is the shelf we answer for.
      await store.put(holon, event);
      const other = leg.from === holon ? leg.to : leg.from;
      let both = true;
      try {
        await store.put(other, event);
      } catch (err) {
        console.warn("[kiosk] stock: partner side refused the transfer", err);
        both = false;
      }
      if (hid !== holon) return;
      events = [...events, event];
      partners = partners.map((p) =>
        p.id === other && both ? { ...p, events: [...p.events, event] } : p,
      );
      showNotice($t(both ? "stock.transferRecorded" : "stock.transferHalf"));
      await tick();
      publishTotals(holon);
    } catch (err) {
      fail(err, "stock.transferFailed");
    } finally {
      transferring = null;
    }
  }

  // ── Presentation helpers ────────────────────────────────────────────────
  const STATUS_KEY: Record<ShelfRow["status"], MessageKey> = {
    empty: "stock.status.empty",
    low: "stock.status.low",
    ok: "stock.status.ok",
  };
  const KIND_KEY: Record<string, MessageKey> = {
    "stock:produced": "stock.kind.produced",
    "stock:consumed": "stock.kind.consumed",
    "stock:raised": "stock.kind.raised",
    "stock:lowered": "stock.kind.lowered",
    "stock:transferred": "stock.kind.transferred",
  };
  function when(at: number, loc: string): string {
    if (!at) return "";
    return new Date(at).toLocaleString(loc, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  const signed = (n: number, unit: string) =>
    `${n > 0 ? "+" : "−"}${fmtQty(Math.abs(n), unit)}`;
  function onKey(e: KeyboardEvent, fn: () => void) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  }
</script>

<div class="board">
  <div class="stock scroll">
    {#if loading && !sets.own.length}
      <p class="empty">{$t("stock.reading")}</p>
    {:else if $stockViewMode === "reorder"}
      {#if !board || !board.reorder.length}
        <p class="empty">
          {$t(hasTargets ? "stock.reorderEmpty" : "stock.reorderNoTargets")}
        </p>
      {:else if !reorder.length}
        <p class="empty">{$t("stock.noMatch", { q: $searchQuery.trim() })}</p>
      {:else}
        <ul class="rows">
          {#each reorder as line (line.itemId)}
            <li class="row plain">
              <div class="text">
                <h3>{line.name}</h3>
                <div class="meta">
                  <span class="rtype">{line.category}</span>
                  <span class="basis"
                    >{$t("stock.basis", {
                      target: fmtQty(line.basis.target, line.unit),
                      onhand: fmtQty(line.basis.onhand, line.unit),
                      incoming: fmtQty(line.basis.incoming, line.unit),
                      reserved: fmtQty(line.basis.reserved, line.unit),
                    })}</span
                  >
                </div>
              </div>
              <span class="status buy"
                >{$t("stock.buy", {
                  q: fmtQty(line.quantity, line.unit),
                })}</span
              >
            </li>
          {/each}
        </ul>
        <div class="actions center">
          <button class="primary" on:click={addToShopping} disabled={shopping}
            >{shopping
              ? $t("stock.toShoppingBusy")
              : $t("stock.toShopping")}</button
          >
        </div>
      {/if}
    {:else if $stockViewMode === "moves"}
      {#if board && board.scarcity.some((s) => s.shortage > 0)}
        <h2 class="section">{$t("stock.shortages")}</h2>
        <ul class="rows">
          {#each board.scarcity.filter((s) => s.shortage > 0) as s (s.category)}
            <li class="row plain">
              <div class="text">
                <h3>{s.category}</h3>
                <div class="meta">
                  <span class="basis"
                    >{$t("stock.blocked", {
                      pct: Math.round(s.blocked * 100),
                    })}</span
                  >
                </div>
              </div>
              <span class="status short"
                >{$t("stock.shortage", { q: fmtQty(s.shortage, "") })}</span
              >
            </li>
          {/each}
        </ul>
      {/if}
      <h2 class="section">{$t("stock.plan")}</h2>
      {#if !federated.length}
        <p class="empty small">{$t("stock.noPartners")}</p>
      {:else if !board || !board.plan.length}
        <p class="empty small">{$t("stock.planEmpty")}</p>
      {:else}
        <ul class="rows">
          {#each board.plan as leg (legKey(leg))}
            {@const item = itemForLeg(leg)}
            <li class="row plain">
              <div class="text">
                <h3>
                  {leg.to === hid
                    ? $t("stock.legTo", { from: nameOf(leg.from) })
                    : leg.from === hid
                      ? $t("stock.legFrom", { to: nameOf(leg.to) })
                      : $t("stock.legOther", {
                          from: nameOf(leg.from),
                          to: nameOf(leg.to),
                        })}
                </h3>
                <div class="meta">
                  <span class="rtype">{leg.category}</span>
                  <span class="basis">{$t("stock.hops", { n: leg.cost })}</span>
                </div>
              </div>
              <span class="qty">{fmtQty(leg.quantity, item?.unit ?? "")}</span>
              {#if item && (leg.to === hid || leg.from === hid)}
                <button
                  class="chip"
                  on:click={() => recordTransfer(leg)}
                  disabled={transferring === legKey(leg)}
                  >{leg.to === hid
                    ? $t("stock.recordReceived")
                    : $t("stock.recordSent")}</button
                >
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
      {#if board && board.positions.length}
        <h2 class="section">{$t("stock.positions")}</h2>
        <ul class="rows">
          {#each board.positions as p (p.holonId + ":" + p.category)}
            <li class="row plain">
              <div class="text">
                <h3>{nameOf(p.holonId)}</h3>
                <div class="meta"><span class="rtype">{p.category}</span></div>
              </div>
              {#if p.surplus > 0}
                <span class="status available"
                  >{$t("stock.surplus", { q: fmtQty(p.surplus, "") })}</span
                >
              {/if}
              {#if p.deficit > 0}
                <span class="status short"
                  >{$t("stock.deficit", { q: fmtQty(p.deficit, "") })}</span
                >
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {:else if !rows.length && !partnerShelves.length && !filtering}
      <div class="empty">
        <p>{$t("stock.emptyShelf")}</p>
        <p class="lead">{$t("stock.emptyShelfLead")}</p>
      </div>
    {:else if !shelf.length && !partnerShelves.length}
      <p class="empty">{$t("stock.noMatch", { q: $searchQuery.trim() })}</p>
    {:else}
      {#each groups as group (group.category)}
        <h2 class="section">{group.category}</h2>
        <ul class="rows">
          {#each group.rows as row (row.spec.id)}
            <li>
              <div
                class="row"
                class:out={row.status === "empty"}
                role="button"
                tabindex="0"
                on:click={() => (openItemId = row.spec.id)}
                on:keydown={(e) => onKey(e, () => (openItemId = row.spec.id))}
              >
                <div class="text">
                  <h3>{row.spec.name}</h3>
                  <div class="meta">
                    {#if row.spec.target}
                      <span class="basis"
                        >{$t("stock.targetLine", {
                          q: fmtQty(row.spec.target, row.spec.unit),
                        })}</span
                      >
                    {/if}
                    {#if row.incoming > 0}
                      <span class="basis in"
                        >{$t("stock.incoming", {
                          q: fmtQty(row.incoming, row.spec.unit),
                        })}</span
                      >
                    {/if}
                  </div>
                  <div class="bar" aria-hidden="true">
                    <span
                      class="fill st-{row.status}"
                      style="width: {Math.round(row.fill * 100)}%"
                    ></span>
                  </div>
                </div>
                <div class="stepper" class:live={taps[row.spec.id] != null}>
                  <button
                    class="step"
                    aria-label={$t("stock.minusOne", { name: row.spec.name })}
                    disabled={shown(row) <= 0}
                    on:click|stopPropagation={() => tap(row, -1)}
                    on:keydown|stopPropagation>−</button
                  >
                  <span class="qty">{fmtQty(shown(row), row.spec.unit)}</span>
                  <button
                    class="step"
                    aria-label={$t("stock.plusOne", { name: row.spec.name })}
                    on:click|stopPropagation={() => tap(row, 1)}
                    on:keydown|stopPropagation>+</button
                  >
                </div>
                <span class="status st-{row.status}"
                  >{$t(STATUS_KEY[row.status])}</span
                >
              </div>
            </li>
          {/each}
        </ul>
      {/each}
      {#each partnerShelves as shelf (shelf.id)}
        <h2 class="section partner">
          {$t("stock.partnerShelf", { name: shelf.name })}
        </h2>
        <ul class="rows">
          {#each shelf.rows as row (row.spec.id)}
            <li class="row plain is-foreign">
              <div class="text">
                <h3>{row.spec.name}</h3>
                <div class="meta">
                  <span class="rtype">{row.spec.category}</span>
                </div>
              </div>
              <span class="qty">{fmtQty(row.onhand, row.spec.unit)}</span>
            </li>
          {/each}
        </ul>
      {/each}
    {/if}
  </div>

  {#if $stockViewMode === "shelf"}
    <div class="fabrow">
      <VoiceButtons />
      <button
        class="fab"
        on:click={openAdd}
        aria-label={$t("stock.addItem")}
        title={$t("stock.addItem")}
      >
        ＋
      </button>
    </div>
  {/if}
</div>

{#if openRow}
  {@const row = openRow}
  <Modal on:close={closeSheet}>
    <div class="sheet">
      <div class="head">
        <div>
          <h3>{row.spec.name}</h3>
          <span class="rtype">{row.spec.category}</span>
        </div>
        <div class="tools">
          <button
            class="icon-btn"
            class:done={copied}
            aria-label={$t("stock.copyLink")}
            title={$t(copied ? "stock.linkCopied" : "stock.copyLink")}
            on:click={() => copyLink(row.spec.id)}>{copied ? "✓" : "⛓"}</button
          >
          <button
            class="icon-btn"
            aria-label={$t("stock.editItem")}
            title={$t("stock.editItem")}
            on:click={() => openEdit(row.spec)}>✎</button
          >
        </div>
      </div>
      <div class="level">
        <button
          class="step big-step"
          aria-label={$t("stock.minusOne", { name: row.spec.name })}
          disabled={shown(row) <= 0}
          on:click={() => tap(row, -1)}>−</button
        >
        <div class="reading">
          <span class="big" class:live={taps[row.spec.id] != null}
            >{fmtQty(shown(row), row.spec.unit)}</span
          >
          <span class="status st-{row.status}"
            >{$t(STATUS_KEY[row.status])}</span
          >
        </div>
        <button
          class="step big-step"
          aria-label={$t("stock.plusOne", { name: row.spec.name })}
          on:click={() => tap(row, 1)}>+</button
        >
      </div>
      <ul class="facts">
        {#if row.inFlight && row.level}
          <li>
            {$t("stock.confirmedPending", {
              confirmed: fmtQty(row.level.confirmed, row.spec.unit),
              pending: fmtQty(row.level.pending, row.spec.unit),
            })}
          </li>
        {/if}
        {#if row.incoming > 0}
          <li>
            {$t("stock.incoming", { q: fmtQty(row.incoming, row.spec.unit) })}
          </li>
        {/if}
        {#if row.level && row.level.reserved > 0}
          <li>
            {$t("stock.reserved", {
              q: fmtQty(row.level.reserved, row.spec.unit),
            })}
          </li>
        {/if}
        {#if row.spec.target}
          <li>
            {$t("stock.targetLine", {
              q: fmtQty(row.spec.target, row.spec.unit),
            })}
          </li>
        {/if}
        {#if row.spec.min}
          <li>
            {$t("stock.minLine", { q: fmtQty(row.spec.min, row.spec.unit) })}
          </li>
        {/if}
      </ul>

      {#if moveOpen}
        <div class="move">
          <p class="lead">{$t(MOVE_LEAD[moveOpen])}</p>
          <div class="qtyrow">
            <input
              class="line"
              type="number"
              inputmode="decimal"
              min="0"
              step="any"
              bind:value={mQty}
              placeholder={$t("stock.quantity")}
              on:keydown={(e) => e.key === "Enter" && recordMove()}
            />
            <span class="unit"
              >{$t(
                UNITS.find((u) => u.id === row.spec.unit)?.key ??
                  "stock.unit.one",
              )}</span
            >
          </div>
          <input
            class="line"
            bind:value={mNote}
            placeholder={$t("stock.notePlaceholder")}
            maxlength="120"
          />
          <div class="actions">
            <button
              class="primary"
              on:click={recordMove}
              disabled={recording || num(mQty) == null}
              >{recording ? $t("stock.recording") : $t("stock.record")}</button
            >
            <button class="ghost" on:click={() => (moveOpen = null)}
              >{$t("common.cancel")}</button
            >
          </div>
        </div>
      {:else}
        <div class="moves">
          <button class="mv" on:click={() => openMove("use")}
            ><span class="g">−</span>{$t("stock.use")}</button
          >
          <button class="mv" on:click={() => openMove("add")}
            ><span class="g">+</span>{$t("stock.add")}</button
          >
          <button class="mv" on:click={() => openMove("count")}
            ><span class="g">≡</span>{$t("stock.count")}</button
          >
        </div>
      {/if}

      <h4>{$t("stock.history")}</h4>
      {#if !history.length}
        <p class="none">{$t("stock.noHistory")}</p>
      {:else}
        <ul class="hist">
          {#each history.slice(0, 30) as line (line.id)}
            <li class:pending={line.pending}>
              <span class="delta" class:neg={line.delta < 0}
                >{signed(line.delta, line.unit)}</span
              >
              <span class="what"
                >{$t(KIND_KEY[line.kind] ?? "stock.kind.transferred")}{line.who
                  ? ` · ${line.who}`
                  : ""}{line.pending ? ` · ${$t("stock.pending")}` : ""}</span
              >
              <span class="at">{when(line.at, $locale)}</span>
              {#if line.note}<span class="note">{line.note}</span>{/if}
            </li>
          {/each}
        </ul>
      {/if}

      {#if confirmDelete}
        <p class="lead">{$t("stock.deleteConfirm", { name: row.spec.name })}</p>
        <div class="actions">
          <button
            class="danger"
            disabled={saving}
            on:click={() => deleteSpec(row.spec)}>{$t("stock.delete")}</button
          >
          <button class="ghost" on:click={() => (confirmDelete = false)}
            >{$t("common.cancel")}</button
          >
        </div>
      {:else}
        <button class="linkish" on:click={() => (confirmDelete = true)}
          >{$t("stock.delete")}</button
        >
      {/if}
    </div>
  </Modal>
{/if}

{#if formOpen}
  <Modal on:close={() => (formOpen = false)}>
    <div class="form">
      <div class="glyph" aria-hidden="true">{editing ? "✎" : "＋"}</div>
      <h3>{$t(editing ? "stock.editItem" : "stock.addItem")}</h3>
      {#if !editing}<p class="lead">{$t("stock.addLead")}</p>{/if}
      <input
        class="line"
        bind:value={fName}
        placeholder={$t("stock.namePlaceholder")}
        maxlength="60"
      />
      <input
        class="line"
        bind:value={fCategory}
        placeholder={$t("stock.categoryPlaceholder")}
        maxlength="40"
      />
      <div class="types" role="radiogroup" aria-label={$t("stock.unit")}>
        {#each UNITS as u (u.id)}
          <button
            type="button"
            class="typechip"
            class:on={fUnit === u.id}
            role="radio"
            aria-checked={fUnit === u.id}
            on:click={() => (fUnit = u.id)}
          >
            <span class="tl">{$t(u.key)}</span>
          </button>
        {/each}
      </div>
      <label class="field">
        <span>{$t("stock.target")} <small>{$t("stock.targetHint")}</small></span
        >
        <input
          class="line"
          type="number"
          inputmode="decimal"
          min="0"
          step="any"
          bind:value={fTarget}
        />
      </label>
      <label class="field">
        <span>{$t("stock.min")} <small>{$t("stock.minHint")}</small></span>
        <input
          class="line"
          type="number"
          inputmode="decimal"
          min="0"
          step="any"
          bind:value={fMin}
        />
      </label>
      <div class="actions">
        <button
          class="primary"
          on:click={saveSpec}
          disabled={saving || !fName.trim()}
          >{saving ? $t("stock.saving") : $t("stock.save")}</button
        >
        <button class="ghost" on:click={() => (formOpen = false)}
          >{$t("common.cancel")}</button
        >
      </div>
    </div>
  </Modal>
{/if}

<style>
  .board {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .stock {
    flex: 1;
    min-height: 0;
    padding: 0.5rem 1.4rem 5.5rem;
    max-width: 52rem;
    width: 100%;
    margin: 0 auto;
  }
  .section {
    margin: 1rem 0 0.45rem;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .section.partner {
    color: var(--teal-deep);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    animation: kiosk-rise 0.42s ease both;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.65rem 0.8rem;
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 14px;
    box-shadow: var(--shadow-soft);
    cursor: pointer;
  }
  .row.plain {
    cursor: default;
  }
  .row:not(.plain):active {
    filter: brightness(0.97);
  }
  .row.out {
    opacity: 0.75;
  }
  .row.is-foreign {
    border-left: 4px solid var(--teal);
  }
  .row .text {
    flex: 1;
    min-width: 0;
  }
  .row h3 {
    margin: 0;
    font-size: 0.98rem;
    line-height: 1.3;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
    margin-top: 0.15rem;
  }
  .rtype {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .basis {
    font-size: 0.72rem;
    color: var(--muted);
  }
  .basis.in {
    color: var(--teal-deep);
    font-weight: 700;
  }
  .bar {
    margin-top: 0.4rem;
    height: 5px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ink) 8%, transparent);
    overflow: hidden;
  }
  .bar .fill {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: var(--teal);
    transition: width 0.3s ease;
  }
  .bar .fill.st-low {
    background: #e0a13a;
  }
  .bar .fill.st-empty {
    background: transparent;
  }
  .qty {
    font-size: 1.15rem;
    font-weight: 800;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  /* − / + one unit, on the row and on the card. Big enough for a thumb. */
  .stepper {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .stepper .qty {
    min-width: 3.2ch;
    text-align: center;
    transition: color 0.2s ease;
  }
  .stepper.live .qty,
  .big.live {
    color: var(--teal-deep);
  }
  .step {
    width: 2.3rem;
    height: 2.3rem;
    border-radius: 50%;
    border: 1.5px solid var(--line);
    background: var(--card);
    color: var(--teal-deep);
    font-size: 1.25rem;
    font-weight: 800;
    line-height: 1;
    display: grid;
    place-items: center;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
  }
  .step:active:not(:disabled) {
    background: color-mix(in srgb, var(--teal) 14%, var(--card));
    transform: scale(0.94);
  }
  .step:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .big-step {
    width: 3.4rem;
    height: 3.4rem;
    font-size: 1.8rem;
    flex-shrink: 0;
  }
  .status {
    flex: 0 0 auto;
    white-space: nowrap;
    font-size: 0.76rem;
    font-weight: 700;
    color: var(--ink-soft);
    background: var(--note-coral);
    border-radius: 999px;
    padding: 0.15rem 0.7rem;
  }
  /* Tinted from the accent rather than the mint note: the note and the deep
     teal are both dark in the dark theme and the chip vanished. */
  .status.st-ok,
  .status.available {
    background: color-mix(in srgb, var(--teal) 22%, var(--card));
    color: var(--ink);
  }
  .status.st-low {
    background: var(--note-sun);
    color: var(--ink);
  }
  .status.buy {
    background: var(--note-sky);
    color: var(--ink);
  }
  .status.short {
    background: var(--note-coral);
  }
  .chip {
    flex: 0 0 auto;
    font-size: 0.78rem;
    font-weight: 700;
    color: #fff;
    background: var(--teal);
    border-radius: 999px;
    padding: 0.4rem 0.8rem;
  }
  .chip:disabled {
    opacity: 0.6;
  }
  .empty {
    color: var(--muted);
    text-align: center;
    padding: 3rem 1rem;
    font-size: 1.1rem;
  }
  .empty.small {
    padding: 1.2rem 1rem;
    font-size: 0.95rem;
  }
  .empty .lead {
    font-size: 0.9rem;
    margin: 0.4rem 0 0;
  }
  .empty p {
    margin: 0;
  }
  .actions {
    display: flex;
    gap: 0.6rem;
    margin-top: 1rem;
  }
  .actions.center {
    justify-content: center;
  }
  .primary,
  .ghost,
  .danger {
    flex: 1;
    min-height: 52px;
    border-radius: 14px;
    font-size: 1rem;
    font-weight: 700;
    transition: transform 0.1s ease;
  }
  .actions.center .primary {
    flex: 0 1 22rem;
  }
  .primary {
    background: var(--teal);
    color: #fff;
    box-shadow: var(--shadow-soft);
  }
  .ghost {
    background: rgba(255, 255, 255, 0.5);
    color: var(--ink);
  }
  .danger {
    background: var(--note-coral);
    color: var(--ink);
  }
  .primary:active,
  .ghost:active,
  .danger:active {
    transform: scale(0.97);
  }
  .primary:disabled,
  .ghost:disabled,
  .danger:disabled {
    opacity: 0.6;
  }

  /* FAB row, as on the Library. */
  .fabrow {
    position: absolute;
    right: 1.3rem;
    bottom: 1.3rem;
    display: flex;
    align-items: center;
    gap: 0.8rem;
    z-index: 6;
  }
  .fab {
    width: 3.4rem;
    height: 3.4rem;
    border-radius: 50%;
    font-size: 2rem;
    line-height: 1;
    color: #fff;
    background: var(--teal);
    box-shadow: 0 10px 24px rgba(14, 107, 102, 0.4);
    display: grid;
    place-items: center;
    transition:
      transform 0.12s ease,
      background 0.15s ease;
  }
  .fab:active {
    transform: scale(0.92);
    background: var(--teal-deep);
  }

  /* Item sheet */
  .sheet {
    padding: 0.2rem 0.1rem;
  }
  .sheet .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.6rem;
  }
  .sheet h3 {
    margin: 0;
    font-size: 1.35rem;
    color: var(--ink);
  }
  .icon-btn {
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 50%;
    background: var(--card);
    border: 1.5px solid var(--line);
    font-size: 1.1rem;
    color: var(--teal-deep);
  }
  .level {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    margin: 0.7rem 0 0.3rem;
  }
  .level .reading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    flex: 1;
    min-width: 0;
  }
  .sheet .tools {
    display: flex;
    gap: 0.4rem;
    flex-shrink: 0;
    /* Clear the modal's own ✕ (44px, top-right corner). */
    margin-right: 2.4rem;
  }
  .icon-btn.done {
    color: var(--teal);
  }
  .level .big {
    font-size: 2.2rem;
    font-weight: 800;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .facts {
    list-style: none;
    margin: 0 0 0.6rem;
    padding: 0;
    color: var(--muted);
    font-size: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .moves {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
    margin: 0.4rem 0 0.8rem;
  }
  .mv {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    padding: 0.6rem 0.3rem;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--card);
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--ink);
  }
  .mv .g {
    font-size: 1.4rem;
    line-height: 1;
    color: var(--teal-deep);
  }
  .mv:active {
    transform: scale(0.96);
  }
  .move .lead,
  .sheet .lead {
    color: var(--muted);
    margin: 0.3rem 0 0.5rem;
    font-size: 0.9rem;
  }
  .qtyrow {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .qtyrow .line {
    flex: 1;
  }
  .qtyrow .unit {
    color: var(--muted);
    font-weight: 700;
    font-size: 0.85rem;
  }
  .sheet h4 {
    margin: 0.6rem 0 0.3rem;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .none {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 0;
  }
  .hist {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 12rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
  }
  .hist li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.5rem;
    align-items: baseline;
    padding: 0.3rem 0.1rem;
    border-bottom: 1px solid var(--line);
  }
  .hist li.pending {
    opacity: 0.65;
  }
  .hist .delta {
    font-weight: 800;
    color: var(--teal-deep);
    font-variant-numeric: tabular-nums;
  }
  .hist .delta.neg {
    color: #b8452e;
  }
  .hist .what {
    color: var(--ink);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hist .at {
    color: var(--muted);
    font-size: 0.75rem;
    white-space: nowrap;
  }
  .hist .note {
    grid-column: 2 / -1;
    color: var(--muted);
    font-size: 0.78rem;
  }
  .linkish {
    margin-top: 0.8rem;
    background: none;
    color: var(--muted);
    font-size: 0.8rem;
    text-decoration: underline;
  }

  /* Add / edit dialog (mirrors the Library's). */
  .form {
    text-align: center;
    padding: 0.4rem 0.25rem;
  }
  .form .glyph {
    font-size: 1.8rem;
    color: var(--teal);
    font-weight: 800;
  }
  .form h3 {
    margin: 0.2rem 0 0.3rem;
    font-size: 1.3rem;
    color: var(--ink);
  }
  .form .lead {
    color: var(--muted);
    margin: 0 0 0.8rem;
    font-size: 0.9rem;
  }
  .line {
    width: 100%;
    padding: 0.8rem 0.9rem;
    font-size: 1rem;
    font-family: inherit;
    line-height: 1.5;
    color: var(--ink);
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 14px;
    margin-bottom: 0.6rem;
  }
  .line:focus {
    outline: none;
    border-color: var(--teal);
  }
  .types {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.4rem;
    margin-bottom: 0.6rem;
  }
  .typechip {
    padding: 0.55rem 0.2rem;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--card);
  }
  .typechip .tl {
    font-size: 0.66rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .typechip.on {
    border-color: var(--teal);
    background: color-mix(in srgb, var(--teal) 12%, var(--card));
  }
  .typechip.on .tl {
    color: var(--teal-deep);
  }
  .field {
    display: block;
    text-align: left;
    margin-bottom: 0.2rem;
  }
  .field > span {
    display: block;
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--ink);
    margin: 0 0 0.25rem 0.2rem;
  }
  .field small {
    font-weight: 400;
    color: var(--muted);
  }
</style>
