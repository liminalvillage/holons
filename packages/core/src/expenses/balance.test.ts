import { describe, expect, it } from 'vitest';
import {
  coerceSplitWith,
  computeBalances,
  computeUserCurrencyBalance,
  expenseSharers,
  normalizeCurrency,
} from './balance.js';
import type { Expense, User } from './types.js';

const users: User[] = [
  { id: 1, first_name: 'Alice' },
  { id: 2, first_name: 'Bob' },
  { id: 3, first_name: 'Carol' },
];

const baseExpense = (overrides: Partial<Expense>): Expense => ({
  id: 1,
  date: 0,
  amount: 30,
  currency: 'eur',
  description: 'dinner',
  paidBy: 1,
  splitWith: [1, 2, 3],
  ...overrides,
});

describe('normalizeCurrency', () => {
  it('lowercases, strips trailing s and non-letters', () => {
    expect(normalizeCurrency('EUROS')).toBe('euro');
    expect(normalizeCurrency('USD$')).toBe('usd');
    expect(normalizeCurrency('')).toBe('');
    expect(normalizeCurrency(null)).toBe('');
  });
});

describe('coerceSplitWith', () => {
  it('passes arrays through and wraps scalars', () => {
    expect(coerceSplitWith([1, 2])).toEqual([1, 2]);
    expect(coerceSplitWith(7)).toEqual([7]);
    expect(coerceSplitWith('x')).toEqual(['x']);
    expect(coerceSplitWith('[1,2]')).toEqual([1, 2]);
    expect(coerceSplitWith(null)).toEqual([]);
  });
});

describe('expenseSharers', () => {
  it('is the split when one is named', () => {
    expect(expenseSharers({ splitWith: [2] }, [1, 2, 3])).toEqual([2]);
  });

  it('is the whole group when nobody is named', () => {
    expect(expenseSharers({ splitWith: [] }, [1, 2, 3])).toEqual([1, 2, 3]);
    expect(expenseSharers({ splitWith: undefined as never }, [1, 2])).toEqual([1, 2]);
    expect(expenseSharers(null, [1])).toEqual([1]);
  });

  it('is nobody when nobody is named and there is no group', () => {
    expect(expenseSharers({ splitWith: [] }, [])).toEqual([]);
  });
});

describe('computeBalances', () => {
  it('splits a 30 EUR dinner three ways: payer is owed 20', () => {
    const { balances } = computeBalances([baseExpense({})], users, 'eur');
    expect(balances.find((b) => b.userId === 1)!.net).toBeCloseTo(20);
    expect(balances.find((b) => b.userId === 2)!.net).toBeCloseTo(-10);
    expect(balances.find((b) => b.userId === 3)!.net).toBeCloseTo(-10);
  });

  it('ignores expenses in another currency', () => {
    const { balances } = computeBalances(
      [baseExpense({ currency: 'usd' })],
      users,
      'eur'
    );
    expect(balances.every((b) => b.net === 0)).toBe(true);
  });

  it('honours allowedCurrencies gating', () => {
    const result = computeBalances([baseExpense({})], users, 'eur', ['usd']);
    expect(result.balances.every((b) => b.net === 0)).toBe(true);
  });

  it('drops expenses whose payer is not in the user list', () => {
    const result = computeBalances(
      [baseExpense({ paidBy: 999 })],
      users,
      'eur'
    );
    expect(result.balances.every((b) => b.net === 0)).toBe(true);
  });

  it('shares an expense with no split among every user', () => {
    const { balances } = computeBalances([baseExpense({ splitWith: [] })], users, 'eur');
    expect(balances.find((b) => b.userId === 1)!.net).toBeCloseTo(20);
    expect(balances.find((b) => b.userId === 2)!.net).toBeCloseTo(-10);
    expect(balances.find((b) => b.userId === 3)!.net).toBeCloseTo(-10);
  });
});

describe('computeUserCurrencyBalance', () => {
  it('matches the matrix-row sum for the payer', () => {
    expect(computeUserCurrencyBalance([baseExpense({})], 1, 'eur')).toBeCloseTo(20);
  });

  it('returns 0 when the currency has no expenses', () => {
    expect(computeUserCurrencyBalance([baseExpense({})], 1, 'jpy')).toBe(0);
  });

  it('shares an expense with no split among the members given', () => {
    const unsplit = [baseExpense({ splitWith: [] })];
    const members = users.map((u) => u.id);
    expect(computeUserCurrencyBalance(unsplit, 1, 'eur', members)).toBeCloseTo(20);
    expect(computeUserCurrencyBalance(unsplit, 2, 'eur', members)).toBeCloseTo(-10);
    // Someone outside the group neither owes nor is owed.
    expect(computeUserCurrencyBalance(unsplit, 999, 'eur', members)).toBe(0);
  });

  it('has nobody owing an unsplit expense when no group is given', () => {
    expect(computeUserCurrencyBalance([baseExpense({ splitWith: [] })], 1, 'eur')).toBe(0);
    expect(computeUserCurrencyBalance([baseExpense({ splitWith: [] })], 2, 'eur')).toBe(0);
  });
});
