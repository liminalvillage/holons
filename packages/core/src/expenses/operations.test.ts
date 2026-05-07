import { describe, expect, it } from 'vitest';
import {
  addParticipant,
  createExpense,
  removeParticipant,
  splitAmongAll,
  toggleParticipant,
} from './operations.js';
import type { Expense } from './types.js';

const expense: Expense = {
  id: 1,
  date: 0,
  amount: 12,
  currency: 'eur',
  description: 'beers',
  paidBy: 1,
  splitWith: [1, 2],
};

describe('createExpense', () => {
  it('rejects non-positive or non-numeric amounts', () => {
    expect(createExpense({ id: 1, holonId: 100, amount: 0, currency: 'eur', description: 'x', paidBy: 1 })).toBeNull();
    expect(createExpense({ id: 1, holonId: 100, amount: NaN, currency: 'eur', description: 'x', paidBy: 1 })).toBeNull();
  });

  it('normalizes currency and strips leading prepositions', () => {
    const e = createExpense({
      id: 1,
      holonId: 100,
      amount: 5,
      currency: 'EUR',
      description: 'for pizza',
      paidBy: 1,
    });
    expect(e).not.toBeNull();
    expect(e!.currency).toBe('eur');
    expect(e!.description).toBe('pizza');
  });

  it('falls back to [holonId] when splitWith is empty', () => {
    const e = createExpense({
      id: 1,
      holonId: 100,
      amount: 5,
      currency: 'eur',
      description: 'solo',
      paidBy: 1,
    });
    expect(e!.splitWith).toEqual([100]);
  });
});

describe('toggleParticipant', () => {
  it('adds when absent and removes the holon sentinel', () => {
    const seeded: Expense = { ...expense, splitWith: [100] };
    const next = toggleParticipant(seeded, 2, 100);
    expect(next.splitWith).toEqual([2]);
  });

  it('removes when present and falls back to [holonId] if empty', () => {
    const seeded: Expense = { ...expense, splitWith: [2] };
    const next = toggleParticipant(seeded, 2, 100);
    expect(next.splitWith).toEqual([100]);
  });

  it('does not mutate the input', () => {
    const original = { ...expense, splitWith: [...expense.splitWith] };
    toggleParticipant(expense, 3, 100);
    expect(expense).toEqual(original);
  });
});

describe('addParticipant / removeParticipant / splitAmongAll', () => {
  it('addParticipant is idempotent', () => {
    expect(addParticipant(expense, 2).splitWith).toEqual([1, 2]);
    expect(addParticipant(expense, 3).splitWith).toEqual([1, 2, 3]);
  });

  it('removeParticipant filters by string-equality', () => {
    expect(removeParticipant(expense, '2').splitWith).toEqual([1]);
  });

  it('splitAmongAll replaces the split', () => {
    expect(splitAmongAll(expense, [10, 20]).splitWith).toEqual([10, 20]);
  });
});
