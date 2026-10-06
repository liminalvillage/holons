// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { foldHoldings, formatHolding, fromBaseUnits, holdingLines, holdsAnything, nativeUnit } from './holdings.js';
import { addBundleToken, readBundleRecord, readBundleTokens, withBundleToken, withoutBundleToken } from './bundle.js';

const EVO = { address: '0x46CfAd0408Fe97042E7f16f6dC82B12978Fea6d3', symbol: 'EVO', decimals: 18 };
const bundle = { address: '0xB634A9352cb6dc7905A7a51240095C9F9123802C', chainId: 11155111 };

describe('fromBaseUnits', () => {
  it('reads wei as ether and keeps six places', () => {
    expect(fromBaseUnits(2_500_000_000_000_000n, 18)).toBe(0.0025);
    expect(fromBaseUnits(20_495_768_928_487_072_305n, 18)).toBe(20.495769);
    expect(fromBaseUnits(1_234_567n, 6)).toBe(1.234567);
    expect(fromBaseUnits(0n, 18)).toBe(0);
  });
});

describe('foldHoldings', () => {
  it('splits a balance into held, free and mine, per unit', () => {
    const h = foldHoldings({
      chainId: 11155111,
      native: { balance: 10n ** 16n, deposited: 10n ** 16n, mine: 2n * 10n ** 15n },
      tokens: [{ token: EVO, holding: { balance: 10n * 10n ** 18n, deposited: 0n, mine: null } }],
    });
    expect(h.native).toEqual({ unit: 'ETH', address: null, decimals: 18, total: 0.01, held: 0.01, free: 0, mine: 0.002 });
    expect(h.tokens[0]).toEqual({ unit: 'EVO', address: EVO.address, decimals: 18, total: 10, held: 0, free: 10, mine: null });
  });

  it('never reports more held than the balance', () => {
    const h = foldHoldings({ chainId: 1, native: { balance: 5n, deposited: 9n }, tokens: [] });
    expect(h.native.held).toBe(h.native.total);
    expect(h.native.free).toBe(0);
  });

  it('names the coin by chain', () => {
    expect(nativeUnit(100)).toBe('xDAI');
    expect(nativeUnit(137)).toBe('POL');
    expect(nativeUnit(424242)).toBe('ETH');
    expect(foldHoldings({ chainId: 42220, native: { balance: 0n, deposited: 0n }, tokens: [] }).native.unit).toBe('CELO');
  });
});

describe('holdsAnything / holdingLines', () => {
  const empty = foldHoldings({
    chainId: 11155111,
    native: { balance: 0n, deposited: 0n, mine: 0n },
    tokens: [{ token: EVO, holding: { balance: 0n, deposited: 0n, mine: 0n } }],
  });
  it('is quiet when the Bundle holds nothing', () => {
    expect(holdsAnything(empty)).toBe(false);
    expect(holdsAnything(null)).toBe(false);
    expect(holdingLines(empty)).toEqual([]);
  });
  it('lists only the units with a balance, or held for the viewer', () => {
    const h = foldHoldings({
      chainId: 11155111,
      native: { balance: 0n, deposited: 0n, mine: 0n },
      tokens: [{ token: EVO, holding: { balance: 3n * 10n ** 18n, deposited: 3n * 10n ** 18n, mine: 10n ** 18n } }],
    });
    expect(holdsAnything(h)).toBe(true);
    expect(holdingLines(h).map((l) => l.unit)).toEqual(['EVO']);
  });
});

describe('formatHolding', () => {
  it('trims zeros and keeps the unit', () => {
    expect(formatHolding(20.495769, 'EVO')).toBe('20.495769 EVO');
    expect(formatHolding(0.0025, 'ETH')).toBe('0.0025 ETH');
    expect(formatHolding(100, 'EVO')).toBe('100 EVO');
  });
});

describe('bundle record tokens', () => {
  it('reads listed tokens, dropping the unusable and the duplicate', () => {
    const record = readBundleRecord({
      bundle: {
        ...bundle,
        tokens: [EVO, { ...EVO, address: EVO.address.toLowerCase(), symbol: 'evo' }, { address: 'nope', symbol: 'X', decimals: 18 }, { address: EVO.address, symbol: '', decimals: 18 }],
      },
    });
    expect(record?.tokens).toEqual([EVO]);
    expect(readBundleTokens(readBundleRecord({ bundle }))).toEqual([]);
  });

  it('lists a token once, replacing the entry at its address', () => {
    const once = withBundleToken(bundle, EVO);
    const twice = withBundleToken(once, { ...EVO, symbol: 'EVO2', name: 'Olive oil' });
    expect(twice.tokens).toEqual([{ ...EVO, symbol: 'EVO2', name: 'Olive oil' }]);
    expect(withoutBundleToken(twice, EVO.address.toLowerCase()).tokens).toEqual([]);
    expect(() => withBundleToken(bundle, { address: 'x', symbol: 'X', decimals: 18 })).toThrow();
  });

  it('writes the token onto the canonical settings document', async () => {
    const docs: Record<string, any> = { h1: { id: 'h1', name: 'Oilonics', bundle } };
    const hs = {
      get: async (_h: string, _l: string, id: string) => docs[id] ?? null,
      put: async (_h: string, _l: string, doc: any) => {
        docs[doc.id] = doc;
      },
    };
    const next = await addBundleToken(hs, 'h1', EVO);
    expect(next.tokens).toEqual([EVO]);
    expect(docs.h1.name).toBe('Oilonics');
    expect(docs.h1.bundle.tokens).toEqual([EVO]);
    await expect(addBundleToken(hs, 'h2', EVO)).rejects.toThrow(/No Bundle/);
  });
});
