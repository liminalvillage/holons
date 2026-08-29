import { describe, expect, it } from 'vitest';
import {
  EVENT_KIND_MAPPINGS,
  RESOURCE_SPECIFICATIONS,
  VF_ACTIONS,
  VF_UNIT_HOUR,
  VF_UNIT_ONE,
  economicEventProblems,
  eventMeasure,
  isEconomicEvent,
  isVfAction,
  normalizeAgent,
  normalizeReaEvent,
  toValueFlowsJsonLd,
} from './valueflows.js';
import { REAEventFactory } from './event-factory.js';
import { REAEventStore } from './event-store.js';

describe('ValueFlows action vocabulary', () => {
  it('carries the 19 actions of the ValueFlows spec, verbatim', () => {
    expect(Object.keys(VF_ACTIONS).sort()).toEqual(
      [
        'accept', 'cite', 'combine', 'consume', 'copy', 'deliverService', 'dropoff',
        'lower', 'modify', 'move', 'pickup', 'produce', 'raise', 'separate',
        'transfer', 'transferAllRights', 'transferCustody', 'use', 'work',
      ].sort(),
    );
  });

  it('records the spec resource effects and process sides', () => {
    expect(VF_ACTIONS.transfer.resourceEffect).toBe('decrementIncrement');
    expect(VF_ACTIONS.transferCustody.resourceEffect).toBe('noEffect');
    expect(VF_ACTIONS.work.inputOutput).toBe('input');
    expect(VF_ACTIONS.deliverService.inputOutput).toBe('outputInput');
    expect(VF_ACTIONS.produce.pairsWith).toBe('consume');
    expect(VF_ACTIONS.consume.pairsWith).toBe('produce');
    expect(VF_ACTIONS.pickup.pairsWith).toBe('dropoff');
    expect(VF_ACTIONS.accept.pairsWith).toBe('modify');
    expect(VF_ACTIONS.combine.pairsWith).toBe('separate');
    expect(VF_ACTIONS.copy.resourceEffect).toBe('incrementTo');
    expect(VF_ACTIONS.raise.resourceEffect).toBe('increment');
    expect(VF_ACTIONS.lower.resourceEffect).toBe('decrement');
  });

  it('every Holons event kind maps to a real ValueFlows action and resource spec', () => {
    for (const [kind, mapping] of Object.entries(EVENT_KIND_MAPPINGS)) {
      expect(isVfAction(mapping.action), kind).toBe(true);
      expect(RESOURCE_SPECIFICATIONS[mapping.resourceConformsTo], kind).toBeDefined();
    }
    // Labour is `work`, an input to the quest process.
    expect(EVENT_KIND_MAPPINGS['quest:time_logged'].action).toBe('work');
    expect(EVENT_KIND_MAPPINGS['quest:time_logged'].measure).toBe('effortQuantity');
    expect(EVENT_KIND_MAPPINGS['quest:time_logged'].process).toBe('inputOf');
    // A completed quest is a service delivered out of the process.
    expect(EVENT_KIND_MAPPINGS['quest:completed'].action).toBe('deliverService');
    expect(EVENT_KIND_MAPPINGS['quest:completed'].process).toBe('outputOf');
    // Lending keeps the rights with the lender: custody only.
    expect(EVENT_KIND_MAPPINGS['item:borrowed'].action).toBe('transferCustody');
    expect(EVENT_KIND_MAPPINGS['item:deposit_held'].action).toBe('transferCustody');
    // Money and credits change hands outright.
    expect(EVENT_KIND_MAPPINGS['expense:paid'].action).toBe('transfer');
    expect(EVENT_KIND_MAPPINGS['credit:transfer'].action).toBe('transfer');
  });

  it('money and credit are media of exchange; time and appreciation are not', () => {
    expect(RESOURCE_SPECIFICATIONS.money.mediumOfExchange).toBe(true);
    expect(RESOURCE_SPECIFICATIONS.credit.mediumOfExchange).toBe(true);
    expect(RESOURCE_SPECIFICATIONS.time.mediumOfExchange).toBe(false);
    expect(RESOURCE_SPECIFICATIONS.appreciation.mediumOfExchange).toBe(false);
    expect(RESOURCE_SPECIFICATIONS.time.defaultUnitOfEffort).toBe(VF_UNIT_HOUR);
  });
});

