// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import type { HoloSphere } from 'holosphere';
import type { PublishedNeed } from '../needs/types.js';
import { foldStock } from '../inventory/fold.js';
import { acceptMatch } from './accept.js';
import { reserveOffer } from './lifecycle.js';
import { buildOfferDelivery, offerDeliveryEventId, settleOfferReservation } from './settle.js';
import { createOffer, remainingSupply } from './transform.js';

function fakeHolosphere() {
  const writes: Array<{ holon: string; lens: string; value: any }> = [];
  const failOn = new Set<string>();
  const holosphere = {
    put: vi.fn(async (holon: string, lens: string, value: any) => {
      if (failOn.has(`${holon}/${lens}`)) throw new Error('denied');
      writes.push({ holon, lens, value });
    }),
    propagate: vi.fn(async () => ({ success: 0 })),
    getFederation: vi.fn(async () => ({ federated: [] })),
    get: vi.fn(async () => null),
    appname: 'test-app',
  } as unknown as HoloSphere;
  return { holosphere, writes, failOn };
}

const offer = () =>
  createOffer({
    holonId: 'a',
    initiator: { id: 7, username: 'ada' },
    title: 'Flour',
    category: 'food',
    supply: { itemId: 'flour', quantity: 8, unit: 'kg' },
    source: { kind: 'stock', itemId: 'flour' },
    price: 2,
    currency: 'EUR',
    id: 'offer-stock-flour',
    now: 0,
  });
const need = (over: Partial<PublishedNeed> = {}): PublishedNeed =>
  ({ id: 'n1', type: 'need', status: 'requested', title: 'flour', category: 'food', initiator: { id: 9 }, responses: [], ...over }) as PublishedNeed;

describe('acceptMatch', () => {
  it('answers the need from the offer and reserves the units', async () => {
    const { holosphere, writes } = fakeHolosphere();
    const out = await acceptMatch(
      { holosphere },
      { offer: offer(), offerHolonId: 'a', need: need(), needHolonId: 'b', quantity: 5, actor: { id: 7, name: 'Ada' }, now: 1000, responseId: 'p1', reservationId: 'r1' },
    );
    expect(out.ok).toBe(true);
    expect(out.responseId).toBe('p1');
    expect(out.need.status).toBe('offered');
    expect(out.need.responses![0]).toMatchObject({ id: 'p1', offerId: 'offer-stock-flour', offerHolonId: 'a', reservationId: 'r1', price: 2, currency: 'EUR', responder: { id: 7, holonId: 'a' } });
    expect(out.offer.status).toBe('reserved');
    expect(out.offer.reservations[0]).toMatchObject({ id: 'r1', needId: 'n1', needHolonId: 'b', responseId: 'p1', quantity: 5 });
    expect(remainingSupply(out.offer)).toBe(3);
    // Need written on its owner first, then the offer on its own holon.
    expect(writes.map((w) => `${w.holon}/${w.lens}/${w.value.id}`)).toEqual(['b/quests/n1', 'a/quests/offer-stock-flour']);
  });

  it('routes a federated need back to its owner under its source key, envelopes stripped', async () => {
    const { holosphere, writes } = fakeHolosphere();
    const foreign = need({ _hologram: { isHologram: true, sourceHolon: 'b', sourceKey: 'n1' }, _federation: { origin: 'b' } } as never);
    const out = await acceptMatch({ holosphere }, { offer: offer(), offerHolonId: 'a', need: foreign, needHolonId: 'b', needKey: 'n1', quantity: 1, actor: { id: 7 } });
    expect(out.ok).toBe(true);
    const w = writes.find((x) => x.lens === 'quests' && x.value.id === 'n1')!;
    expect(w.holon).toBe('b');
    expect('_hologram' in w.value).toBe(false);
    expect('_federation' in w.value).toBe(false);
  });

  it('refuses more than the offer has left, without touching the need', async () => {
    const { holosphere, writes } = fakeHolosphere();
    const out = await acceptMatch({ holosphere }, { offer: offer(), offerHolonId: 'a', need: need(), needHolonId: 'b', quantity: 9, actor: { id: 7 } });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('insufficient');
    expect(writes).toEqual([]);
  });

  it('refuses a closed need and one’s own need', async () => {
    const { holosphere } = fakeHolosphere();
    expect((await acceptMatch({ holosphere }, { offer: offer(), offerHolonId: 'a', need: need({ status: 'fulfilled' }), needHolonId: 'b', quantity: 1, actor: { id: 7 } })).reason).toBe('closed');
    expect((await acceptMatch({ holosphere }, { offer: offer(), offerHolonId: 'a', need: need({ initiator: { id: 7 } } as never), needHolonId: 'b', quantity: 1, actor: { id: 7 } })).reason).toBe('own_need');
  });

  it('does not reserve when the need write fails', async () => {
    const { holosphere, writes, failOn } = fakeHolosphere();
    failOn.add('b/quests');
    const out = await acceptMatch({ holosphere }, { offer: offer(), offerHolonId: 'a', need: need(), needHolonId: 'b', quantity: 2, actor: { id: 7 } });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('write_failed');
    expect(out.offer.reservations).toEqual([]);
    expect(writes).toEqual([]);
  });
});

