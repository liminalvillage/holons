// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { FoldedMints } from './mints.js';
import { defaultPotUnit, hasPot, potBalance, potTotal, potUnits } from './pot.js';
import type { FundUsage } from './usage.js';

const mints = (byUnit: Record<string, number>): FoldedMints =>
  ({ mints: [], accepted: [], byUnit, pendingByUnit: {}, source: 'bootstrap', policy: {} as never, epochs: [] }) as FoldedMints;

describe('potUnits', () => {
  it('the collective first, then minted units by size, then what only reaches from upstream', () => {
    const units = potUnits({
      collective: { currency: 'EUR', balance: 12 },
      mints: mints({ L: 200, WOOD: 3 }),
      inbound: [{ from: 'm', unit: 'L', right: 5 }, { from: 'n', unit: 'KWH', right: 9 }],
    });
    expect(units).toEqual(['eur', 'l', 'wood', 'kwh']);
    expect(defaultPotUnit({ mints: mints({ L: 1 }) })).toBe('l');
    expect(defaultPotUnit({})).toBe('');
  });

  it('a zero mint or a zero right is not a unit', () => {
    expect(potUnits({ mints: mints({ L: 0 }), inbound: [{ from: 'm', unit: 'EUR', right: 0 }] })).toEqual([]);
  });
});

describe('potBalance / potTotal', () => {
  it('what is held here is the bank in that currency plus what was minted in it; inbound is added by rightsTotal', () => {
    const sources = { collective: { currency: 'eur', balance: 100 }, mints: mints({ EUR: 50, L: 200 }), inbound: [{ from: 'm', unit: 'L', right: 80 }] };
    expect(potBalance('EUR', sources)).toBe(150);
    expect(potBalance('l', sources)).toBe(200);
    expect(potTotal('L', sources, null)).toBe(280);
    expect(potTotal('EUR', sources, null)).toBe(150);
    expect(hasPot('usd', sources)).toBe(false);
    expect(potTotal('usd', sources, null)).toBe(0);
  });

  it('a bank balance gets the lifetime spend added back; a mint or an inbound right is gross and does not', () => {
    const usage: FundUsage = {
      unit: 'l',
      parties: {},
      lifetime: { ada: { l: { spent: 30, claimed: 0 } } },
      unattributed: {},
      unattributedPayees: [],
      claimsSource: 'log',
      legacyClaimed: {},
    };
    // The bank shows 70 after paying 30: the pot was 100.
    expect(potTotal('L', { collective: { currency: 'L', balance: 70 } }, usage)).toBe(100);
    // A 70 L right from upstream is 70 L whatever was handed over from it.
    expect(potTotal('L', { inbound: [{ from: 'm', unit: 'L', right: 70 }] }, usage)).toBe(70);
    // 100 L minted stay 100 L minted after 30 L of payouts.
    expect(potTotal('L', { mints: mints({ L: 100 }) }, usage)).toBe(100);
    // Mixed: the bank's 70 (+30 spent) plus 50 minted in the same unit.
    expect(potTotal('L', { collective: { currency: 'L', balance: 70 }, mints: mints({ L: 50 }) }, usage)).toBe(150);
  });
});
