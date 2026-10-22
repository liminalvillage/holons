// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
  handoffExpenseId,
  handoffFeeExpenseId,
  settleNeedHandoff,
} from './settle.js';
import type { PublishedNeed } from './types.js';
import type { HoloSphere } from 'holosphere';
import { createOffer } from '../offers/transform.js';
import { reserveOffer } from '../offers/lifecycle.js';
import { foldStock } from '../inventory/fold.js';

function fakeStores() {
  // Every write settleNeedHandoff makes, keyed for assertions.
  const writes: Array<{ holon: string; lens: string; value: any }> = [];
  const db = {
    put: vi.fn(async (holon: string, lens: string, value: any) => {
      writes.push({ holon, lens, value });
    }),
    get: vi.fn(async (_holon: string, lens: string) =>
      lens === 'checklists'
        ? {
            id: 'shopping',
            type: 'shopping',
            items: [{ id: 'item-1', text: 'flour', checked: false }],
          }
        : null
    ),
    getAll: vi.fn(async () => []),
  };
  const holosphere = {
    put: vi.fn(async () => {}),
    propagate: vi.fn(async () => ({ success: 1 })),
    createHologram: vi.fn(async (holon: string, lens: string, item: any) => ({
      id: item.id,
      soul: `test-app/${holon}/${lens}/${item.id}`,
    })),
    getNodeRef: vi.fn(() => ({ get: () => ({ get: () => ({ put: () => {} }) }) })),
    appname: 'test-app',
    getFederation: vi.fn(async () => ({ federated: [] })),
    get: vi.fn(async () => null),
    isValidH3: () => false,
  } as unknown as HoloSphere;
  return { db, holosphere, writes };
}

const claimedNeed = (over: Partial<PublishedNeed> = {}): PublishedNeed =>
  ({
    id: 'need-1',
    title: 'flour 5kg',
    type: 'need',
    status: 'claimed',
    initiator: { id: 'req-user' },
    participants: [],
    source: { kind: 'shopping', itemId: 'item-1' },
    responses: [
      {
        id: 'r1',
        responder: { id: 'prov-user', name: 'Prov', holonId: 'prov-holon' },
        price: 2,
        currency: 'hour',
        createdAt: 'x',
      },
    ],
    claimedResponseId: 'r1',
    handoff: { code: 'WXYZ', requesterAt: 'a', providerAt: 'b' },
    ...over,
  }) as PublishedNeed;

