<script lang="ts">
  // SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Stock — what this holon keeps, in quantity. The dashboard twin of the
  // kiosk's Stock board, built the way the Flows board is: one column, one
  // pill to switch panels, cards a thumb can tap, sheets instead of tables.
  //
  //   SHELF    one row per item the holon keeps, grouped by category, with
  //            the level folded from REA stock events; tap a row for its
  //            story and to record a movement (use / add / count).
  //   REORDER  what to buy to bring every item back to its restock level;
  //            one tap writes it into the shared shopping checklist.
  //   MOVES    shortages against open needs, and the transfers the
  //            federation could make from partner surpluses, nearest
  //            partnership first (core's transport plan); a tap records one.
  //
  // Meaning lives in `@holons/core/inventory`; `$lib/stock` arranges it for
  // the screen. Data rules inherited from Flows: `rea_events` is read
  // one-shot with a retry backoff and a periodic refresh, never subscribed
  // (it is the holon's whole ledger); every await is followed by a
  // holon-identity check. The `stock` lens (item specs) is small and streams
  // in live, federation-aware, so a partner's shelf shows beside ours.
  import { onDestroy, onMount, getContext } from "svelte";
  import type { HoloSphere } from "holosphere";
  import { ID } from "../dashboard/store";
  import { telegramUser } from "$lib/stores/telegram";
  import { nostrPublicKey } from "$lib/stores/nostr";
  import { showFederated } from "$lib/stores/lensFilters";
  import { awaitName } from "$lib/stores/nameResolver";
  import { loadFilters, saveFilters } from "$lib/util/persistedFilters";
  import { notifyWriteDenied } from "$lib/stores/writeNotifications";
  import { getEventStore } from "$lib/rea/eventStore";
  import { getFederationSnapshot } from "@holons/core/federation";
  import type { ChecklistStore } from "@holons/core/checklists";
  import {
    STOCK_LENS,
    buildStockEvent,
    buildStockTransfer,
    correctionKind,
    createStockItemSpec,
    readStockItemSpecs,
    stockItemId,
    syncReorderToShopping,
    updateStockItemSpec,
    type StockActorLike,
    type StockEventLike,
    type StockItemSpecRecord,
    type StockTransfer,
  } from "@holons/core/inventory";
  import {
    buildStockBoard,
    fmtQty,
    groupShelf,
    historyOf,
    normalizeLens,
    shelfRows,
    splitSpecs,
    type PartnerStock,
    type ShelfRow,
  } from "$lib/stock";
  import PillSwitch from "./flows/PillSwitch.svelte";
  import Sheet from "./flows/Sheet.svelte";

  const holosphere = getContext("holosphere") as HoloSphere;

  type Panel = "shelf" | "reorder" | "moves";
  const PANELS: { id: Panel; label: string; glyph: string }[] = [
    { id: "shelf", label: "Shelf", glyph: "▤" },
    { id: "reorder", label: "Reorder", glyph: "🛒" },
    { id: "moves", label: "Moves", glyph: "⇄" },
  ];

  // What the person last looked at, per device — a board remembers its tab.
  let prefs = loadFilters("stock", { panel: "shelf" });
  $: saveFilters("stock", prefs);
  $: panel = (PANELS.some((p) => p.id === prefs.panel) ? prefs.panel : "shelf") as Panel;

  // ── Data ────────────────────────────────────────────────────────────────
  let holonID = "";
  let loading = true;
  let rawStock: unknown[] = [];
  let needs: unknown[] = [];
  let events: StockEventLike[] = [];
  let federated: string[] = [];
  let partnerNames: Record<string, string> = {};
  let partners: PartnerStock[] = [];

  let stockSub: { unsubscribe: () => void; setFederated: (on: boolean) => void } | undefined;
  let questsSub: { unsubscribe: () => void } | undefined;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let loadingFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  const REFRESH_MS = 30_000;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  $: if ($ID && $ID !== holonID) void bind($ID);

  // Toggle partners in/out live on the existing subscription — no
  // re-subscribe, so our own rows never blink out while federation flips.
  let lastFedFlag = $showFederated;
  $: if (holonID && $showFederated !== lastFedFlag) {
    lastFedFlag = $showFederated;
    stockSub?.setFederated($showFederated);
  }

  function teardown() {
    stockSub?.unsubscribe();
    questsSub?.unsubscribe();
    stockSub = questsSub = undefined;
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    if (loadingFallbackTimer) clearTimeout(loadingFallbackTimer);
    loadingFallbackTimer = null;
  }

  async function bind(id: string) {
    teardown();
    holonID = id;
    rawStock = [];
    needs = [];
    events = [];
    federated = [];
    partners = [];
    openItemId = null;
    moveOpen = null;
    formOpen = false;
    loading = true;

    if (!holosphere || !id) {
      loading = false;
      return;
    }
    // A cold relay still gets a board: the read retries below give up on
    // their own, but the spinner must not outlive them.
    loadingFallbackTimer = setTimeout(() => {
      if (holonID === id) loading = false;
    }, 9000);

    try {
      // Specs are keyed by ITEM id and two holons can both keep "flour";
      // each holon's copy stays, split by origin in $lib/stock.
      stockSub = holosphere.subscribeFederated(
        id,
        STOCK_LENS,
        (items: unknown[]) => {
          if (holonID !== id) return;
          rawStock = normalizeLens(items);
        },
        { includeFederated: $showFederated, dedupeAcrossSpaces: false },
      );
      // Open needs are this holon's own demand; partners' needs are not
      // federated, so the local stream is the whole picture.
      questsSub = holosphere.subscribeFederated(
        id,
        "quests",
        (items: unknown[]) => {
          if (holonID !== id) return;
          needs = normalizeLens(items).filter(
            (q) => (q as { type?: string })?.type === "need",
          );
        },
        { includeFederated: false },
      );
    } catch (err) {
      console.error("[stock] subscribe failed", err);
    }

    void refreshEvents(id);
    void loadFederation(id);
    refreshTimer = setInterval(() => {
      if (holonID !== id) return;
      void readEvents(id);
      void loadPartnerStock(id);
    }, REFRESH_MS);
  }

  /** One read of our REA events; empty is a real answer once the retries are done. */
  async function readEvents(id: string): Promise<boolean> {
    try {
      const all = normalizeLens(await holosphere.getAll(id, "rea_events")) as StockEventLike[];
      if (holonID !== id) return false;
      if (all.length) {
        events = all;
        return true;
      }
    } catch (err) {
      console.error("[stock] failed to read rea_events", err);
    }
    return false;
  }

  async function refreshEvents(id: string) {
    for (const delay of [0, 600, 1500, 3000]) {
      if (delay) await sleep(delay);
      if (holonID !== id) return;
      if (await readEvents(id)) break;
    }
    if (holonID === id) loading = false;
  }

  /** Partners: their shelves are public to the federation, so read them directly. */
  async function loadFederation(id: string) {
    try {
      const snapshot = await getFederationSnapshot(holosphere, id);
      if (holonID !== id) return;
      federated = (snapshot.federated ?? []).map(String);
      partnerNames = { ...snapshot.partnerNames, ...partnerNames };
      for (const pid of federated) {
        if (partnerNames[pid]) continue;
        awaitName(pid)
          .then((name) => {
            if (holonID !== id || !name) return;
            partnerNames = { ...partnerNames, [pid]: name };
          })
          .catch(() => {});
      }
    } catch (err) {
      // A holon with no federation record simply has no partners.
      console.warn("[stock] federation load failed", err);
    }
    await loadPartnerStock(id);
  }

  async function loadPartnerStock(id: string) {
    const ids = federated.filter((pid) => pid && pid !== id);
    const next = await Promise.all(
      ids.map(async (pid): Promise<PartnerStock> => {
        let evs: StockEventLike[] = [];
        let specs: StockItemSpecRecord[] = [];
        let fed: string[] = [];
        try {
          evs = normalizeLens(await holosphere.getAll(pid, "rea_events")) as StockEventLike[];
        } catch (err) {
          console.warn("[stock] partner events failed", pid, err);
        }
        // Their specs, read straight from their lens: stock is public to
        // the federation, and the federated copy of the lens may lag or be
        // switched off on this screen.
        try {
          specs = readStockItemSpecs(normalizeLens(await holosphere.getAll(pid, STOCK_LENS)));
        } catch (err) {
          console.warn("[stock] partner specs failed", pid, err);
        }
        try {
          fed = ((await getFederationSnapshot(holosphere, pid)).federated ?? []).map(String);
        } catch {
          fed = [id];
        }
        return { id: pid, name: "", specs, events: evs, federated: fed };
      }),
    );
    if (holonID !== id) return;
    partners = next;
  }

  // ── Derivations ─────────────────────────────────────────────────────────
  $: sets = splitSpecs(rawStock);
  $: partnersWithSpecs = partners.map((p) => ({
    ...p,
    name: partnerNames[p.id] ?? p.id,
    specs: p.specs.length ? p.specs : (sets.partners[p.id] ?? []),
  }));
  $: board = holonID
    ? buildStockBoard({
        holonId: holonID,
        specs: sets.own,
        events,
        needs,
        federated,
        partners: partnersWithSpecs,
      })
    : null;
  $: rows = board ? shelfRows(sets.own, board.levels) : [];
  $: groups = groupShelf(rows);
  // Partner shelves come along only when the federation toggle is on, like
  // every other lens on the dashboard.
  $: partnerShelves =
    $showFederated && board
      ? partnersWithSpecs
          .map((p) => ({
            id: p.id,
            name: p.name,
            rows: shelfRows(p.specs, board!.partnerLevels[p.id] ?? []),
          }))
          .filter((p) => p.rows.length)
      : [];
  $: hasTargets = sets.own.some((s) => (s.target ?? 0) > 0);
  $: shortages = board ? board.scarcity.filter((s) => s.shortage > 0) : [];
  $: nameOf = (id: string) => (id === holonID ? "here" : (partnerNames[id] ?? id));

  // The viewer: Telegram first, a Nostr key as fallback — the same order the
  // rest of the dashboard resolves "me" in. Stock events name who recorded
  // them, so a write needs one.
  $: actor = ($telegramUser
    ? {
        id: $telegramUser.id,
        username: $telegramUser.username,
        first_name: $telegramUser.first_name,
      }
    : $nostrPublicKey
      ? { id: $nostrPublicKey }
      : null) as StockActorLike | null;

  // ── Feedback ────────────────────────────────────────────────────────────
  let notice = "";
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  function say(text: string) {
    notice = text;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = ""), 4000);
  }
  const isDenied = (err: unknown) => {
    const e = err as { name?: string; message?: string } | null;
    return (
      e?.name === "AuthorizationError" ||
      /denied|unauthori[sz]ed|permission/i.test(String(e?.message ?? ""))
    );
  };
  function fail(err: unknown, text: string) {
    console.error("[stock]", err);
    if (isDenied(err)) {
      notifyWriteDenied("Unable to save — no write permission for this holon");
      say("You can't change this holon's stock.");
    } else {
      say(text);
    }
  }
  function requireActor(): StockActorLike | null {
    if (!actor) say("Sign in to record stock.");
    return actor;
  }

  // ── Item form (add / edit) ──────────────────────────────────────────────
  const UNITS: { id: string; label: string }[] = [
    { id: "one", label: "pieces" },
    { id: "kg", label: "kg" },
    { id: "l", label: "litres" },
    { id: "m", label: "metres" },
    { id: "pack", label: "packs" },
  ];
  const unitLabel = (unit: string) => UNITS.find((u) => u.id === unit)?.label ?? unit;

  let formOpen = false;
  let editing: StockItemSpecRecord | null = null;
  let fName = "";
  let fCategory = "";
  let fUnit = "one";
  let fTarget: string | number = "";
  let fMin: string | number = "";
  let saving = false;
  let formError = "";

  function openAdd() {
    if (!requireActor()) return;
    editing = null;
    fName = "";
    fCategory = "";
    fUnit = "one";
    fTarget = "";
    fMin = "";
    formError = "";
    formOpen = true;
  }
  function openEdit(spec: StockItemSpecRecord) {
    if (!requireActor()) return;
    editing = spec;
    fName = spec.name;
    fCategory = spec.category === "general" ? "" : spec.category;
    fUnit = spec.unit;
    fTarget = spec.target != null ? String(spec.target) : "";
    fMin = spec.min != null ? String(spec.min) : "";
    formError = "";
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
    const id = holonID;
    const who = actor;
    if (!id || !who || !fName.trim() || saving) return;
    saving = true;
    formError = "";
    try {
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
        const itemId = stockItemId(fName);
        if (sets.own.some((s) => s.id === itemId)) {
          formError = "An item with that name is already on the shelf.";
          return;
        }
        record = createStockItemSpec({
          name: fName,
          category: fCategory,
          unit: fUnit,
          target: num(fTarget) ?? undefined,
          min: num(fMin) ?? undefined,
          createdBy: who.id,
        });
      }
      await holosphere.put(id, STOCK_LENS, record);
      if (holonID !== id) return;
      // Optimistic: the lens echo follows, but the row should not blink in late.
      rawStock = [
        ...rawStock.filter(
          (r) =>
            (r as { id?: string })?.id !== record.id ||
            (r as { _federation?: { origin?: string } })?._federation?.origin,
        ),
        record,
      ];
      formOpen = false;
      if (editing && openItemId === editing.id) openItemId = record.id;
    } catch (err) {
      fail(err, "Couldn't save the item.");
      formError = isDenied(err) ? "You can't write to this holon." : "Couldn't save that. Try again.";
    } finally {
      saving = false;
    }
  }

  let confirmDelete = false;
  async function deleteSpec(spec: StockItemSpecRecord) {
    const id = holonID;
    if (!id || !requireActor() || saving) return;
    saving = true;
    try {
      await holosphere.delete(id, STOCK_LENS, spec.id);
      if (holonID !== id) return;
      rawStock = rawStock.filter(
        (r) =>
          (r as { id?: string })?.id !== spec.id ||
          (r as { _federation?: { origin?: string } })?._federation?.origin,
      );
      confirmDelete = false;
      openItemId = null;
    } catch (err) {
      fail(err, "Couldn't remove the item.");
    } finally {
      saving = false;
    }
  }

  // ── Item sheet + movements ──────────────────────────────────────────────
  let openItemId: string | null = null;
  $: openRow = rows.find((r) => r.spec.id === openItemId) ?? null;
  $: history = openRow && holonID ? historyOf(events, holonID, openRow.spec.id) : [];

  type MoveKind = "use" | "add" | "count";
  let moveOpen: MoveKind | null = null;
  let mQty: string | number = "";
  let mNote = "";
  let recording = false;

  function openMove(kind: MoveKind) {
    if (!requireActor()) return;
    moveOpen = kind;
    mQty = kind === "count" && openRow ? String(openRow.onhand) : "";
    mNote = "";
  }

  const MOVE_LEAD: Record<MoveKind, string> = {
    use: "How much went out?",
    add: "How much came in?",
    count: "How much is on the shelf right now?",
  };

  async function recordMove() {
    const id = holonID;
    const who = actor;
    const row = openRow;
    const kind = moveOpen;
    if (!id || !who || !row || !kind || recording) return;
    const q = num(mQty);
    if (q == null) return;
    let eventKind: "stock:produced" | "stock:consumed" | "stock:raised" | "stock:lowered";
    let quantity = q;
    if (kind === "add") eventKind = "stock:produced";
    else if (kind === "use") eventKind = "stock:consumed";
    else {
      const delta = q - row.onhand;
      if (Math.abs(delta) < 0.0005) {
        say("The shelf already says that.");
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
        holonId: id,
        kind: eventKind,
        itemId: row.spec.id,
        quantity,
        unit: row.spec.unit,
        actor: who,
        note: mNote.trim() || null,
      });
      await getEventStore(holosphere).put(id, event);
      if (holonID !== id) return;
      events = [...events, event as StockEventLike];
      moveOpen = null;
      say("Recorded.");
      // The relay echo lands a moment later; re-read so the fold is the
      // stored truth rather than our optimistic copy.
      await sleep(1500);
      if (holonID === id) void readEvents(id);
    } catch (err) {
      fail(err, "Couldn't record that.");
    } finally {
      recording = false;
    }
  }

  // ── Reorder → shopping list ─────────────────────────────────────────────
  let shopping = false;
  async function addToShopping() {
    const id = holonID;
    const who = requireActor();
    if (!id || !board || !who || shopping) return;
    shopping = true;
    try {
      const changed = await syncReorderToShopping(
        holosphere as unknown as ChecklistStore,
        id,
        board.reorder,
        { creator: who.id },
      );
      say(
        changed
          ? `${changed} ${changed === 1 ? "row" : "rows"} on the shopping list.`
          : "The shopping list already has it all.",
      );
    } catch (err) {
      fail(err, "Couldn't write the shopping list.");
    } finally {
      shopping = false;
    }
  }

  // ── Moves → record a transfer ───────────────────────────────────────────
  let transferring: string | null = null;
  const legKey = (leg: StockTransfer) => `${leg.category}:${leg.from}:${leg.to}`;

  /** The item the leg is about: the receiver's item in that category, by our name for it. */
  function itemForLeg(leg: StockTransfer): StockItemSpecRecord | null {
    const from = leg.from === holonID ? sets.own : (sets.partners[leg.from] ?? []);
    const to = leg.to === holonID ? sets.own : (sets.partners[leg.to] ?? []);
    const inCategory = (s: StockItemSpecRecord) => s.category === leg.category;
    return to.find(inCategory) ?? from.find(inCategory) ?? sets.own.find(inCategory) ?? null;
  }

  async function recordTransfer(leg: StockTransfer) {
    const id = holonID;
    const who = requireActor();
    if (!id || !who || transferring) return;
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
        actor: who,
      });
      const store = getEventStore(holosphere);
      // Our side first — that is the shelf we answer for. A transfer must
      // sit on BOTH holons under the same id so the two ledgers agree.
      await store.put(id, event);
      const other = leg.from === id ? leg.to : leg.from;
      let both = true;
      try {
        await store.put(other, event);
      } catch (err) {
        console.warn("[stock] partner side refused the transfer", err);
        both = false;
      }
      if (holonID !== id) return;
      events = [...events, event as StockEventLike];
      partners = partners.map((p) =>
        p.id === other && both
          ? { ...p, events: [...p.events, event as StockEventLike] }
          : p,
      );
      say(
        both
          ? "Transfer recorded on both shelves."
          : "Recorded on this shelf only; the partner's refused the write.",
      );
    } catch (err) {
      fail(err, "Couldn't record the transfer.");
    } finally {
      transferring = null;
    }
  }

  // ── Presentation helpers ────────────────────────────────────────────────
  const STATUS_LABEL: Record<ShelfRow["status"], string> = {
    empty: "Empty",
    low: "Low",
    ok: "OK",
  };
  const KIND_LABEL: Record<string, string> = {
    "stock:produced": "Added",
    "stock:consumed": "Used",
    "stock:raised": "Counted up",
    "stock:lowered": "Counted down",
    "stock:transferred": "Transfer",
  };
  const whenFmt = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const when = (at: number) => (at ? whenFmt.format(at) : "");
  const signed = (n: number, unit: string) => `${n > 0 ? "+" : "−"}${fmtQty(Math.abs(n), unit)}`;
  const hops = (n: number) => `${n} ${n === 1 ? "hop" : "hops"}`;

  function closeItem() {
    openItemId = null;
    moveOpen = null;
    confirmDelete = false;
  }

  onMount(() => {
    if ($ID) void bind($ID);
  });

  onDestroy(() => {
    teardown();
    if (noticeTimer) clearTimeout(noticeTimer);
  });
