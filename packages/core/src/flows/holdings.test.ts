// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { formatHolding, fromBaseUnits, nativeUnit, treasuryLines } from './holdings.js';

const EVO = { address: '0x46CfAd0408Fe97042E7f16f6dC82B12978Fea6d3', symbol: 'EVO', decimals: 18 };

describe('fromBaseUnits', () => {
  it('reads wei as ether and keeps six places', () => {
    expect(fromBaseUnits(2_500_000_000_000_000n, 18)).toBe(0.0025);
    expect(fromBaseUnits(20_495_768_928_487_072_305n, 18)).toBe(20.495769);
    expect(fromBaseUnits(1_234_567n, 6)).toBe(1.234567);
    expect(fromBaseUnits(0n, 18)).toBe(0);
  });
});

describe('nativeUnit', () => {
  it('names the coin by chain', () => {
    expect(nativeUnit(100)).toBe('xDAI');
    expect(nativeUnit(137)).toBe('POL');
    expect(nativeUnit(424242)).toBe('ETH');
    expect(nativeUnit(42220)).toBe('CELO');
  });
});

describe('treasuryLines', () => {
  it('prints the coin first, then every listed token, each in its unit', () => {
    const lines = treasuryLines(11155111, [EVO], { native: 10n ** 16n, tokens: { [EVO.address.toLowerCase()]: 30n * 10n ** 18n } });
    expect(lines).toEqual([
      { unit: 'ETH', address: null, decimals: 18, balance: 0.01 },
      { unit: 'EVO', address: EVO.address, decimals: 18, balance: 30 },
    ]);
  });

  it('reads a unit nobody reported as zero, and the coin by its chain', () => {
    const lines = treasuryLines(100, [EVO], null);
    expect(lines).toEqual([
      { unit: 'xDAI', address: null, decimals: 18, balance: 0 },
      { unit: 'EVO', address: EVO.address, decimals: 18, balance: 0 },
    ]);
    expect(treasuryLines(1, [EVO], { tokens: { [EVO.address]: 5n * 10n ** 18n } })[1].balance).toBe(5);
  });
});

describe('formatHolding', () => {
  it('trims zeros and keeps the unit', () => {
    expect(formatHolding(0.0025, 'ETH')).toBe('0.0025 ETH');
    expect(formatHolding(100, 'EVO')).toBe('100 EVO');
    expect(formatHolding(1.5, 'L')).toBe('1.5 L');
  });
});
