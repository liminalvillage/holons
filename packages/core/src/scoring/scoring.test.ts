import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EQUATION,
  REAAggregator,
  calculateAllUserScores,
  calculatePercentageShare,
  calculateScoreFromUserData,
  calculateTaskCompletionScores,
  calculateUserScore,
  getActionScore,
  getCachedEquation,
  getScoreBreakdown,
  migrateEquation,
  toAggregates,
  type REAEventStoreLike,
  type UserAggregates,
} from './index.js';

describe('DEFAULT_EQUATION', () => {
  it('uses the canonical weights shared across UIs', () => {
    expect(DEFAULT_EQUATION).toEqual({
      initiated: 1,
      completed: 2,
      sent: 1,
      received: 1,
      hours: 1,
      collaboration: 1,
      wants: 1,
      offers: 1,
      currencies: { hour: 1 },
    });
  });
});

describe('migrateEquation', () => {
  it('folds legacy hours into currencies.hour', () => {
    const migrated = migrateEquation({
      initiated: 1,
      completed: 2,
      sent: 1,
      received: 1,
      hours: 3,
      collaboration: 1,
      wants: 1,
      offers: 1,
    });
    expect(migrated.currencies.hour).toBe(3);
    // hours is mirrored back for legacy readers.
    expect(migrated.hours).toBe(3);
  });

  it('is idempotent', () => {
    const once = migrateEquation({ hours: 4 });
    const twice = migrateEquation(once);
    expect(twice).toEqual(once);
  });

  it('preserves currencies.hour when both are set', () => {
    const migrated = migrateEquation({ hours: 5, currencies: { hour: 7 } });
    expect(migrated.currencies.hour).toBe(7);
  });

  it('returns the default equation when called with undefined', () => {
    expect(migrateEquation(undefined)).toEqual(DEFAULT_EQUATION);
  });
});

describe('toAggregates', () => {
  it('counts arrays and passes through numeric counts', () => {
    expect(
      toAggregates({
        initiated: [1, 2, 3],
        completed: 5,
        sent: 4,
        received: 2,
        hours: 10,
        collaboration: 1,
        wants: ['a'],
        offers: 0,
      }),
    ).toEqual({
      initiated: 3,
      completed: 5,
      sent: 4,
      received: 2,
      hours: 10,
      collaboration: 1,
      wants: 1,
      offers: 0,
    });
  });

  it('defaults missing fields to 0', () => {
    expect(toAggregates({})).toEqual({
      initiated: 0,
      completed: 0,
      sent: 0,
      received: 0,
      hours: 0,
      collaboration: 0,
      wants: 0,
      offers: 0,
    });
  });
});

describe('calculateUserScore', () => {
  it('returns the smoke-recipe score (13) for the documented inputs', () => {
    const aggregates: UserAggregates = {
      initiated: 3,
      completed: 2,
      sent: 0,
      received: 0,
      hours: 5,
      collaboration: 1,
      wants: 0,
      offers: 0,
    };
    // 3*1 + 2*2 + 5*1 + 1*1 = 3 + 4 + 5 + 1 = 13
    expect(calculateUserScore(aggregates, DEFAULT_EQUATION)).toBe(13);
  });

  it('respects custom equation weights', () => {
    const aggregates: UserAggregates = {
      initiated: 1,
      completed: 1,
      sent: 1,
      received: 1,
      hours: 1,
      collaboration: 1,
      wants: 1,
      offers: 1,
    };
    expect(
      calculateUserScore(aggregates, {
        initiated: 0,
        completed: 0,
        sent: 0,
        received: 0,
        hours: 10,
        collaboration: 0,
        wants: 0,
        offers: 0,
        currencies: {},
      }),
    ).toBe(10);
  });

  it('adds Σ currencyBalances * equation.currencies', () => {
    const aggregates: UserAggregates = {
      initiated: 0,
      completed: 0,
      sent: 0,
      received: 0,
      hours: 0,
      collaboration: 0,
      wants: 0,
      offers: 0,
    };
    const equation = {
      ...DEFAULT_EQUATION,
      // Clear everything except the currency weights so the test is focused.
      initiated: 0, completed: 0, sent: 0, received: 0, hours: 0,
      collaboration: 0, wants: 0, offers: 0,
      currencies: { hour: 2, eur: 3 },
    };
    expect(
      calculateUserScore(aggregates, equation, { hour: 5, eur: 10 }),
    ).toBe(5 * 2 + 10 * 3);
  });

  it('falls back to aggregates.hours when currencies.hour is set but balance is not', () => {
    const aggregates: UserAggregates = {
      initiated: 0, completed: 0, sent: 0, received: 0,
      hours: 4, collaboration: 0, wants: 0, offers: 0,
    };
    // Migrated equation: currencies.hour = 2, hours mirrored to 2.
    const equation = { ...DEFAULT_EQUATION, hours: 2, currencies: { hour: 2 } };
    // Without currencyBalances, hours fall-through path applies once: 4*2 = 8.
    expect(calculateUserScore(aggregates, equation)).toBe(8);
  });

  it('does not double-count hours when both currencies.hour and equation.hours are set', () => {
    const aggregates: UserAggregates = {
      initiated: 0, completed: 0, sent: 0, received: 0,
      hours: 4, collaboration: 0, wants: 0, offers: 0,
    };
    const equation = { ...DEFAULT_EQUATION, hours: 2, currencies: { hour: 2 } };
    // Explicit hour balance wins; aggregates.hours fallback is suppressed.
    expect(calculateUserScore(aggregates, equation, { hour: 4 })).toBe(8);
  });
});