describe('normalizeAgent', () => {
  it('maps users to Person and holons/external to Organization, keeping the legacy type', () => {
    expect(normalizeAgent({ id: 1, type: 'user', name: 'ana' })).toEqual({
      id: '1', type: 'user', agentType: 'Person', name: 'ana',
    });
    expect(normalizeAgent({ id: 'h', type: 'holon' }).agentType).toBe('Organization');
    expect(normalizeAgent({ id: 'external', type: 'external' })).toMatchObject({
      agentType: 'Organization', type: 'external',
    });
  });

  it('projects a ValueFlows-only agent back onto the legacy type', () => {
    expect(normalizeAgent({ id: 'x', agentType: 'Organization' }).type).toBe('holon');
    expect(normalizeAgent({ id: 'y', agentType: 'Person' }).type).toBe('user');
  });
});

describe('normalizeReaEvent', () => {
  const legacyTimeLog = {
    id: 'h1_quest_time_logged_u1_q1',
    timestamp: Date.UTC(2026, 0, 2, 3, 4, 5),
    resource: { type: 'time', quantity: 2.5, unit: 'hours' },
    provider: { id: 'u1', type: 'user', name: 'ana' },
    receiver: { id: 'h1', type: 'holon', name: 'h1' },
    context: { holonId: 'h1', questId: 'q1', note: 'fixing the roof' },
    eventType: 'quest:time_logged',
    status: 'confirmed',
  };

  it('lifts a pre-ValueFlows record into a vf:EconomicEvent', () => {
    const e = normalizeReaEvent(legacyTimeLog);
    expect(e.action).toBe('work');
    expect(e.effortQuantity).toEqual({ hasNumericalValue: 2.5, hasUnit: VF_UNIT_HOUR });
    expect(e.resourceQuantity).toBeUndefined();
    expect(e.resourceConformsTo).toBe('time');
    expect(e.hasPointInTime).toBe('2026-01-02T03:04:05.000Z');
    expect(e.inScopeOf).toBe('h1');
    expect(e.inputOf).toBe('q1');
    expect(e.outputOf).toBeUndefined();
    expect(e.note).toBe('fixing the roof');
    expect(e.provider.agentType).toBe('Person');
    expect(e.receiver.agentType).toBe('Organization');
    expect(e.resourceClassifiedAs).toEqual(['labour', 'time']);
    expect(isEconomicEvent(e)).toBe(true);
    expect(economicEventProblems(e)).toEqual([]);
    // The legacy projection is untouched.
    expect(e.eventType).toBe('quest:time_logged');
    expect(e.resource).toEqual(legacyTimeLog.resource);
    expect(e.timestamp).toBe(legacyTimeLog.timestamp);
  });

  it('is idempotent and does not mutate its input', () => {
    const copy = JSON.parse(JSON.stringify(legacyTimeLog));
    const once = normalizeReaEvent(legacyTimeLog);
    const twice = normalizeReaEvent(once);
    expect(twice).toEqual(once);
    expect(legacyTimeLog).toEqual(copy);
  });

  it('projects a ValueFlows-only record back onto the legacy shape', () => {
    const e = normalizeReaEvent({
      id: 'vf-1',
      action: 'transfer',
      provider: { id: 'u1', agentType: 'Person' },
      receiver: { id: 'u2', agentType: 'Person' },
      resourceQuantity: { hasNumericalValue: 12, hasUnit: 'eur' },
      resourceConformsTo: 'money',
      hasPointInTime: '2026-03-04T05:06:07.000Z',
      inScopeOf: 'h9',
      note: 'lunch',
    });
    expect(e.timestamp).toBe(Date.parse('2026-03-04T05:06:07.000Z'));
    expect(e.resource).toEqual({ type: 'money', quantity: 12, unit: 'eur' });
    expect(e.context).toEqual({ holonId: 'h9', questId: null, note: 'lunch' });
    expect(e.eventType).toBe('money:transfer');
    expect(e.provider.type).toBe('user');
    expect(e.status).toBe('confirmed');
  });

  it('links a borrowed item as the inventoried resource under custody', () => {
    const [borrow, fee, deposit] = REAEventFactory.itemBorrowed(
      'h1', { id: 7, username: 'bo' }, { id: 'drill-1', createdBy: 3 }, 2, 5,
    );
    expect(borrow.action).toBe('transferCustody');
    expect(borrow.resourceInventoriedAs).toBe('drill-1');
    expect(borrow.resourceQuantity).toEqual({ hasNumericalValue: 1, hasUnit: VF_UNIT_ONE });
    expect(borrow.provider).toMatchObject({ id: '3', agentType: 'Person' });
    expect(borrow.receiver).toMatchObject({ id: '7', agentType: 'Person' });
    expect(fee.action).toBe('transfer');
    expect(fee.resourceQuantity).toEqual({ hasNumericalValue: 2, hasUnit: 'credits' });
    expect(deposit.action).toBe('transferCustody');
    expect(deposit.status).toBe('pending');
    expect(deposit.receiver.agentType).toBe('Organization');
  });
});

