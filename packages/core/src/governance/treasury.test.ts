// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
  TREASURY_ID,
  clampTreasuryRate,
  executeProposal,
  fundingExpenseId,
  readTreasuryRate,
  splitHours,
  treasuryBalance,
} from './treasury.js';
import { createExpense } from '../expenses/index.js';

describe('rates and splits', () => {
  it('clamps the rate into [0, 0.5] and defaults junk to 0', () => {
    expect(clampTreasuryRate(0.05)).toBe(0.05);
    expect(clampTreasuryRate(0.9)).toBe(0.5);
    expect(clampTreasuryRate(-1)).toBe(0);
    expect(clampTreasuryRate(NaN)).toBe(0);
    expect(clampTreasuryRate(undefined)).toBe(0);
    expect(readTreasuryRate({ treasuryRate: 0.1 })).toBe(0.1);
    expect(readTreasuryRate({ treasuryRate: '0.1' })).toBe(0.1);
    expect(readTreasuryRate({})).toBe(0);
    expect(readTreasuryRate(null)).toBe(0);
  });

  it('splits the hours to two decimals, fee to the treasury', () => {
    expect(splitHours(2, 0.05)).toEqual({ toProvider: 1.9, toTreasury: 0.1 });
    expect(splitHours(1, 0)).toEqual({ toProvider: 1, toTreasury: 0 });
    expect(splitHours(1, 0.333)).toEqual({ toProvider: 0.67, toTreasury: 0.33 });
    // Rounded parts always re-sum to the whole.
    const { toProvider, toTreasury } = splitHours(0.1, 0.05);
    expect(toProvider + toTreasury).toBeCloseTo(0.1, 10);
  });
});

describe('treasuryBalance', () => {
  it('is the treasury account hour balance: fees in, funded proposals out', () => {
    const fee = createExpense({
      id: 'e1',
      holonId: 'h',
      amount: 0.5,
      currency: 'hour',
      description: 'fee',
      paidBy: TREASURY_ID,
      splitWith: ['req'],
    });
    const funded = createExpense({
      id: 'e2',
      holonId: 'h',
      amount: 0.2,
      currency: 'hour',
      description: 'funded',
      paidBy: 'beneficiary',
      splitWith: [TREASURY_ID],
    });
    expect(treasuryBalance([fee!, funded!])).toBeCloseTo(0.3, 10);
    expect(treasuryBalance([])).toBe(0);
  });
});

describe('executeProposal', () => {
  const passed = { yes: 9, total: 12, ratio: 0.75, passed: true, direct: 9, delegated: 0 };
  const funding = (over: object = {}) => ({
    id: 'prop-7',
    type: 'proposal',
    title: 'repair the shared oven',
    initiator: { id: 'alice', username: 'Alice' },
    participants: [{ id: 'alice' }],
    requestedHours: 3,
    ...over,
  });
  const db = () => ({
    put: vi.fn(async () => {}),
    get: vi.fn(async () => ({ id: 'h', name: 'H', treasuryRate: 0 })),
  });

  it('funds a passed proposal from the treasury and stamps it executed', async () => {
    const store = db();
    const res = await executeProposal(store, 'h', funding(), {
      tally: passed,
      balance: 5,
      now: 1700000000000,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.expense).toMatchObject({
      id: fundingExpenseId('prop-7'),
      amount: 3,
      currency: 'hour',
      paidBy: 'alice',
      splitWith: [TREASURY_ID],
    });
    expect(store.put).toHaveBeenCalledWith('h', 'expenses', res.expense);
    expect(store.put).toHaveBeenCalledWith(
      'h',
      'quests',
      expect.objectContaining({ id: 'prop-7', status: 'executed' })
    );
  });

  it('pays an explicit beneficiary over the initiator', async () => {
    const store = db();
    const res = await executeProposal(
      store,
      'h',
      funding({ beneficiary: { id: 'bob' } }),
      { tally: passed, balance: 5 }
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.expense?.paidBy).toBe('bob');
  });

  it('applies a treasury-rate proposal to the settings doc', async () => {
    const store = db();
    const res = await executeProposal(
      store,
      'h',
      funding({ requestedHours: undefined, newTreasuryRate: 0.05 }),
      { tally: passed, balance: 0 }
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rate).toBe(0.05);
    expect(store.put).toHaveBeenCalledWith(
      'h',
      'settings',
      expect.objectContaining({ id: 'h', name: 'H', treasuryRate: 0.05 })
    );
  });

  it('rejects unpassed, empty, executed, or unaffordable proposals', async () => {
    const store = db();
    const notPassed = await executeProposal(store, 'h', funding(), {
      tally: { ...passed, passed: false },
      balance: 5,
    });
    expect(notPassed).toMatchObject({ ok: false, reason: 'not_passed' });

    const broke = await executeProposal(store, 'h', funding(), { tally: passed, balance: 1 });
    expect(broke).toMatchObject({ ok: false, reason: 'insufficient_treasury' });

    const done = await executeProposal(store, 'h', funding({ status: 'executed' }), {
      tally: passed,
      balance: 5,
    });
    expect(done).toMatchObject({ ok: false, reason: 'already_executed' });

    const empty = await executeProposal(store, 'h', funding({ requestedHours: undefined }), {
      tally: passed,
      balance: 5,
    });
    expect(empty).toMatchObject({ ok: false, reason: 'no_effect' });

    expect(store.put).not.toHaveBeenCalled();
  });
});
