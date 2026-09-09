// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Matching offers to needs: the transportation problem with offers as
 * sources and needs as sinks, one solve per category (`solveTransport`).
 *
 * Reading a market: the same records reach a viewer by several roads — a
 * partner's copy, a hologram at the home cell, and that hologram again on
 * every parent cell it was upcast to — so a market is deduped by canonical
 * id before anything is counted. Reservations already made are honoured:
 * they come back as `committed` legs and are subtracted from both sides
 * before the LP runs, so it only proposes what is still free.
 *
 * The duals come along: a need's price is the marginal cost of one more
 * unit reaching it (an unreachable need prices at `UNMET_COST`), which the
 * boards render as contention. `byCategory.blocked` is the same share of
 * demand nobody can cover that `inventory/scarcity` reports for shelves.
 */

import { demandOf } from '../inventory/scarcity.js';
import { solveTransport, type TransportCost } from '../inventory/transport.js';
import { OPEN_NEED_STATUSES, type PublishedNeed } from '../needs/types.js';
import { normalizeNeed } from '../needs/transform.js';
import { holonOf, supplyOf } from './supply.js';
import { isLiveReservation, normalizeOffer } from './transform.js';
import type { OfferMode, OfferRecord } from './types.js';

export interface MarketOffer {
  offerId: string;
  holonId: string;
  hex?: string;
  category: string;
  /** Units still free. */
  quantity: number;
  unit: string;
  mode: OfferMode;
  offer: OfferRecord;
}

export interface MarketNeed {
  needId: string;
  holonId: string;
  hex?: string;
  category: string;
  /** Units still unserved. */
  quantity: number;
  unit?: string;
  need: PublishedNeed;
}

export interface MatchLeg {
  offerId: string;
  needId: string;
  offerHolonId: string;
  needHolonId: string;
  category: string;
  quantity: number;
  cost: number;
}

export interface CategoryContention {
  category: string;
  /** Free supply and open demand before the solve. */
  supply: number;
  demand: number;
  /** Units the plan moves. */
  matched: number;
  /** Demand nobody can cover. */
  shortage: number;
  /** shortage / demand, 0..1 (0 when there is no demand). */
  blocked: number;
  /** Demand-weighted mean of the needs' prices. */
  price: number;
}

export interface MatchPlan {
  /** What the LP proposes on top of what is already committed. */
  legs: MatchLeg[];
  /** Reservations already made, as legs. */
  committed: MatchLeg[];
  byCategory: CategoryContention[];
  /** Marginal cost of one more unit reaching each need (`UNMET_COST` when nothing can). */
  needPrice: Record<string, number>;
  /** Potential of each offer (0 while it still has free units). */
  offerPrice: Record<string, number>;
  unmetNeeds: Record<string, number>;
  unusedOffers: Record<string, number>;
  moved: number;
}

/** The price of a need nobody can serve. */
export const UNMET_COST = 1000;

const EPS = 1e-9;

/** `id` of a record, as a string; empty when it has none. */
function idOf(rec: unknown): string {
  const id = (rec as { id?: unknown } | null)?.id;
  return id == null ? '' : String(id);
}

function stampOf(rec: unknown): number {
  const r = rec as { published?: { at?: unknown }; updated?: unknown; created?: unknown } | null;
  const at = r?.published?.at;
  if (typeof at === 'number') return at;
  for (const v of [r?.updated, r?.created]) {
    if (typeof v === 'string') {
      const t = Date.parse(v);
      if (Number.isFinite(t)) return t;
    }
    if (typeof v === 'number') return v;
  }
  return 0;
}

/**
 * One record per canonical id, the newest stamp winning. A record reached
 * through federation or a hologram carries the same id as the canonical
 * one, so the id is the key; where two copies tie, the one that is not an
 * envelope (own record) wins.
 */
export function dedupeMarket<T>(records: T[]): T[] {
  const byId = new Map<string, T>();
  const order: string[] = [];
  for (const rec of records ?? []) {
    const id = idOf(rec);
    if (!id) continue;
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, rec);
      order.push(id);
      continue;
    }
    const a = stampOf(prev);
    const b = stampOf(rec);
    const envelope = (x: unknown) =>
      !!(x as { _hologram?: unknown; _federation?: unknown })?._hologram ||
      !!(x as { _federation?: unknown })?._federation;
    if (b > a || (b === a && envelope(prev) && !envelope(rec))) byId.set(id, rec);
  }
  return order.map((id) => byId.get(id)!);
}

/** Offers still free, read as supply at the holon each record belongs to. */
export function toMarketOffers(records: unknown[], fallbackHolon: string, now: number = Date.now()): MarketOffer[] {
  const out: MarketOffer[] = [];
  for (const rec of dedupeMarket(records ?? [])) {
    const offer = normalizeOffer(rec, now);
    if (!offer) continue;
    const holonId = holonOf(rec, fallbackHolon);
    const s = supplyOf(offer, holonId);
    if (!s) continue;
    out.push({
      offerId: s.offerId,
      holonId,
      ...(s.hex ? { hex: s.hex } : {}),
      category: s.category,
      quantity: s.quantity,
      unit: s.unit,
      mode: s.mode,
      offer,
    });
  }
  return out;
}

