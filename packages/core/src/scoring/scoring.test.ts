import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EQUATION,
  REAAggregator,
  calculateAllUserScores,
  calculateScoreFromUserData,
  calculateTaskCompletionScores,
  calculateUserScore,
  extractReaUsers,
  getActionScore,
  getCachedEquation,
  getScoreBreakdown,
  migrateEquation,
  normalizeShares,
  parseCurrencyCodes,
  saveEquation,
  scoreHolonUsers,
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
      collaboration: 1,
      participation: 0,
      coParticipants: 0,
      activity: 0,
      groupSize: 0,
      variance: 0,
      currencies: { hour: 1 },
    });
  });

  it('omits the deprecated top-level hours field', () => {
    expect('hours' in DEFAULT_EQUATION).toBe(false);
  });
});

describe('migrateEquation', () => {
  it('folds legacy hours into currencies.hour and discards the top-level field', () => {
    const migrated = migrateEquation({
      initiated: 1,
      completed: 2,
      sent: 1,
      received: 1,
      hours: 3,
      collaboration: 1,
    });
    expect(migrated.currencies.hour).toBe(3);
    expect('hours' in migrated).toBe(false);
  });

  it('strips retired wants/offers weights without turning them into currencies', () => {
    const migrated = migrateEquation({ collaboration: 1, wants: 1, offers: 2 });
    expect('wants' in migrated).toBe(false);
    expect('offers' in migrated).toBe(false);
    expect(migrated.currencies.wants).toBeUndefined();
    expect(migrated.currencies.offers).toBeUndefined();
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

  it('folds flat per-currency keys into the currencies sub-map', () => {
    // telegram-ui historically wrote `valueEquation.euro = 0` at the top
    // level instead of `valueEquation.currencies.euro`. Migration must
    // recover those weights so cross-system reads agree.
    const migrated = migrateEquation({
      initiated: 1,
      completed: 2,
      sent: 1,
      received: 1,
      hours: 1,
      collaboration: 1,
      euro: 3,
      usd: 5,
    });
    expect(migrated.currencies.euro).toBe(3);
    expect(migrated.currencies.usd).toBe(5);
    expect((migrated as any).euro).toBeUndefined();
    expect((migrated as any).usd).toBeUndefined();
  });

  it('lets an explicit currencies entry win over a flat duplicate', () => {
    const migrated = migrateEquation({
      hours: 1,
      euro: 3,
      currencies: { euro: 9 },
    });
    expect(migrated.currencies.euro).toBe(9);
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
      }),
    ).toEqual({
      initiated: 3,
      completed: 5,
      sent: 4,
      received: 2,
      hours: 10,
      collaboration: 1,
      participation: 0,
      coParticipants: 0,
      activity: 0,
      groupSize: 0,
      variance: 0,
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
      participation: 0,
      coParticipants: 0,
      activity: 0,
      groupSize: 0,
      variance: 0,
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
    };
    expect(
      calculateUserScore(aggregates, {
        initiated: 0,
        completed: 0,
        sent: 0,
        received: 0,
        hours: 10,
        collaboration: 0,
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
    };
    const equation = {
      ...DEFAULT_EQUATION,
      // Clear everything except the currency weights so the test is focused.
      initiated: 0, completed: 0, sent: 0, received: 0, hours: 0,
      collaboration: 0,
      currencies: { hour: 2, eur: 3 },
    };
    expect(
      calculateUserScore(aggregates, equation, { hour: 5, eur: 10 }),
    ).toBe(5 * 2 + 10 * 3);
  });

  it('falls back to aggregates.hours when currencies.hour is set but balance is not', () => {
    const aggregates: UserAggregates = {
      initiated: 0, completed: 0, sent: 0, received: 0,
      hours: 4, collaboration: 0,
    };
    // Migrated equation: currencies.hour = 2, hours mirrored to 2.
    const equation = { ...DEFAULT_EQUATION, hours: 2, currencies: { hour: 2 } };
    // Without currencyBalances, hours fall-through path applies once: 4*2 = 8.
    expect(calculateUserScore(aggregates, equation)).toBe(8);
  });

  it('does not double-count hours when both currencies.hour and equation.hours are set', () => {
    const aggregates: UserAggregates = {
      initiated: 0, completed: 0, sent: 0, received: 0,
      hours: 4, collaboration: 0,
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

describe('normalizeShares', () => {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  it('returns [] for an empty pool', () => {
    expect(normalizeShares([])).toEqual([]);
  });

  it('gives a single member the whole pie', () => {
    expect(normalizeShares([42])).toEqual([100]);
  });

  it('is plain proportional when every score is non-negative', () => {
    expect(normalizeShares([3, 2])).toEqual([60, 40]);
    expect(normalizeShares([1, 1, 2])).toEqual([25, 25, 50]);
  });

  it('splits evenly when all scores are equal', () => {
    expect(normalizeShares([5, 5, 5, 5])).toEqual([25, 25, 25, 25]);
    // ...even when the equal value is negative or zero.
    expect(normalizeShares([0, 0])).toEqual([50, 50]);
    const thirds = normalizeShares([-3, -3, -3]);
    thirds.forEach((s) => expect(s).toBeCloseTo(100 / 3));
    expect(sum(thirds)).toBeCloseTo(100);
  });

  it('shifts negatives so every share is strictly positive and sums to 100', () => {
    const shares = normalizeShares([317.8, 271.7, 30.3, -6.2, -47.3]);
    // Strictly positive — the splitter must allocate something to everyone.
    expect(Math.min(...shares)).toBeGreaterThan(0);
    expect(sum(shares)).toBeCloseTo(100);
    // The most-indebted member gets the smallest (but nonzero) slice.
    expect(shares[shares.length - 1]).toBe(Math.min(...shares));
  });

  it('is monotonic — a debtor never outranks a non-debtor', () => {
    // scores: a=10, b=-2 (debt), c=5
    const [a, b, c] = normalizeShares([10, -2, 5]);
    expect(a).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(0); // the debtor still gets a positive slice
  });

  it('does not explode when signed balances sum to zero', () => {
    // Mutual-credit ledger where Σscore = 0 — the raw score/Σscore form blew
    // up here (division by ~0); the shift keeps it finite and well-formed.
    const shares = normalizeShares([50, -50]);
    expect(sum(shares)).toBeCloseTo(100);
    expect(shares[0]).toBeGreaterThan(shares[1]);
    expect(shares[1]).toBeGreaterThan(0);
  });
});

describe('scoreHolonUsers', () => {
  const eq = { ...DEFAULT_EQUATION, currencies: { hour: 1, eur: 1 } };
  const loaded = [
    { userId: 'a', aggregates: { ...toAggregates({ initiated: [1], completed: [1] }) }, balances: { eur: 100 } },
    { userId: 'b', aggregates: { ...toAggregates({ initiated: [1] }) }, balances: { eur: -100 } },
    { userId: 'c', aggregates: { ...toAggregates({ completed: [1] }) }, balances: { eur: 0 } },
  ];

  it('scores from aggregates + balances and assigns shares summing to 100', () => {
    const rows = scoreHolonUsers(loaded, eq);
    // a: initiated 1 + completed 2 + eur 100 = 103
    expect(rows[0].score).toBeCloseTo(103);
    // b: initiated 1 + eur -100 = -99
    expect(rows[1].score).toBeCloseTo(-99);
    // c: completed 2 = 2
    expect(rows[2].score).toBeCloseTo(2);
    const sum = rows.reduce((s, r) => s + r.percentage, 0);
    expect(sum).toBeCloseTo(100);
    // strictly positive + monotonic with score
    expect(Math.min(...rows.map((r) => r.percentage))).toBeGreaterThan(0);
    expect(rows[0].percentage).toBeGreaterThan(rows[2].percentage);
    expect(rows[2].percentage).toBeGreaterThan(rows[1].percentage);
  });

  it('returns rows in input order with breakdown attached', () => {
    const rows = scoreHolonUsers(loaded, eq);
    expect(rows.map((r) => r.userId)).toEqual(['a', 'b', 'c']);
    expect(rows[0].breakdown.total).toBeCloseTo(rows[0].score);
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
    // All scores non-negative → proportional share.
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
      // No `context.questId` on any of the fixture events, so the
      // collaboration signals all land at 0.
      participation: 0,
      coParticipants: 0,
      activity: 7,
      groupSize: 0,
      variance: 0,
    });
  });

  it('derives collaboration signals from quest event groupings', async () => {
    // Two quests:
    //  - q1: u1 + u2  → group size 2
    //  - q2: u1 + u2 + u3 → group size 3
    // u1's group sizes: [2, 3] → mean 2.5, variance ((0.5)² + (0.5)²)/2 = 0.25
    // co-participants: {u2, u3} → 2
    // participation: 2 (both quests touch u1)
    // activity: count of events where u1 is provider or receiver.
    const aggregator = new REAAggregator(
      buildStore([
        // q1
        { eventType: 'quest:initiated', provider: { id: 'u1' }, receiver: { id: 'holon', type: 'holon' }, context: { questId: 'q1' }, resource: {} },
        { eventType: 'quest:time_logged', provider: { id: 'u2' }, receiver: { id: 'holon', type: 'holon' }, context: { questId: 'q1' }, resource: { quantity: 1 } },
        // q2
        { eventType: 'quest:initiated', provider: { id: 'u1' }, receiver: { id: 'holon', type: 'holon' }, context: { questId: 'q2' }, resource: {} },
        { eventType: 'quest:time_logged', provider: { id: 'u2' }, receiver: { id: 'holon', type: 'holon' }, context: { questId: 'q2' }, resource: { quantity: 1 } },
        { eventType: 'quest:time_logged', provider: { id: 'u3' }, receiver: { id: 'holon', type: 'holon' }, context: { questId: 'q2' }, resource: { quantity: 1 } },
      ]),
    );
    const a = await aggregator.getUserAggregates('h1', 'u1');
    expect(a.participation).toBe(2);
    expect(a.coParticipants).toBe(2);
    expect(a.groupSize).toBe(2.5);
    expect(a.variance).toBe(0.25);
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

  it('derives the active-user roster from the event stream', async () => {
    const aggregator = new REAAggregator(
      buildStore([
        {
          eventType: 'quest:initiated',
          provider: { id: 'u1', type: 'user', name: 'alice' },
          receiver: { id: 'h1', type: 'holon', name: 'h1' },
        },
        {
          eventType: 'appreciation',
          provider: { id: 'u2', type: 'user', name: 'bob' },
          receiver: { id: 'u1', type: 'user', name: 'alice' },
        },
      ]),
    );
    const users = await aggregator.getActiveUsers('h1');
    expect(users).toContainEqual({ id: 'u1', name: 'alice' });
    expect(users).toContainEqual({ id: 'u2', name: 'bob' });
    // The holon-typed receiver is not a user and must be excluded.
    expect(users.map((u) => u.id)).not.toContain('h1');
  });
});

describe('extractReaUsers', () => {
  it('collects distinct user-type agents from providers and receivers', () => {
    const users = extractReaUsers([
      { provider: { id: 'u1', type: 'user', name: 'alice' } },
      { receiver: { id: 'u2', type: 'user', name: 'bob' } },
      { provider: { id: 'u1', type: 'user', name: 'alice' } }, // dup
    ]);
    expect(users).toHaveLength(2);
    expect(users).toContainEqual({ id: 'u1', name: 'alice' });
    expect(users).toContainEqual({ id: 'u2', name: 'bob' });
  });

  it('excludes holon- and external-typed agents and id-less agents', () => {
    const users = extractReaUsers([
      { provider: { id: 'u1', type: 'user', name: 'alice' }, receiver: { id: 'h1', type: 'holon' } },
      { provider: { id: 'x', type: 'external', name: 'feed' } },
      { provider: { type: 'user', name: 'ghost' } }, // no id
    ]);
    expect(users).toEqual([{ id: 'u1', name: 'alice' }]);
  });

  it('keeps the first non-empty name and never downgrades it to empty', () => {
    const users = extractReaUsers([
      { provider: { id: 'u1', type: 'user' } }, // no name yet
      { provider: { id: 'u1', type: 'user', name: 'alice' } }, // fills it in
      { provider: { id: 'u1', type: 'user' } }, // must not blank it
    ]);
    expect(users).toEqual([{ id: 'u1', name: 'alice' }]);
  });

  it('coerces numeric agent ids to strings', () => {
    const users = extractReaUsers([
      { provider: { id: 1578071183, type: 'user', name: 'alex' } },
    ]);
    expect(users).toEqual([{ id: '1578071183', name: 'alex' }]);
  });
});

describe('saveEquation', () => {
  /** Minimal holosphere double: one settings document per holon. */
  function fakeHolosphere(existing: any = null) {
    const puts: any[] = [];
    return {
      puts,
      get: vi.fn(async () => existing),
      put: vi.fn(async (_holon: string, _lens: string, doc: any) => {
        puts.push(doc);
      }),
    };
  }

  it('stores the migrated equation under valueEquation, keeping other settings', async () => {
    const hs = fakeHolosphere({ id: '42', language: 'it', hex: '8a1f' });
    const saved = await saveEquation(hs, '42', {
      ...DEFAULT_EQUATION,
      completed: 5,
    });

    expect(hs.put).toHaveBeenCalledWith('42', 'settings', expect.any(Object));
    const doc = hs.puts[0];
    expect(doc.language).toBe('it');
    expect(doc.hex).toBe('8a1f');
    expect(doc.id).toBe('42');
    expect(doc.valueEquation.completed).toBe(5);
    expect(saved.completed).toBe(5);
  });

  it('folds a legacy top-level hours weight into currencies.hour', async () => {
    const hs = fakeHolosphere();
    const saved = await saveEquation(hs, '42', {
      ...DEFAULT_EQUATION,
      currencies: {},
      hours: 3,
    } as any);

    expect(saved.currencies.hour).toBe(3);
    expect('hours' in saved).toBe(false);
  });

  it('zeroes blank or non-numeric weights instead of storing NaN', async () => {
    const hs = fakeHolosphere();
    const saved = await saveEquation(hs, '42', {
      ...DEFAULT_EQUATION,
      completed: null,
      sent: '' as any,
      currencies: { hour: undefined as any, euro: '2' as any },
    } as any);

    expect(saved.completed).toBe(0);
    expect(saved.sent).toBe(0);
    expect(saved.currencies.hour).toBe(0);
    expect(saved.currencies.euro).toBe(2);
  });

  it('lets a group zero every weight — an all-zero equation round-trips', async () => {
    const hs = fakeHolosphere();
    const saved = await saveEquation(hs, '42', {
      initiated: 0,
      completed: 0,
      sent: 0,
      received: 0,
      collaboration: 0,
      participation: 0,
      coParticipants: 0,
      activity: 0,
      groupSize: 0,
      variance: 0,
      currencies: { hour: 0 },
    });

    expect(Object.values(saved).every((v) => v === 0 || typeof v === 'object')).toBe(true);
    expect(getCachedEquation('42').completed).toBe(0);
  });

  it('registers weighted currencies in the holon currency list', async () => {
    const hs = fakeHolosphere({ currencies: ['euro'] });
    await saveEquation(hs, '42', {
      ...DEFAULT_EQUATION,
      currencies: { hour: 1, euro: 2, token: 0 },
    });

    expect(hs.puts[0].currencies).toEqual(['euro', 'hour', 'token']);
  });

  it('never duplicates a currency that differs only in case', async () => {
    const hs = fakeHolosphere({ currencies: ['Euro'] });
    await saveEquation(hs, '42', {
      ...DEFAULT_EQUATION,
      currencies: { euro: 2 },
    });

    expect(hs.puts[0].currencies).toEqual(['Euro']);
  });

  it('still writes the equation when the settings read fails', async () => {
    const hs = fakeHolosphere();
    hs.get = vi.fn(async () => {
      throw new Error('relay down');
    });

    await saveEquation(hs, '99', { ...DEFAULT_EQUATION, initiated: 4 });

    expect(hs.puts[0].valueEquation.initiated).toBe(4);
  });
});

describe('parseCurrencyCodes', () => {
  it('splits on commas and spaces, lowercasing as it goes', () => {
    expect(parseCurrencyCodes('Euro, hour  Token')).toEqual([
      'euro',
      'hour',
      'token',
    ]);
  });

  it('drops blanks, duplicates and codes the holon already has', () => {
    expect(parseCurrencyCodes('  euro,,euro , HOUR ', ['Hour'])).toEqual([
      'euro',
    ]);
  });

  it('returns nothing for an empty or absent entry', () => {
    expect(parseCurrencyCodes('   ')).toEqual([]);
    expect(parseCurrencyCodes(undefined as any)).toEqual([]);
  });
});