describe('settleNeedHandoff', () => {
  it('closes fulfilled, records completion, and moves the hours on the owner holon', async () => {
    const { db, holosphere, writes } = fakeStores();
    const out = await settleNeedHandoff({ holosphere, db }, 'owner-h', claimedNeed(), {
      now: 1700000000000,
      mirrorToProvider: false,
    });

    expect(out.need.status).toBe('fulfilled');
    expect(out.hours).toBe(2);
    expect(out.providerId).toBe('prov-user');
    expect(out.requesterId).toBe('req-user');
    // Provider joined the participants and logged the hours.
    expect(out.need.participants.some((p: any) => String(p.id) === 'prov-user')).toBe(true);
    expect((out.need as any).timeTracking).toEqual({ 'prov-user': 2 });

    // REA events landed on the owner holon.
    const eventWrites = writes.filter((w) => w.lens === 'rea_events');
    expect(eventWrites.length).toBeGreaterThan(0);
    expect(eventWrites.every((w) => w.holon === 'owner-h')).toBe(true);

    // The requester → provider hour expense, stable id.
    const expense = writes.find((w) => w.lens === 'expenses');
    expect(expense?.holon).toBe('owner-h');
    expect(expense?.value).toMatchObject({
      id: handoffExpenseId('need-1'),
      amount: 2,
      currency: 'hour',
      paidBy: 'prov-user',
      splitWith: ['req-user'],
    });

    // The originating shopping item was checked off.
    const checklist = writes.find((w) => w.lens === 'checklists');
    expect(checklist?.value.items[0].checked).toBe(true);
    expect(out.errors).toEqual([]);
  });

  it('falls back to 1 hour when the accepted response has no price', async () => {
    const { db, holosphere } = fakeStores();
    const need = claimedNeed();
    delete (need.responses![0] as any).price;
    const out = await settleNeedHandoff({ holosphere, db }, 'owner-h', need, {
      mirrorToProvider: false,
    });
    expect(out.hours).toBe(1);
  });

  it('mirrors expense + events into the provider holon and holograms the quest', async () => {
    const { db, holosphere, writes } = fakeStores();
    const out = await settleNeedHandoff({ holosphere, db }, 'owner-h', claimedNeed(), {
      now: 1700000000000,
    });
    expect(out.providerHolonId).toBe('prov-holon');

    const mirrorExpenses = writes.filter(
      (w) => w.lens === 'expenses' && w.holon === 'prov-holon'
    );
    expect(mirrorExpenses).toHaveLength(1);
    expect(mirrorExpenses[0].value.id).toBe(handoffExpenseId('need-1'));

    const mirrorEvents = writes.filter(
      (w) => w.lens === 'rea_events' && w.holon === 'prov-holon'
    );
    expect(mirrorEvents.map((w) => w.value.eventType).sort()).toEqual([
      'quest:completed',
      'quest:time_logged',
    ]);

    // The quest mirror is a hologram pointer minted from the owner's record.
    expect((holosphere as any).createHologram).toHaveBeenCalledWith(
      'owner-h',
      'quests',
      expect.objectContaining({ id: 'need-1' })
    );
    expect((holosphere as any).put).toHaveBeenCalledWith(
      'prov-holon',
      'quests',
      expect.objectContaining({ soul: 'test-app/owner-h/quests/need-1' })
    );
  });

  it('skips the mirror when the provider holon IS the owner holon', async () => {
    const { db, holosphere, writes } = fakeStores();
    const need = claimedNeed();
    (need.responses![0].responder as any).holonId = 'owner-h';
    await settleNeedHandoff({ holosphere, db }, 'owner-h', need, {});
    expect(writes.filter((w) => w.lens === 'expenses')).toHaveLength(1);
    expect((holosphere as any).createHologram).not.toHaveBeenCalled();
  });

  it('collects mirror errors without failing the owner-side settlement', async () => {
    const { db, holosphere, writes } = fakeStores();
    db.put.mockImplementation(async (holon: string, lens: string, value: any) => {
      if (holon === 'prov-holon') throw new Error('denied');
      writes.push({ holon, lens, value });
    });
    const out = await settleNeedHandoff({ holosphere, db }, 'owner-h', claimedNeed(), {});
    expect(writes.some((w) => w.lens === 'expenses' && w.holon === 'owner-h')).toBe(true);
    expect(out.errors.join(' ')).toMatch(/mirror/);
  });

  it('mints nothing: a response without an offer settles the need alone', async () => {
    const { db, holosphere, writes } = fakeStores();
    const out = await settleNeedHandoff({ holosphere, db }, 'owner-h', claimedNeed(), { now: 1700000000000 });
    expect(out.offerSettled).toBeNull();
    expect(writes.some((w) => w.value?.type === 'offer')).toBe(false);
    expect('mintedOfferId' in out).toBe(false);
  });

  it('is idempotent on ids: a double settle writes the same expense id', async () => {
    const { db, holosphere, writes } = fakeStores();
    await settleNeedHandoff({ holosphere, db }, 'owner-h', claimedNeed(), {
      mirrorToProvider: false,
    });
    await settleNeedHandoff({ holosphere, db }, 'owner-h', claimedNeed(), {
      mirrorToProvider: false,
    });
    const ids = writes.filter((w) => w.lens === 'expenses').map((w) => w.value.id);
    expect(new Set(ids).size).toBe(1);
  });
});

