// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  editOffer,
  expireOffers,
  fulfillReservation,
  offerPartyOf,
  releaseReservation,
  reserveOffer,
  withdrawOffer,
} from './lifecycle.js';
import { createOffer, remainingSupply } from './transform.js';

const initiator = { id: 7, username: 'ada' };
const fresh = (quantity = 10) =>
  createOffer({ holonId: 'h', initiator, title: 'Flour', category: 'food', supply: { quantity, unit: 'kg' }, id: 'o', now: 0 });
const ask = (responseId: string, quantity: number, id = `r-${responseId}`) => ({
  needId: `need-${responseId}`,
  needHolonId: 'b',
  responseId,
  quantity,
  id,
  now: 1000,
});

describe('reserveOffer', () => {
  it('holds units and flips the offer to reserved', () => {
    const out = reserveOffer(fresh(), ask('p1', 4));
    expect(out.ok).toBe(true);
    expect(out.offer.status).toBe('reserved');
    expect(out.reservation).toMatchObject({ id: 'r-p1', needId: 'need-p1', responseId: 'p1', quantity: 4 });
    expect(remainingSupply(out.offer)).toBe(6);
  });

  it('the same response reserves once', () => {
    const first = reserveOffer(fresh(), ask('p1', 4));
    const again = reserveOffer(first.offer, ask('p1', 4, 'other'));
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('duplicate');
    expect(again.offer).toBe(first.offer);
  });

  it('refuses more than is left, and anything on a closed offer', () => {
    const half = reserveOffer(fresh(), ask('p1', 6)).offer;
    expect(reserveOffer(half, ask('p2', 5)).reason).toBe('insufficient');
    expect(reserveOffer(half, ask('p2', 4)).ok).toBe(true);
    expect(reserveOffer({ ...fresh(), status: 'withdrawn' }, ask('p1', 1)).reason).toBe('closed');
    expect(reserveOffer(fresh(), ask('p1', 0)).reason).toBe('invalid_quantity');
  });
});

describe('release / fulfill', () => {
  it('release gives the units back and reopens the offer', () => {
    const held = reserveOffer(fresh(), ask('p1', 4)).offer;
    const out = releaseReservation(held, 'r-p1', 2000);
    expect(out.ok).toBe(true);
    expect(out.offer.status).toBe('open');
    expect(remainingSupply(out.offer)).toBe(10);
    expect(reserveOffer(out.offer, ask('p1', 10)).ok).toBe(true);
    expect(releaseReservation(out.offer, 'r-p1').reason).toBe('already_released');
    expect(releaseReservation(held, 'nope').reason).toBe('no_such_reservation');
  });

  it('fulfilling the last unit closes the offer; earlier ones leave it on the market', () => {
    const a = reserveOffer(fresh(10), ask('p1', 4)).offer;
    const b = reserveOffer(a, ask('p2', 6)).offer;
    const one = fulfillReservation(b, 'r-p1', 3000);
    expect(one.ok).toBe(true);
    expect(one.offer.status).toBe('reserved'); // p2 still live
    expect(remainingSupply(one.offer)).toBe(0);
    const two = fulfillReservation(one.offer, 'r-p2', 4000);
    expect(two.offer.status).toBe('fulfilled');
    expect(two.offer.fulfilledAt).toBe(new Date(4000).toISOString());
    // idempotent
    expect(fulfillReservation(two.offer, 'r-p2').offer).toEqual(two.offer);
  });

  it('a partial fulfilment keeps the rest open', () => {
    const held = reserveOffer(fresh(10), ask('p1', 4)).offer;
    const out = fulfillReservation(held, 'r-p1');
    expect(out.offer.status).toBe('open');
    expect(remainingSupply(out.offer)).toBe(6);
  });
});

describe('withdrawOffer / editOffer', () => {
  it('withdraw is refused while a reservation is live', () => {
    const held = reserveOffer(fresh(), ask('p1', 4)).offer;
    expect(withdrawOffer(held).reason).toBe('has_live_reservations');
    const released = releaseReservation(held, 'r-p1').offer;
    const out = withdrawOffer(released, 5000);
    expect(out.ok).toBe(true);
    expect(out.offer.status).toBe('withdrawn');
    expect(withdrawOffer(out.offer).reason).toBe('already_closed');
  });

  it('edit cannot cut supply below what is promised', () => {
    const held = reserveOffer(fresh(10), ask('p1', 4)).offer;
    expect(editOffer(held, { supply: { quantity: 3, unit: 'kg' } }).reason).toBe('below_reserved');
    const ok = editOffer(held, { supply: { quantity: 4, unit: 'kg' }, title: 'Flour (T65)', price: 2 });
    expect(ok.ok).toBe(true);
    expect(ok.offer.title).toBe('Flour (T65)');
    expect(remainingSupply(ok.offer)).toBe(0);
    expect(editOffer({ ...fresh(), status: 'fulfilled' }, { title: 'x' }).reason).toBe('closed');
  });
});

describe('expireOffers / offerPartyOf', () => {
  it('expires only open offers past their date with nothing live', () => {
    const past = { ...fresh(), id: 'past', expires_at: 10 };
    const future = { ...fresh(), id: 'future', expires_at: 30 };
    const held = { ...reserveOffer({ ...fresh(), id: 'held', expires_at: 10 }, ask('p1', 1)).offer };
    const out = expireOffers([past, future, held], 20);
    expect(out.map((o) => o.id)).toEqual(['past']);
    expect(out[0].status).toBe('expired');
  });

  it('the initiator is the provider', () => {
    expect(offerPartyOf(fresh(), 7)).toBe('provider');
    expect(offerPartyOf(fresh(), '7')).toBe('provider');
    expect(offerPartyOf(fresh(), 8)).toBeNull();
    expect(offerPartyOf(fresh(), null)).toBeNull();
  });
});
