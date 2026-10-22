// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { planLedger, type LedgerContext } from './ledger.js';
import type { REAEvent } from './event-store.js';
import { toValueFlowsJsonLd } from './valueflows.js';

const NOW = Date.parse('2026-09-08T12:00:00.000Z');
const H = '-1001';

function ctx(partial: Partial<LedgerContext> & Pick<LedgerContext, 'lens' | 'key'>): LedgerContext {
  return { holonId: H, next: null, prev: null, existing: [], actor: null, now: NOW, ...partial };
}

const kinds = (plan: ReturnType<typeof planLedger>) => plan.upserts.map((u) => u.event.eventType);
const ids = (plan: ReturnType<typeof planLedger>) => plan.upserts.map((u) => u.event.id);

describe('planLedger: quests', () => {
  const quest = {
    id: 'q1',
    title: 'Fix the pump',
    status: 'ongoing',
    created: '2026-09-01T09:00:00.000Z',
    initiator: { id: 7, username: 'ada' },
    participants: [{ id: 7, username: 'ada' }, { id: 9, first_name: 'Bo' }],
    timeTracking: { '9': 1.5 },
  };

  it('derives initiative, one commitment per member, and logged hours', () => {
    const plan = planLedger(ctx({ lens: 'quests', key: 'q1', next: quest }));
    expect(kinds(plan).sort()).toEqual(['quest:initiated', 'quest:joined', 'quest:joined', 'quest:time_logged']);
    const initiated = plan.upserts.find((u) => u.event.eventType === 'quest:initiated')!;
    expect(initiated.event.id).toBe(`${H}_quest_initiated_7_q1`);
    expect(initiated.pinTime).toBe(true);
    expect(initiated.event.hasPointInTime).toBe('2026-09-01T09:00:00.000Z');
    expect(initiated.onlyIfAbsent).toBe(true);
    const joined = plan.upserts.filter((u) => u.event.eventType === 'quest:joined').map((u) => u.event);
    expect(joined.map((e) => e.vfType)).toEqual(['Commitment', 'Commitment']);
    expect(joined.map((e) => e.status)).toEqual(['pending', 'pending']);
    expect(joined[0].inputOf).toBe('q1');
    expect(joined[0].effortQuantity).toBeUndefined();
    const hours = plan.upserts.find((u) => u.event.eventType === 'quest:time_logged')!.event;
    expect(hours.id).toBe(`${H}_quest_time_logged_9_q1`);
    expect(hours.effortQuantity).toEqual({ hasNumericalValue: 1.5, hasUnit: 'hour' });
  });

  it('is idempotent: the same document plans the same ids', () => {
    const a = ids(planLedger(ctx({ lens: 'quests', key: 'q1', next: quest })));
    const b = ids(planLedger(ctx({ lens: 'quests', key: 'q1', next: quest })));
    expect(a).toEqual(b);
  });

  it('retracts the commitment of a member who left, and hours zeroed out', () => {
    const before = planLedger(ctx({ lens: 'quests', key: 'q1', next: quest }));
    const existing = before.upserts.map((u) => u.event);
    const after = planLedger(
      ctx({
        lens: 'quests',
        key: 'q1',
        next: { ...quest, participants: [quest.participants[0]], timeTracking: {} },
        existing,
      }),
    );
    expect(after.deletes.sort()).toEqual([`${H}_quest_joined_9_q1`, `${H}_quest_time_logged_9_q1`].sort());
    expect(after.deletes).not.toContain(`${H}_quest_initiated_7_q1`);
  });

  it('marks commitments finished when the quest completes', () => {
    const plan = planLedger(ctx({ lens: 'quests', key: 'q1', next: { ...quest, status: 'completed' } }));
    const joined = plan.upserts.filter((u) => u.event.eventType === 'quest:joined').map((u) => u.event);
    expect(joined.every((e) => e.finished === true && e.status === 'confirmed')).toBe(true);
    // Completion itself is priced by the completion plan, not derived here.
    expect(kinds(plan)).not.toContain('quest:completed');
  });

  it('withdraws an abandoned quest but keeps a finished one', () => {
    const existing = planLedger(ctx({ lens: 'quests', key: 'q1', next: quest })).upserts.map((u) => u.event);
    const gone = planLedger(ctx({ lens: 'quests', key: 'q1', next: null, prev: quest, existing }));
    expect(gone.deletes.sort()).toEqual(existing.map((e) => e.id).sort());
    const done = planLedger(
      ctx({ lens: 'quests', key: 'q1', next: null, prev: { ...quest, status: 'completed' }, existing }),
    );
    expect(done.deletes).toEqual([]);
    expect(done.upserts).toEqual([]);
  });

  it('treats the events lens like quests', () => {
    const plan = planLedger(ctx({ lens: 'events', key: 'q1', next: quest }));
    expect(kinds(plan)).toContain('quest:initiated');
  });

  it('skips members without an id and dedupes repeats', () => {
    const plan = planLedger(
      ctx({
        lens: 'quests',
        key: 'q1',
        next: { ...quest, participants: [{ username: 'ghost' }, { id: 9 }, { id: 9 }], timeTracking: {} },
      }),
    );
    expect(kinds(plan).filter((k) => k === 'quest:joined')).toHaveLength(1);
  });
});

