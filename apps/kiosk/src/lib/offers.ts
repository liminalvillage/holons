// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Offers board's view models, kept out of the Svelte file so vitest can
// pin them. A twin of the web dashboard's `$lib/offers` so the two surfaces
// read one market the same way. Every number here comes from `@holons/core/offers` (and the
// transport plan under it); this module only arranges the market for a
// screen: which records are ours, which a partner's, which reached us
// through a hex cell; the three lanes — Supply, Matches, Demand — and the
// scale control that widens the market from this holon to its partners to
// its home cell and the cells above.

import {
  UNMET_COST,
  dedupeMarket,
  holonOf,
  matchCost,
  matchOffersToNeeds,
  normalizeOffer,
  remainingSupply,
  cellAcrossKm,
  formatAcross,
  scaleLadder,
  stockOfferId,
  toMarketNeeds,
  toMarketOffers,
  type CategoryContention,
  type CellMarket,
  type MatchLeg,
  type OfferRecord,
} from "@holons/core/offers";
import {
  demandQuantity,
  demandUnit,
  federationCost,
  type PartnerGraph,
} from "@holons/core/inventory";
import { normalizeNeed, type PublishedNeed } from "@holons/core/needs";
import { classifyMarketItem } from "@holons/core/tasks";

export { fmtQty } from "./stock";
import { filterBySearch } from "./data";

// ── Scale ────────────────────────────────────────────────────────────────

export type Scale =
  | { kind: "holon" }
  | { kind: "partners" }
  | { kind: "cell"; cell: string; level: number };

export interface ScaleOption {
  id: string;
  label: string;
  glyph?: string;
  scale: Scale;
}

/**
 * The scale control's options: this holon, its federation, then the home
 * cell and the ladder rungs above it (core `scaleLadder`), each labelled
 * by its width so a stop means the same distance on every holon.
 */
export function scaleOptions(
  homeHex: string | null,
  partnerCount: number,
): ScaleOption[] {
  const out: ScaleOption[] = [
    { id: "holon", label: "This holon", glyph: "⌂", scale: { kind: "holon" } },
    {
      id: "partners",
      label: partnerCount ? `Federation (${partnerCount})` : "Federation",
      glyph: "⇄",
      scale: { kind: "partners" },
    },
  ];
  if (homeHex) {
    scaleLadder(homeHex).forEach((cell, level) => {
      out.push({
        id: `cell:${level}`,
        label: formatAcross(cellAcrossKm(cell)),
        glyph: "⬡",
        scale: { kind: "cell", cell, level },
      });
    });
  }
  return out;
}

export function scaleById(options: ScaleOption[], id: string): Scale {
  return options.find((o) => o.id === id)?.scale ?? { kind: "holon" };
}

// ── Cards ────────────────────────────────────────────────────────────────

export type CardSource = "own" | "partner" | "cell";

export const OFFER_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  reserved: "Partly promised",
  fulfilled: "Delivered",
  withdrawn: "Withdrawn",
  expired: "Expired",
};

export const NEED_STATUS_LABELS: Record<string, string> = {
  requested: "Requested",
  offered: "Offers received",
  claimed: "Claimed",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
};

export interface OfferCard {
  offer: OfferRecord;
  /** Unique across holons: `<holon>::<id>` for foreign records. */
  key: string;
  ownerHolonId: string;
  /** The board's own holon holds it. */
  own: boolean;
  /** The viewer listed it. */
  mine: boolean;
  /** Kept in step with the shelf by the surplus sync. */
  auto: boolean;
  remaining: number;
  statusLabel: string;
  source: CardSource;
  raw: unknown;
}

export interface NeedCard {
  need: PublishedNeed;
  key: string;
  ownerHolonId: string;
  own: boolean;
  mine: boolean;
  /** Open to a provider (requested / offered); legacy requests are not. */
  matchable: boolean;
  /** A legacy `type:'request'` shown alongside needs. */
  legacy: boolean;
  quantity: number;
  unit: string;
  statusLabel: string;
  source: CardSource;
  raw: unknown;
}