describe('settleNeedHandoff treasury fee', () => {
  async function settleWithRate(rate?: number) {
    const { db, holosphere, writes } = fakeStores();
    const out = await settleNeedHandoff({ holosphere, db }, 'owner-h', claimedNeed(), {
      now: 1700000000000,
      treasuryRate: rate,
    });
    return { out, writes };
  }

  it('withholds the voted rate into the treasury and credits the provider the rest', async () => {
    const { out, writes } = await settleWithRate(0.05);
    expect(out.treasuryFee).toBeCloseTo(0.1, 10); // 5% of 2h
    const transfer = writes.find((w) => w.value?.id === handoffExpenseId('need-1'));
    expect(transfer?.value).toMatchObject({ amount: 1.9, paidBy: 'prov-user' });
    const fee = writes.find((w) => w.value?.id === handoffFeeExpenseId('need-1'));
    expect(fee?.holon).toBe('owner-h');
    expect(fee?.value).toMatchObject({
      amount: 0.1,
      currency: 'hour',
      paidBy: 'treasury',
      splitWith: ['req-user'],
    });
    // The provider-holon mirror carries their net share, never the fee.
    const mirrored = writes.filter(
      (w) => w.holon === 'prov-holon' && w.lens === 'expenses'
    );
    expect(mirrored).toHaveLength(1);
    expect(mirrored[0].value).toMatchObject({ amount: 1.9 });
    // Karma input is untouched: the full hours stay logged.
    expect((out.need as any).timeTracking).toEqual({ 'prov-user': 2 });
  });

  it('writes no fee expense without a voted rate', async () => {
    const { out, writes } = await settleWithRate(undefined);
    expect(out.treasuryFee).toBe(0);
    expect(writes.some((w) => w.value?.id === handoffFeeExpenseId('need-1'))).toBe(false);
    const transfer = writes.find((w) => w.value?.id === handoffExpenseId('need-1'));
    expect(transfer?.value).toMatchObject({ amount: 2 });
  });
});

describe('settleNeedHandoff with a standing offer', () => {
  const stockOffer = () => {
    const base = createOffer({
      holonId: 'prov-holon',
      initiator: { id: 'prov-user' },
      title: 'Flour',
      category: 'food',
      supply: { itemId: 'flour', quantity: 8, unit: 'kg' },
      source: { kind: 'stock', itemId: 'flour' },
      id: 'offer-stock-flour',
      now: 0,
    });
    return reserveOffer(base, { needId: 'need-1', needHolonId: 'owner-h', responseId: 'r1', quantity: 5, id: 'resv-1' }).offer;
  };
  const needFromOffer = () =>
    claimedNeed({
      responses: [
        {
          id: 'r1',
          responder: { id: 'prov-user', name: 'Prov', holonId: 'prov-holon' },
          price: 2,
          currency: 'hour',
          createdAt: 'x',
          offerId: 'offer-stock-flour',
          offerHolonId: 'prov-holon',
          reservationId: 'resv-1',
        },
      ],
    });

  it('settles the reservation and writes one stock transfer on both ledgers', async () => {
    const { db, holosphere, writes } = fakeStores();
    let offer: any = stockOffer();
    db.get.mockImplementation(async (_h: string, lens: string, key?: string | number) => {
      if (lens === 'quests' && key === 'offer-stock-flour') return offer;
      if (lens === 'checklists') return { id: 'shopping', type: 'shopping', items: [] };
      return null;
    });
    (holosphere.put as any).mockImplementation(async (_h: string, lens: string, value: any) => {
      if (lens === 'quests' && value?.id === 'offer-stock-flour') offer = value;
    });

    const out = await settleNeedHandoff({ holosphere, db }, 'owner-h', needFromOffer(), {
      now: 1700000000000,
      mirrorToProvider: false,
    });

    expect(out.offerSettled).toMatchObject({ offerId: 'offer-stock-flour', offerHolonId: 'prov-holon', wroteBoth: true });

    // The offer record shrank: 5 delivered, 3 still free.
    expect(offer.reservations[0].settledAt).toBeTruthy();
    expect(offer.status).toBe('open');

    // One transfer, same id, on both holons; the provider's shelf drops by 5.
    const transfers = writes.filter((w) => w.lens === 'rea_events' && w.value?.eventType === 'stock:transferred');
    expect(transfers.map((w) => w.holon).sort()).toEqual(['owner-h', 'prov-holon']);
    expect(new Set(transfers.map((w) => w.value.id)).size).toBe(1);
    expect(transfers[0].value.id).toBe(out.offerSettled!.eventId);
    const provEvents = transfers.filter((w) => w.holon === 'prov-holon').map((w) => w.value);
    const levels = foldStock(
      [{ id: 'seed', eventType: 'stock:produced', resource: { quantity: 8, unit: 'kg', resourceId: 'flour' }, context: { holonId: 'prov-holon' }, timestamp: 1 } as any, ...provEvents],
      'prov-holon',
    );
    expect(levels.find((l) => l.itemId === 'flour')?.onhand).toBe(3);
  });
});