describe('planLedger: board items are intents', () => {
  const need = {
    id: 'n1',
    type: 'need',
    title: 'Someone to fix the fence',
    status: 'requested',
    item_type: 'service',
    created: '2026-09-02T09:00:00.000Z',
    initiator: { id: 7, username: 'ada' },
    participants: [],
  };

  it('publishes a need as a vf:Intent the asker receives', () => {
    const plan = planLedger(ctx({ lens: 'quests', key: 'n1', next: need }));
    expect(kinds(plan)).toEqual(['need:published']);
    const e = plan.upserts[0].event;
    expect(e.vfType).toBe('Intent');
    expect(e.action).toBe('deliverService');
    expect(e.receiver.id).toBe('7');
    expect(e.provider.id).toBe(H);
    expect(e.status).toBe('pending');
    expect(toValueFlowsJsonLd(e)['@type']).toBe('vf:Intent');
  });

  it('adds the provider commitment once a response is claimed, and closes both when fulfilled', () => {
    const claimed = {
      ...need,
      status: 'claimed',
      responses: [{ id: 'r1', responder: { id: 21, name: 'Cy', holonId: '-1002' }, createdAt: '2026-09-03T00:00:00Z' }],
      claimedResponseId: 'r1',
      claimedAt: '2026-09-03T10:00:00.000Z',
    };
    const plan = planLedger(ctx({ lens: 'quests', key: 'n1', next: claimed }));
    expect(kinds(plan).sort()).toEqual(['need:claimed', 'need:published']);
    const c = plan.upserts.find((u) => u.event.eventType === 'need:claimed')!;
    expect(c.event.vfType).toBe('Commitment');
    expect(c.event.provider.id).toBe('21');
    expect(c.event.receiver.id).toBe('7');
    expect(c.event.hasPointInTime).toBe('2026-09-03T10:00:00.000Z');
    expect(c.pinTime).toBe(true);

    const done = planLedger(ctx({ lens: 'quests', key: 'n1', next: { ...claimed, status: 'fulfilled' } }));
    expect(done.upserts.every((u) => u.event.finished === true)).toBe(true);
  });

  it('offers are provided by the offerer; requests received by the asker', () => {
    const offer = planLedger(ctx({ lens: 'quests', key: 'o1', next: { ...need, id: 'o1', type: 'offer', item_type: 'good' } }));
    expect(offer.upserts[0].event.eventType).toBe('offer:listed');
    expect(offer.upserts[0].event.provider.id).toBe('7');
    expect(offer.upserts[0].event.action).toBe('transfer');
    const req = planLedger(ctx({ lens: 'quests', key: 'r1', next: { ...need, id: 'r1', type: 'request' } }));
    expect(req.upserts[0].event.eventType).toBe('request:listed');
    expect(req.upserts[0].event.receiver.id).toBe('7');
  });
});