export type MatchRole = "provider" | "requester" | "observer";
export type MatchState = "proposed" | "responded" | "claimed" | "settled";

export interface MatchCard {
  key: string;
  leg: MatchLeg;
  offer: OfferCard | null;
  need: NeedCard | null;
  role: MatchRole;
  state: MatchState;
  /** Already reserved (a standing commitment) rather than proposed. */
  committed: boolean;
  /** 0..1, from the need's dual price. */
  contention: number;
  price: number;
  distanceLabel: string;
  canAccept: boolean;
}

export interface OfferBoard {
  supply: OfferCard[];
  demand: NeedCard[];
  matches: MatchCard[];
  contention: CategoryContention[];
  /** Units of open demand nothing at this scale can cover. */
  unmet: number;
  /** Units of free supply nothing at this scale asks for. */
  unused: number;
  /** Holons with something on this market. */
  holons: string[];
}

export interface BuildOfferBoardInput {
  holonId: string;
  viewerId: string | null;
  scale: Scale;
  /** The `quests` stream: own records plus partner copies (federated). */
  quests: unknown[];
  /** The cell's market when the scale is a cell. */
  cell?: CellMarket | null;
  partners: PartnerGraph;
  /** Home cells by holon id (own, partners, and whatever the cell records say). */
  hexOf: Record<string, string | undefined>;
  now?: number;
}

/**
 * Own records and partner copies from one stream. A copy carries a
 * `_federation`/`_hologram` envelope on the live stream but may arrive bare
 * from a read, so the record's own `holonId` counts as provenance too.
 */
export function splitByOrigin(
  raw: unknown[],
  holonId: string,
): { own: unknown[]; partner: unknown[] } {
  const own: unknown[] = [];
  const partner: unknown[] = [];
  for (const rec of raw ?? []) {
    if (holonOf(rec, holonId) === holonId) own.push(rec);
    else partner.push(rec);
  }
  return { own, partner };
}

const holonOfRecord = (rec: unknown, fallback: string): string =>
  holonOf(rec, fallback);

const keyFor = (holon: string, id: string, own: boolean) =>
  own ? id : `${holon}::${id}`;

/** 0..1 from a need's price: 0 at cost 0, 1 when nobody can serve it. */
export function contentionMeter(price: number, unmetCost = UNMET_COST): number {
  if (!Number.isFinite(price) || price >= unmetCost) return 1;
  if (price <= 0) return 0;
  // Log scale: a partner hop reads as low, ten cells as high, unmet as full.
  return Math.min(0.95, Math.log1p(price) / Math.log1p(unmetCost / 10));
}

export function distanceLabel(cost: number, hops: number): string {
  if (cost === 0) return "here";
  if (!Number.isFinite(cost)) return "unreachable";
  if (Number.isFinite(hops)) return hops === 1 ? "1 hop" : `${hops} hops`;
  const cells = Math.max(0, Math.round(cost - 1));
  return cells === 0
    ? "same cell"
    : cells === 1
      ? "1 cell away"
      : `${cells} cells away`;
}

function matchState(need: PublishedNeed | null, offerId: string): MatchState {
  if (!need) return "proposed";
  const resp = (need.responses ?? []).find((r) => r.offerId === offerId);
  if (!resp) return "proposed";
  if (need.status === "fulfilled") return "settled";
  if (need.claimedResponseId === resp.id) return "claimed";
  return "responded";
}

