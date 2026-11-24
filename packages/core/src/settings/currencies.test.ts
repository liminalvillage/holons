// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  currencyUsage,
  normalizeCurrencyList,
  readHolonCurrencies,
  saveHolonCurrencies,
} from './currencies.js';

describe('normalizeCurrencyList', () => {
  it('normalizes, drops blanks and duplicates, keeps order', () => {
    expect(normalizeCurrencyList(['USD', 'Euros', 'euro', '', 3, 'usd'])).toEqual([
      'usd',
      'euro',
    ]);
  });
});

describe('readHolonCurrencies', () => {
  it('reads the list off a settings doc', () => {
    expect(readHolonCurrencies({ currencies: ['EUR', 'hour'] })).toEqual(['eur', 'hour']);
    expect(readHolonCurrencies(null)).toEqual([]);
    expect(readHolonCurrencies({ currencies: 'eur' })).toEqual([]);
  });
});

describe('currencyUsage', () => {
  it('counts records per currency', () => {
    expect(
      currencyUsage([
        { amount: 1, currency: 'EUR' },
        { amount: 2, currency: 'eur' },
        { amount: 3, currency: 'usd' },
        null,
      ]),
    ).toMatchObject({ eur: 2, usd: 1 });
  });
});

describe('saveHolonCurrencies', () => {
  it('writes the list into the keyed settings doc, keeping the rest', async () => {
    const puts: any[] = [];
    const hs = {
      get: async () => ({ id: 'h1', name: 'Hub', currencies: ['usd'] }),
      put: async (_h: string, _l: string, doc: any) => puts.push(doc),
    };
    const out = await saveHolonCurrencies(hs, 'h1', ['USD', 'Tree']);
    expect(out).toEqual(['usd', 'tree']);
    expect(puts[0]).toEqual({ id: 'h1', name: 'Hub', currencies: ['usd', 'tree'] });
  });
  it('still writes when the read fails', async () => {
    const puts: any[] = [];
    const hs = {
      get: async () => {
        throw new Error('offline');
      },
      put: async (_h: string, _l: string, doc: any) => puts.push(doc),
    };
    await saveHolonCurrencies(hs, 'h1', ['eur']);
    expect(puts[0]).toEqual({ id: 'h1', currencies: ['eur'] });
  });
});
