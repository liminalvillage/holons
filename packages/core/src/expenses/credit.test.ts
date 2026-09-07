// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { computeBalances } from './balance.js';
import {
  computeMutualCredit,
  createSettlement,
  creditPairs,
  expenseCurrencies,
  isSettlement,
  participantIds,
  settlementPlan,
} from './credit.js';
import type { Expense, User } from './types.js';

const users: User[] = [
  { id: 1, first_name: 'Alice' },
  { id: 2, first_name: 'Bob' },
  { id: 3, first_name: 'Carol' },
];

const expense = (overrides: Partial<Expense>): Expense => ({
  id: 1,
  created: '2026-01-01T00:00:00.000Z',
  amount: 30,
  currency: 'eur',
  description: 'dinner',
  paidBy: 1,
  splitWith: [1, 2, 3],
  ...overrides,
});

describe('creditPairs', () => {
  it('reads each positive cell as "column owes row"', () => {
    const { creditMatrix, userIds } = computeBalances([expense({})], users, 'eur');
    const pairs = creditPairs(creditMatrix, userIds);
    expect(pairs).toEqual([
      { from: 2, to: 1, amount: 10 },
      { from: 3, to: 1, amount: 10 },
    ]);
  });

  it('nets two-way debts into one direction and sorts largest first', () => {
    const { creditMatrix, userIds } = computeBalances(
      [
        expense({ id: 1, amount: 30, paidBy: 1, splitWith: [1, 2, 3] }),
        expense({ id: 2, amount: 12, paidBy: 2, splitWith: [1, 2] }),
        expense({ id: 3, amount: 90, paidBy: 3, splitWith: [1, 2, 3] }),
      ],
      users,
      'eur',
    );
    const pairs = creditPairs(creditMatrix, userIds);
    // Bob owes Carol 30; Alice owes Carol 30 - 10 = 20;
    // Bob owes Alice 10 - 6 = 4.
    expect(pairs).toEqual([
      { from: 2, to: 3, amount: 30 },
      { from: 1, to: 3, amount: 20 },
      { from: 2, to: 1, amount: 4 },
    ]);
  });

  it('drops rounding dust', () => {
    expect(creditPairs([[0, 0.001], [-0.001, 0]], ['a', 'b'])).toEqual([]);
  });
});

describe('settlementPlan', () => {
  it('is empty when everyone is square', () => {
    expect(settlementPlan([{ userId: 1, net: 0 }, { userId: 2, net: 0 }])).toEqual([]);
  });

  it('pays the largest creditor from the largest debtor first', () => {
    const plan = settlementPlan([
      { userId: 'a', net: 50 },
      { userId: 'b', net: -30 },
      { userId: 'c', net: -20 },
    ]);
    expect(plan).toEqual([
      { from: 'b', to: 'a', amount: 30 },
      { from: 'c', to: 'a', amount: 20 },
    ]);
  });

  it('never needs more transfers than people minus one', () => {
    const balances = [
      { userId: 1, net: 40 },
      { userId: 2, net: 10 },
      { userId: 3, net: -25 },
      { userId: 4, net: -25 },
    ];
    const plan = settlementPlan(balances);
    expect(plan.length).toBeLessThanOrEqual(balances.length - 1);
    // Applying the plan squares everyone.
    const net = new Map(balances.map((b) => [String(b.userId), b.net]));
    for (const t of plan) {
      net.set(String(t.from), (net.get(String(t.from)) ?? 0) + t.amount);
      net.set(String(t.to), (net.get(String(t.to)) ?? 0) - t.amount);
    }
    for (const v of net.values()) expect(Math.abs(v)).toBeLessThan(0.01);
  });

  it('ignores balances below the dust threshold', () => {
    expect(settlementPlan([{ userId: 1, net: 0.004 }, { userId: 2, net: -0.004 }])).toEqual([]);
  });
});

describe('createSettlement', () => {
  it('records a repayment as an expense the debtor paid for the creditor', () => {
    const s = createSettlement({
      id: 's1',
      from: 2,
      to: 1,
      amount: 10,
      currency: 'EUR',
      now: Date.UTC(2026, 0, 2),
    });
    expect(s).not.toBeNull();
    expect(s?.paidBy).toBe(2);
    expect(s?.splitWith).toEqual([1]);
    expect(s?.currency).toBe('eur');
    expect(s?.kind).toBe('settlement');
    expect(s?.created).toBe('2026-01-02T00:00:00.000Z');
    expect(isSettlement(s!)).toBe(true);
  });

  it('squares the pair it settles', () => {
    const dinner = expense({});
    const paid = createSettlement({ id: 's1', from: 2, to: 1, amount: 10, currency: 'eur' })!;
    const { pairs, balances } = computeMutualCredit([dinner, paid], users, 'eur');
    expect(pairs).toEqual([{ from: 3, to: 1, amount: 10 }]);
    expect(balances.find((b) => b.userId === 2)?.net).toBe(0);
  });

  it('rejects a non-positive amount or paying yourself', () => {
    expect(createSettlement({ id: 'x', from: 1, to: 2, amount: 0, currency: 'eur' })).toBeNull();
    expect(createSettlement({ id: 'x', from: 1, to: 1, amount: 5, currency: 'eur' })).toBeNull();
  });

  it('is not mistaken for an ordinary expense', () => {
    expect(isSettlement(expense({}))).toBe(false);
  });
});

describe('computeMutualCredit', () => {
  it('bundles balances, pairs, plan and volume for one currency', () => {
    const result = computeMutualCredit(
      [expense({}), expense({ id: 2, currency: 'usd', amount: 99 })],
      users,
      'eur',
    );
    expect(result.currency).toBe('eur');
    expect(result.volume).toBe(30);
    expect(result.count).toBe(1);
    expect(result.balances.map((b) => b.net)).toEqual([20, -10, -10]);
    expect(result.plan).toEqual([
      { from: 2, to: 1, amount: 10 },
      { from: 3, to: 1, amount: 10 },
    ]);
    expect(result.pairs).toEqual(result.plan);
  });

  it('settlements count in balances but not in volume', () => {
    const paid = createSettlement({ id: 's', from: 2, to: 1, amount: 10, currency: 'eur' })!;
    const result = computeMutualCredit([expense({}), paid], users, 'eur');
    expect(result.volume).toBe(30);
    expect(result.count).toBe(1);
    expect(result.balances.find((b) => b.userId === 1)?.net).toBe(10);
  });

  it('is empty without users or a currency', () => {
    expect(computeMutualCredit([expense({})], [], 'eur').balances).toEqual([]);
    expect(computeMutualCredit([expense({})], users, '').balances).toEqual([]);
  });
});

describe('participantIds', () => {
  it('lists every payer and sharer once, as strings', () => {
    const ids = participantIds([
      expense({ paidBy: 1, splitWith: [1, 2] }),
      expense({ id: 2, paidBy: '2', splitWith: '3' as unknown as string[] }),
    ]);
    expect(ids).toEqual(['1', '2', '3']);
  });
});

describe('expenseCurrencies', () => {
  it('lists the normalized currencies in first-seen order, legacy unit included', () => {
    const list = expenseCurrencies([
      expense({ currency: 'EUR' }),
      expense({ id: 2, currency: 'usd' }),
      { ...expense({ id: 3, currency: '' }), unit: 'hours' } as Expense,
      expense({ id: 4, currency: 'EURs' }),
    ]);
    expect(list).toEqual(['eur', 'usd', 'hour']);
  });
});
