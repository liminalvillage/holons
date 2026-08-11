// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { handoffExpenseId, mintedOfferId, settleNeedHandoff } from './settle.js';
import type { PublishedNeed } from './types.js';
import type { HoloSphere } from 'holosphere';

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

  it('mints the flywheel offer on the provider holon, attributed and provenance-stamped', async () => {
    const { db, holosphere, writes } = fakeStores();
    const out = await settleNeedHandoff({ holosphere, db }, 'owner-h', claimedNeed(), {
      now: 1700000000000,
    });
    expect(out.mintedOfferId).toBe(mintedOfferId('need-1'));
    const offer = writes.find(
      (w) => w.lens === 'quests' && w.holon === 'prov-holon' && w.value.type === 'offer'
    );
    expect(offer?.value).toMatchObject({
      id: 'offer-from-need-1',
      type: 'offer',
      title: 'flour 5kg',
      initiator: { id: 'prov-user' },
      mintedFrom: {
        needId: 'need-1',
        holonId: 'owner-h',
        at: new Date(1700000000000).toISOString(),
      },
    });
  });

  it('mints on the owner holon when the responder declared no holon of their own', async () => {
    const { db, holosphere, writes } = fakeStores();
    const need = claimedNeed();
    delete (need.responses![0].responder as any).holonId;
    const out = await settleNeedHandoff({ holosphere, db }, 'owner-h', need, {});
    expect(out.mintedOfferId).toBe('offer-from-need-1');
    const offer = writes.find((w) => w.lens === 'quests' && w.value.type === 'offer');
    expect(offer?.holon).toBe('owner-h');
  });

  it('skips the mint when mintProviderOffer is false or there is no provider', async () => {
    const { db, holosphere, writes } = fakeStores();
    const out = await settleNeedHandoff({ holosphere, db }, 'owner-h', claimedNeed(), {
      mintProviderOffer: false,
    });
    expect(out.mintedOfferId).toBeNull();
    expect(writes.some((w) => w.value?.type === 'offer')).toBe(false);

    const orphan = claimedNeed({ claimedResponseId: 'nope' });
    const out2 = await settleNeedHandoff({ holosphere, db }, 'owner-h', orphan, {});
    expect(out2.mintedOfferId).toBeNull();
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
