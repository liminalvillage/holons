<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The Offers board: the market, read as resources matched to needs.
  //
  // Three layouts behind the pills band (see `offersViewMode`):
  //   supply  — what is on the table: this holon's offers (the shelf's
  //             surplus among them, kept in step automatically), then the
  //             partners' and the cell's as the scale widens.
  //   matches — who could serve whom: the transport plan's legs, offers as
  //             supply and needs as demand, cheapest road first, with each
  //             need's contention (its dual price). One tap commits.
  //   demand  — the needs at this scale; respond / accept / hand off.
  //
  // The scale chips widen the market: this holon → its partners → its home
  // cell → the cells above. Meaning lives in `@holons/core/offers`;
  // $lib/offers arranges it for the screen. `?offer=<id>` on the route opens
  // an offer's card on boot ($lib/stocklink). Every await is followed by a
  // holon-identity check.
  import { onMount, tick } from "svelte";
  import { get } from "svelte/store";
  import {
    holonId,
    rawQuests,
    partnerNames,
    rotationHold,
    scope,
    offersViewMode,
    searchQuery,
    showNotice,
  } from "$lib/stores";
  import { currentUser, loginOpen } from "$lib/auth";
  import { getHolosphere, getLensStore } from "$lib/holosphere";
  import { t, type MessageKey } from "$lib/i18n";
  import { resolveOffersScale, setOffersScale } from "$lib/config";
  import type { HoloSphere } from "holosphere";
  import {
    getFederationSnapshot,
    readSettingsHex,
  } from "@holons/core/federation";
  import {
    acceptMatch,
    createOffer,
    editOffer,
    publishOfferNearby,
    readAutoOfferSetting,
    readCellMarket,
    refreshPublishedOffer,
    syncSurplusFromShelf,
    withdrawPublishedOffer,
    ownerRef,
    type CellMarket,
    type OfferMode,
    type OfferRecord,
  } from "@holons/core/offers";
  import {
    claimNeed,
    confirmNeedHandoff,
    foldHandoffConfirmations,
    normalizeNeed,
    refreshPublishedNeed,
    respondToNeed,
    settleNeedHandoff,
  } from "@holons/core/needs";
  import type { PartnerGraph } from "@holons/core/inventory";
  import {
    buildOfferBoard,
    filterBoard,
    fmtQty,
    groupByCategory,
    scaleById,
    scaleOptions,
    type MatchCard,
    type NeedCard,
    type OfferCard,
    type Scale,
  } from "$lib/offers";
  import {
    OFFER_PARAM,
    cardFromSearch,
    offerUrl,
    withoutCard,
  } from "$lib/stocklink";
  import { segmentFor } from "$lib/dock";
  import Modal from "$lib/components/Modal.svelte";
  import VoiceButtons from "$lib/components/VoiceButtons.svelte";

  // ── Data ────────────────────────────────────────────────────────────────
  let hid: string | null = null;
  let hsRef: HoloSphere | null = null;
  let federated: string[] = [];
  let partnerGraph: PartnerGraph = {};
  let hexOf: Record<string, string | undefined> = {};
  let homeHex: string | null = null;
  let cell: CellMarket | null = null;
  let cellLoading = false;
  let autoOffer = true;
  let cellTimer: ReturnType<typeof setInterval> | null = null;
  let scaleId = resolveOffersScale();

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
    hid = null;
    hsRef = null;
    if (cellTimer) clearInterval(cellTimer);
    cellTimer = null;
    cellKey = "";
    cell = null;
  }

  async function bind(holon: string | null) {
    teardown();
    hid = holon;
    federated = [];
    partnerGraph = {};
    hexOf = {};
    homeHex = null;
    openKey = null;
    openNeedKey = null;
    if (!holon) return;
    let hs: HoloSphere;
    try {
      hs = await getHolosphere();
    } catch (err) {
      console.error("[kiosk] offers: failed to connect", err);
      return;
    }
    if (hid !== holon) return;
    hsRef = hs;
    void loadFederation(hs, holon);
    void readAutoOfferSetting(hs, holon).then((on) => {
      if (hid === holon) autoOffer = on;
    });
  }

  async function loadFederation(hs: HoloSphere, holon: string) {
    try {
      const [snapshot, hex] = await Promise.all([
        getFederationSnapshot(hs, holon),
        readSettingsHex(hs, holon),
      ]);
      if (hid !== holon) return;
      homeHex = hex;
      hexOf = { ...hexOf, [holon]: hex ?? undefined };
      federated = (snapshot.federated ?? []).map(String);
      partnerGraph = { [holon]: federated };
      if (Object.keys(snapshot.partnerNames ?? {}).length)
        partnerNames.update((m) => ({ ...snapshot.partnerNames, ...m }));
      for (const pid of federated) {
        void Promise.all([
          getFederationSnapshot(hs, pid).catch(() => null),
          readSettingsHex(hs, pid),
        ]).then(([snap, phex]) => {
          if (hid !== holon) return;
          if (snap)
            partnerGraph = {
              ...partnerGraph,
              [pid]: (snap.federated ?? []).map(String),
            };
          if (phex) hexOf = { ...hexOf, [pid]: phex };
        });
      }
    } catch (err) {
      console.warn("[kiosk] offers: federation load failed", err);
    }
  }

  // ── Scale ───────────────────────────────────────────────────────────────
  $: options = scaleOptions(homeHex, federated.length).map((o) => ({
    ...o,
    label: scaleLabel(o.id, o.label),
  }));
  $: activeScaleId = options.some((o) => o.id === scaleId)
    ? scaleId
    : "partners";
  $: activeScale = scaleById(options, activeScaleId) as Scale;
  $: void watchCell(activeScale, hid);
  function pickScale(id: string) {
    scaleId = id;
    setOffersScale(id);
  }
  function scaleLabel(id: string, fallback: string): string {
    const key = (
      id === "holon"
        ? "offers.scale.holon"
        : id === "partners"
          ? "offers.scale.partners"
          : `offers.scale.${id.replace(":", "")}`
    ) as MessageKey;
    try {
      const s = $t(key);
      if (id === "partners" && federated.length)
        return `${s} (${federated.length})`;
      return s === key ? fallback : s;
    } catch {
      return fallback;
    }
  }

  let cellKey = "";
  async function watchCell(s: Scale, holon: string | null) {
    const key = s.kind === "cell" && holon ? `${holon}:${s.cell}` : "";
    if (key === cellKey) return;
    cellKey = key;
    if (cellTimer) clearInterval(cellTimer);
    cellTimer = null;
    cell = null;
    if (!key || s.kind !== "cell" || !hsRef) return;
    const hs = hsRef;
    const read = async () => {
      cellLoading = true;
      try {
        const market = await readCellMarket(hs, s.cell);
        if (hid !== holon || cellKey !== key) return;
        cell = market;
      } finally {
        if (cellKey === key) cellLoading = false;
      }
    };
    await read();
    cellTimer = setInterval(() => void read(), 30_000);
  }

  // ── Derivations ─────────────────────────────────────────────────────────
  $: viewerId = $currentUser ? String($currentUser.id) : null;
  $: fullBoard = hid
    ? buildOfferBoard({
        holonId: hid,
        viewerId,
        scale: activeScale,
        quests:
          $scope === "personal"
            ? $rawQuests.filter(
                (q) => !(q as { _federation?: unknown })._federation,
              )
            : $rawQuests,
        cell,
        partners: partnerGraph,
        hexOf,
      })
    : null;
  $: board = fullBoard ? filterBoard(fullBoard, $searchQuery) : null;
  $: filtering = $searchQuery.trim().length > 0;
  $: supplyGroups = board ? groupByCategory(board.supply) : [];
  $: autoCards = fullBoard
    ? fullBoard.supply.filter((c) => c.own && c.auto)
    : [];
  $: handoffConfirmations = foldHandoffConfirmations($rawQuests as never[]);
  $: nameOf = (id: string) =>
    id === hid ? $t("offers.here") : ($partnerNames[id] ?? id);
  $: matchGroups = board
    ? (["provider", "requester", "observer"] as const)
        .map((role) => ({
          role,
          cards: board!.matches.filter((m) => m.role === role),
        }))
        .filter((g) => g.cards.length)
    : [];
  $: initiator = $currentUser
    ? {
        id: $currentUser.id,
        username: $currentUser.username ?? String($currentUser.id),
        firstName: $currentUser.first_name,
        lastName: $currentUser.last_name,
      }
    : null;
  $: rotationHold.set(
    openKey != null || openNeedKey != null || formOpen || shareOpen,
  );

  const MODE_KEY: Record<OfferMode, MessageKey> = {
    give: "offers.mode.give",
    lend: "offers.mode.lend",
    sell: "offers.mode.sell",
  };
  const STATE_KEY: Record<MatchCard["state"], MessageKey> = {
    proposed: "offers.state.proposed",
    responded: "offers.state.responded",
    claimed: "offers.state.claimed",
    settled: "offers.state.settled",
  };
  const ROLE_KEY: Record<MatchCard["role"], MessageKey> = {
    provider: "offers.role.provider",
    requester: "offers.role.requester",
    observer: "offers.role.observer",
  };
  const offerStatusKey = (s: string) => `offers.status.${s}` as MessageKey;
  const needStatusKey = (c: NeedCard) =>
    c.legacy
      ? "offers.need.request"
      : (`offers.need.${c.need.status}` as MessageKey);

  // ── Login gate / feedback ───────────────────────────────────────────────
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
    console.error("[kiosk] offers:", err);
    showNotice($t(isDenied(err) ? "offers.denied" : key));
  }
  /** Optimistic: swap a record into the shell's stream so the card does not blink in late. */
  function upsertLocal(record: { id?: unknown }) {
    rawQuests.update((items) => [
      ...items.filter((q) => {
        const r = q as {
          id?: unknown;
          _federation?: unknown;
          _hologram?: unknown;
        };
        return r?.id !== record.id || !!r._federation || !!r._hologram;
      }),
      record as never,
    ]);
  }

  // ── Offer sheet + deep link ─────────────────────────────────────────────
  let openKey: string | null = null;
  $: openCard = board
    ? (board.supply.find((c) => c.key === openKey) ??
      fullBoard?.supply.find((c) => c.key === openKey) ??
      null)
    : null;
  let linkedOffer: string | null =
    typeof location !== "undefined"
      ? cardFromSearch(location.search, OFFER_PARAM)
      : null;
  $: if (
    linkedOffer &&
    fullBoard &&
    fullBoard.supply.some((c) => c.key === linkedOffer)
  ) {
    openKey = linkedOffer;
    linkedOffer = null;
  }
  function closeOffer() {
    openKey = null;
    confirmWithdraw = false;
    if (
      typeof location === "undefined" ||
      !cardFromSearch(location.search, OFFER_PARAM)
    )
      return;
    try {
      window.history.replaceState(
        window.history.state,
        "",
        location.pathname +
          withoutCard(location.search, OFFER_PARAM) +
          location.hash,
      );
    } catch {
      /* the address bar is cosmetic here */
    }
  }
  let copied = false;
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  async function copyLink(offerId: string) {
    if (!hid) return;
    try {
      await navigator.clipboard.writeText(
        offerUrl(location.origin, segmentFor(hid), offerId),
      );
      copied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 1800);
    } catch {
      showNotice($t("clipboard.writeFailed"));
    }
  }

  // ── Offer form (create / edit) ──────────────────────────────────────────
  const UNITS: { id: string; key: MessageKey }[] = [
    { id: "one", key: "stock.unit.one" },
    { id: "kg", key: "stock.unit.kg" },
    { id: "l", key: "stock.unit.l" },
    { id: "m", key: "stock.unit.m" },
    { id: "pack", key: "stock.unit.pack" },
  ];
  let formOpen = false;
  let editing: OfferRecord | null = null;
  let fTitle = "";
  let fCategory = "";
  let fQty: string | number = "1";
  let fUnit = "one";
  let fMode: OfferMode = "give";
  let fPrice: string | number = "";
  let fCurrency = "EUR";
  let fNotes = "";
  let saving = false;

  const num = (raw: string | number | null | undefined): number | null => {
    if (raw == null) return null;
    const text = String(raw).trim().replace(",", ".");
    if (text === "") return null;
    const v = Number(text);
    return Number.isFinite(v) && v >= 0 ? v : null;
  };

  function openAdd() {
    if (!requireUser()) return;
    editing = null;
    fTitle = "";
    fCategory = "";
    fQty = "1";
    fUnit = "one";
    fMode = "give";
    fPrice = "";
    fCurrency = "EUR";
    fNotes = "";
    formOpen = true;
  }
  function openEdit(offer: OfferRecord) {
    if (!requireUser()) return;
    editing = offer;
    fTitle = String(offer.title ?? "");
    fCategory = offer.category ?? "";
    fQty = String(offer.supply.quantity);
    fUnit = offer.supply.unit;
    fMode = offer.mode;
    fPrice = offer.price != null ? String(offer.price) : "";
    fCurrency = offer.currency ?? "EUR";
    fNotes = String(offer.description ?? "");
    formOpen = true;
  }

  async function saveOffer() {
    const holon = hid;
    const who = initiator;
    const hs = hsRef;
    if (!holon || !who || !hs || !fTitle.trim() || saving) return;
    const quantity = num(fQty);
    if (!quantity || quantity <= 0) {
      showNotice($t("offers.howMany"));
      return;
    }
    saving = true;
    try {
      if (editing) {
        const out = editOffer(editing, {
          title: fTitle,
          description: fNotes || undefined,
          category: fCategory,
          supply: { ...editing.supply, quantity, unit: fUnit },
          mode: fMode,
          price: fMode === "sell" ? (num(fPrice) ?? undefined) : undefined,
          currency: fMode === "sell" ? fCurrency : undefined,
        });
        if (!out.ok) {
          showNotice(
            $t(
              out.reason === "below_reserved"
                ? "offers.belowReserved"
                : "offers.closed",
            ),
          );
          return;
        }
        const r = await refreshPublishedOffer(hs, holon, out.offer);
        if (hid !== holon) return;
        upsertLocal(r.offer);
        showNotice($t("offers.saved"));
      } else {
        const offer = createOffer({
          holonId: holon,
          initiator: who,
          title: fTitle,
          description: fNotes || undefined,
          category: fCategory || undefined,
          supply: { quantity, unit: fUnit },
          mode: fMode,
          price: fMode === "sell" ? (num(fPrice) ?? undefined) : undefined,
          currency: fMode === "sell" ? fCurrency : undefined,
        });
        const store = await getLensStore();
        await store.put(holon, "quests", offer);
        if (hid !== holon) return;
        upsertLocal(offer);
        showNotice($t("offers.created"));
        shareTarget = offer;
        shareOpen = true;
      }
      formOpen = false;
    } catch (err) {
      fail(err, "offers.saveFailed");
    } finally {
      saving = false;
    }
  }

  // ── Share / withdraw / auto ─────────────────────────────────────────────
  let shareOpen = false;
  let shareTarget: OfferRecord | null = null;
  let shToPartners = true;
  let shToHex = false;
  let sharing = false;
  let confirmWithdraw = false;
  let withdrawing = false;
  $: if (shareOpen) shToHex = !!homeHex && shToHex;

  async function share() {
    const holon = hid;
    const hs = hsRef;
    const offer = shareTarget;
    if (!holon || !hs || !offer || sharing) return;
    sharing = true;
    try {
      const out = await publishOfferNearby(hs, holon, offer, {
        toPartners: shToPartners,
        toHex: shToHex && !!homeHex,
      });
      if (hid !== holon) return;
      upsertLocal(out.offer);
      if (out.errors.length) console.warn("[kiosk] offers: share", out.errors);
      shareOpen = false;
      showNotice($t("offers.shared"));
    } catch (err) {
      fail(err, "offers.saveFailed");
    } finally {
      sharing = false;
    }
  }

  async function withdraw(card: OfferCard) {
    const holon = hid;
    const hs = hsRef;
    if (!holon || !hs || withdrawing) return;
    withdrawing = true;
    try {
      const out = await withdrawPublishedOffer(hs, holon, card.offer);
      if (hid !== holon) return;
      if (!out.ok) {
        showNotice(
          $t(
            out.reason === "has_live_reservations"
              ? "offers.withdrawHeld"
              : "offers.closed",
          ),
        );
        return;
      }
      upsertLocal(out.offer);
      closeOffer();
      showNotice($t("offers.withdrawn"));
    } catch (err) {
      fail(err, "offers.saveFailed");
    } finally {
      withdrawing = false;
    }
  }

  async function toggleAutoOffer(on: boolean) {
    const holon = hid;
    const hs = hsRef;
    const who = initiator;
    if (!holon || !hs || !who || !requireUser()) return;
    autoOffer = on;
    try {
      const settings = ((await hs.get(holon, "settings", holon)) ?? {
        id: holon,
      }) as Record<string, unknown> & { stock?: Record<string, unknown> };
      const store = await getLensStore();
      await store.put(holon, "settings", {
        ...settings,
        id: holon,
        stock: { ...(settings.stock ?? {}), autoOffer: on },
      });
      const out = await syncSurplusFromShelf(hs, holon, {
        initiator: who,
        enabled: on,
      });
      if (hid !== holon) return;
      for (const o of [...out.created, ...out.updated, ...out.withdrawn])
        upsertLocal(o);
      showNotice(
        $t("offers.autoToggled", {
          state: $t(on ? "offers.on" : "offers.off"),
        }),
      );
    } catch (err) {
      autoOffer = !on;
      fail(err, "offers.saveFailed");
    }
  }

  // ── Matches: one tap ────────────────────────────────────────────────────
  let accepting: string | null = null;

  async function offerIt(m: MatchCard) {
    const holon = hid;
    const hs = hsRef;
    const who = initiator;
    if (
      !holon ||
      !hs ||
      !m.offer ||
      !m.need ||
      accepting ||
      !requireUser() ||
      !who
    )
      return;
    accepting = m.key;
    try {
      const ref = ownerRef(m.need.raw, holon, String(m.need.need.id));
      const out = await acceptMatch(
        { holosphere: hs },
        {
          offer: m.offer.offer,
          offerHolonId: m.offer.ownerHolonId,
          need: m.need.need,
          needHolonId: ref?.holon ?? m.need.ownerHolonId,
          needKey: ref?.key,
          quantity: m.leg.quantity,
          actor: {
            id: who.id,
            name:
              `${who.firstName ?? ""} ${who.lastName ?? ""}`.trim() ||
              who.username,
          },
        },
      );
      if (hid !== holon) return;
      if (!out.ok) {
        showNotice(
          $t(
            out.reason === "own_need"
              ? "offers.ownNeed"
              : out.reason === "insufficient"
                ? "offers.insufficient"
                : out.reason === "closed"
                  ? "offers.needClosed"
                  : "offers.offerFailed",
          ),
        );
        return;
      }
      upsertLocal(out.offer);
      if (m.need.own) upsertLocal(out.need);
      showNotice(
        $t("offers.offered", {
          q: fmtQty(m.leg.quantity, m.offer.offer.supply.unit),
        }),
      );
    } catch (err) {
      fail(err, "offers.offerFailed");
    } finally {
      accepting = null;
    }
  }

  async function acceptIt(m: MatchCard) {
    if (!m.need) return;
    const resp = (m.need.need.responses ?? []).find(
      (r) => r.offerId === m.leg.offerId,
    );
    if (!resp) return;
    accepting = m.key;
    try {
      await claimResponse(m.need, resp.id);
    } finally {
      accepting = null;
    }
  }

  // ── Need sheet: respond / accept / handoff ──────────────────────────────
  let openNeedKey: string | null = null;
  $: openNeed = board
    ? (board.demand.find((c) => c.key === openNeedKey) ??
      fullBoard?.demand.find((c) => c.key === openNeedKey) ??
      null)
    : null;
  let rMessage = "";
  let rCode = "";
  let busy = false;
  $: needResponses = openNeed ? (openNeed.need.responses ?? []) : [];
  $: needParty =
    openNeed && viewerId
      ? openNeed.mine
        ? "requester"
        : needResponses.some(
              (r) =>
                String(r.responder?.id) === viewerId &&
                r.id === openNeed!.need.claimedResponseId,
            )
          ? "provider"
          : null
      : null;
  $: needConfirms = openNeed
    ? (handoffConfirmations[String(openNeed.need.id)] ?? {})
    : {};

  async function respond(card: NeedCard) {
    const holon = hid;
    const hs = hsRef;
    const who = initiator;
    if (!holon || !hs || !who || busy || !requireUser()) return;
    const result = respondToNeed(card.need, {
      responder: {
        id: who.id,
        name:
          `${who.firstName ?? ""} ${who.lastName ?? ""}`.trim() || who.username,
        holonId: holon,
      },
      message: rMessage.trim() || undefined,
    });
    if (!result.ok) {
      showNotice(
        $t(
          result.reason === "own_need" ? "offers.ownNeed" : "offers.needClosed",
        ),
      );
      return;
    }
    busy = true;
    try {
      const ref = ownerRef(card.raw, holon, String(card.need.id));
      const {
        _hologram,
        _federation,
        key: _k,
        ...record
      } = result.need as Record<string, unknown>;
      if (ref?.key) record.id = ref.key;
      const store = await getLensStore();
      await store.put(ref?.holon ?? holon, "quests", record);
      if (hid !== holon) return;
      if (!ref) upsertLocal(result.need);
      rMessage = "";
      showNotice($t("offers.responded"));
    } catch (err) {
      fail(err, "offers.respondFailed");
    } finally {
      busy = false;
    }
  }

  async function claimResponse(card: NeedCard, responseId: string) {
    const holon = hid;
    const hs = hsRef;
    if (!holon || !hs || busy || !requireUser()) return;
    const {
      _hologram,
      _federation,
      key: _k,
      ...bare
    } = card.raw as Record<string, unknown>;
    const need = normalizeNeed(bare);
    if (!need) return;
    const result = claimNeed(need, responseId);
    if (!result.ok) {
      showNotice(
        $t(
          result.reason === "not_offered"
            ? "offers.nothingToAccept"
            : "offers.responseGone",
        ),
      );
      return;
    }
    busy = true;
    try {
      const ref = ownerRef(card.raw, holon, String(need.id));
      if (ref?.holon) {
        const store = await getLensStore();
        await store.put(ref.holon, "quests", {
          ...result.need,
          id: ref.key ?? String(need.id),
        });
      } else await refreshPublishedNeed(hs, holon, result.need);
      if (hid !== holon) return;
      if (!ref?.holon) upsertLocal(result.need);
      showNotice(
        $t("offers.accepted", { code: result.need.handoff?.code ?? "" }),
      );
    } catch (err) {
      fail(err, "offers.acceptFailed");
    } finally {
      busy = false;
    }
  }

  async function confirmHandoff(
    card: NeedCard,
    party: "requester" | "provider",
  ) {
    const holon = hid;
    const hs = hsRef;
    if (!holon || !hs || busy || !requireUser()) return;
    const {
      _hologram,
      _federation,
      key: _k,
      ...bare
    } = card.raw as Record<string, unknown>;
    const need = normalizeNeed(bare);
    if (!need) return;
    const ref = ownerRef(card.raw, holon, String(need.id));
    const owner = ref?.holon ?? holon;
    const needKey = ref?.key ?? String(need.id);
    busy = true;
    try {
      const result = await confirmNeedHandoff(hs, owner, need, party, {
        code: party === "provider" ? rCode.trim() : undefined,
        key: needKey,
        confirmations: handoffConfirmations,
      });
      if (!result.ok) {
        showNotice(
          $t(
            result.reason === "bad_code" ? "offers.badCode" : "offers.notReady",
          ),
        );
        return;
      }
      if (result.both) {
        const settled = await settleNeedHandoff({ holosphere: hs }, owner, {
          ...result.need,
          id: needKey,
        });
        if (settled.errors.length)
          console.warn("[kiosk] offers: settlement partial", settled.errors);
        if (hid !== holon) return;
        if (!ref?.holon) upsertLocal(settled.need);
        showNotice(
          $t(
            settled.offerSettled ? "offers.deliveredOffer" : "offers.delivered",
          ),
        );
      } else showNotice($t("offers.confirmed"));
      rCode = "";
    } catch (err) {
      fail(err, "offers.confirmFailed");
    } finally {
      busy = false;
    }
  }

  function onKey(e: KeyboardEvent, fn: () => void) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  }