export function buildOfferBoard(input: BuildOfferBoardInput): OfferBoard {
  const now = input.now ?? Date.now();
  const { holonId, viewerId, scale } = input;
  const split = splitByOrigin(input.quests, holonId);

  // What this scale sees.
  let offerRecords: unknown[] = split.own;
  let needRecords: unknown[] = split.own;
  const sources = new Map<string, CardSource>();
  const stamp = (recs: unknown[], src: CardSource) => {
    for (const r of recs) {
      const id = String((r as { id?: unknown })?.id ?? "");
      if (!id) continue;
      const holon = holonOfRecord(r, holonId);
      const key = `${holon}::${id}`;
      if (!sources.has(key)) sources.set(key, src);
    }
  };
  stamp(split.own, "own");
  if (scale.kind === "partners") {
    stamp(split.partner, "partner");
    offerRecords = [...split.own, ...split.partner];
    needRecords = offerRecords;
  } else if (scale.kind === "cell") {
    stamp(split.partner, "partner");
    const cellOffers = input.cell?.offers ?? [];
    const cellNeeds = input.cell?.needs ?? [];
    stamp(cellOffers, "cell");
    stamp(cellNeeds, "cell");
    offerRecords = dedupeMarket([
      ...split.own,
      ...split.partner,
      ...cellOffers,
    ]);
    needRecords = dedupeMarket([...split.own, ...split.partner, ...cellNeeds]);
  }

  // Where everybody is: cell records carry their own `hex`.
  const hexOf: Record<string, string | undefined> = { ...input.hexOf };
  for (const r of [...offerRecords, ...needRecords]) {
    const hex = (r as { hex?: unknown })?.hex;
    const holon = holonOfRecord(r, holonId);
    if (typeof hex === "string" && hex && !hexOf[holon]) hexOf[holon] = hex;
  }
  const cost = matchCost({ partners: input.partners, hexOf });
  const hops = federationCost(input.partners);

  // Cards.
  const supply: OfferCard[] = [];
  const offerByKey = new Map<string, OfferCard>();
  for (const raw of dedupeMarket(offerRecords)) {
    const offer = normalizeOffer(raw, now);
    if (!offer) continue;
    const ownerHolonId = holonOfRecord(raw, holonId);
    const own = ownerHolonId === holonId;
    const id = String(offer.id);
    const card: OfferCard = {
      offer,
      key: keyFor(ownerHolonId, id, own),
      ownerHolonId,
      own,
      mine:
        viewerId != null &&
        String((offer.initiator as { id?: unknown })?.id ?? "") ===
          String(viewerId),
      auto:
        offer.source?.kind === "stock" &&
        id === stockOfferId(offer.source.itemId),
      remaining: remainingSupply(offer),
      statusLabel: OFFER_STATUS_LABELS[offer.status] ?? offer.status,
      source:
        sources.get(`${ownerHolonId}::${id}`) ?? (own ? "own" : "partner"),
      raw,
    };
    supply.push(card);
    offerByKey.set(`${ownerHolonId}::${id}`, card);
  }

  const demand: NeedCard[] = [];
  const needByKey = new Map<string, NeedCard>();
  for (const raw of dedupeMarket(needRecords)) {
    const kind = classifyMarketItem(raw);
    if (kind !== "need" && kind !== "request") continue;
    if ((raw as { _deleted?: unknown })?._deleted) continue;
    const need = kind === "need" ? normalizeNeed(raw) : (raw as PublishedNeed);
    if (!need) continue;
    const ownerHolonId = holonOfRecord(raw, holonId);
    const own = ownerHolonId === holonId;
    const id = String(need.id);
    const legacy = kind === "request";
    const status = String(need.status ?? "");
    const card: NeedCard = {
      need,
      key: keyFor(ownerHolonId, id, own),
      ownerHolonId,
      own,
      mine:
        viewerId != null &&
        String((need.initiator as { id?: unknown })?.id ?? "") ===
          String(viewerId),
      matchable: !legacy && (status === "requested" || status === "offered"),
      legacy,
      quantity: demandQuantity(need),
      unit: demandUnit(need) ?? "one",
      statusLabel: legacy ? "Request" : (NEED_STATUS_LABELS[status] ?? status),
      source:
        sources.get(`${ownerHolonId}::${id}`) ?? (own ? "own" : "partner"),
      raw,
    };
    demand.push(card);
    needByKey.set(`${ownerHolonId}::${id}`, card);
  }

  // The LP.
  const marketOffers = toMarketOffers(offerRecords, holonId, now);
  const marketNeeds = toMarketNeeds(needRecords, holonId);
  const plan = matchOffersToNeeds(marketOffers, marketNeeds, cost);

  const toCard = (leg: MatchLeg, committed: boolean): MatchCard => {
    const offer = offerByKey.get(`${leg.offerHolonId}::${leg.offerId}`) ?? null;
    const need = needByKey.get(`${leg.needHolonId}::${leg.needId}`) ?? null;
    const state = matchState(need?.need ?? null, leg.offerId);
    const role: MatchRole =
      offer?.own || offer?.mine
        ? "provider"
        : need?.own || need?.mine
          ? "requester"
          : "observer";
    const price = plan.needPrice[leg.needId] ?? leg.cost;
    const canAccept =
      viewerId != null &&
      ((role === "provider" &&
        state === "proposed" &&
        !!need?.matchable &&
        !need.mine) ||
        (role === "requester" && state === "responded"));
    return {
      key: `${leg.offerHolonId}::${leg.offerId}>${leg.needHolonId}::${leg.needId}`,
      leg,
      offer,
      need,
      role,
      state,
      committed,
      contention: contentionMeter(price),
      price,
      distanceLabel: distanceLabel(
        leg.cost,
        hops(leg.offerHolonId, leg.needHolonId),
      ),
      canAccept,
    };
  };
  const matches = [
    ...plan.committed.map((l) => toCard(l, true)),
    ...plan.legs.map((l) => toCard(l, false)),
  ];
  const rank: Record<MatchRole, number> = {
    provider: 0,
    requester: 1,
    observer: 2,
  };
  matches.sort(
    (a, b) =>
      rank[a.role] - rank[b.role] ||
      Number(b.committed) - Number(a.committed) ||
      a.leg.cost - b.leg.cost,
  );

  supply.sort(
    (a, b) =>
      Number(b.own) - Number(a.own) ||
      (a.offer.category ?? "").localeCompare(b.offer.category ?? "") ||
      String(a.offer.title ?? "").localeCompare(String(b.offer.title ?? "")),
  );
  demand.sort(
    (a, b) =>
      Number(b.own) - Number(a.own) ||
      Number(b.matchable) - Number(a.matchable) ||
      String(a.need.title ?? "").localeCompare(String(b.need.title ?? "")),
  );

  const holons = new Set<string>([holonId]);
  for (const c of supply) holons.add(c.ownerHolonId);
  for (const c of demand) holons.add(c.ownerHolonId);

  return {
    supply,
    demand,
    matches,
    contention: plan.byCategory,
    unmet: Object.values(plan.unmetNeeds).reduce((s, v) => s + v, 0),
    unused: Object.values(plan.unusedOffers).reduce((s, v) => s + v, 0),
    holons: [...holons].sort(),
  };
}