describe('planLedger: expenses', () => {
  const expense = {
    id: 'e1',
    amount: 90,
    currency: 'EUR',
    description: 'veg',
    paidBy: 1,
    splitWith: [1, 2, 3],
    created: '2026-09-01T10:00:00.000Z',
  };

  it('derives paid + one share per non-payer, pinned to the expense date', () => {
    const plan = planLedger(ctx({ lens: 'expenses', key: 'e1', next: expense }));
    expect(kinds(plan).sort()).toEqual(['expense:paid', 'expense:share', 'expense:share']);
    expect(plan.upserts.every((u) => u.pinTime)).toBe(true);
    expect(plan.upserts[0].event.hasPointInTime).toBe('2026-09-01T10:00:00.000Z');
  });

  it('retracts shares that a shrunk split no longer has', () => {
    const existing = planLedger(ctx({ lens: 'expenses', key: 'e1', next: expense })).upserts.map((u) => u.event);
    const plan = planLedger(ctx({ lens: 'expenses', key: 'e1', next: { ...expense, splitWith: [1, 2] }, existing }));
    expect(kinds(plan).sort()).toEqual(['expense:paid', 'expense:share']);
    expect(plan.deletes).toEqual([`${H}_expense_e1_share_2`]);
  });

  it('retracts everything on delete', () => {
    const existing = planLedger(ctx({ lens: 'expenses', key: 'e1', next: expense })).upserts.map((u) => u.event);
    const plan = planLedger(ctx({ lens: 'expenses', key: 'e1', next: null, existing }));
    expect(plan.deletes.sort()).toEqual(existing.map((e) => e.id).sort());
  });

  it('leaves library borrow/return mirrors to the library lens', () => {
    const plan = planLedger(
      ctx({ lens: 'expenses', key: 'e2', next: { ...expense, id: 'e2', type: 'borrow', itemId: 'drill', currency: 'credits' } }),
    );
    expect(plan.upserts).toEqual([]);
  });
});