</script>

<div class="board" id="stock-top">
  <header class="top">
    <div class="titles">
      <h1>Stock</h1>
      <p class="sub">What this holon keeps, in quantity — and what the federation could move.</p>
    </div>
  </header>

  <!-- The board's one navigation: which reading of the shelf to show. -->
  <nav class="tabs">
    <PillSwitch
      options={PANELS}
      value={panel}
      onChange={(id) => (prefs.panel = id)}
      label="Which panel"
      stretch
    />
  </nav>

  {#if loading && !sets.own.length}
    <p class="empty">Counting the shelves…</p>
  {:else if panel === "reorder"}
    <section class="panel">
      <header class="head">
        <div class="titles">
          <h2>Reorder</h2>
          <p class="sub">What to buy to bring every item back to its restock level.</p>
        </div>
      </header>
      {#if !board || !board.reorder.length}
        <p class="empty">
          {hasTargets
            ? "Everything is at its restock level."
            : "Set a restock level on an item to get a shopping list."}
        </p>
      {:else}
        <ul class="rows">
          {#each board.reorder as line (line.itemId)}
            <li class="row plain">
              <div class="text">
                <h3>{line.name}</h3>
                <div class="meta">
                  <span class="rtype">{line.category}</span>
                  <span class="basis">
                    restock to {fmtQty(line.basis.target, line.unit)} · on hand
                    {fmtQty(line.basis.onhand, line.unit)} · on the way
                    {fmtQty(line.basis.incoming, line.unit)} · reserved
                    {fmtQty(line.basis.reserved, line.unit)}
                  </span>
                </div>
              </div>
              <span class="status buy">Buy {fmtQty(line.quantity, line.unit)}</span>
            </li>
          {/each}
        </ul>
        <div class="actions center">
          <button type="button" class="primary" on:click={addToShopping} disabled={shopping}>
            {shopping ? "Adding…" : "Add to shopping list"}
          </button>
        </div>
        <p class="note">
          Rows are keyed by item, so re-running replaces rather than stacks. See the
          <a href={`/${holonID}/shopping`}>shopping list</a>.
        </p>
      {/if}
    </section>
  {:else if panel === "moves"}
    <section class="panel">
      {#if shortages.length}
        <h2 class="section">Shortages</h2>
        <ul class="rows">
          {#each shortages as s (s.category)}
            <li class="row plain">
              <div class="text">
                <h3>{s.category}</h3>
                <div class="meta">
                  <span class="basis">
                    {Math.round(s.blocked * 100)}% of the need can't be met from the shelf
                  </span>
                </div>
              </div>
              <span class="status short">{fmtQty(s.shortage, "")} short</span>
            </li>
          {/each}
        </ul>
      {/if}

      <h2 class="section">Moves the federation could make</h2>
      {#if !federated.length}
        <p class="empty small">Federate with a partner to see moves.</p>
      {:else if !board || !board.plan.length}
        <p class="empty small">Nothing to move: no shortage a partner could cover.</p>
      {:else}
        <ul class="rows">
          {#each board.plan as leg (legKey(leg))}
            {@const item = itemForLeg(leg)}
            <li class="row plain">
              <div class="text">
                <h3>
                  {leg.to === holonID
                    ? `${nameOf(leg.from)} → here`
                    : leg.from === holonID
                      ? `here → ${nameOf(leg.to)}`
                      : `${nameOf(leg.from)} → ${nameOf(leg.to)}`}
                </h3>
                <div class="meta">
                  <span class="rtype">{leg.category}</span>
                  <span class="basis">{hops(leg.cost)}</span>
                </div>
              </div>
              <span class="qty">{fmtQty(leg.quantity, item?.unit ?? "")}</span>
              {#if item && (leg.to === holonID || leg.from === holonID)}
                <button
                  type="button"
                  class="chip"
                  on:click={() => recordTransfer(leg)}
                  disabled={transferring === legKey(leg)}
                >
                  {leg.to === holonID ? "Record received" : "Record sent"}
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      {#if board && board.positions.length}
        <h2 class="section">Shelves across the federation</h2>
        <ul class="rows">
          {#each board.positions as p (p.holonId + ":" + p.category)}
            <li class="row plain">
              <div class="text">
                <h3>{nameOf(p.holonId)}</h3>
                <div class="meta"><span class="rtype">{p.category}</span></div>
              </div>
              {#if p.surplus > 0}
                <span class="status available">{fmtQty(p.surplus, "")} spare</span>
              {/if}
              {#if p.deficit > 0}
                <span class="status short">{fmtQty(p.deficit, "")} short</span>
              {/if}
              {#if p.surplus <= 0 && p.deficit <= 0}
                <span class="status ok">square</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {:else}
    <section class="panel shelf">
      {#if !rows.length && !partnerShelves.length}
        <div class="empty">
          <p>Nothing on the shelf yet.</p>
          <p class="lead">Add what this place keeps, then record what comes in and goes out.</p>
        </div>
      {:else}
        {#each groups as group (group.category)}
          <h2 class="section">{group.category}</h2>
          <ul class="rows">
            {#each group.rows as row (row.spec.id)}
              <li>
                <button
                  type="button"
                  class="row tap"
                  class:out={row.status === "empty"}
                  on:click={() => (openItemId = row.spec.id)}
                >
                  <span class="text">
                    <span class="name">{row.spec.name}</span>
                    <span class="meta">
                      {#if row.spec.target}
                        <span class="basis">Restock to {fmtQty(row.spec.target, row.spec.unit)}</span>
                      {/if}
                      {#if row.incoming > 0}
                        <span class="basis in">{fmtQty(row.incoming, row.spec.unit)} on the way</span>
                      {/if}
                      {#if row.inFlight}
                        <span class="basis in">A transfer is in flight</span>
                      {/if}
                    </span>
                    <span class="bar" aria-hidden="true">
                      <span class="fill st-{row.status}" style="width: {Math.round(row.fill * 100)}%"></span>
                    </span>
                  </span>
                  <span class="qty">{fmtQty(row.onhand, row.spec.unit)}</span>
                  <span class="status st-{row.status}">{STATUS_LABEL[row.status]}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/each}
        {#each partnerShelves as shelf (shelf.id)}
          <h2 class="section partner">{shelf.name}'s shelf</h2>
          <ul class="rows">
            {#each shelf.rows as row (row.spec.id)}
              <li class="row plain is-foreign">
                <div class="text">
                  <h3>{row.spec.name}</h3>
                  <div class="meta"><span class="rtype">{row.spec.category}</span></div>
                </div>
                <span class="qty">{fmtQty(row.onhand, row.spec.unit)}</span>
              </li>
            {/each}
          </ul>
        {/each}
      {/if}
    </section>
    <button type="button" class="fab" on:click={openAdd} aria-label="Add an item" title="Add an item">
      +
    </button>
  {/if}

  {#if notice}
    <p class="note toast" role="status">{notice}</p>
  {/if}
</div>

{#if openRow}
  {@const row = openRow}
  <Sheet title={row.spec.name} on:close={closeItem}>
    <div class="sheet-head">
      <span class="rtype">{row.spec.category}</span>
      <button type="button" class="link" on:click={() => openEdit(row.spec)}>✎ Edit item</button>
    </div>
    <div class="level">
      <span class="big">{fmtQty(row.onhand, row.spec.unit)}</span>
      <span class="status st-{row.status}">{STATUS_LABEL[row.status]}</span>
    </div>
    <ul class="facts">
      {#if row.inFlight && row.level}
        <li>
          {fmtQty(row.level.confirmed, row.spec.unit)} confirmed ·
          {fmtQty(row.level.pending, row.spec.unit)} once everything settles
        </li>
      {/if}
      {#if row.incoming > 0}
        <li>{fmtQty(row.incoming, row.spec.unit)} on the way</li>
      {/if}
      {#if row.level && row.level.reserved > 0}
        <li>{fmtQty(row.level.reserved, row.spec.unit)} reserved for needs</li>
      {/if}
      {#if row.spec.target}
        <li>Restock to {fmtQty(row.spec.target, row.spec.unit)}</li>
      {/if}
      {#if row.spec.min}
        <li>Keep {fmtQty(row.spec.min, row.spec.unit)}</li>
      {/if}
    </ul>

    {#if moveOpen}
      <div class="move">
        <p class="lead">{MOVE_LEAD[moveOpen]}</p>
        <label class="amount-field">
          <span class="k">Quantity · {unitLabel(row.spec.unit)}</span>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            type="number"
            inputmode="decimal"
            min="0"
            step="any"
            bind:value={mQty}
            placeholder="0"
            autofocus
            on:keydown={(e) => e.key === "Enter" && recordMove()}
          />
        </label>
        <label class="text-field">
          <span class="k">Note (optional)</span>
          <input type="text" bind:value={mNote} maxlength="120" placeholder="Where it went, who brought it…" />
        </label>
        <div class="actions">
          <button type="button" class="ghost" on:click={() => (moveOpen = null)}>Cancel</button>
          <button type="button" class="primary" on:click={recordMove} disabled={recording || num(mQty) == null}>
            {recording ? "Recording…" : "Record"}
          </button>
        </div>
      </div>
    {:else}
      <div class="moves">
        <button type="button" class="mv" on:click={() => openMove("use")}>
          <span class="g">−</span>Use
        </button>
        <button type="button" class="mv" on:click={() => openMove("add")}>
          <span class="g">+</span>Add
        </button>
        <button type="button" class="mv" on:click={() => openMove("count")}>
          <span class="g">≡</span>Count
        </button>
      </div>
    {/if}

    <h4 class="k hist-head">History</h4>
    {#if !history.length}
      <p class="none">No movements yet.</p>
    {:else}
      <ul class="hist">
        {#each history.slice(0, 30) as line (line.id)}
          <li class:pending={line.pending}>
            <span class="delta" class:neg={line.delta < 0}>{signed(line.delta, line.unit)}</span>
            <span class="what">
              {KIND_LABEL[line.kind] ?? "Transfer"}{line.who ? ` · ${line.who}` : ""}{line.pending
                ? " · pending"
                : ""}
            </span>
            <span class="at">{when(line.at)}</span>
            {#if line.note}<span class="hnote">{line.note}</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}

    <svelte:fragment slot="actions">
      {#if confirmDelete}
        <button type="button" class="ghost" on:click={() => (confirmDelete = false)}>Keep it</button>
        <button type="button" class="danger" disabled={saving} on:click={() => deleteSpec(row.spec)}>
          Remove {row.spec.name}
        </button>
      {:else}
        <button type="button" class="ghost" on:click={() => (confirmDelete = true)}>Remove item</button>
      {/if}
    </svelte:fragment>
  </Sheet>
{/if}

{#if formOpen}
  <Sheet title={editing ? "Edit item" : "Add an item"} on:close={() => (formOpen = false)}>
    {#if !editing}<p class="sub">Something kept in quantity: flour, screws, oil.</p>{/if}
    <label class="text-field">
      <span class="k">Name</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input type="text" bind:value={fName} maxlength="60" placeholder="Flour" autofocus />
    </label>
    <label class="text-field">
      <span class="k">Category</span>
      <input type="text" bind:value={fCategory} maxlength="40" placeholder="food, hardware…" />
    </label>
    <div class="k field-label">Unit</div>
    <ul class="picks" role="radiogroup" aria-label="Unit">
      {#each UNITS as u (u.id)}
        <li>
          <button
            type="button"
            role="radio"
            aria-checked={fUnit === u.id}
            class="pick"
            class:on={fUnit === u.id}
            on:click={() => (fUnit = u.id)}
          >
            {u.label}
          </button>
        </li>
      {/each}
    </ul>
    <label class="text-field">
      <span class="k">Restock up to <small>— empty means never reorder</small></span>
      <input type="number" inputmode="decimal" min="0" step="any" bind:value={fTarget} />
    </label>
    <label class="text-field">
      <span class="k">Keep at least <small>— never offered to partners below this</small></span>
      <input type="number" inputmode="decimal" min="0" step="any" bind:value={fMin} />
    </label>
    {#if formError}<p class="error">{formError}</p>{/if}
    <svelte:fragment slot="actions">
      <button type="button" class="ghost" on:click={() => (formOpen = false)}>Cancel</button>
      <button type="button" class="primary" on:click={saveSpec} disabled={saving || !fName.trim()}>
        {saving ? "Saving…" : "Save"}
      </button>
    </svelte:fragment>
  </Sheet>
{/if}

<style>
  .board {
    --flow-accent: #0f766e;
    padding: 0.9rem 1rem calc(5rem + env(safe-area-inset-bottom));
    max-width: 52rem;
    margin: 0 auto;
    color: var(--color-text-primary);
  }

  @media (min-width: 640px) {
    .board {
      padding: 1.2rem 1.5rem 5rem;
    }
  }

  .top {
    margin-bottom: 0.8rem;
  }

  h1 {
    margin: 0;
    font-size: 1.45rem;
    font-weight: 600;
  }

  h2 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 600;
  }

  h3 {
    margin: 0;
    font-size: 0.98rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .sub {
    margin: 0.15rem 0 0;
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }

  .lead {
    margin: 0 0 0.6rem;
    font-size: 0.9rem;
    color: var(--color-text-secondary);
  }

  /* The tab pill stays put while the panel scrolls under it. */
  .tabs {
    position: sticky;
    top: 0;
    z-index: 10;
    margin: 0 -0.25rem 1rem;
    padding: 0.35rem 0.25rem;
    background: var(--color-bg-primary);
  }

  .panel {
    animation: stock-rise 0.42s ease both;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 0.8rem;
    margin-bottom: 0.6rem;
  }

  .section {
    margin: 1rem 0 0.45rem;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
  }

  .section.partner {
    color: #5eead4;
  }

  .k {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
  }

  .k small {
    text-transform: none;
    letter-spacing: 0;
  }

  /* ── Rows ──────────────────────────────────────────────────────────── */
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    width: 100%;
    padding: 0.65rem 0.9rem;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: 16px;
    color: var(--color-text-primary);
    text-align: left;
  }

  .row.tap {
    cursor: pointer;
    touch-action: manipulation;
    transition: transform 0.1s ease;
  }

  .row.tap:active {
    transform: scale(0.99);
  }

  .row.out {
    opacity: 0.75;
  }

  .row.is-foreign {
    border-left: 4px solid #0f766e;
  }

  .row .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .row .name {
    font-size: 0.98rem;
    font-weight: 600;
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
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
  }

  .basis {
    font-size: 0.78rem;
    color: var(--color-text-muted);
  }

  .basis.in {
    color: #5eead4;
  }

  .bar {
    display: block;
    height: 0.3rem;
    margin-top: 0.4rem;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.18);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: #10b981;
    transition: width 0.3s ease;
  }

  .fill.st-low {
    background: #f59e0b;
  }

  .fill.st-empty {
    background: #f43f5e;
  }

  .qty {
    font-size: 1.05rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .status {
    flex: 0 0 auto;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.25rem 0.55rem;
    border-radius: 999px;
    white-space: nowrap;
    background: rgba(16, 185, 129, 0.16);
    color: #6ee7b7;
  }

  .status.st-low {
    background: rgba(245, 158, 11, 0.18);
    color: #fcd34d;
  }

  .status.st-empty,
  .status.short {
    background: rgba(244, 63, 94, 0.16);
    color: #fda4af;
  }

  .status.buy {
    background: rgba(15, 118, 110, 0.22);
    color: #99f6e4;
  }

  .status.available,
  .status.ok {
    background: rgba(16, 185, 129, 0.16);
    color: #6ee7b7;
  }

  .chip {
    flex: 0 0 auto;
    min-height: 2.4rem;
    padding: 0 0.9rem;
    border-radius: 999px;
    background: var(--flow-accent, #0f766e);
    color: #f0fdfa;
    font-size: 0.82rem;
    font-weight: 600;
    touch-action: manipulation;
  }

  .chip:disabled {
    opacity: 0.45;
  }

  /* ── Panel actions ──────────────────────────────────────────────────── */
  .actions {
    display: flex;
    gap: 0.6rem;
    margin-top: 0.9rem;
  }

  .actions.center {
    justify-content: center;
  }

  .actions button {
    min-height: 3rem;
    padding: 0 1.4rem;
    border-radius: 999px;
    font-weight: 600;
    font-size: 0.95rem;
    touch-action: manipulation;
  }

  .actions .primary {
    background: var(--flow-accent, #0f766e);
    color: #f0fdfa;
  }

  .actions .primary:disabled {
    opacity: 0.45;
  }

  .actions .ghost {
    background: rgba(255, 255, 255, 0.06);
    color: var(--color-text-secondary);
  }

  .move .actions button {
    flex: 1 1 0;
  }

  .empty {
    color: var(--color-text-muted);
    text-align: center;
    padding: 2.4rem 1rem;
  }

  .empty.small {
    padding: 1rem;
  }

  .empty p {
    margin: 0;
  }

  .empty .lead {
    margin-top: 0.3rem;
    color: var(--color-text-muted);
  }

  .note {
    color: var(--color-text-muted);
    font-size: 0.8rem;
    text-align: center;
    margin: 0.7rem 0 0;
  }

  .note a {
    color: #5eead4;
  }

  .note.toast {
    position: fixed;
    left: 50%;
    bottom: calc(1.4rem + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 50;
    margin: 0;
    padding: 0.6rem 1rem;
    border-radius: 999px;
    background: var(--color-bg-tertiary, #1e293b);
    border: 1px solid var(--color-border);
    color: var(--color-text-primary);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
    animation: stock-rise 0.25s ease both;
  }

  .fab {
    position: fixed;
    right: calc(1.1rem + env(safe-area-inset-right));
    bottom: calc(1.3rem + env(safe-area-inset-bottom));
    z-index: 40;
    width: 3.6rem;
    height: 3.6rem;
    border-radius: 50%;
    background: var(--flow-accent, #0f766e);
    color: #f0fdfa;
    font-size: 2rem;
    line-height: 1;
    display: grid;
    place-items: center;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
    touch-action: manipulation;
    transition: transform 0.1s ease;
  }

  .fab:active {
    transform: scale(0.92);
  }

  /* ── Sheet content ──────────────────────────────────────────────────── */
  .sheet-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    margin-bottom: 0.4rem;
  }

  .link {
    background: none;
    color: #5eead4;
    font-size: 0.85rem;
    font-weight: 600;
    padding: 0.3rem 0;
    touch-action: manipulation;
  }

  .level {
    display: flex;
    align-items: baseline;
    gap: 0.7rem;
    margin: 0.2rem 0 0.5rem;
  }

  .big {
    margin: 0;
    font-size: 1.8rem;
    color: #5eead4;
    font-variant-numeric: tabular-nums;
  }

  .facts {
    list-style: none;
    margin: 0 0 0.8rem;
    padding: 0;
    font-size: 0.85rem;
    color: var(--color-text-secondary);
    display: grid;
    gap: 0.2rem;
  }

  .moves {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
    margin: 0.4rem 0 1rem;
  }

  .mv {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    min-height: 3rem;
    border-radius: 14px;
    background: var(--color-bg-primary);
    border: 1px solid var(--color-border);
    color: var(--color-text-primary);
    font-weight: 600;
    touch-action: manipulation;
  }

  .mv .g {
    font-size: 1.2rem;
    color: #5eead4;
  }

  .move {
    margin: 0.4rem 0 1rem;
  }

  .amount-field,
  .text-field {
    display: block;
    margin-bottom: 0.9rem;
  }

  .amount-field input,
  .text-field input {
    display: block;
    width: 100%;
    margin-top: 0.3rem;
    background: var(--color-bg-primary);
    border: 1px solid var(--color-border);
    border-radius: 14px;
    color: var(--color-text-primary);
    padding: 0.7rem 0.9rem;
    font-size: 1rem;
    min-height: 3rem;
  }

  .amount-field input {
    font-size: 1.8rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .amount-field input:focus,
  .text-field input:focus {
    outline: none;
    border-color: #0f766e;
  }

  .field-label {
    margin-top: 0.4rem;
  }

  .picks {
    list-style: none;
    margin: 0.4rem 0 0.9rem;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .pick {
    min-height: 2.75rem;
    padding: 0 0.9rem;
    border-radius: 999px;
    background: var(--color-bg-tertiary);
    border: 1.5px solid transparent;
    color: var(--color-text-secondary);
    font-size: 0.85rem;
    touch-action: manipulation;
  }

  .pick.on {
    background: rgba(15, 118, 110, 0.22);
    border-color: #0f766e;
    color: #f0fdfa;
  }

  .error {
    color: #fca5a5;
    font-size: 0.85rem;
    margin: 0.6rem 0 0;
  }

  .hist-head {
    margin: 0.4rem 0 0.4rem;
  }

  .none {
    margin: 0;
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }

  .hist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.35rem;
    font-size: 0.85rem;
  }

  .hist li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    column-gap: 0.6rem;
    align-items: baseline;
    padding: 0.35rem 0;
    border-top: 1px solid rgba(148, 163, 184, 0.2);
  }

  .hist li.pending {
    opacity: 0.7;
  }

  .delta {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: #5eead4;
    white-space: nowrap;
  }

  .delta.neg {
    color: #fca5a5;
  }

  .what {
    color: var(--color-text-secondary);
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .at {
    color: var(--color-text-muted);
    font-size: 0.78rem;
    white-space: nowrap;
  }

  .hnote {
    grid-column: 2 / -1;
    color: var(--color-text-muted);
    font-size: 0.8rem;
  }

  @keyframes stock-rise {
    from {
      opacity: 0;
      translate: 0 14px;
    }
    to {
      opacity: 1;
      translate: 0 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .panel,
    .note.toast {
      animation: none;
    }
  }
</style>
