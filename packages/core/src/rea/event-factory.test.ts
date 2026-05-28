import { describe, expect, it } from 'vitest';
import { REAEventFactory } from './event-factory.js';

describe('REAEventFactory.expenseEvents', () => {
  const expense = {
    id: 'exp-1',
    amount: 90,
    currency: 'EUR',
    description: 'weekly veg',
    paidBy: 1,
    splitWith: [1, 2, 3], // payer + two others
    created: '2026-05-01T10:00:00.000Z',
  };

  it('emits one expense:paid and one expense:share per non-payer', () => {
    const events = REAEventFactory.expenseEvents('h1', expense);
    const paid = events.filter((e) => e.eventType === 'expense:paid');
    const shares = events.filter((e) => e.eventType === 'expense:share');
    expect(paid).toHaveLength(1);
    expect(shares).toHaveLength(2); // 3 in split minus the payer
    // Share amount = total / split size.
    expect(shares[0].resource?.quantity).toBeCloseTo(30);
    // Currency persisted lowercased.
    expect(paid[0].resource?.unit).toBe('eur');
  });

  it('uses stable ids keyed on expense.id (idempotent across re-emits)', () => {
    const a = REAEventFactory.expenseEvents('h1', expense).map((e) => e.id);
    const b = REAEventFactory.expenseEvents('h1', expense).map((e) => e.id);
    expect(a).toEqual(b); // same ids → upsert, never duplicate
    expect(a).toContain('h1_expense_exp-1_paid');
    expect(a).toContain('h1_expense_exp-1_share_1');
  });

  it('falls back to a random base id when expense.id is missing', () => {
    const noId = { ...expense, id: '' };
    const ev = REAEventFactory.expenseEvents('h1', noId);
    expect(ev[0].id).not.toContain('_expense__'); // not the stable form
    expect(ev[0].id.endsWith('_paid')).toBe(true);
  });
});
