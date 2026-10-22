// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { computeMutualCredit, type Expense } from '../expenses/index.js';
import { allocate, withPot } from './allocation.js';
import { claimCeilings } from './ceiling.js';
import { fundAccount, buildFundUsage, rightsTotal } from './usage.js';
import { potTotal } from './pot.js';
import { buildWallet, creditPositionOf, walletLine } from './wallet.js';

const HOLON = '-100';
const NOW = Date.parse('2026-10-10T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

// Half each: the one rule, read per unit.
const shares = allocate({
  total: null,
  config: { interiorPercent: 100, steepness: 50, nzones: 1, interiorMode: 'custom' },
  members: [
    { id: 'ada', name: 'Ada', percentage: 50 },
    { id: 'bob', name: 'Bob', percentage: 50 },
  ],
  zoned: [],
});
const parties = [
  { id: 'ada', name: 'Ada' },
  { id: 'bob', name: 'Bob' },
];
const users = [{ id: 'ada' }, { id: 'bob' }, { id: 'cy' }];

const expense = (over: Partial<Expense> & { amount: number; currency: string; paidBy: string }): Expense =>
  ({
    id: `e-${over.paidBy}-${over.amount}-${over.currency}`,
    created: new Date(NOW - DAY).toISOString(),
    description: '',
    participants: [],
    splitWith: [],
    ...over,
  }) as Expense;

describe('withPot', () => {
  it('keeps every percentage and re-prices every amount in the unit asked for', () => {
    const inL = withPot(shares, 200, 'l');
    expect(inL.unit).toBe('l');
    expect(inL.total).toBe(200);
    expect(inL.interior.map((s) => [s.id, s.percentage, s.amount])).toEqual([
      ['ada', 50, 100],
      ['bob', 50, 100],
    ]);
    const bare = withPot(inL, null, 'eur');
    expect(bare.total).toBeNull();
    expect(bare.interior.every((s) => s.amount === null)).toBe(true);
    // Zone members are re-priced too.
    const zoned = allocate({
      total: 100,
      unit: 'eur',
      config: { interiorPercent: 0, steepness: 50, nzones: 1 },
      members: [],
      zoned: [{ id: 'p', name: 'P', zone: 1 }],
    });
    expect(withPot(zoned, 10, 'l').exterior[0].members?.[0].amount).toBe(10);
  });
});

describe('fundAccount per unit', () => {
  it('reads the statement in the unit asked for, off one usage keyed by every unit', () => {
    const usage = buildFundUsage({
      holonId: HOLON,
      unit: 'eur',
      parties,
      expenses: [
        // The fund paid Ada 30 EUR and 5 L.
        expense({ amount: 30, currency: 'EUR', paidBy: HOLON, splitWith: ['ada'] }),
        expense({ amount: 5, currency: 'L', paidBy: HOLON, splitWith: ['ada'] }),
      ],
      now: NOW,
    });
    const eur = fundAccount(withPot(shares, 200, 'eur'), usage, 'ada', 'eur')!;
    expect(eur.unit).toBe('eur');
    expect(eur.right).toBe(100);
    expect(eur.lifetimeSpent).toBe(30);
    expect(eur.available).toBe(70);
    expect(eur.otherUnits).toEqual([{ unit: 'l', spent: 5, claimed: 0 }]);
    const l = fundAccount(withPot(shares, 20, 'l'), usage, 'ada', 'l')!;
    expect(l.unit).toBe('l');
    expect(l.right).toBe(10);
    expect(l.lifetimeSpent).toBe(5);
    expect(l.available).toBe(5);
    expect(l.otherUnits).toEqual([{ unit: 'eur', spent: 30, claimed: 0 }]);
  });

  it('rightsTotal adds back the spend in the unit asked for, not the usage unit', () => {
    const usage = buildFundUsage({
      holonId: HOLON,
      unit: 'l',
      parties,
      expenses: [expense({ amount: 30, currency: 'EUR', paidBy: HOLON, splitWith: ['ada'] })],
      now: NOW,
    });
    expect(rightsTotal(100, usage, 0, 'eur')).toBe(130);
    expect(rightsTotal(100, usage, 0, 'l')).toBe(100);
    // A collective in EUR while the board is on L still sizes its pot right.
    const sources = { collective: { currency: 'EUR', balance: 100 }, mints: { byUnit: { L: 50 } } as never };
    expect(potTotal('eur', sources, usage)).toBe(130);
    expect(potTotal('l', sources, usage)).toBe(50);
  });
});

describe('buildWallet', () => {
  const sources = {
    collective: { currency: 'EUR', balance: 200 },
    mints: { byUnit: { L: 40 } } as never,
    inbound: [],
    chain: null,
  };

  it('one line per unit the party holds anything in — fund units first, then credit-only', () => {
    const expenses = [
      // Ada paid 60 EUR for the three of them: Bob and Cy owe her 20 each.
      expense({ amount: 60, currency: 'EUR', paidBy: 'ada', splitWith: ['ada', 'bob', 'cy'] }),
      // Bob paid 9 USD for Ada: she owes him 9 USD — a unit the fund never held.
      expense({ amount: 9, currency: 'USD', paidBy: 'bob', splitWith: ['ada'] }),
    ];
    const usage = buildFundUsage({ holonId: HOLON, unit: 'eur', parties, expenses, now: NOW });
    const credit = ['eur', 'usd'].map((c) => computeMutualCredit(expenses, users, c));
    const wallet = buildWallet({ partyId: 'ada', shares, sources, usage, credit });

    expect(wallet.map((l) => l.unit)).toEqual(['eur', 'l', 'usd']);
    const eur = walletLine(wallet, 'EUR')!;
    expect(eur.account?.right).toBe(100);
    expect(eur.available).toBe(100);
    expect(eur.pot).toBe(200);
    expect(eur.sources).toEqual(['collective']);
    expect(eur.credit).toEqual({ net: 40, owedToYou: 40, youOwe: 0 });
    expect(eur.claimable).toBeNull(); // no ceilings given

    const l = walletLine(wallet, 'l')!;
    expect(l.account?.right).toBe(20);
    expect(l.sources).toEqual(['mint']);
    expect(l.credit).toBeNull();

    const usd = walletLine(wallet, 'usd')!;
    expect(usd.account).toBeNull();
    expect(usd.available).toBe(0);
    expect(usd.pot).toBe(0);
    expect(usd.sources).toEqual(['credit']);
    expect(usd.credit).toEqual({ net: -9, owedToYou: 0, youOwe: 9 });
  });

  it('a party with no seat and nothing open has an empty wallet; a square credit is no line', () => {
    const expenses = [expense({ amount: 10, currency: 'EUR', paidBy: 'cy', splitWith: ['cy'] })];
    const credit = [computeMutualCredit(expenses, users, 'eur')];
    expect(buildWallet({ partyId: 'cy', shares, sources, usage: null, credit })).toEqual([]);
    expect(creditPositionOf(credit[0], 'cy')).toBeNull();
    expect(buildWallet({ partyId: '', shares, sources, usage: null })).toEqual([]);
  });

  it('carries the headroom as `claimable` when the ceilings are given, and zero for a Pot-held unit', () => {
    const usage = buildFundUsage({ holonId: HOLON, unit: 'eur', parties, expenses: [], now: NOW });
    const pots = { eur: potTotal('eur', sources, usage), l: potTotal('l', sources, usage) };
    const ceilings = claimCeilings({ shares, pots, usage, claims: null });
    const wallet = buildWallet({ partyId: 'bob', shares, sources, usage, ceilings, claims: null });
    expect(walletLine(wallet, 'eur')?.claimable).toBe(100);
    expect(walletLine(wallet, 'l')?.claimable).toBe(20);

    const held = buildWallet({
      partyId: 'bob',
      shares,
      sources: { ...sources, chain: { EUR: 200 } },
      usage,
      held: ['eur'],
      ceilings: claimCeilings({ shares, pots, usage, claims: null, held: ['eur'] }),
      claims: null,
    });
    const eur = walletLine(held, 'eur')!;
    expect(eur.held).toBe(true);
    expect(eur.claimable).toBe(0);
    expect(eur.sources).toEqual(['collective', 'pot']);
    expect(eur.account?.right).toBe(200); // the Pot's receipt and the bank balance are two lots
  });
});
