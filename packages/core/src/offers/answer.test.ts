// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import type { HoloSphere } from 'holosphere';
import { createNeed } from '../needs/transform.js';
import { claimNeed } from '../needs/responses.js';
import { answerNeed, offerForNeed, releaseNeedReservations } from './answer.js';
import { createOffer, remainingSupply } from './transform.js';

const ada = { id: 7, username: 'ada' };
const bob = { id: 9, username: 'bob' };
const need = () => createNeed({ holonId: 'b', initiator: bob, title: 'flour for Sunday', category: 'food', demand: { quantity: 3, unit: 'kg' }, id: 'need-1', now: 0 });

function fake() {
  const store = new Map<string, any>();
  const writes: string[] = [];
  const holosphere = {
    put: vi.fn(async (holon: string, lens: string, value: any) => {
      store.set(`${holon}/${lens}/${value.id}`, value);
      writes.push(`${holon}/${lens}/${value.id}`);
    }),
    get: vi.fn(async (holon: string, lens: string, key: string) => (lens === 'settings' ? null : (store.get(`${holon}/${lens}/${key}`) ?? null))),
    delete: vi.fn(async () => {}),
    propagate: vi.fn(async () => ({ success: 0 })),
    getFederation: vi.fn(async () => ({ federated: [] })),
    appname: 'test-app',
  } as unknown as HoloSphere;
  return { holosphere, store, writes };
}

describe('offerForNeed', () => {
  it('mirrors the need: its title, category, unit and quantity, source pointing back', () => {
    const o = offerForNeed(need(), 'b', { holonId: 'a', initiator: ada, message: 'from the mill', id: 'o1', now: 1 });
    expect(o).toMatchObject({
      id: 'o1', type: 'offer', status: 'open', title: 'flour for Sunday', category: 'food', mode: 'give',
      supply: { quantity: 3, unit: 'kg' }, description: 'from the mill', source: { kind: 'need', needId: 'need-1', holonId: 'b' }, reservations: [],
    });
  });
});

describe('answerNeed', () => {
  it('with no standing offer, raises one for the need on the provider’s holon and answers from it', async () => {
    const { holosphere, store, writes } = fake();
    const out = await answerNeed({ holosphere }, { need: need(), needHolonId: 'b', holonId: 'a', initiator: ada, actor: { id: 7, name: 'Ada' }, message: 'sure', now: 5, responseId: 'r1', reservationId: 'v1' });
    expect(out.ok).toBe(true);
    expect(out.raised).toBe(true);
    expect(out.offer).toMatchObject({ status: 'reserved', source: { kind: 'need', needId: 'need-1', holonId: 'b' }, supply: { quantity: 3, unit: 'kg' } });
    expect(out.offer.reservations).toEqual([expect.objectContaining({ id: 'v1', needId: 'need-1', responseId: 'r1', quantity: 3 })]);
    expect(remainingSupply(out.offer)).toBe(0);
    expect(out.need.status).toBe('offered');
    expect(out.need.responses?.[0]).toMatchObject({ id: 'r1', offerId: out.offer.id, offerHolonId: 'a', reservationId: 'v1', message: 'sure' });
    // The offer landed on a, the answered need on b.
    expect(store.get(`a/quests/${out.offer.id}`)?.status).toBe('reserved');
    expect(store.get('b/quests/need-1')?.status).toBe('offered');
    expect(writes.filter((w) => w.startsWith('a/')).length).toBeGreaterThan(0);
  });

  it('with a standing offer, answers from it and raises nothing', async () => {
    const { holosphere, store } = fake();
    const standing = createOffer({ holonId: 'a', initiator: ada, title: 'Flour', category: 'food', supply: { itemId: 'flour', quantity: 10, unit: 'kg' }, id: 'offer-stock-flour', now: 0 });
    const out = await answerNeed({ holosphere }, { need: need(), needHolonId: 'b', holonId: 'a', initiator: ada, actor: { id: 7 }, offer: { record: standing, holonId: 'a' } });
    expect(out).toMatchObject({ ok: true, raised: false });
    expect(out.offer.id).toBe('offer-stock-flour');
    expect(remainingSupply(out.offer)).toBe(7);
    expect([...store.keys()].filter((k) => k.startsWith('a/quests/'))).toEqual(['a/quests/offer-stock-flour']);
  });

  it('refuses the requester’s own need, or a closed one, before publishing anything', async () => {
    const { holosphere, writes } = fake();
    const own = await answerNeed({ holosphere }, { need: need(), needHolonId: 'b', holonId: 'b', initiator: bob, actor: { id: 9 } });
    expect(own).toMatchObject({ ok: false, reason: 'own_need', raised: false });
    const closed = await answerNeed({ holosphere }, { need: { ...need(), status: 'cancelled' }, needHolonId: 'b', holonId: 'a', initiator: ada, actor: { id: 7 } });
    expect(closed).toMatchObject({ ok: false, reason: 'closed', raised: false });
    expect(writes).toEqual([]);
  });
});

describe('releaseNeedReservations', () => {
  it('on a claim, frees the losers: a raised offer is withdrawn, a standing one gets its units back', async () => {
    const { holosphere, store } = fake();
    let n = need();
    // Ada answers by raising an offer; Carl answers from a standing 10 kg one.
    const a = await answerNeed({ holosphere }, { need: n, needHolonId: 'b', holonId: 'a', initiator: ada, actor: { id: 7 }, responseId: 'ra', reservationId: 'va' });
    n = a.need;
    const standing = createOffer({ holonId: 'c', initiator: { id: 11, username: 'carl' }, title: 'Flour', category: 'food', supply: { quantity: 10, unit: 'kg' }, id: 'offer-stock-flour', now: 0 });
    await holosphere.put('c', 'quests', standing);
    const c = await answerNeed({ holosphere }, { need: n, needHolonId: 'b', holonId: 'c', initiator: { id: 11, username: 'carl' }, actor: { id: 11 }, offer: { record: standing, holonId: 'c' }, responseId: 'rc', reservationId: 'vc' });
    n = c.need;
    expect(n.responses?.map((r) => r.id)).toEqual(['ra', 'rc']);
    expect(remainingSupply(store.get('c/quests/offer-stock-flour'))).toBe(7);

    // Bob picks Carl.
    const claimed = claimNeed(n, 'rc', { code: 'WXYZ' });
    const out = await releaseNeedReservations(holosphere, claimed.need, { except: 'rc' });
    expect(out.errors).toEqual([]);
    expect(out.withdrawn.map((o) => o.id)).toEqual([a.offer.id]);
    expect(store.get(`a/quests/${a.offer.id}`)?.status).toBe('withdrawn');
    expect(out.released).toEqual([]);
    // Carl's reservation stands.
    const carl = store.get('c/quests/offer-stock-flour');
    expect(remainingSupply(carl)).toBe(7);
    expect(carl.reservations.find((r: any) => r.id === 'vc').releasedAt).toBeUndefined();

    // Bob cancels instead: everything is freed, the standing offer is whole again.
    const all = await releaseNeedReservations(holosphere, n);
    expect(all.released.map((o) => o.id)).toEqual(['offer-stock-flour']);
    expect(remainingSupply(store.get('c/quests/offer-stock-flour'))).toBe(10);
    expect(store.get('c/quests/offer-stock-flour').status).toBe('open');
  });
});
