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

  it('what was already drawn is still part of the pot, as rightsTotal has always read it', () => {
    const usage: FundUsage = {
      unit: 'l',
      parties: {},
      lifetime: { ada: { l: { spent: 30, claimed: 0 } } },
      unattributed: {},
      unattributedPayees: [],
      claimsSource: 'log',
      legacyClaimed: {},
    };
    expect(potTotal('L', { inbound: [{ from: 'm', unit: 'L', right: 70 }] }, usage)).toBe(100);
  });
});