describe('planLedger: library', () => {
  const item = {
    id: 'drill',
    type: 'tool',
    createdBy: 5,
    createdByUsername: 'owner',
    value: 3,
    created: '2026-08-01T00:00:00.000Z',
    bookings: [] as any[],
  };
  const booking = {
    id: 'b1',
    start: '2026-09-08',
    end: '2026-09-10',
    borrowerId: '9',
    borrower: 'bo',
    created: '2026-09-07T08:00:00.000Z',
  };

  it('lists a new item on the shelf (once)', () => {
    const plan = planLedger(ctx({ lens: 'library', key: 'drill', next: item }));
    expect(kinds(plan)).toEqual(['item:listed']);
    expect(plan.upserts[0].event.action).toBe('raise');
    expect(plan.upserts[0].onlyIfAbsent).toBe(true);
    expect(plan.upserts[0].event.resourceInventoriedAs).toBe('drill');
  });

  it('records a booking as custody + fee, keyed on the booking', () => {
    const plan = planLedger(ctx({ lens: 'library', key: 'drill', next: { ...item, bookings: [booking] } }));
    expect(kinds(plan).sort()).toEqual(['item:borrowed', 'item:fee_paid', 'item:listed']);
    const borrow = plan.upserts.find((u) => u.event.eventType === 'item:borrowed')!;
    expect(borrow.event.id).toBe(`${H}_booking_b1_borrow`);
    expect(borrow.event.hasPointInTime).toBe('2026-09-07T08:00:00.000Z');
    expect(borrow.event.context.bookingId).toBe('b1');
    expect(borrow.event.provider.id).toBe('5');
    expect(borrow.event.receiver.id).toBe('9');
    const fee = plan.upserts.find((u) => u.event.eventType === 'item:fee_paid')!.event;
    expect(fee.resourceQuantity).toEqual({ hasNumericalValue: 3, hasUnit: 'credits' });
  });

  it('does not charge the owner for their own booking', () => {
    const plan = planLedger(
      ctx({ lens: 'library', key: 'drill', next: { ...item, bookings: [{ ...booking, borrowerId: '5' }] } }),
    );
    expect(kinds(plan)).toEqual(['item:listed']);
  });

  it('turns a finished booking into a return, once', () => {
    const existing = planLedger(ctx({ lens: 'library', key: 'drill', next: { ...item, bookings: [booking] } })).upserts.map(
      (u) => u.event,
    );
    const returned = planLedger(
      ctx({ lens: 'library', key: 'drill', next: { ...item, bookings: [], returnedAt: '2026-09-10T18:00:00.000Z' }, existing }),
    );
    expect(kinds(returned)).toEqual(['item:listed', 'item:returned']);
    const ret = returned.upserts.find((u) => u.event.eventType === 'item:returned')!;
    expect(ret.event.id).toBe(`${H}_booking_b1_return`);
    expect(ret.event.provider.id).toBe('9');
    expect(ret.event.hasPointInTime).toBe('2026-09-10T18:00:00.000Z');
    expect(returned.deletes).toEqual([]);
    // Second put after the return: nothing new.
    const again = planLedger(
      ctx({ lens: 'library', key: 'drill', next: { ...item, bookings: [] }, existing: [...existing, ret.event] }),
    );
    expect(kinds(again)).toEqual(['item:listed']);
  });

  it('retracts a reservation cancelled before it started', () => {
    const future = { ...booking, id: 'b2', start: '2026-09-20', end: '2026-09-21' };
    const existing = planLedger(ctx({ lens: 'library', key: 'drill', next: { ...item, bookings: [future] } })).upserts.map(
      (u) => u.event,
    );
    const plan = planLedger(ctx({ lens: 'library', key: 'drill', next: { ...item, bookings: [] }, existing }));
    expect(plan.deletes.sort()).toEqual([`${H}_booking_b2_borrow`, `${H}_booking_b2_fee`].sort());
    expect(kinds(plan)).not.toContain('item:returned');
  });

  it('delists on delete, and re-listing clears the delisting', () => {
    const listed = planLedger(ctx({ lens: 'library', key: 'drill', next: item })).upserts.map((u) => u.event);
    const gone = planLedger(ctx({ lens: 'library', key: 'drill', next: null, prev: item, existing: listed }));
    expect(kinds(gone)).toEqual(['item:delisted']);
    expect(gone.upserts[0].event.action).toBe('lower');
    const back = planLedger(ctx({ lens: 'library', key: 'drill', next: item, existing: [...listed, gone.upserts[0].event] }));
    expect(back.deletes).toEqual([gone.upserts[0].event.id]);
  });
});

describe('planLedger: shopping list', () => {
  const list = {
    id: 'shopping',
    type: 'shopping',
    title: 'Shopping',
    items: [
      { id: 'i1', text: 'olive oil', checked: true, quantity: 2 },
      { id: 'i2', text: 'bread', checked: false },
    ],
  };

  it('records a ticked line as bought by whoever ticked it', () => {
    const plan = planLedger(ctx({ lens: 'checklists', key: 'shopping', next: list, actor: '42' }));
    expect(kinds(plan)).toEqual(['shopping:bought']);
    const e = plan.upserts[0].event;
    expect(e.provider.id).toBe('42');
    expect(e.receiver.id).toBe(H);
    expect(e.resourceQuantity).toEqual({ hasNumericalValue: 2, hasUnit: 'one' });
    expect(e.context.listId).toBe('shopping');
    expect(plan.upserts[0].onlyIfAbsent).toBe(true);
  });

  it('falls back to the market when nobody is known to have bought it', () => {
    const plan = planLedger(ctx({ lens: 'checklists', key: 'shopping', next: list }));
    expect(plan.upserts[0].event.provider.id).toBe('external');
  });

  it('un-ticking retracts; clearing bought lines keeps the purchase', () => {
    const existing = planLedger(ctx({ lens: 'checklists', key: 'shopping', next: list })).upserts.map((u) => u.event);
    const unticked = planLedger(
      ctx({ lens: 'checklists', key: 'shopping', next: { ...list, items: [{ ...list.items[0], checked: false }] }, existing }),
    );
    expect(unticked.deletes).toEqual([existing[0].id]);
    const cleared = planLedger(ctx({ lens: 'checklists', key: 'shopping', next: { ...list, items: [list.items[1]] }, existing }));
    expect(cleared.deletes).toEqual([]);
    const listGone = planLedger(ctx({ lens: 'checklists', key: 'shopping', next: null, existing }));
    expect(listGone.deletes).toEqual([]);
  });

  it('ignores checklists that are not the shopping list', () => {
    const plan = planLedger(ctx({ lens: 'checklists', key: 'c9', next: { id: 'c9', type: 'task', items: list.items } }));
    expect(plan.upserts).toEqual([]);
  });
});