describe('REAEventFactory emits ValueFlows events', () => {
  it('for every kind it produces', () => {
    const u = { id: 1, username: 'ana' };
    const v = { id: 2, username: 'bo' };
    const quest = { id: 'q1', title: 'roof' };
    const all = [
      REAEventFactory.questInitiated('h', u, quest),
      REAEventFactory.questCompleted('h', u, quest),
      REAEventFactory.timeLogged('h', u, 3, 'q1', 'n'),
      ...REAEventFactory.appreciationExchange('h', u, v, 2, 'thanks', 'q1'),
      ...REAEventFactory.expenseEvents('h', {
        id: 'e1', amount: 30, currency: 'EUR', description: 'veg', paidBy: 1, splitWith: [1, 2],
        created: '2026-05-01T10:00:00.000Z',
      }),
      REAEventFactory.directTransfer('h', u, v, 5, 'EUR'),
      ...REAEventFactory.itemReturned('h', v, { id: 'i1', createdBy: 1 }, 5),
      REAEventFactory.creditIssued('h', u, v, 4),
      REAEventFactory.creditTransfer('h', u, v, 4),
    ];
    for (const e of all) {
      expect(economicEventProblems(e), e.eventType).toEqual([]);
      expect(EVENT_KIND_MAPPINGS[e.eventType].action).toBe(e.action);
      expect(eventMeasure(e)?.hasNumericalValue).toBe(e.resource.quantity);
    }
  });

  it('models a quest as a process: initiation and hours flow in, completion flows out', () => {
    const u = { id: 1 };
    const quest = { id: 'q1', title: 'roof' };
    expect(REAEventFactory.questInitiated('h', u, quest)).toMatchObject({
      action: 'work', inputOf: 'q1', effortQuantity: { hasNumericalValue: 1, hasUnit: VF_UNIT_ONE },
    });
    expect(REAEventFactory.timeLogged('h', u, 2, 'q1')).toMatchObject({
      action: 'work', inputOf: 'q1', effortQuantity: { hasNumericalValue: 2, hasUnit: VF_UNIT_HOUR },
    });
    expect(REAEventFactory.questCompleted('h', u, quest)).toMatchObject({
      action: 'deliverService', outputOf: 'q1', receiver: { id: 'h', agentType: 'Organization' },
    });
  });

  it('carries an ISO instant that mirrors the ms timestamp', () => {
    const e = REAEventFactory.expenseEvents('h', {
      id: 'e1', amount: 30, currency: 'EUR', description: 'veg', paidBy: 1, splitWith: [1, 2],
      created: '2026-05-01T10:00:00.000Z',
    })[0];
    expect(e.hasPointInTime).toBe('2026-05-01T10:00:00.000Z');
    expect(e.timestamp).toBe(Date.parse('2026-05-01T10:00:00.000Z'));
    expect(e.resourceQuantity).toEqual({ hasNumericalValue: 30, hasUnit: 'eur' });
  });
});