</script>

<div class="board">
  <div class="offers scroll">
    <div class="scale" role="radiogroup" aria-label={$t("offers.scale")}>
      {#each options as o (o.id)}
        <button
          type="button"
          class="scalechip"
          class:on={activeScaleId === o.id}
          role="radio"
          aria-checked={activeScaleId === o.id}
          on:click={() => pickScale(o.id)}
        >
          <span class="g">{o.glyph}</span>{o.label}
        </button>
      {/each}
      {#if cellLoading}<span class="basis">{$t("offers.cellReading")}</span
        >{/if}
    </div>

    {#if !board}
      <p class="empty">{$t("offers.reading")}</p>
    {:else if $offersViewMode === "supply"}
      <div class="auto">
        <div class="text">
          <h3>{$t("offers.autoTitle")}</h3>
          <p class="basis">
            {autoOffer
              ? $t("offers.autoOn", { n: autoCards.length })
              : $t("offers.autoOff")}
          </p>
        </div>
        <button
          type="button"
          class="switch"
          class:on={autoOffer}
          role="switch"
          aria-checked={autoOffer}
          aria-label={$t("offers.autoTitle")}
          on:click={() => toggleAutoOffer(!autoOffer)}
        >
          <span class="knob"></span>
        </button>
      </div>
      {#if !board.supply.length}
        {#if filtering}
          <p class="empty">
            {$t("offers.noMatch", { q: $searchQuery.trim() })}
          </p>
        {:else}
          <div class="empty">
            <p>{$t("offers.emptySupply")}</p>
            <p class="lead">{$t("offers.emptySupplyLead")}</p>
          </div>
        {/if}
      {:else}
        {#each supplyGroups as group (group.category)}
          <h2 class="section">{group.category}</h2>
          <ul class="rows">
            {#each group.cards as card (card.key)}
              <li>
                <div
                  class="row"
                  class:is-foreign={!card.own}
                  class:out={card.offer.status !== "open" &&
                    card.offer.status !== "reserved"}
                  role="button"
                  tabindex="0"
                  on:click={() => (openKey = card.key)}
                  on:keydown={(e) => onKey(e, () => (openKey = card.key))}
                >
                  <div class="text">
                    <h3>{card.offer.title}</h3>
                    <div class="meta">
                      <span class="rtype">{$t(MODE_KEY[card.offer.mode])}</span>
                      {#if card.auto}<span class="tag">{$t("offers.auto")}</span
                        >{/if}
                      {#if !card.own}<span class="basis"
                          >{nameOf(card.ownerHolonId)}{card.source === "cell"
                            ? ` · ${$t("offers.onMap")}`
                            : ""}</span
                        >{/if}
                      {#if card.offer.price != null}<span class="basis"
                          >{card.offer.price} {card.offer.currency ?? ""}</span
                        >{/if}
                    </div>
                  </div>
                  <span class="qty"
                    >{fmtQty(card.remaining, card.offer.supply.unit)}</span
                  >
                  <span class="status st-{card.offer.status}"
                    >{$t(offerStatusKey(card.offer.status))}</span
                  >
                </div>
              </li>
            {/each}
          </ul>
        {/each}
      {/if}
    {:else if $offersViewMode === "demand"}
      {#if !board.demand.length}
        {#if filtering}
          <p class="empty">
            {$t("offers.noMatch", { q: $searchQuery.trim() })}
          </p>
        {:else}
          <div class="empty">
            <p>{$t("offers.emptyDemand")}</p>
            <p class="lead">{$t("offers.emptyDemandLead")}</p>
          </div>
        {/if}
      {:else}
        <ul class="rows">
          {#each board.demand as card (card.key)}
            <li>
              <div
                class="row"
                class:is-foreign={!card.own}
                class:out={!card.matchable && !card.legacy}
                role="button"
                tabindex="0"
                on:click={() => (openNeedKey = card.key)}
                on:keydown={(e) => onKey(e, () => (openNeedKey = card.key))}
              >
                <div class="text">
                  <h3>{card.need.title}</h3>
                  <div class="meta">
                    {#if card.need.category}<span class="rtype"
                        >{card.need.category}</span
                      >{/if}
                    {#if !card.own}<span class="basis"
                        >{nameOf(card.ownerHolonId)}{card.source === "cell"
                          ? ` · ${$t("offers.onMap")}`
                          : ""}</span
                      >{/if}
                    {#if (card.need.responses ?? []).length}<span class="basis"
                        >{$t("offers.responses", {
                          n: card.need.responses!.length,
                        })}</span
                      >{/if}
                  </div>
                </div>
                {#if !card.legacy}<span class="qty"
                    >{fmtQty(card.quantity, card.unit)}</span
                  >{/if}
                <span class="status" class:st-ok={card.matchable}
                  >{$t(needStatusKey(card))}</span
                >
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    {:else}
      {#if board.contention.length}
        <h2 class="section">{$t("offers.contention")}</h2>
        <ul class="rows">
          {#each board.contention as c (c.category)}
            <li class="row plain">
              <div class="text">
                <h3>{c.category}</h3>
                <div class="meta">
                  <span class="basis"
                    >{$t("offers.contentionLine", {
                      supply: c.supply,
                      demand: c.demand,
                    })}{c.shortage > 0
                      ? ` · ${$t("offers.uncovered", { q: c.shortage })}`
                      : ""}</span
                  >
                </div>
                <div class="bar" aria-hidden="true">
                  <span
                    class="fill"
                    class:hot={c.blocked > 0.5}
                    style="width: {Math.round(c.blocked * 100)}%"
                  ></span>
                </div>
              </div>
              <span
                class="status"
                class:short={c.blocked > 0}
                class:st-ok={c.blocked === 0}
                >{c.blocked > 0
                  ? $t("offers.blocked", { pct: Math.round(c.blocked * 100) })
                  : $t("offers.covered")}</span
              >
            </li>
          {/each}
        </ul>
      {/if}
      {#if !board.matches.length}
        {#if filtering}
          <p class="empty">
            {$t("offers.noMatch", { q: $searchQuery.trim() })}
          </p>
        {:else}
          <div class="empty">
            <p>{$t("offers.emptyMatches")}</p>
            <p class="lead">
              {$t(
                board.demand.some((d) => d.matchable)
                  ? "offers.emptyMatchesNeeds"
                  : "offers.emptyMatchesNone",
              )}
            </p>
          </div>
        {/if}
      {:else}
        {#each matchGroups as group (group.role)}
          <h2 class="section">{$t(ROLE_KEY[group.role])}</h2>
          <ul class="rows">
            {#each group.cards as m (m.key)}
              <li class="row plain" class:committed={m.committed}>
                <div class="text">
                  <h3>
                    {m.offer?.offer.title ?? m.leg.offerId}
                    <span class="arrow">→</span>
                    {m.need?.need.title ?? m.leg.needId}
                  </h3>
                  <div class="meta">
                    <span class="rtype">{m.leg.category}</span>
                    <span class="basis"
                      >{nameOf(m.leg.offerHolonId)} → {nameOf(
                        m.leg.needHolonId,
                      )} · {m.distanceLabel}</span
                    >
                    <span class="tag" class:live={m.state !== "proposed"}
                      >{$t(STATE_KEY[m.state])}</span
                    >
                  </div>
                  <div class="bar thin" aria-hidden="true">
                    <span
                      class="fill"
                      class:hot={m.contention > 0.6}
                      style="width: {Math.round(m.contention * 100)}%"
                    ></span>
                  </div>
                </div>
                <span class="qty"
                  >{fmtQty(
                    m.leg.quantity,
                    m.offer?.offer.supply.unit ?? "",
                  )}</span
                >
                {#if m.canAccept && m.role === "provider"}
                  <button
                    type="button"
                    class="chip"
                    on:click={() => offerIt(m)}
                    disabled={accepting === m.key}
                    >{$t("offers.offerIt")}</button
                  >
                {:else if m.canAccept && m.role === "requester"}
                  <button
                    type="button"
                    class="chip"
                    on:click={() => acceptIt(m)}
                    disabled={accepting === m.key}>{$t("offers.accept")}</button
                  >
                {:else if m.state === "claimed" && m.need}
                  <button
                    type="button"
                    class="chip ghost"
                    on:click={() => (openNeedKey = m.need!.key)}
                    >{$t("offers.handoff")}</button
                  >
                {:else if m.state === "settled"}
                  <span class="status st-ok">✓</span>
                {:else if m.need}
                  <button
                    type="button"
                    class="chip ghost"
                    on:click={() => (openNeedKey = m.need!.key)}
                    >{$t("offers.view")}</button
                  >
                {/if}
              </li>
            {/each}
          </ul>
        {/each}
      {/if}
    {/if}
  </div>

  {#if $offersViewMode === "supply"}
    <div class="fabrow">
      <VoiceButtons />
      <button
        class="fab"
        on:click={openAdd}
        aria-label={$t("offers.addOffer")}
        title={$t("offers.addOffer")}>＋</button
      >
    </div>
  {/if}
</div>

{#if openCard}
  {@const card = openCard}
  <Modal on:close={closeOffer}>
    <div class="sheet">
      <div class="head">
        <div>
          <h3>{card.offer.title}</h3>
          <span class="rtype"
            >{card.offer.category ?? ""} · {$t(MODE_KEY[card.offer.mode])}</span
          >
        </div>
        <div class="tools">
          <button
            class="icon-btn"
            class:done={copied}
            aria-label={$t("offers.copyLink")}
            title={$t(copied ? "offers.linkCopied" : "offers.copyLink")}
            on:click={() => copyLink(String(card.offer.id))}
            >{copied ? "✓" : "⛓"}</button
          >
          {#if card.own && !card.auto && (card.offer.status === "open" || card.offer.status === "reserved")}
            <button
              class="icon-btn"
              aria-label={$t("offers.edit")}
              title={$t("offers.edit")}
              on:click={() => openEdit(card.offer)}>✎</button
            >
          {/if}
        </div>
      </div>
      <div class="level">
        <span class="big">{fmtQty(card.remaining, card.offer.supply.unit)}</span
        >
        <span class="status st-{card.offer.status}"
          >{$t(offerStatusKey(card.offer.status))}</span
        >
      </div>
      <ul class="facts">
        <li>
          {$t("offers.listed", {
            q: fmtQty(card.offer.supply.quantity, card.offer.supply.unit),
          })}{card.remaining < card.offer.supply.quantity
            ? ` · ${$t("offers.promised", { q: fmtQty(card.offer.supply.quantity - card.remaining, card.offer.supply.unit) })}`
            : ""}
        </li>
        {#if card.offer.price != null}<li>
            {$t("offers.pricePer", {
              price: card.offer.price,
              currency: card.offer.currency ?? "",
              unit: $t(
                UNITS.find((u) => u.id === card.offer.supply.unit)?.key ??
                  "stock.unit.one",
              ),
            })}
          </li>{/if}
        {#if card.offer.description}<li>{card.offer.description}</li>{/if}
        {#if card.auto}<li>{$t("offers.autoFact")}</li>{/if}
        {#if card.offer.source?.kind === "minted"}<li>
            {$t("offers.mintedFact")}
          </li>{/if}
        {#if !card.own}<li>
            {$t("offers.listedBy", { name: nameOf(card.ownerHolonId) })}
          </li>{/if}
        {#if card.own}
          <li>
            {$t(
              card.offer.published?.toPartners && card.offer.published?.toHex
                ? "offers.sharedBoth"
                : card.offer.published?.toPartners
                  ? "offers.sharedPartners"
                  : card.offer.published?.toHex
                    ? "offers.sharedMap"
                    : "offers.sharedNone",
            )}
          </li>
        {/if}
      </ul>
      {#if card.offer.reservations.length}
        <h4>{$t("offers.promisedTo")}</h4>
        <ul class="hist">
          {#each card.offer.reservations as r (r.id)}
            <li class:pending={!!r.releasedAt}>
              <span class="delta"
                >{fmtQty(r.quantity, card.offer.supply.unit)}</span
              >
              <span class="what">{r.needId} · {nameOf(r.needHolonId)}</span>
              <span class="at"
                >{$t(
                  r.settledAt
                    ? "offers.resv.delivered"
                    : r.releasedAt
                      ? "offers.resv.released"
                      : "offers.resv.reserved",
                )}</span
              >
            </li>
          {/each}
        </ul>
      {/if}
      {#if card.own && (card.offer.status === "open" || card.offer.status === "reserved")}
        {#if confirmWithdraw}
          <p class="lead">
            {$t("offers.withdrawConfirm", {
              name: String(card.offer.title ?? ""),
            })}
          </p>
          <div class="actions">
            <button
              class="danger"
              disabled={withdrawing}
              on:click={() => withdraw(card)}>{$t("offers.withdraw")}</button
            >
            <button class="ghost" on:click={() => (confirmWithdraw = false)}
              >{$t("offers.keep")}</button
            >
          </div>
        {:else}
          <div class="actions">
            <button
              class="primary"
              on:click={() => ((shareTarget = card.offer), (shareOpen = true))}
              >{$t("offers.share")}</button
            >
            <button class="ghost" on:click={() => (confirmWithdraw = true)}
              >{$t("offers.withdraw")}</button
            >
          </div>
        {/if}
      {/if}
    </div>
  </Modal>
{/if}

{#if openNeed}
  {@const card = openNeed}
  <Modal on:close={() => ((openNeedKey = null), (rMessage = ""), (rCode = ""))}>
    <div class="sheet">
      <div class="head">
        <div>
          <h3>{card.need.title}</h3>
          <span class="rtype"
            >{card.need.category ?? ""}{!card.own
              ? ` · ${nameOf(card.ownerHolonId)}`
              : ""}</span
          >
        </div>
      </div>
      <div class="level">
        {#if !card.legacy}<span class="big"
            >{fmtQty(card.quantity, card.unit)}</span
          >{/if}
        <span class="status" class:st-ok={card.matchable}
          >{$t(needStatusKey(card))}</span
        >
      </div>
      {#if card.need.description}<p class="lead">
          {card.need.description}
        </p>{/if}

      {#if needResponses.length}
        <h4>{$t("offers.responsesTitle")}</h4>
        <ul class="hist">
          {#each needResponses as r (r.id)}
            <li>
              <span class="delta">{r.responder?.name ?? r.responder?.id}</span>
              <span class="what"
                >{r.message ?? ""}{r.offerId
                  ? ` · ${r.offerId}`
                  : ""}{r.price != null
                  ? ` · ${r.price} ${r.currency ?? ""}`
                  : ""}</span
              >
              {#if card.mine && card.need.status === "offered"}
                <button
                  type="button"
                  class="chip"
                  disabled={busy}
                  on:click={() => claimResponse(card, r.id)}
                  >{$t("offers.acceptResponse")}</button
                >
              {:else if card.need.claimedResponseId === r.id}
                <span class="status st-ok">✓</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      {#if card.matchable && !card.mine && viewerId}
        <p class="lead">{$t("offers.respondLead")}</p>
        <input
          class="line"
          bind:value={rMessage}
          placeholder={$t("offers.respondPlaceholder")}
          maxlength="160"
        />
        <div class="actions">
          <button class="primary" disabled={busy} on:click={() => respond(card)}
            >{$t("offers.respond")}</button
          >
        </div>
      {:else if card.need.status === "claimed" && needParty === "requester"}
        <p class="lead">
          {$t("offers.yourCode", { code: card.need.handoff?.code ?? "" })}
        </p>
        {#if !needConfirms.requesterAt && !card.need.handoff?.requesterAt}
          <div class="actions">
            <button
              class="primary"
              disabled={busy}
              on:click={() => confirmHandoff(card, "requester")}
              >{$t("offers.confirmRequester")}</button
            >
          </div>
        {:else}<p class="lead">{$t("offers.confirmed")}</p>{/if}
      {:else if card.need.status === "claimed" && needParty === "provider"}
        {#if !needConfirms.providerAt && !card.need.handoff?.providerAt}
          <p class="lead">{$t("offers.codeLead")}</p>
          <input
            class="line"
            bind:value={rCode}
            placeholder={$t("offers.codePlaceholder")}
            maxlength="8"
            autocapitalize="characters"
          />
          <div class="actions">
            <button
              class="primary"
              disabled={busy || !rCode.trim()}
              on:click={() => confirmHandoff(card, "provider")}
              >{$t("offers.confirmProvider")}</button
            >
          </div>
        {:else}<p class="lead">{$t("offers.waiting")}</p>{/if}
      {:else if card.need.status === "claimed"}
        <p class="lead">{$t("offers.claimedBy")}</p>
      {/if}
    </div>
  </Modal>
{/if}

{#if formOpen}
  <Modal on:close={() => (formOpen = false)}>
    <div class="form">
      <div class="glyph" aria-hidden="true">{editing ? "✎" : "＋"}</div>
      <h3>{$t(editing ? "offers.editOffer" : "offers.addOffer")}</h3>
      {#if !editing}<p class="lead">{$t("offers.addLead")}</p>{/if}
      <input
        class="line"
        bind:value={fTitle}
        placeholder={$t("offers.whatPlaceholder")}
        maxlength="80"
      />
      <input
        class="line"
        bind:value={fCategory}
        placeholder={$t("offers.categoryPlaceholder")}
        maxlength="40"
      />
      <div class="qtyrow">
        <input
          class="line"
          type="number"
          inputmode="decimal"
          min="0"
          step="any"
          bind:value={fQty}
          placeholder={$t("offers.howMuch")}
        />
        <span class="unit"
          >{$t(
            UNITS.find((u) => u.id === fUnit)?.key ?? "stock.unit.one",
          )}</span
        >
      </div>
      <div class="types" role="radiogroup" aria-label={$t("offers.unit")}>
        {#each UNITS as u (u.id)}
          <button
            type="button"
            class="typechip"
            class:on={fUnit === u.id}
            role="radio"
            aria-checked={fUnit === u.id}
            on:click={() => (fUnit = u.id)}
            ><span class="tl">{$t(u.key)}</span></button
          >
        {/each}
      </div>
      <div class="types three" role="radiogroup" aria-label={$t("offers.how")}>
        {#each ["give", "lend", "sell"] as m (m)}
          <button
            type="button"
            class="typechip"
            class:on={fMode === m}
            role="radio"
            aria-checked={fMode === m}
            on:click={() => (fMode = m as OfferMode)}
            ><span class="tl">{$t(MODE_KEY[m as OfferMode])}</span></button
          >
        {/each}
      </div>
      {#if fMode === "sell"}
        <div class="qtyrow">
          <input
            class="line"
            type="number"
            inputmode="decimal"
            min="0"
            step="any"
            bind:value={fPrice}
            placeholder={$t("offers.price")}
          />
          <input
            class="line short"
            bind:value={fCurrency}
            maxlength="8"
            placeholder={$t("offers.currency")}
          />
        </div>
      {/if}
      <input
        class="line"
        bind:value={fNotes}
        placeholder={$t("offers.notesPlaceholder")}
        maxlength="240"
      />
      <div class="actions">
        <button
          class="primary"
          on:click={saveOffer}
          disabled={saving || !fTitle.trim()}
          >{saving
            ? $t("offers.saving")
            : $t(editing ? "offers.save" : "offers.listIt")}</button
        >
        <button class="ghost" on:click={() => (formOpen = false)}
          >{$t("common.cancel")}</button
        >
      </div>
    </div>
  </Modal>
{/if}

{#if shareOpen && shareTarget}
  <Modal on:close={() => (shareOpen = false)}>
    <div class="form">
      <div class="glyph" aria-hidden="true">⇄</div>
      <h3>{$t("offers.share")}</h3>
      <p class="lead">{$t("offers.shareLead")}</p>
      <label class="opt" class:on={shToPartners}>
        <input type="checkbox" bind:checked={shToPartners} />
        <span class="ol"
          >{$t("offers.sharePartners")}<small
            >{federated.length
              ? $t("offers.sharePartnersHint", { n: federated.length })
              : $t("offers.sharePartnersNone")}</small
          ></span
        >
      </label>
      <label class="opt" class:on={shToHex} class:off={!homeHex}>
        <input type="checkbox" bind:checked={shToHex} disabled={!homeHex} />
        <span class="ol"
          >{$t("offers.shareMap")}<small
            >{homeHex
              ? $t("offers.shareMapHint")
              : $t("offers.shareMapNone")}</small
          ></span
        >
      </label>
      <div class="actions">
        <button
          class="primary"
          on:click={share}
          disabled={sharing || (!shToPartners && !shToHex)}
          >{sharing ? $t("offers.shareBusy") : $t("offers.share")}</button
        >
        <button class="ghost" on:click={() => (shareOpen = false)}
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
  .offers {
    flex: 1;
    min-height: 0;
    padding: 0.5rem 1.4rem 5.5rem;
    max-width: 52rem;
    width: 100%;
    margin: 0 auto;
  }
  .scale {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin: 0.2rem 0 0.6rem;
  }
  .scalechip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.4rem 0.75rem;
    border-radius: 999px;
    border: 1.5px solid var(--line);
    background: var(--card);
    color: var(--ink);
    font-size: 0.8rem;
    font-weight: 700;
  }
  .scalechip .g {
    color: var(--teal-deep);
  }
  .scalechip.on {
    background: var(--teal);
    border-color: var(--teal);
    color: #fff;
  }
  .scalechip.on .g {
    color: #fff;
  }
  .section {
    margin: 1rem 0 0.45rem;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
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
    opacity: 0.7;
  }
  .row.is-foreign {
    border-left: 4px solid var(--teal);
  }
  .row.committed {
    border-color: var(--teal);
  }
  .row .text {
    flex: 1;
    min-width: 0;
  }
  .row h3 {
    margin: 0;
    font-size: 0.98rem;
    color: var(--ink);
  }
  .arrow {
    color: var(--muted);
    margin: 0 0.25rem;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.6rem;
    align-items: center;
    margin-top: 0.15rem;
    font-size: 0.78rem;
    color: var(--muted);
  }
  .rtype {
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 0.68rem;
    font-weight: 800;
    color: var(--teal-deep);
  }
  .basis {
    font-size: 0.78rem;
    color: var(--muted);
  }
  .tag {
    font-size: 0.66rem;
    font-weight: 800;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    background: var(--paper-deep);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-soft);
  }
  .tag.live {
    background: color-mix(in srgb, var(--teal) 22%, var(--card));
    color: var(--ink);
  }
  .bar {
    height: 5px;
    border-radius: 3px;
    background: var(--paper-deep);
    overflow: hidden;
    margin-top: 0.35rem;
  }
  .bar.thin {
    height: 3px;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--teal);
    transition: width 0.3s ease;
  }
  .fill.hot {
    background: var(--warn);
  }
  .qty {
    font-size: 1.15rem;
    font-weight: 800;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .status {
    flex: 0 0 auto;
    white-space: nowrap;
    font-size: 0.76rem;
    font-weight: 700;
    color: var(--ink-soft);
    background: var(--paper-deep);
    border-radius: 999px;
    padding: 0.15rem 0.7rem;
  }
  .status.st-open,
  .status.st-ok {
    background: color-mix(in srgb, var(--teal) 22%, var(--card));
    color: var(--ink);
  }
  .status.st-reserved {
    background: var(--note-sun);
    color: var(--ink);
  }
  .status.short {
    background: var(--note-coral);
    color: var(--ink);
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
  .chip.ghost {
    background: var(--card);
    color: var(--teal-deep);
    border: 1.5px solid var(--line);
  }
  .chip:disabled {
    opacity: 0.6;
  }
  .auto {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 0.65rem 0.8rem;
    border: 1.5px dashed var(--line);
    border-radius: 14px;
    margin-bottom: 0.6rem;
  }
  .auto .text {
    flex: 1;
    min-width: 0;
  }
  .auto h3 {
    margin: 0;
    font-size: 0.95rem;
    color: var(--ink);
  }
  .auto .basis {
    display: block;
    margin-top: 0.15rem;
  }
  .switch {
    position: relative;
    width: 3rem;
    height: 1.7rem;
    border-radius: 999px;
    background: var(--paper-deep);
    border: 1.5px solid var(--line);
    flex-shrink: 0;
    transition: background 0.15s ease;
  }
  .switch.on {
    background: var(--teal);
    border-color: var(--teal);
  }
  .switch .knob {
    position: absolute;
    top: 0.12rem;
    left: 0.12rem;
    width: 1.3rem;
    height: 1.3rem;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s ease;
  }
  .switch.on .knob {
    transform: translateX(1.3rem);
  }
  .empty {
    color: var(--muted);
    text-align: center;
    padding: 3rem 1rem;
    font-size: 1.1rem;
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
  .sheet .tools {
    display: flex;
    gap: 0.4rem;
    flex-shrink: 0;
    margin-right: 2.4rem;
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
  .icon-btn.done {
    color: var(--teal);
  }
  .level {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    margin: 0.7rem 0 0.3rem;
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
  .sheet .lead,
  .form .lead {
    color: var(--muted);
    margin: 0.3rem 0 0.5rem;
    font-size: 0.9rem;
  }
  .sheet h4 {
    margin: 0.6rem 0 0.3rem;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .hist {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 14rem;
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
    align-items: center;
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
  .line.short {
    flex: 0 0 7rem;
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
    margin-bottom: 0.6rem;
  }
  .types {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.4rem;
    margin-bottom: 0.6rem;
  }
  .types.three {
    grid-template-columns: repeat(3, 1fr);
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
    color: var(--ink);
  }
  .typechip.on {
    border-color: var(--teal);
    background: color-mix(in srgb, var(--teal) 16%, var(--card));
  }
  .opt {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    text-align: left;
    padding: 0.6rem 0.7rem;
    border: 1.5px solid var(--line);
    border-radius: 14px;
    margin-bottom: 0.5rem;
    background: var(--card);
  }
  .opt.on {
    border-color: var(--teal);
  }
  .opt.off {
    opacity: 0.55;
  }
  .opt input {
    margin-top: 0.2rem;
    width: 1.1rem;
    height: 1.1rem;
    accent-color: var(--teal);
  }
  .opt .ol {
    display: flex;
    flex-direction: column;
    font-weight: 700;
    color: var(--ink);
    font-size: 0.92rem;
  }
  .opt .ol small {
    font-weight: 500;
    color: var(--muted);
    font-size: 0.78rem;
  }
</style>