describe('planLedger: roles', () => {
  const role = {
    id: 'cook',
    title: 'Cook',
    participants: [{ id: 7, username: 'ada', isPermanent: true, assigned_at: '2026-09-01T00:00:00.000Z' }],
    weekSchedule: {
      weekKey: '2026-W37',
      assignments: [{ dayOfWeek: 0, date: '2026-09-07', users: [{ id: 9, username: 'bo' }] }],
    },
  };

  it('commits permanent holders and day holders', () => {
    const plan = planLedger(ctx({ lens: 'roles', key: 'cook', next: role }));
    expect(ids(plan).sort()).toEqual([`${H}_role_taken_cook_7_permanent`, `${H}_role_taken_cook_9_2026-09-07`].sort());
    expect(plan.upserts.every((u) => u.event.vfType === 'Commitment' && u.event.action === 'work')).toBe(true);
  });

  it('retracts a released role', () => {
    const existing = planLedger(ctx({ lens: 'roles', key: 'cook', next: role })).upserts.map((u) => u.event);
    const plan = planLedger(ctx({ lens: 'roles', key: 'cook', next: { ...role, participants: [] }, existing }));
    expect(plan.deletes).toEqual([`${H}_role_taken_cook_7_permanent`]);
    const gone = planLedger(ctx({ lens: 'roles', key: 'cook', next: null, existing }));
    expect(gone.deletes.sort()).toEqual(existing.map((e) => e.id).sort());
  });
});

describe('planLedger: peer appreciation', () => {
  const record = {
    id: '1757000000000',
    from: { id: 7, username: 'ada' },
    to: { id: 9, first_name: 'Bo' },
    amount: 3,
    reason: 'for the fence',
    date: 1757000000000,
  };

  it('is the usual sent/received pair, keyed on the record', () => {
    const plan = planLedger(ctx({ lens: 'appreciations', key: record.id, next: record }));
    expect(ids(plan)).toEqual([`${H}_appreciation_${record.id}_sent`, `${H}_appreciation_${record.id}_received`]);
    expect(plan.upserts[0].event.resourceQuantity).toEqual({ hasNumericalValue: 3, hasUnit: 'one' });
    expect(plan.upserts[0].event.timestamp).toBe(1757000000000);
    const gone = planLedger(ctx({ lens: 'appreciations', key: record.id, next: null, existing: plan.upserts.map((u) => u.event) }));
    expect(gone.deletes).toHaveLength(2);
  });
});

describe('planLedger: scope', () => {
  it('ignores lenses without economic meaning', () => {
    expect(planLedger(ctx({ lens: 'settings', key: 's', next: { id: 's' } }))).toEqual({ upserts: [], deletes: [] });
    expect(planLedger(ctx({ lens: 'rea_events', key: 'x', next: { id: 'x' } as unknown as REAEvent }))).toEqual({
      upserts: [],
      deletes: [],
    });
  });
});