describe('buildOfferDelivery / settleOfferReservation', () => {
  const held = () => reserveOffer(offer(), { needId: 'n1', needHolonId: 'b', responseId: 'p1', quantity: 5, id: 'r1', now: 1 }).offer;

  it('a stock-sourced offer settles as a stock transfer the shelf fold sees, under a stable id', () => {
    const o = held();
    const ev = buildOfferDelivery({ offer: o, offerHolonId: 'a', needHolonId: 'b', reservation: o.reservations[0], actor: { id: 7 }, now: 5 });
    expect(ev.eventType).toBe('stock:transferred');
    expect(ev.id).toBe(offerDeliveryEventId('a', 'offer-stock-flour', 'r1'));
    expect(ev.context).toMatchObject({ offerId: 'offer-stock-flour', needId: 'n1', reservationId: 'r1', toHolonId: 'b' });
    const seed = { id: 's', eventType: 'stock:produced', resource: { quantity: 8, unit: 'kg', resourceId: 'flour' }, context: { holonId: 'a' }, timestamp: 1 };
    expect(foldStock([seed as never, ev], 'a').find((l) => l.itemId === 'flour')?.onhand).toBe(3);
    expect(foldStock([ev], 'b').find((l) => l.itemId === 'flour')?.onhand).toBe(5);
  });

  it('a loan, a service and a plain gift take their own ValueFlows actions', () => {
    const base = held();
    const r = base.reservations[0];
    const lend = buildOfferDelivery({ offer: { ...base, source: undefined, mode: 'lend' }, offerHolonId: 'a', needHolonId: 'b', reservation: r, actor: { id: 7 } });
    expect(lend.eventType).toBe('offer:lent');
    expect(lend.action).toBe('transferCustody');
    const service = buildOfferDelivery({ offer: { ...base, source: undefined, item_type: 'service' } as never, offerHolonId: 'a', needHolonId: 'b', reservation: r, actor: { id: 7 } });
    expect(service.eventType).toBe('offer:service_delivered');
    expect(service.action).toBe('deliverService');
    const gift = buildOfferDelivery({ offer: { ...base, source: undefined }, offerHolonId: 'a', needHolonId: 'b', reservation: r, actor: { id: 7 } });
    expect(gift.eventType).toBe('offer:delivered');
    expect(gift.action).toBe('transfer');
    expect(gift.resourceQuantity).toEqual({ hasNumericalValue: 5, hasUnit: 'kg' });
  });

  it('settles the reservation, re-publishes, and writes the event on both ledgers', async () => {
    const { holosphere, writes } = fakeHolosphere();
    const out = await settleOfferReservation({ holosphere }, 'a', held(), 'r1', { needHolonId: 'b', actor: { id: 7 }, now: 9 });
    expect(out.ok).toBe(true);
    expect(out.wroteBoth).toBe(true);
    expect(out.offer.reservations[0].settledAt).toBe(new Date(9).toISOString());
    expect(out.offer.status).toBe('open');
    const events = writes.filter((w) => w.lens === 'rea_events');
    expect(events.map((w) => w.holon).sort()).toEqual(['a', 'b']);
    expect(events[0].value.id).toBe(events[1].value.id);
    // A second settle upserts the same id rather than stacking.
    const again = await settleOfferReservation({ holosphere }, 'a', out.offer, 'r1', { needHolonId: 'b', actor: { id: 7 } });
    expect(again.ok).toBe(true);
    expect(again.event?.id).toBe(out.event?.id);
  });

  it('a denied write on the need holon is reported, not thrown', async () => {
    const { holosphere, failOn } = fakeHolosphere();
    failOn.add('b/rea_events');
    const out = await settleOfferReservation({ holosphere }, 'a', held(), 'r1', { needHolonId: 'b', actor: { id: 7 } });
    expect(out.ok).toBe(true);
    expect(out.wroteBoth).toBe(false);
    expect(out.errors.join(' ')).toMatch(/rea b/);
    expect((await settleOfferReservation({ holosphere }, 'a', held(), 'nope', { needHolonId: 'b', actor: { id: 7 } })).reason).toBe('no_such_reservation');
  });
});
