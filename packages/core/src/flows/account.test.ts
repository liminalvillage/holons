// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { accountBalances, claimRails, logLine, potLine } from './account.js';

const seat = potLine({ holon: 'pot', unit: 'eth', token: '0xE', account: { collected: 1, collectable: 2, accruing: 0.5, total: 3.5 } });
const fundA = logLine({ holon: 'fundA', unit: 'eur', headroom: 40, totals: { claimed: 10, pending: 5, settled: 20 } });
const fundB = logLine({ holon: 'fundB', unit: 'EUR', headroom: 100 });

describe('statement lines', () => {
  it('reads a Pot seat: collectable is available, nothing is ever pending', () => {
    expect(seat).toEqual({ holon: 'pot', unit: 'ETH', place: 'chain', available: 2, pending: 0, paid: 1, accruing: 0.5, token: '0xE' });
  });

  it('reads a right in the log: headroom is available, approved and awaiting are both pending', () => {
    expect(fundA).toEqual({ holon: 'fundA', unit: 'EUR', place: 'log', available: 40, pending: 15, paid: 20, accruing: 0 });
  });

  it('reads an unknown headroom as nothing to take out', () => {
    expect(logLine({ holon: 'f', unit: 'eur', headroom: null }).available).toBe(0);
    expect(logLine({ holon: 'f', unit: 'eur', headroom: -3 }).available).toBe(0);
  });
});

describe('accountBalances', () => {
  it('keeps one balance per unit and never sums across units', () => {
    const balances = accountBalances([seat, fundA, fundB]);
    expect(balances.map((b) => [b.unit, b.available, b.pending, b.paid, b.accruing, b.total])).toEqual([
      ['EUR', 140, 15, 20, 0, 175],
      ['ETH', 2, 0, 1, 0.5, 3.5],
    ]);
    expect(balances[0].lines.map((l) => l.holon)).toEqual(['fundB', 'fundA']);
  });

  it('puts a unit with something to take out ahead of a larger one with nothing', () => {
    const spent = logLine({ holon: 'f', unit: 'usd', headroom: 0, totals: { settled: 900 } });
    expect(accountBalances([spent, seat]).map((b) => b.unit)).toEqual(['ETH', 'USD']);
  });

  it('drops empty lines, and has nothing to say with none', () => {
    expect(accountBalances([logLine({ holon: 'f', unit: 'eur', headroom: 0 })])).toEqual([]);
    expect(accountBalances([])).toEqual([]);
  });
});

describe('claimRails', () => {
  const rails = (input: Parameters<typeof claimRails>[0]) => claimRails(input).map((r) => [r.rail, r.enabled, r.reason ?? null, r.mode]);

  it('on chain: only the wallet, collected by the party itself', () => {
    expect(rails({ line: seat, payoutAddress: '0xabc', collective: { slug: 'c', currency: 'ETH' } })).toEqual([
      ['wallet', true, null, 'collect'],
      ['opencollective', false, 'on-chain', 'request'],
      ['paypal', false, 'on-chain', 'request'],
      ['bank', false, 'on-chain', 'request'],
    ]);
  });

  it('in the log with a collective in the same currency: all four, each a request', () => {
    expect(rails({ line: fundA, payoutAddress: '0xabc', collective: { slug: 'c', currency: 'eur' } })).toEqual([
      ['wallet', true, null, 'request'],
      ['opencollective', true, null, 'request'],
      ['paypal', true, null, 'request'],
      ['bank', true, null, 'request'],
    ]);
  });

  it('says why a rail is closed', () => {
    expect(rails({ line: fundA })).toEqual([
      ['wallet', false, 'no-wallet', 'request'],
      ['opencollective', false, 'no-collective', 'request'],
      ['paypal', false, 'no-collective', 'request'],
      ['bank', false, 'no-collective', 'request'],
    ]);
    expect(rails({ line: fundA, collective: { slug: 'c', currency: 'USD' } })[1]).toEqual(['opencollective', false, 'other-currency', 'request']);
    expect(rails({ line: { ...fundA, available: 0 }, payoutAddress: '0xabc', collective: { slug: 'c', currency: 'EUR' } }).every((r) => r[1] === false && r[2] === 'empty')).toBe(true);
  });
});
