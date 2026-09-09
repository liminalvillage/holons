// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { demandOf, scarcity } from '../inventory/scarcity.js';
import type { StockLevel } from '../inventory/types.js';
import type { PublishedNeed } from '../needs/types.js';
import { matchCost } from './distance.js';
import { reserveOffer } from './lifecycle.js';
import {
  UNMET_COST,
  dedupeMarket,
  matchOffersToNeeds,
  matchesFor,
  toMarketNeeds,
  toMarketOffers,
} from './match.js';
import { holonOf, ownerRef, supplyOf } from './supply.js';
import { createOffer } from './transform.js';

const initiator = { id: 7, username: 'ada' };
const offer = (id: string, holonId: string, quantity: number, category = 'food', extra: Record<string, unknown> = {}) => ({
  ...createOffer({ holonId, initiator, title: id, category, supply: { itemId: 'flour', quantity, unit: 'kg' }, id, now: 0 }),
  holonId,
  ...extra,
});
const need = (id: string, holonId: string, quantity: number, category = 'food', extra: Record<string, unknown> = {}): PublishedNeed =>
  ({
    id,
    type: 'need',
    status: 'requested',
    title: id,
    category,
    holonId,
    stock: { itemId: 'flour', quantity, unit: 'kg' },
    responses: [],
    ...extra,
  }) as PublishedNeed;

describe('supply is the dual of demand', () => {
  it('reads the same quantity a need asks for, keyed by category', () => {
    const o = createOffer({ holonId: 'a', initiator, title: 'Flour', category: 'food', supply: { itemId: 'flour', quantity: 5, unit: 'kg' }, id: 'o' });
    const s = supplyOf(o, 'a')!;
    const d = demandOf(need('n', 'b', 5), 'b')!;
    expect(s.quantity).toBe(d.quantity);
    expect(s.category).toBe(d.category);
    expect(s.itemId).toBe(d.itemId);
  });

  it('a legacy unit-less offer counts as one, like a unit-less need', () => {
    const s = supplyOf({ id: 'x', type: 'offer', status: 'open', category: 'tools', supply: { quantity: 1, unit: 'one' }, mode: 'give', reservations: [] } as never, 'a')!;
    const d = demandOf({ status: 'requested', category: 'tools' }, 'b')!;
    expect(s.quantity).toBe(d.quantity);
  });

  it('closed, uncategorised or spent offers are not supply', () => {
    expect(supplyOf({ ...offer('o', 'a', 3), status: 'withdrawn' }, 'a')).toBeNull();
    expect(supplyOf({ ...offer('o', 'a', 3), category: '' }, 'a')).toBeNull();
    const spent = reserveOffer(offer('o', 'a', 3), { needId: 'n', needHolonId: 'b', responseId: 'p', quantity: 3 }).offer;
    expect(supplyOf(spent, 'a')).toBeNull();
  });

  it('holonOf reads the origin envelope, the hologram soul, then the record', () => {
    expect(holonOf({ _federation: { origin: 'b' } }, 'x')).toBe('b');
    expect(holonOf({ _hologram: { isHologram: true, sourceHolon: 'c' } }, 'x')).toBe('c');
    expect(holonOf({ _hologram: { soul: 'App/d/quests/o1' } }, 'x')).toBe('d');
    expect(holonOf({ holonId: 'e' }, 'x')).toBe('e');
    expect(holonOf({ holon: 'f' }, 'x')).toBe('f');
    expect(holonOf({}, 'x')).toBe('x');
  });

  it('ownerRef routes a foreign write to its owner, enveloped or bare', () => {
    expect(ownerRef({ _hologram: { isHologram: true, sourceHolon: 'b', sourceKey: 'k' } }, 'a', 'id')).toEqual({ holon: 'b', key: 'k' });
    expect(ownerRef({ holon: 'b' }, 'a', 'id')).toEqual({ holon: 'b', key: 'id' });
    expect(ownerRef({ holon: 'a' }, 'a', 'id')).toBeUndefined();
    expect(ownerRef({}, 'a', 'id')).toBeUndefined();
  });
});

describe('dedupeMarket', () => {
  it('keeps one record per id, newest first, own copy over an envelope on a tie', () => {
    const own = { id: 'o', published: { at: 5 } };
    const copy = { id: 'o', published: { at: 5 }, _federation: { origin: 'a' } };
    const newer = { id: 'o', published: { at: 9 }, _hologram: { soul: 's' } };
    expect(dedupeMarket([copy, own])).toEqual([own]);
    expect(dedupeMarket([own, copy, newer])).toEqual([newer]);
    expect(dedupeMarket([{ id: 'p' }, { id: 'o' }, { id: 'p' }]).map((r) => r.id)).toEqual(['p', 'o']);
  });
});

