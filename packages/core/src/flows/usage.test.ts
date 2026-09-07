import { describe, expect, it } from 'vitest';
import {
  buildFundUsage,
  fundAccount,
  rightsTotal,
  usageOf,
  usageTotals,
  usageUnits,
} from './usage.js';
import type { OpenCollectiveSnapshot } from './opencollective.js';
import { allocate } from './allocation.js';
import type { Expense } from '../expenses/index.js';

const HOLON = '-100';
const NOW = Date.parse('2026-09-07T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

const parties = [
  { id: 'ada', name: 'Ada', aliases: ['ada_l', 'Ada Lovelace'] },
  { id: 'bob', name: 'Bob' },
  { id: '-200', name: 'Partner Holon' },
];

function expense(partial: Partial<Expense> & { id: string }): Expense {
  return {
    created: daysAgo(3),
    amount: 0,
    currency: 'eur',
    description: '',
    paidBy: '',
    splitWith: [],
    ...partial,
  } as Expense;
}

function collective(
  expenses: OpenCollectiveSnapshot['expenses'],
  currency = 'EUR',
): OpenCollectiveSnapshot {
  return {
    slug: 'c',
    name: 'Collective',
    currency,
    balance: 1000,
    totalReceived: 0,
    totalSpent: 0,
    transactions: [],
    expenses,
    fetchedAt: NOW,
  };
}

describe('buildFundUsage from the expenses lens', () => {
  it('reads a party paying for the holon as a claim on the fund', () => {
    const usage = buildFundUsage({
      holonId: HOLON,
      unit: 'EUR',
      parties,
      expenses: [
        expense({ id: 'e1', amount: 90, paidBy: 'ada', splitWith: [HOLON, 'ada', 'bob'] }),
      ],
      now: NOW,
    });
    // Ada fronted 90 three ways: the holon's share is her claim.
    expect(usageOf(usage, 'ada')).toEqual({ spent: 0, claimed: 30 });
    expect(usageOf(usage, 'bob')).toEqual({ spent: 0, claimed: 0 });
  });

  it('moves a claim to spent once the holon settles it', () => {
    const usage = buildFundUsage({
      holonId: HOLON,
      unit: 'EUR',
      parties,
      expenses: [
        expense({ id: 'e1', amount: 100, paidBy: 'ada', splitWith: [HOLON] }),
        expense({
          id: 's1',
          amount: 100,
          paidBy: HOLON,
          splitWith: ['ada'],
          kind: 'settlement',
        }),
      ],
      now: NOW,
    });
    expect(usageOf(usage, 'ada')).toEqual({ spent: 100, claimed: 0 });
  });

  it('counts the fund paying for a party as their spending, by share', () => {
    const usage = buildFundUsage({
      holonId: HOLON,
      unit: 'EUR',
      parties,
      expenses: [
        expense({ id: 'e1', amount: 300, paidBy: HOLON, splitWith: ['ada', 'bob', 'zed'] }),
      ],
      now: NOW,
    });
    expect(usageOf(usage, 'ada').spent).toBe(100);
    expect(usageOf(usage, 'bob').spent).toBe(100);
    // zed has no right; their share is not a party's.
    expect(usage.parties.zed).toBeUndefined();
  });

  it('windows spending but not claims', () => {
    const usage = buildFundUsage({
      holonId: HOLON,
      unit: 'EUR',
      parties,
      expenses: [
        expense({ id: 'old-claim', amount: 40, paidBy: 'bob', splitWith: [HOLON], created: daysAgo(400) }),
        expense({ id: 'old-spend', amount: 70, paidBy: HOLON, splitWith: ['bob'], created: daysAgo(400) }),
        expense({ id: 'new-spend', amount: 10, paidBy: HOLON, splitWith: ['bob'], created: daysAgo(1) }),
      ],
      now: NOW,
      windowDays: 90,
    });
    expect(usageOf(usage, 'bob')).toEqual({ spent: 10, claimed: 40 });

    const allTime = buildFundUsage({
      holonId: HOLON,
      unit: 'EUR',
      parties,
      expenses: [
        expense({ id: 'old-spend', amount: 70, paidBy: HOLON, splitWith: ['bob'], created: daysAgo(400) }),
      ],
      now: NOW,
      windowDays: null,
    });
    expect(usageOf(allTime, 'bob').spent).toBe(70);
  });

  it('keeps every currency apart', () => {
    const usage = buildFundUsage({
      holonId: HOLON,
      unit: 'EUR',
      parties,
      expenses: [
        expense({ id: 'e1', amount: 50, paidBy: 'ada', splitWith: [HOLON], currency: 'eur' }),
        expense({ id: 'e2', amount: 20, paidBy: 'ada', splitWith: [HOLON], currency: 'usd' }),
        expense({ id: 'e3', amount: 5, paidBy: 'ada', splitWith: [HOLON], currency: '', unit: 'hours' } as any),
      ],
      now: NOW,
    });
    expect(usageOf(usage, 'ada')).toEqual({ spent: 0, claimed: 50 });
    expect(usageOf(usage, 'ada', 'usd')).toEqual({ spent: 0, claimed: 20 });
    expect(usageOf(usage, 'ada', 'hours')).toEqual({ spent: 0, claimed: 5 });
    expect(usageUnits(usage, 'ada')).toEqual(['eur', 'hour', 'usd']);
  });

  it('ignores self-shares and records that name no holon', () => {
    const usage = buildFundUsage({
      holonId: HOLON,
      unit: 'EUR',
      parties,
      expenses: [
        expense({ id: 'peer', amount: 60, paidBy: 'ada', splitWith: ['ada', 'bob'] }),
        expense({ id: 'self', amount: 60, paidBy: HOLON, splitWith: [HOLON] }),
      ],
      now: NOW,
    });
    expect(usageTotals(usage)).toMatchObject({ spent: 0, claimed: 0 });
  });
});

describe('buildFundUsage from OpenCollective', () => {
  const snapshot = collective([
    { id: 'x1', status: 'paid', rawStatus: 'PAID', amount: 200, currency: 'EUR', createdAt: NOW - 2 * DAY, description: 'Invoice', payee: 'Ada Lovelace', payeeSlug: 'ada-lovelace' },
    { id: 'x2', status: 'open', rawStatus: 'PENDING', amount: 80, currency: 'EUR', createdAt: NOW - 500 * DAY, description: 'Old claim', payee: 'bob', payeeSlug: 'bob' },
    { id: 'x3', status: 'paid', rawStatus: 'PAID', amount: 999, currency: 'EUR', createdAt: NOW - 500 * DAY, description: 'Long ago', payee: 'Bob', payeeSlug: 'bob' },
    { id: 'x4', status: 'paid', rawStatus: 'PAID', amount: 45, currency: 'EUR', createdAt: NOW - DAY, description: 'Vendor', payee: 'Hall Hire Ltd', payeeSlug: 'hall-hire' },
    { id: 'x5', status: 'open', rawStatus: 'APPROVED', amount: 12, currency: 'USD', createdAt: NOW - DAY, description: 'Dollars', payee: 'Ada', payeeSlug: 'ada' },
    { id: 'x6', status: 'paid', rawStatus: 'PAID', amount: 30, currency: 'EUR', createdAt: NOW - DAY, description: 'Slug match', payee: 'A. L.', payeeSlug: 'ada_l' },
  ]);

  const usage = buildFundUsage({
    holonId: HOLON,
    unit: 'EUR',
    parties,
    expenses: [],
    collective: snapshot,
    now: NOW,
    windowDays: 90,
  });

  it('matches payees to parties by alias, name and slug', () => {
    // x1 by the alias "Ada Lovelace", x6 by the slug of the alias "ada_l".
    expect(usageOf(usage, 'ada')).toEqual({ spent: 230, claimed: 0 });
    expect(usageOf(usage, 'ada', 'usd')).toEqual({ spent: 0, claimed: 12 });
  });

  it('keeps an old open claim and drops an old payout, like the window says', () => {
    expect(usageOf(usage, 'bob')).toEqual({ spent: 0, claimed: 80 });
  });

  it('reports what matched nobody instead of dropping it', () => {
    expect(usage.unattributed.eur).toEqual({ spent: 45, claimed: 0 });
    expect(usage.unattributedPayees).toEqual([{ name: 'Hall Hire Ltd', unit: 'eur', spent: 45, claimed: 0 }]);
  });

  it('totals attributed and unattributed apart', () => {
    const totals = usageTotals(usage);
    expect(totals.attributed).toEqual({ spent: 230, claimed: 80 });
    expect(totals.unattributed).toEqual({ spent: 45, claimed: 0 });
    expect(totals.spent).toBe(275);
    expect(totals.claimed).toBe(80);
  });

  it('lists the pot unit first', () => {
    expect(usageUnits(usage)).toEqual(['eur', 'usd']);
  });

  it('never matches an unnamed party to everything', () => {
    const blank = buildFundUsage({
      holonId: HOLON,
      unit: 'EUR',
      parties: [{ id: 'ghost', name: '' }],
      expenses: [],
      collective: snapshot,
      now: NOW,
    });
    expect(blank.parties.ghost).toBeUndefined();
  });
});

describe('rightsTotal', () => {
  it('is the balance plus what rights-holders already took, less outside claims', () => {
    const usage = buildFundUsage({
      holonId: HOLON,
      unit: 'EUR',
      parties,
      expenses: [],
      collective: collective([
        { id: 'p', status: 'paid', rawStatus: 'PAID', amount: 200, currency: 'EUR', createdAt: NOW - DAY, description: '', payee: 'Ada' },
        { id: 'o', status: 'open', rawStatus: 'PENDING', amount: 50, currency: 'EUR', createdAt: NOW - DAY, description: '', payee: 'Nobody Known' },
        { id: 'v', status: 'paid', rawStatus: 'PAID', amount: 500, currency: 'EUR', createdAt: NOW - DAY, description: '', payee: 'Vendor' },
      ]),
      now: NOW,
    });
    // 800 in the bank + 200 Ada already drew − 50 promised outside = 950;
    // the vendor's 500 is outside the rights and not part of them.
    expect(rightsTotal(800, usage)).toBe(950);
  });

  it('never goes below zero', () => {
    expect(rightsTotal(-10, null)).toBe(0);
  });
});

describe('fundAccount', () => {
  const members = [
    { id: 'ada', name: 'Ada', percentage: 75 },
    { id: 'bob', name: 'Bob', percentage: 25 },
  ];
  const zoned = [{ id: '-200', name: 'Partner Holon', zone: 1 }];
  const config = { interiorPercent: 80, steepness: 50, nzones: 2 };

  it('reads a member right like a bank statement: right, spent, claimed, available', () => {
    const allocation = allocate({ total: 1000, unit: 'eur', config, members, zoned });
    const usage = buildFundUsage({
      holonId: HOLON,
      unit: 'eur',
      parties,
      now: NOW,
      expenses: [
        // The fund paid Ada 100.
        expense({ id: 'p', amount: 100, paidBy: HOLON, splitWith: ['ada'] }),
        // Ada fronted 50 for the holon and is still owed it.
        expense({ id: 'c', amount: 50, paidBy: 'ada', splitWith: [HOLON] }),
        // Ada also drew 3 hours — another unit, a footnote.
        expense({ id: 'h', amount: 3, currency: 'hours', paidBy: HOLON, splitWith: ['ada'] }),
      ],
    });
    const account = fundAccount(allocation, usage, 'ada')!;
    expect(account.side).toBe('interior');
    expect(account.percentage).toBe(60);
    expect(account.right).toBe(600);
    expect(account.spent).toBe(100);
    expect(account.claimed).toBe(50);
    expect(account.available).toBe(450);
    expect(account.over).toBe(0);
    expect(account.unit).toBe('eur');
    expect(account.otherUnits).toEqual([{ unit: 'hour', spent: 3, claimed: 0 }]);
    expect(account.zone).toBeUndefined();
  });

  it('reports how far over a right the party has gone, with nothing available', () => {
    const allocation = allocate({ total: 100, unit: 'eur', config, members, zoned });
    const usage = buildFundUsage({
      holonId: HOLON,
      unit: 'eur',
      parties,
      now: NOW,
      expenses: [expense({ id: 'p', amount: 40, paidBy: HOLON, splitWith: ['bob'] })],
    });
    const account = fundAccount(allocation, usage, 'bob')!;
    expect(account.right).toBe(20);
    expect(account.available).toBe(0);
    expect(account.over).toBe(20);
  });

  it('finds a placed partner on its ring', () => {
    const allocation = allocate({ total: 1000, unit: 'eur', config, members, zoned });
    const account = fundAccount(allocation, null, '-200')!;
    expect(account.side).toBe('exterior');
    expect(account.zone).toBe(1);
    expect(account.right).toBe(200);
    expect(account.available).toBe(200);
    expect(account.spent).toBe(0);
  });

  it('keeps the share but no amounts when the allocation is percentage-only', () => {
    const allocation = allocate({ total: null, unit: '', config, members, zoned });
    const account = fundAccount(allocation, null, 'ada')!;
    expect(account.percentage).toBe(60);
    expect(account.right).toBeNull();
    expect(account.available).toBeNull();
    expect(account.over).toBe(0);
  });

  it('adds up a member who is also seated on a ring', () => {
    const allocation = allocate({
      total: 1000,
      unit: 'eur',
      config,
      members,
      zoned: [...zoned, { id: 'ada', name: 'Ada', zone: 2, kind: 'person' }],
    });
    const account = fundAccount(allocation, null, 'ada')!;
    const seats = [
      ...allocation.interior.filter((s) => s.id === 'ada'),
      ...allocation.exterior.flatMap((z) => (z.members ?? []).filter((s) => s.id === 'ada')),
    ];
    expect(seats).toHaveLength(2);
    expect(account.right).toBe(Math.round(seats.reduce((s, x) => s + (x.amount ?? 0), 0) * 100) / 100);
    expect(account.percentage).toBeCloseTo(seats.reduce((s, x) => s + x.percentage, 0));
    expect(account.side).toBe('interior');
    expect(account.zone).toBe(2);
  });

  it('is null for anyone without a right', () => {
    const allocation = allocate({ total: 1000, unit: 'eur', config, members, zoned });
    expect(fundAccount(allocation, null, 'nobody')).toBeNull();
    expect(fundAccount(allocation, null, '')).toBeNull();
  });
});