/** Group cards by category for a lane. */
export function groupByCategory<
  T extends { offer?: OfferRecord; need?: PublishedNeed },
>(cards: T[]): { category: string; cards: T[] }[] {
  const map = new Map<string, T[]>();
  for (const c of cards) {
    const cat =
      String((c.offer ?? c.need)?.category ?? "").trim() || "uncategorised";
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(c);
  }
  return [...map].map(([category, cards]) => ({ category, cards }));
}

/**
 * The board narrowed by the header search bar: every term must hit a title
 * or a category (the shared `filterBySearch` rule). Matches keep only legs
 * whose offer or need survived. An empty query returns the same board.
 */
export function filterBoard(board: OfferBoard, query: string): OfferBoard {
  if (!query.trim()) return board;
  const keepOffers = new Set(
    filterBySearch(
      board.supply.map((c) => ({
        title: String(c.offer.title ?? ""),
        category: c.offer.category,
        id: c.key,
      })),
      query,
    ).map((h) => h.id),
  );
  const keepNeeds = new Set(
    filterBySearch(
      board.demand.map((c) => ({
        title: String(c.need.title ?? ""),
        category: c.need.category,
        id: c.key,
      })),
      query,
    ).map((h) => h.id),
  );
  return {
    ...board,
    supply: board.supply.filter((c) => keepOffers.has(c.key)),
    demand: board.demand.filter((c) => keepNeeds.has(c.key)),
    matches: board.matches.filter(
      (m) =>
        (m.offer && keepOffers.has(m.offer.key)) ||
        (m.need && keepNeeds.has(m.need.key)),
    ),
  };
}
