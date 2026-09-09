<script lang="ts">
  // SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Offers & Needs — the market, read as resources matched to needs. Built
  // the way the Stock board is: one column, pills to switch lanes, cards a
  // thumb can tap, sheets instead of tables.
  //
  //   SUPPLY   what is on the table — this holon's offers (the shelf's
  //            surplus among them, kept in step automatically), then the
  //            partners' and the cell's as the scale widens.
  //   MATCHES  who could serve whom: the transport plan's legs, offers as
  //            supply and needs as demand, cheapest road first, with each
  //            need's contention (its dual price). One tap commits.
  //   DEMAND   the needs and requests at this scale; respond / accept /
  //            hand off as before.
  //
  // The SCALE control widens the market: this holon → its partners → its
  // home cell → the cells above, where every offer and need published under
  // the cell is one read away. Meaning lives in `@holons/core/offers`;
  // `$lib/offers` arranges it for the screen. Every await is followed by a
  // holon-identity check.
  import { onDestroy, getContext } from "svelte";
  import type { HoloSphere } from "holosphere";
  import { ID } from "../dashboard/store";
  import { telegramUser } from "$lib/stores/telegram";
  import { nostrPublicKey } from "$lib/stores/nostr";
  import { showFederated } from "$lib/stores/lensFilters";
  import { awaitName } from "$lib/stores/nameResolver";
  import { loadFilters, saveFilters } from "$lib/util/persistedFilters";
  import { notifyWriteDenied } from "$lib/stores/writeNotifications";
  import { getSelfInitiator, mergeSelfIntoUsers } from "$lib/util/usersWithSelf";
  import { getFederationSnapshot, readSettingsHex } from "$lib/holosphere/publish";
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
    fmtQty,
    groupByCategory,
    normalizeLens,
    scaleById,
    scaleOptions,
    type MatchCard,
    type NeedCard,
    type OfferCard,
    type Scale,
  } from "$lib/offers";
  import PillSwitch from "./flows/PillSwitch.svelte";
  import Sheet from "./flows/Sheet.svelte";
  import OfferDetailModal from "./OfferDetailModal.svelte";
  import ShareNeedModal from "./shared/ShareNeedModal.svelte";

  const holosphere = getContext("holosphere") as HoloSphere;
  const BOT_API_URL = (import.meta.env.VITE_BOT_API_URL || "").replace(/\/$/, "");

  type Lane = "supply" | "matches" | "demand";
  const LANES: { id: Lane; label: string; glyph: string }[] = [
    { id: "supply", label: "Supply", glyph: "▤" },
    { id: "matches", label: "Matches", glyph: "⇄" },
    { id: "demand", label: "Demand", glyph: "◎" },
  ];

  let prefs = loadFilters("offers", { lane: "matches", scale: "partners" });
  $: saveFilters("offers", prefs);
  $: lane = (LANES.some((l) => l.id === prefs.lane) ? prefs.lane : "matches") as Lane;

  // ── Data ────────────────────────────────────────────────────────────────
  let holonID = "";
  let loading = true;
  let quests: unknown[] = [];
  let federated: string[] = [];
  let partnerNames: Record<string, string> = {};
  let partnerGraph: PartnerGraph = {};
  let hexOf: Record<string, string | undefined> = {};
  let homeHex: string | null = null;
  let cell: CellMarket | null = null;
  let cellLoading = false;
  let autoOffer = true;
  let userStore: Record<string, unknown> = {};

  let questsSub: { unsubscribe: () => void; setFederated: (on: boolean) => void } | undefined;
  let usersOff: (() => void) | null = null;
  let cellTimer: ReturnType<typeof setInterval> | null = null;
  let loadingFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  const REFRESH_MS = 30_000;

  $: if ($ID && $ID !== holonID) void bind($ID);

  let lastFedFlag = $showFederated;
  $: if (holonID && $showFederated !== lastFedFlag) {
    lastFedFlag = $showFederated;
    questsSub?.setFederated($showFederated);
  }

  function teardown() {
    questsSub?.unsubscribe();
    questsSub = undefined;
    usersOff?.();
    usersOff = null;
    if (cellTimer) clearInterval(cellTimer);
    cellTimer = null;
    if (loadingFallbackTimer) clearTimeout(loadingFallbackTimer);
    loadingFallbackTimer = null;
  }
  onDestroy(teardown);

  async function bind(id: string) {
    teardown();
    holonID = id;
    quests = [];
    federated = [];
    partnerGraph = {};
    hexOf = {};
    homeHex = null;
    cell = null;
    openOffer = null;
    openNeed = null;
    formOpen = false;
    loading = true;
    if (!holosphere || !id) {
      loading = false;
      return;
    }
    loadingFallbackTimer = setTimeout(() => {
      if (holonID === id) loading = false;
    }, 9000);
    try {
      questsSub = holosphere.subscribeFederated(
        id,
        "quests",
        (items: unknown[]) => {
          if (holonID !== id) return;
          quests = normalizeLens(items);
          loading = false;
        },
        { includeFederated: $showFederated },
      );
    } catch (err) {
      console.error("[offers] subscribe failed", err);
      loading = false;
    }
    void loadFederation(id);
    void loadUsers(id);
    void readAutoOfferSetting(holosphere, id).then((on) => {
      if (holonID === id) autoOffer = on;
    });
  }

  async function loadFederation(id: string) {
    try {
      const [snapshot, hex] = await Promise.all([getFederationSnapshot(holosphere, id), readSettingsHex(holosphere, id)]);
      if (holonID !== id) return;
      homeHex = hex;
      hexOf = { ...hexOf, [id]: hex ?? undefined };
      federated = (snapshot.federated ?? []).map(String);
      partnerNames = { ...snapshot.partnerNames, ...partnerNames };
      partnerGraph = { [id]: federated };
      for (const pid of federated) {
        if (!partnerNames[pid]) {
          awaitName(pid)
            .then((name) => {
              if (holonID !== id || !name) return;
              partnerNames = { ...partnerNames, [pid]: name };
            })
            .catch(() => {});
        }
        void Promise.all([getFederationSnapshot(holosphere, pid).catch(() => null), readSettingsHex(holosphere, pid)]).then(
          ([snap, phex]) => {
            if (holonID !== id) return;
            if (snap) partnerGraph = { ...partnerGraph, [pid]: (snap.federated ?? []).map(String) };
            if (phex) hexOf = { ...hexOf, [pid]: phex };
          },
        );
      }
    } catch (err) {
      console.warn("[offers] federation load failed", err);
    }
  }

  async function loadUsers(id: string) {
    try {
      const initial = ((await holosphere.getAll(id, "users")) ?? []) as { id?: string | number }[];
      if (holonID !== id) return;
      const keyed: Record<string, { id?: string | number }> = {};
      for (const u of initial) if (u?.id != null) keyed[String(u.id)] = u;
      userStore = mergeSelfIntoUsers(keyed as never) as Record<string, unknown>;
    } catch {
      userStore = mergeSelfIntoUsers({}) as Record<string, unknown>;
    }
    try {
      const sub = holosphere.subscribe(id, "users", (u: { id?: string | number } | null, key?: string) => {
        if (holonID !== id) return;
        const k = String(u?.id ?? key ?? "");
        if (!k) return;
        if (u) userStore = { ...userStore, [k]: u };
        else {
          const { [k]: _drop, ...rest } = userStore;
          userStore = rest;
        }
      });
      usersOff = typeof sub === "function" ? sub : (sub as { unsubscribe?: () => void })?.unsubscribe?.bind(sub) ?? null;
    } catch {
      /* users are a courtesy for the detail modal */
    }
  }

  // ── Scale ───────────────────────────────────────────────────────────────
  $: options = scaleOptions(homeHex, federated.length);
  $: scaleId = options.some((o) => o.id === prefs.scale) ? prefs.scale : "partners";
  $: scale = scaleById(options, scaleId) as Scale;
  $: void watchCell(scale, holonID);

  let cellKey = "";
  async function watchCell(s: Scale, id: string) {
    const key = s.kind === "cell" ? `${id}:${s.cell}` : "";
    if (key === cellKey) return;
    cellKey = key;
    if (cellTimer) clearInterval(cellTimer);
    cellTimer = null;
    cell = null;
    if (s.kind !== "cell" || !id) return;
    const read = async () => {
      cellLoading = true;
      try {
        const market = await readCellMarket(holosphere, s.cell);
        if (holonID !== id || cellKey !== key) return;
        cell = market;
      } finally {
        if (cellKey === key) cellLoading = false;
      }
    };
    await read();
    cellTimer = setInterval(() => void read(), REFRESH_MS);
  }

  // ── Derivations ─────────────────────────────────────────────────────────
  $: self = getSelfInitiator();
  $: viewerId = self?.id ?? ($telegramUser ? String($telegramUser.id) : $nostrPublicKey ? String($nostrPublicKey) : null);
  $: board = holonID
    ? buildOfferBoard({ holonId: holonID, viewerId, scale, quests, cell, partners: partnerGraph, hexOf })
    : null;
  $: supplyGroups = board ? groupByCategory(board.supply) : [];
  $: autoCards = board ? board.supply.filter((c) => c.own && c.auto) : [];
  $: handoffConfirmations = foldHandoffConfirmations(quests as never[]);
  $: nameOf = (id: string) => (id === holonID ? "here" : (partnerNames[id] ?? id));
  $: matchGroups = board
    ? (["provider", "requester", "observer"] as const)
        .map((role) => ({ role, cards: board!.matches.filter((m) => m.role === role) }))
        .filter((g) => g.cards.length)
    : [];
  const ROLE_TITLE: Record<MatchCard["role"], string> = {
    provider: "You could serve",
    requester: "Could serve you",
    observer: "Around you",
  };
  const STATE_LABEL: Record<MatchCard["state"], string> = {
    proposed: "proposed",
    responded: "offered",
    claimed: "accepted · handoff",
    settled: "delivered",
  };
  const MODE_LABEL: Record<OfferMode, string> = { give: "Give", lend: "Lend", sell: "Sell" };

  $: initiator = self
    ? { id: self.id, username: self.username, firstName: self.firstName, lastName: self.lastName }
    : $nostrPublicKey
      ? { id: String($nostrPublicKey), username: String($nostrPublicKey).slice(0, 8) }
      : null;

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
    return e?.name === "AuthorizationError" || /denied|unauthori[sz]ed|permission/i.test(String(e?.message ?? ""));
  };
  function fail(err: unknown, text: string) {
    console.error("[offers]", err);
    if (isDenied(err)) {
      notifyWriteDenied("Unable to save — no write permission for this holon");
      say("You can't change this.");
    } else say(text);
  }
  function requireSelf() {
    if (!initiator) say("Sign in to take part in the market.");
    return initiator;
  }
  function notifyNeedBot(event: "responded" | "claimed" | "settled", holon: string, needId: string) {
    if (!BOT_API_URL) return;
    fetch(`${BOT_API_URL}/notify/need`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ holon, needId, event }),
    }).catch(() => {});
  }
  /** Optimistic: swap a record into the stream so the card does not blink in late. */
  function upsertLocal(record: { id?: unknown }) {
    quests = [
      ...quests.filter((q) => {
        const r = q as { id?: unknown; _federation?: unknown; _hologram?: unknown };
        return r?.id !== record.id || r._federation || r._hologram;
      }),
      record,
    ];
  }

  // ── Offer form (create / edit) ──────────────────────────────────────────
  const UNITS: { id: string; label: string }[] = [
    { id: "one", label: "pieces" },
    { id: "kg", label: "kg" },
    { id: "l", label: "litres" },
    { id: "m", label: "metres" },
    { id: "hour", label: "hours" },
    { id: "pack", label: "packs" },
  ];
  const unitLabel = (unit: string) => UNITS.find((u) => u.id === unit)?.label ?? unit;
  let formOpen = false;
  let editing: OfferRecord | null = null;
  let fTitle = "";
  let fDescription = "";
  let fCategory = "";
  let fQty: string | number = "1";
  let fUnit = "one";
  let fMode: OfferMode = "give";
  let fPrice: string | number = "";
  let fCurrency = "EUR";
  let fService = false;
  let fExpires = "";
  let saving = false;
  let formError = "";

  const num = (raw: string | number | null | undefined): number | null => {
    if (raw == null) return null;
    const text = String(raw).trim().replace(",", ".");
    if (text === "") return null;
    const v = Number(text);
    return Number.isFinite(v) && v >= 0 ? v : null;
  };

  function openAdd() {
    if (!requireSelf()) return;
    editing = null;
    fTitle = "";
    fDescription = "";
    fCategory = "";
    fQty = "1";
    fUnit = "one";
    fMode = "give";
    fPrice = "";
    fCurrency = "EUR";
    fService = false;
    fExpires = "";
    formError = "";
    formOpen = true;
  }
  function openEdit(offer: OfferRecord) {
    if (!requireSelf()) return;
    editing = offer;
    fTitle = String(offer.title ?? "");
    fDescription = String(offer.description ?? "");
    fCategory = offer.category ?? "";
    fQty = String(offer.supply.quantity);
    fUnit = offer.supply.unit;
    fMode = offer.mode;
    fPrice = offer.price != null ? String(offer.price) : "";
    fCurrency = offer.currency ?? "EUR";
    fService = (offer as { item_type?: string }).item_type === "service";
    fExpires = offer.expires_at ? new Date(offer.expires_at).toISOString().slice(0, 10) : "";
    formError = "";
    formOpen = true;
  }

  async function saveOffer() {
    const id = holonID;
    const who = initiator;
    if (!id || !who || !fTitle.trim() || saving) return;
    const quantity = num(fQty);
    if (!quantity || quantity <= 0) {
      formError = "How many?";
      return;
    }
    saving = true;
    formError = "";
    const expiresAt = fExpires ? Date.parse(fExpires + "T23:59:59") : undefined;
    try {
      if (editing) {
        const out = editOffer(editing, {
          title: fTitle,
          description: fDescription || undefined,
          category: fCategory,
          supply: { ...editing.supply, quantity, unit: fUnit },
          mode: fMode,
          price: fMode === "sell" ? (num(fPrice) ?? undefined) : undefined,
          currency: fMode === "sell" ? fCurrency : undefined,
          expires_at: Number.isFinite(expiresAt) ? expiresAt : undefined,
        });
        if (!out.ok) {
          formError = out.reason === "below_reserved" ? "You've promised more than that already." : "This offer is closed.";
          return;
        }
        const r = await refreshPublishedOffer(holosphere, id, out.offer, { federationSourceId: $nostrPublicKey ?? undefined, onWriteDenied: ({ message }) => notifyWriteDenied(message) });
        if (holonID !== id) return;
        upsertLocal(r.offer);
        if (openOffer && openOffer.offer.id === r.offer.id) openOffer = { ...openOffer, offer: r.offer };
        say("Offer updated.");
      } else {
        const offer = createOffer({
          holonId: id,
          initiator: who,
          title: fTitle,
          description: fDescription || undefined,
          category: fCategory || undefined,
          supply: { quantity, unit: fUnit },
          mode: fMode,
          price: fMode === "sell" ? (num(fPrice) ?? undefined) : undefined,
          currency: fMode === "sell" ? fCurrency : undefined,
          itemType: fService ? "service" : "good",
          expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
        });
        await holosphere.put(id, "quests", offer);
        if (holonID !== id) return;
        upsertLocal(offer);
        say("Offer listed here. Share it to reach partners and the map.");
        shareTarget = offer;
        shareOpen = true;
      }
      formOpen = false;
    } catch (err) {
      fail(err, "Couldn't save the offer.");
    } finally {
      saving = false;
    }
  }

  // ── Offer sheet / share / withdraw ──────────────────────────────────────
  let openOffer: OfferCard | null = null;
  let openNeed: NeedCard | null = null;
  let shareOpen = false;
  let shareTarget: OfferRecord | null = null;
  let sharing = false;
  let shareStatus = "";
  let confirmWithdraw = false;
  let withdrawing = false;

  $: if (openOffer && board) {
    const fresh = board.supply.find((c) => c.key === openOffer!.key);
    if (fresh && fresh.offer !== openOffer.offer) openOffer = fresh;
  }

  async function share(ev: CustomEvent<{ toPartners: boolean; toHex: boolean }>) {
    const id = holonID;
    const offer = shareTarget;
    if (!id || !offer) return;
    sharing = true;
    shareStatus = "";
    try {
      const out = await publishOfferNearby(holosphere, id, offer, {
        toPartners: ev.detail.toPartners,
        toHex: ev.detail.toHex,
        federationSourceId: $nostrPublicKey ?? undefined,
        onWriteDenied: ({ message }) => notifyWriteDenied(message),
      });
      if (holonID !== id) return;
      upsertLocal(out.offer);
      shareStatus = out.errors.length ? out.errors.join(" · ") : "";
      if (!out.errors.length) {
        shareOpen = false;
        say(ev.detail.toHex ? "Shared with partners and lit on the map." : "Shared with partners.");
      }
    } catch (err) {
      fail(err, "Couldn't share the offer.");
    } finally {
      sharing = false;
    }
  }

  async function withdraw(card: OfferCard) {
    const id = holonID;
    if (!id || withdrawing) return;
    withdrawing = true;
    try {
      const out = await withdrawPublishedOffer(holosphere, id, card.offer, { federationSourceId: $nostrPublicKey ?? undefined, onWriteDenied: ({ message }) => notifyWriteDenied(message) });
      if (holonID !== id) return;
      if (!out.ok) {
        say(out.reason === "has_live_reservations" ? "Someone is counting on this offer — settle or release it first." : "Already closed.");
        return;
      }
      upsertLocal(out.offer);
      confirmWithdraw = false;
      openOffer = null;
      say("Offer withdrawn.");
    } catch (err) {
      fail(err, "Couldn't withdraw the offer.");
    } finally {
      withdrawing = false;
    }
  }

  async function toggleAutoOffer(on: boolean) {
    const id = holonID;
    const who = initiator;
    if (!id || !who) return;
    autoOffer = on;
    try {
      const settings = ((await holosphere.get(id, "settings", id)) ?? { id }) as Record<string, unknown> & { stock?: Record<string, unknown> };
      await holosphere.put(id, "settings", { ...settings, id, stock: { ...(settings.stock ?? {}), autoOffer: on } });
      const out = await syncSurplusFromShelf(holosphere, id, { initiator: who, enabled: on, federationSourceId: $nostrPublicKey ?? undefined });
      if (holonID !== id) return;
      for (const o of [...out.created, ...out.updated, ...out.withdrawn]) upsertLocal(o);
      say(on ? `Surplus offers on — ${out.created.length} listed.` : `Surplus offers off — ${out.withdrawn.length} withdrawn.`);
    } catch (err) {
      autoOffer = !on;
      fail(err, "Couldn't change the setting.");
    }
  }

  // ── Matches: one tap ────────────────────────────────────────────────────
  let accepting: string | null = null;

  async function offerIt(m: MatchCard) {
    const id = holonID;
    const who = requireSelf();
    if (!id || !who || !m.offer || !m.need || accepting) return;
    accepting = m.key;
    try {
      const ref = ownerRef(m.need.raw, id, String(m.need.need.id));
      const out = await acceptMatch(
        { holosphere },
        {
          offer: m.offer.offer,
          offerHolonId: m.offer.ownerHolonId,
          need: m.need.need,
          needHolonId: ref?.holon ?? m.need.ownerHolonId,
          needKey: ref?.key,
          quantity: m.leg.quantity,
          actor: { id: who.id, name: `${who.firstName ?? ""} ${who.lastName ?? ""}`.trim() || who.username },
          federationSourceId: $nostrPublicKey ?? undefined,
          onWriteDenied: ({ message }) => notifyWriteDenied(message),
        },
      );
      if (holonID !== id) return;
      if (!out.ok) {
        say(
          out.reason === "own_need"
            ? "That's your own need."
            : out.reason === "insufficient"
              ? "Not enough left on the offer."
              : out.reason === "closed"
                ? "That need is closed."
                : "Couldn't offer it.",
        );
        return;
      }
      upsertLocal(out.offer);
      if (m.need.own) upsertLocal(out.need);
      else quests = quests.map((q) => ((q as { id?: unknown })?.id === m.need!.need.id && ownerRef(q, id, String(m.need!.need.id)) ? { ...(q as object), status: out.need.status, responses: out.need.responses } : q));
      notifyNeedBot("responded", ref?.holon ?? m.need.ownerHolonId, String(ref?.key ?? m.need.need.id));
      say(`Offered ${fmtQty(m.leg.quantity, m.offer.offer.supply.unit)} — the requester can now accept.`);
    } catch (err) {
      fail(err, "Couldn't offer it.");
    } finally {
      accepting = null;
    }
  }

  /** The requester accepts the response that drew on the offer. */
  async function acceptIt(m: MatchCard) {
    if (!m.need) return;
    const resp = (m.need.need.responses ?? []).find((r) => r.offerId === m.leg.offerId);
    if (!resp) return;
    accepting = m.key;
    try {
      await claimNeedItem(m.need.raw, resp.id);
    } finally {
      accepting = null;
    }
  }

  // ── Need actions (carried over; the detail modal drives them) ───────────
  let handoffNotice = "";

  async function respondToNeedItem(item: unknown, message: string, price: number | null) {
    const id = holonID;
    const who = requireSelf();
    if (!id || !who) return;
    const need = normalizeNeed(item);
    if (!need) return;
    const result = respondToNeed(need, {
      responder: { id: who.id, name: `${who.firstName} ${who.lastName}`.trim() || who.username, holonId: id },
      message: message || undefined,
      price: price ?? undefined,
    });
    if (!result.ok) {
      say(result.reason === "own_need" ? "That's your own need." : "That need is closed.");
      return;
    }
    const ref = ownerRef(item, id, String(need.id));
    const target = ref?.holon ?? id;
    const { _hologram, _federation, key: _k, ...record } = result.need as Record<string, unknown>;
    if (ref?.key) record.id = ref.key;
    try {
      await holosphere.put(target, "quests", record);
      notifyNeedBot("responded", target, String(record.id));
      if (openNeed && String(openNeed.need.id) === String(need.id)) openNeed = { ...openNeed, need: result.need, raw: { ...(openNeed.raw as object), status: result.need.status, responses: result.need.responses } };
      say("Response sent.");
    } catch (err) {
      fail(err, "Couldn't respond.");
    }
  }

  async function claimNeedItem(item: unknown, responseId: string) {
    const id = holonID;
    if (!id) return;
    const { _hologram, _federation, key: _k, ...bare } = item as Record<string, unknown>;
    const need = normalizeNeed(bare);
    if (!need) return;
    const result = claimNeed(need, responseId);
    if (!result.ok) {
      handoffNotice = result.reason === "not_offered" ? "Nothing to accept yet." : "That response is gone.";
      say(handoffNotice);
      return;
    }
    const ref = ownerRef(item, id, String(need.id));
    try {
      if (ref?.holon) await holosphere.put(ref.holon, "quests", { ...result.need, id: ref.key ?? String(need.id) });
      else await refreshPublishedNeed(holosphere, id, result.need);
      if (holonID !== id) return;
      notifyNeedBot("claimed", ref?.holon ?? id, String(ref?.key ?? need.id));
      handoffNotice = "";
      if (!ref?.holon) upsertLocal(result.need);
      if (openNeed && String(openNeed.need.id) === String(need.id)) openNeed = { ...openNeed, need: result.need, raw: { ...(openNeed.raw as object), ...result.need } };
      say(`Accepted. Handoff code: ${result.need.handoff?.code ?? ""}`);
    } catch (err) {
      fail(err, "Couldn't accept.");
    }
  }

  async function confirmNeedHandoffItem(item: unknown, party: "requester" | "provider", code?: string) {
    const id = holonID;
    if (!id) return;
    const { _hologram, _federation, key: _k, ...bare } = item as Record<string, unknown>;
    const need = normalizeNeed(bare);
    if (!need) return;
    const ref = ownerRef(item, id, String(need.id));
    const owner = ref?.holon ?? id;
    const needKey = ref?.key ?? String(need.id);
    try {
      const result = await confirmNeedHandoff(holosphere, owner, need, party, { code, key: needKey, confirmations: handoffConfirmations });
      if (!result.ok) {
        handoffNotice = result.reason === "bad_code" ? "That code doesn't match — check the requester's screen." : "The handoff is not ready yet.";
        return;
      }
      handoffNotice = "";
      if (result.both) {
        const settled = await settleNeedHandoff({ holosphere }, owner, { ...result.need, id: needKey });
        if (settled.errors.length) console.warn("[offers] settlement partial:", settled.errors);
        notifyNeedBot("settled", owner, needKey);
        say(settled.offerSettled ? "Delivered — the offer and the shelf are updated." : "Delivered.");
      } else say("Confirmed on your side.");
      if (openNeed && String(openNeed.need.id) === String(need.id)) {
        openNeed = { ...openNeed, raw: { ...(openNeed.raw as object), status: result.both ? "fulfilled" : result.need.status, handoff: result.need.handoff } };
      }
    } catch (err) {
      fail(err, "Couldn't confirm.");
    }
  }

  // Legacy requests keep join / leave.
  async function setParticipation(item: Record<string, unknown>, user: { id: string | number; first_name?: string; last_name?: string; username?: string }, join: boolean) {
    const id = holonID;
    if (!id) return;
    const list = (Array.isArray(item.participants) ? item.participants : []) as { id: string | number }[];
    const has = list.some((p) => String(p.id) === String(user.id));
    if (join === has) return;
    const participants = join
      ? [...list, { id: user.id, firstName: user.first_name, lastName: user.last_name, username: user.username }]
      : list.filter((p) => String(p.id) !== String(user.id));
    try {
      await holosphere.put(id, "quests", { ...item, participants });
      if (openNeed && openNeed.need.id === item.id) openNeed = { ...openNeed, raw: { ...item, participants } };
    } catch (err) {
      fail(err, "Couldn't update.");
    }
  }

  function closeNeed() {
    openNeed = null;
    handoffNotice = "";
  }
