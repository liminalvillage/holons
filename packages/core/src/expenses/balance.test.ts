import { describe, expect, it } from 'vitest';
import {
  coerceSplitWith,
  computeBalances,
  computeUserCurrencyBalance,
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
});

describe('computeUserCurrencyBalance', () => {
  it('matches the matrix-row sum for the payer', () => {
    expect(computeUserCurrencyBalance([baseExpense({})], 1, 'eur')).toBeCloseTo(20);
  });

  it('returns 0 when the currency has no expenses', () => {
    expect(computeUserCurrencyBalance([baseExpense({})], 1, 'jpy')).toBe(0);
  });
});
