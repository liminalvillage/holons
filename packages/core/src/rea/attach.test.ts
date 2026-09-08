// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The projection behind holosphere.put/delete, on a real local-only instance
// built by the core factory — the way every UI gets one.
import { describe, expect, it } from 'vitest';
import { createHoloSphere } from '../holosphere/factory.js';
import { attachLedger, hasLedger } from './attach.js';
import { REAEventStore } from './event-store.js';

const H = '-100777';

function fresh() {
  const hs = createHoloSphere({ appName: 'ledger-test', store: { adapter: 'memory' } });
  return { hs, ledger: new REAEventStore(hs as any) };
}

const quest = () => ({
  id: 'q1',
  title: 'Fix the pump',
  status: 'ongoing',
  created: '2026-09-01T09:00:00.000Z',
  initiator: { id: 7, username: 'ada' },
  participants: [] as any[],
  timeTracking: {} as Record<string, number>,
});

describe('attachLedger', () => {
  it('is attached by the factory, once', () => {
    const { hs } = fresh();
    expect(hasLedger(hs)).toBe(true);
    const put = hs.put;
    attachLedger(hs as any);
    expect(hs.put).toBe(put);
    const off = createHoloSphere({ appName: 'ledger-test', store: { adapter: 'memory' }, ledger: false });
    expect(hasLedger(off)).toBe(false);
  });

  it('accounts a quest through its life: created, joined, hours, left', async () => {
    const { hs, ledger } = fresh();
    const q = quest();
    await hs.put(H, 'quests', q);
    let events = await ledger.getAll(H);
    expect(events.map((e) => e.eventType)).toEqual(['quest:initiated']);
    const initiatedAt = events[0].timestamp;

    q.participants = [{ id: 9, username: 'bo' }];
    await hs.put(H, 'quests', q);
    events = await ledger.getAll(H);
    expect(events.map((e) => e.eventType).sort()).toEqual(['quest:initiated', 'quest:joined']);
    const joined = events.find((e) => e.eventType === 'quest:joined')!;
    expect(joined.vfType).toBe('Commitment');
    expect(joined.provider.id).toBe('9');
    // The initiative keeps the creation date across re-puts.
    expect(events.find((e) => e.eventType === 'quest:initiated')!.timestamp).toBe(initiatedAt);

    q.timeTracking = { '9': 2 };
    await hs.put(H, 'quests', q);
    events = await ledger.getAll(H);
    expect(events.map((e) => e.eventType).sort()).toEqual(['quest:initiated', 'quest:joined', 'quest:time_logged']);
    const joinedAt = events.find((e) => e.eventType === 'quest:joined')!.timestamp;

    // A re-put that changes nothing rewrites nothing (the join keeps its instant).
    await hs.put(H, 'quests', { ...q, title: 'Fix the pump' });
    events = await ledger.getAll(H);
    expect(events.find((e) => e.eventType === 'quest:joined')!.timestamp).toBe(joinedAt);

    q.participants = [];
    q.timeTracking = {};
    await hs.put(H, 'quests', q);
    events = await ledger.getAll(H);
    expect(events.map((e) => e.eventType)).toEqual(['quest:initiated']);

    await hs.delete(H, 'quests', 'q1');
    expect(await ledger.getAll(H)).toEqual([]);
  });

  it('treats a tombstone put like a delete', async () => {
    const { hs, ledger } = fresh();
    await hs.put(H, 'quests', quest());
    expect(await ledger.getAll(H)).toHaveLength(1);
    await hs.put(H, 'quests', { ...quest(), _deleted: true });
    expect(await ledger.getAll(H)).toEqual([]);
  });

  it('keeps expenses and their shares in line with the split', async () => {
    const { hs, ledger } = fresh();
    const expense = {
      id: 'e1',
      amount: 60,
      currency: 'EUR',
      description: 'gas',
      paidBy: 1,
      splitWith: [1, 2, 3],
      created: '2026-09-01T10:00:00.000Z',
    };
    await hs.put(H, 'expenses', expense);
    let events = await ledger.getAll(H);
    expect(events.map((e) => e.eventType).sort()).toEqual(['expense:paid', 'expense:share', 'expense:share']);
    expect(events.every((e) => e.hasPointInTime === '2026-09-01T10:00:00.000Z')).toBe(true);

    await hs.put(H, 'expenses', { ...expense, splitWith: [1, 2] });
    events = await ledger.getAll(H);
    expect(events.map((e) => e.eventType).sort()).toEqual(['expense:paid', 'expense:share']);
    expect(events.find((e) => e.eventType === 'expense:share')!.resource.quantity).toBe(30);

    await hs.delete(H, 'expenses', 'e1');
    expect(await ledger.getAll(H)).toEqual([]);
  });

  it('accounts a library item: listed, borrowed with fee, returned', async () => {
    const { hs, ledger } = fresh();
    const item: any = {
      id: 'drill',
      type: 'tool',
      createdBy: 5,
      createdByUsername: 'owner',
      value: 3,
      created: '2026-08-01T00:00:00.000Z',
      bookings: [],
    };
    await hs.put(H, 'library', item);
    expect((await ledger.getAll(H)).map((e) => e.eventType)).toEqual(['item:listed']);

    item.bookings = [
      { id: 'b1', start: '2026-01-01', end: '2026-01-03', borrowerId: '9', borrower: 'bo', created: '2026-01-01T08:00:00.000Z' },
    ];
    await hs.put(H, 'library', item);
    let events = await ledger.getAll(H);
    expect(events.map((e) => e.eventType).sort()).toEqual(['item:borrowed', 'item:fee_paid', 'item:listed']);

    // The fee is fixed at the price the item had when borrowed.
    item.value = 10;
    await hs.put(H, 'library', item);
    events = await ledger.getAll(H);
    expect(events.find((e) => e.eventType === 'item:fee_paid')!.resource.quantity).toBe(3);

    item.bookings = [];
    item.returnedAt = '2026-01-03T18:00:00.000Z';
    await hs.put(H, 'library', item);
    events = await ledger.getAll(H);
    expect(events.map((e) => e.eventType).sort()).toEqual(['item:borrowed', 'item:fee_paid', 'item:listed', 'item:returned']);
    const returned = events.filter((e) => e.eventType === 'item:returned');
    expect(returned).toHaveLength(1);
    expect(returned[0].provider.id).toBe('9');

    await hs.delete(H, 'library', 'drill');
    events = await ledger.getAll(H);
    expect(events.map((e) => e.eventType)).toContain('item:delisted');
    expect(events).toHaveLength(5);
  });

  it('ignores the ledger lens, private writes and hologram pointers', async () => {
    const { hs, ledger } = fresh();
    await hs.put(H, 'quests', { id: 'ptr', soul: 'ledger-test/-1/quests/ptr' });
    expect(await ledger.getAll(H)).toEqual([]);
    await hs.put(H, 'rea_events', {
      id: 'manual',
      eventType: 'credit:issued',
      resource: { type: 'credit', quantity: 1, unit: 'credits' },
      provider: { id: '1', type: 'user' },
      receiver: { id: '2', type: 'user' },
      context: { holonId: H },
      timestamp: 1,
    });
    expect((await ledger.getAll(H)).map((e) => e.id)).toEqual(['manual']);
  });

  it('never blocks the primary write when the projection fails', async () => {
    const { hs } = fresh();
    const logs: string[] = [];
    const host: any = {
      put: async () => 'stored',
      delete: async () => 'gone',
      store: {
        get: () => undefined,
        list: () => {
          throw new Error('boom');
        },
      },
    };
    attachLedger(host, { log: (m) => logs.push(m) });
    // A throwing rawPut for rea_events surfaces as a log, not a rejection.
    host.put = host.put; // keep TS quiet about reassignments
    await expect(host.put(H, 'quests', quest())).resolves.toBe('stored');
    expect(hs).toBeTruthy();
  });

  it('writes the ledger with the same acting identity as the record', async () => {
    const calls: any[] = [];
    const host: any = {
      put: async (...args: any[]) => {
        calls.push(args);
        return null;
      },
      delete: async () => null,
      store: { get: () => undefined, list: () => [] },
    };
    attachLedger(host);
    await host.put(H, 'quests', quest(), { actingAs: '7' });
    const ledgerWrite = calls.find((c) => c[1] === 'rea_events');
    expect(ledgerWrite).toBeTruthy();
    expect(ledgerWrite[3]).toEqual({ actingAs: '7' });
  });
});