</script>

<div class="board" id="offers-top">
  <header class="top">
    <div class="titles">
      <h1>Offers & Needs</h1>
      <p class="sub">Resources on the table, matched to what is needed — here, among partners, and across the map.</p>
    </div>
  </header>

  <nav class="tabs">
    <PillSwitch options={LANES} value={lane} onChange={(id) => (prefs.lane = id)} label="Which lane" stretch />
    <div class="scale">
      <span class="k">Scale</span>
      <PillSwitch options={options} value={scaleId} onChange={(id) => (prefs.scale = id)} label="How wide" compact />
      {#if cellLoading}<span class="basis">reading the cell…</span>{/if}
    </div>
  </nav>

  {#if loading && !quests.length}
    <p class="empty">Reading the market…</p>
  {:else if !board}
    <p class="empty">Pick a holon.</p>
  {:else if lane === "supply"}
    <section class="panel">
      <div class="stats">
        <div class="stat"><span class="n">{board.supply.filter((c) => c.own).length}</span><span class="l">offers here</span></div>
        <div class="stat"><span class="n">{board.supply.filter((c) => !c.own).length}</span><span class="l">around</span></div>
        <div class="stat"><span class="n">{board.unused}</span><span class="l">units unasked</span></div>
      </div>

      <div class="auto">
        <div class="text">
          <h3>From the shelf</h3>
          <p class="basis">
            {autoOffer
              ? `Surplus above each item's keep-back is offered automatically — ${autoCards.length} standing offer${autoCards.length === 1 ? "" : "s"}.`
              : "Surplus is not offered automatically."}
          </p>
        </div>
        <label class="switch">
          <input type="checkbox" checked={autoOffer} on:change={(e) => toggleAutoOffer((e.currentTarget as HTMLInputElement).checked)} />
          <span>{autoOffer ? "On" : "Off"}</span>
        </label>
      </div>

      {#if !board.supply.length}
        <div class="empty">
          <p>Nothing on the table at this scale.</p>
          <p class="lead">List what you can give, lend or sell — or widen the scale.</p>
        </div>
      {:else}
        {#each supplyGroups as group (group.category)}
          <h2 class="section">{group.category}</h2>
          <ul class="rows">
            {#each group.cards as card (card.key)}
              <li>
                <button type="button" class="row tap" class:is-foreign={!card.own} class:closed={card.offer.status !== "open" && card.offer.status !== "reserved"} on:click={() => (openOffer = card)}>
                  <span class="text">
                    <span class="name">{card.offer.title}</span>
                    <span class="meta">
                      <span class="rtype">{MODE_LABEL[card.offer.mode]}</span>
                      {#if card.auto}<span class="tag">auto</span>{/if}
                      {#if !card.own}<span class="basis">{nameOf(card.ownerHolonId)}{card.source === "cell" ? " · on the map" : ""}</span>{/if}
                      {#if card.offer.price != null}<span class="basis">{card.offer.price} {card.offer.currency ?? ""}</span>{/if}
                    </span>
                  </span>
                  <span class="qty">{fmtQty(card.remaining, card.offer.supply.unit)}</span>
                  <span class="status st-{card.offer.status}">{card.statusLabel}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/each}
      {/if}
    </section>
    <button type="button" class="fab" on:click={openAdd} aria-label="List an offer" title="List an offer">+</button>
  {:else if lane === "matches"}
    <section class="panel">
      {#if board.contention.length}
        <h2 class="section">Contention by category</h2>
        <ul class="rows">
          {#each board.contention as c (c.category)}
            <li class="row plain">
              <div class="text">
                <h3>{c.category}</h3>
                <div class="meta">
                  <span class="basis">{c.supply} offered · {c.demand} needed{c.shortage > 0 ? ` · ${c.shortage} nobody can cover` : ""}</span>
                </div>
                <div class="bar" aria-hidden="true"><span class="fill" class:hot={c.blocked > 0.5} style="width: {Math.round(c.blocked * 100)}%"></span></div>
              </div>
              <span class="status" class:short={c.blocked > 0} class:ok={c.blocked === 0}>{c.blocked > 0 ? `${Math.round(c.blocked * 100)}% blocked` : "covered"}</span>
            </li>
          {/each}
        </ul>
      {/if}

      {#if !board.matches.length}
        <div class="empty">
          <p>No match at this scale.</p>
          <p class="lead">
            {board.demand.some((d) => d.matchable)
              ? "Needs are open but nothing offered can reach them — widen the scale or list an offer."
              : "No open need to serve — widen the scale to see more of the market."}
          </p>
        </div>
      {:else}
        {#each matchGroups as group (group.role)}
          <h2 class="section">{ROLE_TITLE[group.role]}</h2>
          <ul class="rows">
            {#each group.cards as m (m.key)}
              <li class="row plain match" class:committed={m.committed}>
                <div class="text">
                  <h3>
                    {m.offer?.offer.title ?? m.leg.offerId}
                    <span class="arrow">→</span>
                    {m.need?.need.title ?? m.leg.needId}
                  </h3>
                  <div class="meta">
                    <span class="rtype">{m.leg.category}</span>
                    <span class="basis">{nameOf(m.leg.offerHolonId)} → {nameOf(m.leg.needHolonId)} · {m.distanceLabel}</span>
                    <span class="tag" class:live={m.state !== "proposed"}>{STATE_LABEL[m.state]}</span>
                  </div>
                  <div class="bar thin" title="How contested this need is" aria-hidden="true">
                    <span class="fill" class:hot={m.contention > 0.6} style="width: {Math.round(m.contention * 100)}%"></span>
                  </div>
                </div>
                <span class="qty">{fmtQty(m.leg.quantity, m.offer?.offer.supply.unit ?? "")}</span>
                {#if m.canAccept && m.role === "provider"}
                  <button type="button" class="chip" on:click={() => offerIt(m)} disabled={accepting === m.key}>Offer it</button>
                {:else if m.canAccept && m.role === "requester"}
                  <button type="button" class="chip" on:click={() => acceptIt(m)} disabled={accepting === m.key}>Accept</button>
                {:else if m.state === "claimed" && m.need}
                  <button type="button" class="chip ghost" on:click={() => (openNeed = m.need)}>Handoff</button>
                {:else if m.state === "settled"}
                  <span class="status ok">✓</span>
                {:else if m.need}
                  <button type="button" class="chip ghost" on:click={() => (openNeed = m.need)}>View</button>
                {/if}
              </li>
            {/each}
          </ul>
        {/each}
      {/if}
    </section>
  {:else}
    <section class="panel">
      {#if !board.demand.length}
        <div class="empty">
          <p>No need at this scale.</p>
          <p class="lead">Needs are published from the <a href={`/${holonID}/shopping`}>shopping list</a>.</p>
        </div>
      {:else}
        <ul class="rows">
          {#each board.demand as card (card.key)}
            <li>
              <button type="button" class="row tap" class:is-foreign={!card.own} class:closed={!card.matchable && !card.legacy} on:click={() => (openNeed = card)}>
                <span class="text">
                  <span class="name">{card.need.title}</span>
                  <span class="meta">
                    {#if card.need.category}<span class="rtype">{card.need.category}</span>{/if}
                    {#if !card.own}<span class="basis">{nameOf(card.ownerHolonId)}{card.source === "cell" ? " · on the map" : ""}</span>{/if}
                    {#if (card.need.responses ?? []).length}<span class="basis">{card.need.responses!.length} response{card.need.responses!.length === 1 ? "" : "s"}</span>{/if}
                  </span>
                </span>
                {#if !card.legacy}<span class="qty">{fmtQty(card.quantity, card.unit)}</span>{/if}
                <span class="status" class:ok={card.matchable} class:muted={!card.matchable}>{card.statusLabel}</span>
              </button>
            </li>
          {/each}
        </ul>
        <p class="note">Need something? Add it to the <a href={`/${holonID}/shopping`}>shopping list</a> and share it as a need.</p>
      {/if}
    </section>
  {/if}

  {#if notice}
    <p class="note toast" role="status">{notice}</p>
  {/if}
</div>

{#if openOffer}
  {@const card = openOffer}
  <Sheet title={String(card.offer.title ?? "Offer")} on:close={() => ((openOffer = null), (confirmWithdraw = false))}>
    <div class="sheet-head">
      <span class="rtype">{card.offer.category ?? "uncategorised"} · {MODE_LABEL[card.offer.mode]}</span>
      {#if card.own && (card.offer.status === "open" || card.offer.status === "reserved") && !card.auto}
        <button type="button" class="link" on:click={() => openEdit(card.offer)}>✎ Edit</button>
      {/if}
    </div>
    <div class="level">
      <span class="big">{fmtQty(card.remaining, card.offer.supply.unit)}</span>
      <span class="status st-{card.offer.status}">{card.statusLabel}</span>
    </div>
    <ul class="facts">
      <li>{fmtQty(card.offer.supply.quantity, card.offer.supply.unit)} listed{card.remaining < card.offer.supply.quantity ? `, ${fmtQty(card.offer.supply.quantity - card.remaining, card.offer.supply.unit)} promised or delivered` : ""}</li>
      {#if card.offer.price != null}<li>{card.offer.price} {card.offer.currency ?? ""} per {unitLabel(card.offer.supply.unit)}</li>{/if}
      {#if card.offer.description}<li>{card.offer.description}</li>{/if}
      {#if card.auto}<li>Kept in step with the shelf — it follows what is on hand above the keep-back.</li>{/if}
      {#if card.offer.source?.kind === "minted"}<li>Earned by fulfilling a need.</li>{/if}
      {#if !card.own}<li>Listed by {nameOf(card.ownerHolonId)}.</li>{/if}
      {#if card.offer.published}<li>Shared {card.offer.published.toPartners ? "with partners" : ""}{card.offer.published.toPartners && card.offer.published.toHex ? " and " : ""}{card.offer.published.toHex ? "on the map" : ""}{!card.offer.published.toPartners && !card.offer.published.toHex ? "nowhere yet" : ""}.</li>{/if}
      {#if card.offer.expires_at}<li>Until {new Date(card.offer.expires_at).toLocaleDateString()}</li>{/if}
    </ul>

    {#if card.offer.reservations.length}
      <h4>Promised to</h4>
      <ul class="hist">
        {#each card.offer.reservations as r (r.id)}
          <li class:muted={!!r.releasedAt}>
            <span class="delta">{fmtQty(r.quantity, card.offer.supply.unit)}</span>
            <span class="what">{r.needId} · {nameOf(r.needHolonId)} · {r.settledAt ? "delivered" : r.releasedAt ? "released" : "reserved"}</span>
          </li>
        {/each}
      </ul>
    {/if}

    {#if card.own && (card.offer.status === "open" || card.offer.status === "reserved")}
      <div class="actions">
        <button type="button" class="primary" on:click={() => ((shareTarget = card.offer), (shareOpen = true))}>Share nearby</button>
        {#if confirmWithdraw}
          <button type="button" class="danger" disabled={withdrawing} on:click={() => withdraw(card)}>Withdraw for real</button>
          <button type="button" class="ghost" on:click={() => (confirmWithdraw = false)}>Keep</button>
        {:else}
          <button type="button" class="ghost" on:click={() => (confirmWithdraw = true)}>Withdraw</button>
        {/if}
      </div>
    {/if}
  </Sheet>
{/if}

{#if formOpen}
  <Sheet title={editing ? "Edit offer" : "List an offer"} on:close={() => (formOpen = false)}>
    <label class="text-field"><span class="field-label">What</span><input bind:value={fTitle} placeholder="Flour, a ladder, two hours of plumbing…" maxlength="80" /></label>
    <label class="text-field"><span class="field-label">Category</span><input bind:value={fCategory} placeholder="food, tools, skills…" maxlength="40" /></label>
    <div class="two">
      <label class="text-field amount-field"><span class="field-label">How much</span><input type="number" inputmode="decimal" min="0" step="any" bind:value={fQty} /></label>
      <label class="text-field"><span class="field-label">Unit</span>
        <select bind:value={fUnit}>{#each UNITS as u (u.id)}<option value={u.id}>{u.label}</option>{/each}</select>
      </label>
    </div>
    <span class="field-label">How</span>
    <div class="picks" role="radiogroup" aria-label="Mode">
      {#each ["give", "lend", "sell"] as m (m)}
        <button type="button" class="pick" class:on={fMode === m} role="radio" aria-checked={fMode === m} on:click={() => (fMode = m as OfferMode)}>{MODE_LABEL[m as OfferMode]}</button>
      {/each}
    </div>
    {#if fMode === "sell"}
      <div class="two">
        <label class="text-field amount-field"><span class="field-label">Price per unit</span><input type="number" inputmode="decimal" min="0" step="any" bind:value={fPrice} /></label>
        <label class="text-field"><span class="field-label">Currency</span><input bind:value={fCurrency} maxlength="8" /></label>
      </div>
    {/if}
    {#if !editing}
      <label class="check"><input type="checkbox" bind:checked={fService} /> This is a service (time), not a thing</label>
    {/if}
    <label class="text-field"><span class="field-label">Notes</span><input bind:value={fDescription} placeholder="Condition, pickup, timing…" maxlength="240" /></label>
    <label class="text-field"><span class="field-label">Until (optional)</span><input type="date" bind:value={fExpires} /></label>
    {#if formError}<p class="error">{formError}</p>{/if}
    <div class="actions">
      <button type="button" class="primary" on:click={saveOffer} disabled={saving || !fTitle.trim()}>{saving ? "Saving…" : editing ? "Save" : "List it"}</button>
      <button type="button" class="ghost" on:click={() => (formOpen = false)}>Cancel</button>
    </div>
  </Sheet>
{/if}

<ShareNeedModal
  open={shareOpen}
  kind="offer"
  holonId={holonID}
  itemText={String(shareTarget?.title ?? "")}
  busy={sharing}
  status={shareStatus}
  on:share={share}
  on:close={() => (shareOpen = false)}
/>

<OfferDetailModal
  open={!!openNeed}
  item={openNeed?.raw ?? null}
  holonID={holonID}
  {userStore}
  selfId={viewerId}
  {handoffConfirmations}
  {handoffNotice}
  on:close={closeNeed}
  on:respond={(e) => respondToNeedItem(e.detail.item, e.detail.message, e.detail.price)}
  on:claim={(e) => claimNeedItem(e.detail.item, e.detail.responseId)}
  on:handoffConfirm={(e) => confirmNeedHandoffItem(e.detail.item, e.detail.party, e.detail.code)}
  on:addParticipant={(e) => setParticipation(e.detail.item, e.detail.user, true)}
  on:removeParticipant={(e) => setParticipation(e.detail.item, e.detail.user, false)}
/>

<style>
  .board {
    --flow-accent: #0f766e;
    padding: 0.9rem 1rem calc(5rem + env(safe-area-inset-bottom));
    max-width: 52rem;
    margin: 0 auto;
    color: var(--color-text-primary);
  }
  @media (min-width: 640px) {
    .board { padding: 1.2rem 1.5rem 5rem; }
  }
  .top { margin-bottom: 0.8rem; }
  h1 { margin: 0; font-size: 1.45rem; font-weight: 600; }
  h2 { margin: 0; font-size: 1.15rem; font-weight: 600; }
  h3 { margin: 0; font-size: 0.98rem; font-weight: 600; color: var(--color-text-primary); }
  h4 { margin: 1rem 0 0.4rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-muted); }
  .sub { margin: 0.15rem 0 0; font-size: 0.85rem; color: var(--color-text-muted); }
  .lead { margin: 0 0 0.6rem; font-size: 0.9rem; color: var(--color-text-secondary); }
  .tabs {
    position: sticky; top: 0; z-index: 10;
    margin: 0 -0.25rem 1rem; padding: 0.35rem 0.25rem;
    background: var(--color-bg-primary);
    display: flex; flex-direction: column; gap: 0.5rem;
  }
  .scale { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
  .k { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-text-muted); }
  .panel { animation: offers-rise 0.42s ease both; }
  .section { margin: 1rem 0 0.45rem; font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-text-muted); }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; margin-bottom: 0.8rem; }
  .stat { display: flex; flex-direction: column; align-items: center; padding: 0.6rem 0.4rem; border: 1px solid var(--color-border, rgba(127,127,127,0.25)); border-radius: 14px; }
  .stat .n { font-size: 1.3rem; font-weight: 800; font-variant-numeric: tabular-nums; }
  .stat .l { font-size: 0.72rem; color: var(--color-text-muted); }
  .auto { display: flex; align-items: center; justify-content: space-between; gap: 0.8rem; padding: 0.65rem 0.8rem; border: 1px dashed var(--color-border, rgba(127,127,127,0.35)); border-radius: 14px; margin-bottom: 0.4rem; }
  .auto .text { flex: 1; min-width: 0; }
  .switch { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; font-weight: 600; cursor: pointer; }
  .switch input { width: 1.1rem; height: 1.1rem; accent-color: var(--flow-accent); }
  .rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .row {
    display: flex; align-items: center; gap: 0.7rem; width: 100%;
    padding: 0.65rem 0.8rem; text-align: left;
    background: var(--color-bg-secondary, rgba(127,127,127,0.08));
    border: 1.5px solid var(--color-border, rgba(127,127,127,0.25));
    border-radius: 14px; color: inherit;
  }
  .row.tap { cursor: pointer; }
  .row.tap:active { filter: brightness(0.97); }
  .row.closed { opacity: 0.6; }
  .row.is-foreign { border-left: 4px solid var(--flow-accent); }
  .row.committed { border-color: var(--flow-accent); }
  .row .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.2rem; }
  .row .name { font-weight: 600; font-size: 0.98rem; }
  .meta { display: flex; flex-wrap: wrap; gap: 0.4rem 0.6rem; font-size: 0.78rem; color: var(--color-text-muted); align-items: center; }
  .rtype { text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.7rem; font-weight: 700; color: var(--flow-accent); }
  .basis { font-size: 0.78rem; }
  .tag { font-size: 0.68rem; font-weight: 700; padding: 0.05rem 0.4rem; border-radius: 999px; background: rgba(127,127,127,0.18); text-transform: uppercase; letter-spacing: 0.05em; }
  .tag.live { background: rgba(15,118,110,0.18); color: var(--flow-accent); }
  .arrow { color: var(--color-text-muted); margin: 0 0.3rem; }
  .bar { height: 5px; border-radius: 3px; background: rgba(127,127,127,0.18); overflow: hidden; margin-top: 0.2rem; }
  .bar.thin { height: 3px; }
  .fill { display: block; height: 100%; background: var(--flow-accent); transition: width 0.3s ease; }
  .fill.hot { background: #c2410c; }
  .qty { font-size: 1.1rem; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .status { font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.55rem; border-radius: 999px; white-space: nowrap; background: rgba(127,127,127,0.18); }
  .status.st-open, .status.ok { background: rgba(15,118,110,0.18); color: var(--flow-accent); }
  .status.st-reserved { background: rgba(217,119,6,0.18); color: #b45309; }
  .status.short { background: rgba(194,65,12,0.18); color: #c2410c; }
  .status.muted, .status.st-fulfilled, .status.st-withdrawn, .status.st-expired { opacity: 0.7; }
  .chip { flex-shrink: 0; padding: 0.4rem 0.8rem; border-radius: 999px; border: 1.5px solid var(--flow-accent); background: var(--flow-accent); color: #fff; font-size: 0.8rem; font-weight: 700; cursor: pointer; }
  .chip.ghost { background: transparent; color: var(--flow-accent); }
  .chip:disabled { opacity: 0.5; cursor: default; }
  .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.9rem; }
  .actions button { padding: 0.55rem 1rem; border-radius: 12px; font-weight: 700; font-size: 0.9rem; border: 1.5px solid transparent; cursor: pointer; }
  .actions .primary { background: var(--flow-accent); color: #fff; }
  .actions .primary:disabled { opacity: 0.5; cursor: default; }
  .actions .ghost { background: transparent; border-color: var(--color-border, rgba(127,127,127,0.35)); color: inherit; }
  .actions .danger { background: #c2410c; color: #fff; }
  .empty { padding: 1.5rem 0.5rem; text-align: center; color: var(--color-text-muted); }
  .empty p { margin: 0.2rem 0; }
  .note { margin: 0.8rem 0 0; font-size: 0.8rem; color: var(--color-text-muted); }
  .note a { color: var(--flow-accent); }
  .note.toast { position: fixed; left: 50%; bottom: calc(1.2rem + env(safe-area-inset-bottom)); transform: translateX(-50%); padding: 0.6rem 1rem; border-radius: 999px; background: var(--color-text-primary); color: var(--color-bg-primary); z-index: 40; margin: 0; }
  .fab { position: fixed; right: 1.2rem; bottom: calc(1.2rem + env(safe-area-inset-bottom)); width: 3.4rem; height: 3.4rem; border-radius: 50%; border: none; background: var(--flow-accent); color: #fff; font-size: 1.8rem; line-height: 1; box-shadow: 0 6px 18px rgba(0,0,0,0.25); cursor: pointer; z-index: 30; }
  .fab:active { transform: scale(0.95); }
  .sheet-head { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; }
  .link { background: none; border: none; color: var(--flow-accent); font-weight: 600; cursor: pointer; padding: 0; }
  .level { display: flex; align-items: center; gap: 0.7rem; margin: 0.7rem 0 0.3rem; }
  .big { font-size: 2.1rem; font-weight: 800; font-variant-numeric: tabular-nums; }
  .facts { list-style: none; margin: 0.4rem 0 0; padding: 0; font-size: 0.88rem; color: var(--color-text-secondary); display: flex; flex-direction: column; gap: 0.25rem; }
  .hist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.85rem; }
  .hist li { display: flex; gap: 0.6rem; align-items: baseline; }
  .hist li.muted { opacity: 0.6; }
  .delta { font-weight: 700; font-variant-numeric: tabular-nums; min-width: 4ch; }
  .what { color: var(--color-text-secondary); }
  .text-field { display: flex; flex-direction: column; gap: 0.25rem; margin-top: 0.7rem; }
  .text-field input, .text-field select { padding: 0.55rem 0.7rem; border-radius: 10px; border: 1.5px solid var(--color-border, rgba(127,127,127,0.35)); background: var(--color-bg-primary); color: inherit; font-size: 0.95rem; }
  .text-field input:focus, .text-field select:focus { outline: none; border-color: var(--flow-accent); }
  .field-label { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-muted); margin-top: 0.7rem; display: block; }
  .text-field .field-label { margin-top: 0; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
  .picks { display: flex; gap: 0.4rem; margin-top: 0.3rem; }
  .pick { flex: 1; padding: 0.5rem; border-radius: 10px; border: 1.5px solid var(--color-border, rgba(127,127,127,0.35)); background: transparent; color: inherit; font-weight: 600; cursor: pointer; }
  .pick.on { border-color: var(--flow-accent); background: rgba(15,118,110,0.14); color: var(--flow-accent); }
  .check { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.7rem; font-size: 0.88rem; }
  .error { color: #c2410c; font-size: 0.85rem; margin: 0.5rem 0 0; }
  @keyframes offers-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
</style>