describe('matchOffersToNeeds', () => {
  const partners = { a: ['b'] };
  const hexOf = { a: 'A', b: 'B', c: 'C' };
  const hexDistance = (x: string, y: string) => (x === y ? 0 : ({ 'A C': 2, 'C A': 2, 'B C': 1, 'C B': 1 })[`${x} ${y}`] ?? 5);
  const cost = matchCost({ partners, hexOf, hexDistance });

  it('serves a holon’s own need first, at cost 0', () => {
    const offers = toMarketOffers([offer('o', 'a', 5)], 'a');
    const needs = toMarketNeeds([need('mine', 'a', 3), need('theirs', 'b', 3)], 'a');
    const plan = matchOffersToNeeds(offers, needs, cost);
    expect(plan.legs).toEqual([
      { offerId: 'o', needId: 'mine', offerHolonId: 'a', needHolonId: 'a', category: 'food', quantity: 3, cost: 0 },
      { offerId: 'o', needId: 'theirs', offerHolonId: 'a', needHolonId: 'b', category: 'food', quantity: 2, cost: 1 },
    ]);
    expect(plan.unmetNeeds).toEqual({ theirs: 1 });
    expect(plan.needPrice.theirs).toBe(UNMET_COST);
    expect(plan.needPrice.mine).toBeLessThan(UNMET_COST);
  });

  it('finds the true optimum with mixed costs: a partner beats a nearer stranger, crossovers included', () => {
    // a↔b partners (1 hop); c is a stranger 2 cells from a, 1 cell from b.
    // Greedy from a's view: a→b at 1 first. But the optimum overall pairs
    // c→b (penalty 1 + 1 = 2) and a→b (1)... let the LP decide and check
    // the total is minimal against every alternative assignment.
    const offers = toMarketOffers([offer('oa', 'a', 4), offer('oc', 'c', 4)], 'x');
    const needs = toMarketNeeds([need('nb', 'b', 4), need('na', 'a', 4)], 'x');
    const plan = matchOffersToNeeds(offers, needs, cost);
    const total = plan.legs.reduce((s, l) => s + l.cost * l.quantity, 0);
    // Alternatives: {oa→na 0, oc→nb 2} = 8; {oa→nb 1, oc→na 3} = 16.
    expect(total).toBe(8);
    expect(plan.legs.map((l) => `${l.offerId}>${l.needId}`).sort()).toEqual(['oa>na', 'oc>nb']);
    expect(plan.moved).toBe(8);
    expect(plan.byCategory[0]).toMatchObject({ category: 'food', supply: 8, demand: 8, matched: 8, shortage: 0, blocked: 0 });
  });

  it('honours standing reservations: they are committed legs and shrink both sides', () => {
    const held = reserveOffer(offer('o', 'a', 5), { needId: 'n', needHolonId: 'b', responseId: 'p', quantity: 2, id: 'r' }).offer;
    const offers = toMarketOffers([held], 'a');
    const needs = toMarketNeeds([need('n', 'b', 5)], 'a');
    const plan = matchOffersToNeeds(offers, needs, cost);
    expect(plan.committed).toEqual([
      { offerId: 'o', needId: 'n', offerHolonId: 'a', needHolonId: 'b', category: 'food', quantity: 2, cost: 1 },
    ]);
    // 3 free on the offer, 3 still open on the need
    expect(plan.legs).toEqual([{ offerId: 'o', needId: 'n', offerHolonId: 'a', needHolonId: 'b', category: 'food', quantity: 3, cost: 1 }]);
    expect(plan.unmetNeeds).toEqual({});
  });

  it('prices: the dearest served need is the priciest, an unreachable one prices at UNMET_COST', () => {
    const noHex = matchCost({ partners: {}, hexOf: { a: 'A', b: 'B' }, hexDistance: () => 3 });
    const offers = toMarketOffers([offer('o', 'a', 10)], 'x');
    const needs = toMarketNeeds([need('near', 'a', 2), need('far', 'b', 2), need('lost', 'z', 2)], 'x');
    const plan = matchOffersToNeeds(offers, needs, noHex);
    expect(plan.needPrice.near).toBe(0);
    expect(plan.needPrice.far).toBe(4); // penalty 1 + 3 cells
    expect(plan.needPrice.lost).toBe(UNMET_COST);
    expect(plan.unmetNeeds).toEqual({ lost: 2 });
    expect(plan.unusedOffers).toEqual({ o: 6 });
  });

  it('blocked agrees with the shelf’s scarcity for the same numbers', () => {
    const offers = toMarketOffers([offer('o', 'a', 3)], 'x');
    const needs = toMarketNeeds([need('n', 'a', 5)], 'x');
    const plan = matchOffersToNeeds(offers, needs, cost);
    const level: StockLevel = { itemId: 'flour', holonId: 'a', unit: 'kg', onhand: 3, confirmed: 3, pending: 0, reserved: 0, incoming: 0, available: 3, updatedAt: 0 };
    const shelf = scarcity([level], [demandOf(need('n', 'a', 5), 'a')!], [{ id: 'flour', name: 'Flour', category: 'food', unit: 'kg' }]);
    expect(plan.byCategory[0].blocked).toBe(shelf[0].blocked);
    expect(plan.byCategory[0].shortage).toBe(shelf[0].shortage);
  });

  it('conservation across scales: the parent sees every child once, and matches at least as much', () => {
    // Child cell A holds a's records, child cell B holds b's; the parent P
    // received both holograms (upcast) — plus a's own record twice by two roads.
    const oa = offer('oa', 'a', 4);
    const ob = offer('ob', 'b', 1);
    const na = need('na', 'a', 2);
    const nb = need('nb', 'b', 5);
    const cellA = { offers: [oa], needs: [na] };
    const cellB = { offers: [ob], needs: [nb] };
    const cellP = { offers: [oa, { ...oa, _hologram: { soul: 'App/a/quests/oa' } }, ob], needs: [na, nb] };
    const solve = (cell: { offers: unknown[]; needs: unknown[] }) =>
      matchOffersToNeeds(toMarketOffers(cell.offers, 'cell'), toMarketNeeds(cell.needs, 'cell'), cost);
    const pa = solve(cellA);
    const pb = solve(cellB);
    const pp = solve(cellP);
    expect(toMarketOffers(cellP.offers, 'cell').map((o) => o.offerId)).toEqual(['oa', 'ob']);
    const sum = (k: 'supply' | 'demand', p: ReturnType<typeof solve>) => p.byCategory.reduce((s, c) => s + c[k], 0);
    expect(sum('supply', pp)).toBe(sum('supply', pa) + sum('supply', pb));
    expect(sum('demand', pp)).toBe(sum('demand', pa) + sum('demand', pb));
    expect(pp.moved).toBeGreaterThanOrEqual(pa.moved + pb.moved);
    expect(pp.moved).toBe(5); // a serves its own 2, sends 2 to b; b's own 1 stays home
  });

  it('matchesFor splits legs by the viewer’s side', () => {
    const plan = matchOffersToNeeds(toMarketOffers([offer('o', 'a', 5)], 'x'), toMarketNeeds([need('n', 'b', 5)], 'x'), cost);
    expect(matchesFor(plan, { holonId: 'a' }).asProvider).toHaveLength(1);
    expect(matchesFor(plan, { holonId: 'a' }).asRequester).toHaveLength(0);
    expect(matchesFor(plan, { holonId: 'b' }).asRequester).toHaveLength(1);
  });

  it('claimed and closed needs are not open demand', () => {
    const needs = toMarketNeeds([need('c', 'b', 5, 'food', { status: 'claimed' }), need('f', 'b', 5, 'food', { status: 'fulfilled' })], 'x');
    expect(needs).toEqual([]);
  });
});

describe('matchCost', () => {
  const hexDistance = (a: string, b: string) => (a === b ? 0 : 1);
  it('partners by hops, strangers by hex, unknown whereabouts forbidden, symmetric', () => {
    const cost = matchCost({ partners: { a: ['b'], b: ['c'] }, hexOf: { a: 'X', d: 'X', e: 'Y' }, hexDistance, scalePenalty: 2 });
    expect(cost('a', 'a')).toBe(0);
    expect(cost('a', 'b')).toBe(1);
    expect(cost('a', 'c')).toBe(2);
    expect(cost('a', 'd')).toBe(2); // same cell, penalty only
    expect(cost('a', 'e')).toBe(3);
    expect(cost('e', 'a')).toBe(3);
    expect(cost('a', 'z')).toBe(Infinity);
  });
});