describe('calculateScoreFromUserData', () => {
  it('aggregates raw user data and applies the equation', () => {
    expect(
      calculateScoreFromUserData(
        { initiated: [1, 2], completed: [1], hours: 3 },
        DEFAULT_EQUATION,
      ),
    ).toBe(2 + 2 + 3); // 2*1 + 1*2 + 3*1 = 7
  });
});

describe('getScoreBreakdown', () => {
  it('returns each component plus a total', () => {
    const breakdown = getScoreBreakdown(
      {
        initiated: 2,
        completed: 1,
        sent: 0,
        received: 0,
        hours: 4,
        collaboration: 1,
        wants: 0,
        offers: 0,
      },
      DEFAULT_EQUATION,
    );
    expect(breakdown.initiated).toBe(2);
    expect(breakdown.completed).toBe(2);
    // DEFAULT_EQUATION has currencies.hour=1, so hours flows through the
    // currency path; breakdown.hours equals currencies.hour.
    expect(breakdown.hours).toBe(4);
    expect(breakdown.currencies.hour).toBe(4);
    expect(breakdown.collaboration).toBe(1);
    expect(breakdown.total).toBe(2 + 2 + 4 + 1);
  });
});

describe('getActionScore', () => {
  it('returns initiated points', () => {
    const s = getActionScore('initiated', 1, DEFAULT_EQUATION);
    expect(s.type).toBe('initiated');
    expect(s.points).toBe(1);
  });

  it('maps "joined" to collaboration', () => {
    const s = getActionScore('joined', 1, DEFAULT_EQUATION);
    expect(s.type).toBe('collaboration');
    expect(s.points).toBe(1);
  });
});

describe('calculateTaskCompletionScores', () => {
  it('rewards initiator, participants, hours, and collaboration', () => {
    const scores = calculateTaskCompletionScores(
      'alice',
      ['bob', 'carol'],
      { bob: 2, carol: 0 },
      DEFAULT_EQUATION,
    );
    expect(scores.get('alice')?.total).toBe(1); // initiated
    expect(scores.get('bob')?.total).toBe(2 + 2 + 1); // completed + 2h + collab
    expect(scores.get('carol')?.total).toBe(2); // completed only
  });
});

describe('calculatePercentageShare', () => {
  it('returns 0 for an empty pool', () => {
    expect(calculatePercentageShare(5, 0)).toBe(0);
  });

  it('returns the percentage of the pool', () => {
    expect(calculatePercentageShare(25, 100)).toBe(25);
  });
});

describe('calculateAllUserScores', () => {
  it('returns scores and percentage shares', () => {
    const result = calculateAllUserScores(
      [
        { id: 'a', username: 'A', initiated: [1], completed: [1] },
        { id: 'b', username: 'B', initiated: [1, 2], completed: [] },
      ],
      DEFAULT_EQUATION,
    );
    expect(result[0].score).toBe(3); // 1 + 2
    expect(result[1].score).toBe(2); // 2 + 0
    expect(result[0].percentage).toBeCloseTo(60);
    expect(result[1].percentage).toBeCloseTo(40);
  });
});

describe('getCachedEquation', () => {
  it('returns a copy of the default equation when nothing is cached', () => {
    const eq = getCachedEquation('unknown-holon');
    expect(eq).toEqual(DEFAULT_EQUATION);
    eq.initiated = 999;
    // Mutating the returned copy must not affect the canonical default.
    expect(DEFAULT_EQUATION.initiated).toBe(1);
  });
});

describe('REAAggregator', () => {
  function buildStore(events: any[]): REAEventStoreLike {
    return {
      async query(_holonId, filters) {
        if (filters?.agentId) {
          const id = String(filters.agentId);
          return events.filter(
            (e) => String(e.provider?.id) === id || String(e.receiver?.id) === id,
          );
        }
        if (filters?.eventType) {
          return events.filter((e) => e.eventType === filters.eventType);
        }
        if (filters?.resourceType) {
          return events.filter((e) => e.resource?.type === filters.resourceType);
        }
        return events;
      },
    };
  }

  it('aggregates a user by event type', async () => {
    const aggregator = new REAAggregator(
      buildStore([
        { eventType: 'quest:initiated', provider: { id: 'u1' }, resource: {} },
        { eventType: 'quest:initiated', provider: { id: 'u1' }, resource: {} },
        { eventType: 'quest:completed', provider: { id: 'u1' }, resource: {} },
        {
          eventType: 'quest:time_logged',
          provider: { id: 'u1' },
          resource: { quantity: 2.5 },
        },
        {
          eventType: 'quest:time_logged',
          provider: { id: 'u1' },
          resource: { quantity: 1.5 },
        },
        { eventType: 'appreciation:sent', provider: { id: 'u1' }, resource: {} },
        { eventType: 'appreciation:received', receiver: { id: 'u1' }, resource: {} },
        { eventType: 'want:declared', provider: { id: 'u1' }, resource: {} },
        { eventType: 'offer:declared', provider: { id: 'u1' }, resource: {} },
      ]),
    );

    const aggregates = await aggregator.getUserAggregates('h1', 'u1');
    expect(aggregates).toEqual({
      initiated: 2,
      completed: 1,
      sent: 1,
      received: 1,
      hours: 4,
      collaboration: 2,
      wants: 1,
      offers: 1,
    });
  });

  it('computes a user score consistent with calculateUserScore', async () => {
    const aggregator = new REAAggregator(
      buildStore([
        { eventType: 'quest:initiated', provider: { id: 'u1' }, resource: {} },
        { eventType: 'quest:completed', provider: { id: 'u1' }, resource: {} },
      ]),
    );
    const score = await aggregator.calculateUserScore('h1', 'u1', DEFAULT_EQUATION);
    // 1 initiated + 1*2 completed = 3
    expect(score).toBe(3);
  });
});