describe('REAEventStore', () => {
  function memoryDb() {
    const rows = new Map<string, any>();
    return {
      rows,
      async put(_holon: string, _lens: string, data: any) { rows.set(data.id, data); },
      async get(_holon: string, _lens: string, key: string) { return rows.get(key) ?? null; },
      async getAll() { return [...rows.values()]; },
    };
  }

  it('normalizes on write and on read, so old records come back as EconomicEvents', async () => {
    const db = memoryDb();
    // A record written before the ValueFlows alignment.
    db.rows.set('old', {
      id: 'old', timestamp: 1, resource: { type: 'money', quantity: 9, unit: 'eur' },
      provider: { id: 'a', type: 'user' }, receiver: { id: 'b', type: 'user' },
      context: { holonId: 'h' }, eventType: 'transfer:direct', status: 'confirmed',
    });
    const store = new REAEventStore(db as any);
    const stored = await store.put('h', REAEventFactory.timeLogged('h', { id: 'a' }, 1, 'q'));
    expect(stored.action).toBe('work');
    expect(db.rows.get(stored.id).action).toBe('work');

    const all = await store.getAll('h');
    expect(all).toHaveLength(2);
    for (const e of all) expect(isEconomicEvent(e)).toBe(true);
    expect((await store.get('h', 'old'))?.action).toBe('transfer');
  });

  it('filters by ValueFlows action, resource specification and process', async () => {
    const db = memoryDb();
    const store = new REAEventStore(db as any);
    await store.putMany('h', [
      REAEventFactory.timeLogged('h', { id: 'a' }, 1, 'q1'),
      REAEventFactory.questCompleted('h', { id: 'a' }, { id: 'q1', title: 't' }),
      REAEventFactory.directTransfer('h', { id: 'a' }, { id: 'b' }, 3, 'eur'),
    ]);
    expect((await store.query('h', { action: 'work' })).map((e) => e.eventType)).toEqual(['quest:time_logged']);
    expect((await store.query('h', { resourceConformsTo: 'money' }))).toHaveLength(1);
    expect((await store.query('h', { processId: 'q1' }))).toHaveLength(2);
  });

  it('refuses a record that is not a ValueFlows EconomicEvent', async () => {
    const store = new REAEventStore(memoryDb() as any);
    await expect(
      store.put('h', { id: 'bad', provider: { id: 'a' } } as any),
    ).rejects.toThrow(/not a ValueFlows EconomicEvent/);
  });
});

describe('toValueFlowsJsonLd', () => {
  it('exports only ValueFlows terms', () => {
    const e = REAEventFactory.timeLogged('h', { id: 'a', username: 'ana' }, 2, 'q1', 'roof');
    const ld = toValueFlowsJsonLd(e);
    expect(ld['@type']).toBe('vf:EconomicEvent');
    expect(ld['vf:action']).toBe('work');
    expect(ld['vf:effortQuantity']).toEqual({
      '@type': 'vf:Measure', 'vf:hasNumericalValue': 2, 'vf:hasUnit': 'hour',
    });
    expect(ld['vf:provider']).toEqual({ '@id': 'a', '@type': 'vf:Person', name: 'ana' });
    expect(ld['vf:inputOf']).toBe('q1');
    expect(ld['vf:note']).toBe('roof');
    expect(Object.keys(ld).some((k) => ['eventType', 'resource', 'timestamp', 'context'].includes(k))).toBe(false);
  });
});
