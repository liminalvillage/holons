// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import type { HoloSphere } from 'holosphere';
import { matchCost } from './distance.js';
import { WANTS_PENALTY, matchOffersToNeeds, toMarketNeeds, toMarketOffers } from './match.js';
import { checkRequestOffer, needFromOffer, requestOffer } from './request.js';
import { createOffer } from './transform.js';
import { reserveOffer } from './lifecycle.js';

const ada = { id: 7, username: 'ada' };
const bob = { id: 9, username: 'bob' };
const flour = (quantity = 8, id = 'offer-stock-flour') =>
  createOffer({ holonId: 'a', initiator: ada, title: 'Flour', category: 'food', supply: { itemId: 'flour', quantity, unit: 'kg' }, id, now: 0 });

function fakeHolosphere(settings: unknown = null) {
  const writes: Array<{ holon: string; lens: string; value: any }> = [];
  const holosphere = {
    put: vi.fn(async (holon: string, lens: string, value: any) => {
      writes.push({ holon, lens, value });
    }),
    propagate: vi.fn(async () => ({ success: 0 })),
    getFederation: vi.fn(async () => ({ federated: [] })),
    get: vi.fn(async (_h: string, lens: string) => (lens === 'settings' ? settings : null)),
    appname: 'test-app',
  } as unknown as HoloSphere;
  return { holosphere, writes };
}

describe('checkRequestOffer / needFromOffer', () => {
  it('asks for an open offer in its own unit and category, naming it', () => {
    const need = needFromOffer(flour(), 'a', { holonId: 'b', initiator: bob, quantity: 3, message: 'for Sunday', id: 'need-1', now: 5 });
    expect(need).toMatchObject({
      id: 'need-1',
      type: 'need',
      status: 'requested',
      title: 'Flour',
      category: 'food',
      demand: { quantity: 3, unit: 'kg' },
      description: 'for Sunday',
      wants: { offerId: 'offer-stock-flour', holonId: 'a' },
      responses: [],
    });
    expect(String(need.holonId ?? (need as any).holon)).toBe('b');
  });

  it('refuses your own offer, a closed one, a bad quantity, or more than is left', () => {
    expect(checkRequestOffer(flour(), 'a', { holonId: 'a', initiator: ada })).toEqual({ ok: false, reason: 'own_offer' });
    expect(checkRequestOffer({ ...flour(), status: 'withdrawn' }, 'a', { holonId: 'b', initiator: bob })).toEqual({ ok: false, reason: 'closed' });
    expect(checkRequestOffer(flour(), 'a', { holonId: 'b', initiator: bob, quantity: 0 })).toEqual({ ok: false, reason: 'invalid_quantity' });
    expect(checkRequestOffer(flour(), 'a', { holonId: 'b', initiator: bob, quantity: 9 })).toEqual({ ok: false, reason: 'insufficient' });
    const held = reserveOffer(flour(), { needId: 'n', needHolonId: 'c', responseId: 'p', quantity: 6, id: 'r' }).offer;
    expect(checkRequestOffer(held, 'a', { holonId: 'b', initiator: bob, quantity: 3 })).toEqual({ ok: false, reason: 'insufficient' });
    expect(checkRequestOffer(held, 'a', { holonId: 'b', initiator: bob, quantity: 2 })).toEqual({ ok: true });
    expect(() => needFromOffer(flour(), 'a', { holonId: 'a', initiator: ada })).toThrow(/own_offer/);
  });
});

describe('requestOffer', () => {
  it('publishes the need on the requester’s holon, to partners and the map, nothing on the provider’s side', async () => {
    const { holosphere, writes } = fakeHolosphere({ hex: '891f1d48b4bffff' });
    const out = await requestOffer(holosphere, { offer: flour(), offerHolonId: 'a', holonId: 'b', initiator: bob, quantity: 2, id: 'need-1', now: 5 });
    expect(out.ok).toBe(true);
    expect(out.need).toMatchObject({ id: 'need-1', wants: { offerId: 'offer-stock-flour', holonId: 'a' }, published: { toPartners: true, toHex: '891f1d48b4bffff' }, hex: '891f1d48b4bffff' });
    expect(writes.map((w) => `${w.holon}/${w.lens}`)).toContain('b/quests');
    expect(writes.some((w) => w.holon === 'a')).toBe(false);
  });

  it('reports a refusal without writing', async () => {
    const { holosphere, writes } = fakeHolosphere();
    const out = await requestOffer(holosphere, { offer: flour(), offerHolonId: 'a', holonId: 'b', initiator: bob, quantity: 50 });
    expect(out).toMatchObject({ ok: false, reason: 'insufficient' });
    expect(writes).toEqual([]);
  });
});

describe('the matcher leans toward the offer a need names', () => {
  const cost = matchCost({ partners: { b: ['a', 'c'] }, hexOf: {} });

  it('breaks a tie toward the wanted offer, and only a tie', () => {
    // a and c are both 1 hop from b with the same flour; b asked a for it.
    const offers = toMarketOffers([{ ...flour(4, 'oa'), holonId: 'a' }, { ...createOffer({ holonId: 'c', initiator: ada, title: 'Flour', category: 'food', supply: { itemId: 'flour', quantity: 4, unit: 'kg' }, id: 'oc', now: 0 }), holonId: 'c' }], 'x');
    const wanted = needFromOffer(flour(4, 'oa'), 'a', { holonId: 'b', initiator: bob, quantity: 4, id: 'nb', now: 0 });
    const needs = toMarketNeeds([{ ...wanted, holonId: 'b' }], 'x');
    expect(needs[0].wantsOfferId).toBe('oa');
    const plan = matchOffersToNeeds(offers, needs, cost);
    expect(plan.legs.map((l) => `${l.offerId}>${l.needId}`)).toEqual(['oa>nb']);
    // A closer source still wins: the penalty is a tie-break, not a rule.
    const nearer = (x: string, y: string) => (x === 'c' && y === 'b' ? 0 : cost(x, y));
    const plan2 = matchOffersToNeeds(offers, needs, nearer);
    expect(plan2.legs.map((l) => `${l.offerId}>${l.needId}`)).toEqual(['oc>nb']);
    expect(WANTS_PENALTY).toBeLessThan(1);
  });
});