/** Needs still open to a provider (requested or offered), read as demand. */
export function toMarketNeeds(records: unknown[], fallbackHolon: string): MarketNeed[] {
  const out: MarketNeed[] = [];
  for (const rec of dedupeMarket(records ?? [])) {
    const need = normalizeNeed(rec);
    if (!need || !OPEN_NEED_STATUSES.includes(need.status)) continue;
    const holonId = holonOf(rec, fallbackHolon);
    const d = demandOf(need, holonId);
    if (!d) continue;
    out.push({
      needId: String(need.id),
      holonId,
      ...(need.hex ? { hex: need.hex } : {}),
      category: d.category,
      quantity: d.quantity,
      ...(need.stock?.unit ? { unit: need.stock.unit } : {}),
      need,
    });
  }
  return out;
}

export interface MatchOptions {
  unmetCost?: number;
  now?: number;
}

/**
 * Solve the market. Free supply is what each offer still has after its
 * reservations; open demand is what each need still lacks after the
 * reservations made for it. The legs are proposals; `committed` is what
 * already stands.
 */
export function matchOffersToNeeds(
  offers: MarketOffer[],
  needs: MarketNeed[],
  cost: TransportCost,
  opts: MatchOptions = {},
): MatchPlan {
  const unmetCost = opts.unmetCost ?? UNMET_COST;
  const needById = new Map(needs.map((n) => [n.needId, n]));

  // Standing reservations: subtract from the need side (the offer side is
  // already net of them via remainingSupply) and report them as legs.
  const committed: MatchLeg[] = [];
  const reservedFor = new Map<string, number>();
  for (const o of offers) {
    for (const r of o.offer.reservations ?? []) {
      if (!isLiveReservation(r)) continue;
      reservedFor.set(r.needId, (reservedFor.get(r.needId) ?? 0) + r.quantity);
      const n = needById.get(r.needId);
      committed.push({
        offerId: o.offerId,
        needId: r.needId,
        offerHolonId: o.holonId,
        needHolonId: n?.holonId ?? r.needHolonId,
        category: o.category,
        quantity: r.quantity,
        cost: cost(o.holonId, n?.holonId ?? r.needHolonId),
      });
    }
  }

  const byCategory = new Map<string, { offers: MarketOffer[]; needs: MarketNeed[] }>();
  const bucket = (category: string) => {
    if (!byCategory.has(category)) byCategory.set(category, { offers: [], needs: [] });
    return byCategory.get(category)!;
  };
  for (const o of offers) if (o.quantity > EPS) bucket(o.category).offers.push(o);
  for (const n of needs) {
    const left = n.quantity - (reservedFor.get(n.needId) ?? 0);
    if (left > EPS) bucket(n.category).needs.push({ ...n, quantity: left });
  }

  const legs: MatchLeg[] = [];
  const contention: CategoryContention[] = [];
  const needPrice: Record<string, number> = {};
  const offerPrice: Record<string, number> = {};
  const unmetNeeds: Record<string, number> = {};
  const unusedOffers: Record<string, number> = {};
  let moved = 0;

  for (const [category, group] of [...byCategory].sort(([a], [b]) => a.localeCompare(b))) {
    const holonOfOffer = new Map(group.offers.map((o) => [o.offerId, o.holonId]));
    const holonOfNeed = new Map(group.needs.map((n) => [n.needId, n.holonId]));
    const sol = solveTransport(
      group.offers.map((o) => ({ id: o.offerId, supply: o.quantity })),
      group.needs.map((n) => ({ id: n.needId, demand: n.quantity })),
      (from, to) => cost(holonOfOffer.get(from)!, holonOfNeed.get(to)!),
      { unmetCost },
    );
    for (const leg of sol.legs) {
      legs.push({
        offerId: leg.from,
        needId: leg.to,
        offerHolonId: holonOfOffer.get(leg.from)!,
        needHolonId: holonOfNeed.get(leg.to)!,
        category,
        quantity: leg.quantity,
        cost: leg.cost,
      });
    }
    Object.assign(needPrice, sol.potentials.sinks);
    Object.assign(offerPrice, sol.potentials.sources);
    Object.assign(unmetNeeds, sol.unmet);
    Object.assign(unusedOffers, sol.unused);
    moved += sol.moved;

    const supply = group.offers.reduce((s, o) => s + o.quantity, 0);
    const demand = group.needs.reduce((s, n) => s + n.quantity, 0);
    const shortage = Object.values(sol.unmet).reduce((s, v) => s + v, 0);
    const weighted = group.needs.reduce((s, n) => s + n.quantity * (sol.potentials.sinks[n.needId] ?? unmetCost), 0);
    contention.push({
      category,
      supply: round3(supply),
      demand: round3(demand),
      matched: sol.moved,
      shortage: round3(shortage),
      blocked: demand > EPS ? Math.min(1, round3(shortage / demand)) : 0,
      price: demand > EPS ? round3(weighted / demand) : 0,
    });
  }

  legs.sort((a, b) => a.category.localeCompare(b.category) || a.cost - b.cost || b.quantity - a.quantity);
  return { legs, committed, byCategory: contention, needPrice, offerPrice, unmetNeeds, unusedOffers, moved: round3(moved) };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** The legs a viewer has a hand in: as provider (their offers) or requester (their needs). */
export function matchesFor(
  plan: MatchPlan,
  viewer: { holonId: string },
): { asProvider: MatchLeg[]; asRequester: MatchLeg[] } {
  const all = [...plan.committed, ...plan.legs];
  return {
    asProvider: all.filter((l) => l.offerHolonId === viewer.holonId),
    asRequester: all.filter((l) => l.needHolonId === viewer.holonId),
  };
}
