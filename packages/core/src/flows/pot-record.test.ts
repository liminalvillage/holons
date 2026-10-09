// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  addPotToken,
  loadPotRecord,
  normalizePotRecord,
  readPotRecord,
  readPotTokens,
  removePotToken,
  savePotRecord,
  savePotTreasury,
  withPotToken,
  withoutPotToken,
} from './pot-record.js';

const EVO = { address: '0x46CfAd0408Fe97042E7f16f6dC82B12978Fea6d3', symbol: 'EVO', decimals: 18 };
const POT = '0xB634A9352cb6dc7905A7a51240095C9F9123802C';
const SAFE = '0xdA20c942FE60dC6bb7E9cfa3297bEad815ec275F';

function fakeHolosphere(docs: Record<string, any> = {}) {
  return {
    docs,
    get: async (_h: string, _l: string, id: string) => docs[id] ?? null,
    put: async (_h: string, _l: string, doc: any) => {
      docs[doc.id] = doc;
    },
  };
}

describe('the Pot record', () => {
  it('reads a stored Pot, lower-cased, with its tokens and treasury; nonsense is null', () => {
    const pot = readPotRecord({ pot: { address: POT, chainId: '11155111', challenge: 259200, tokens: [EVO], treasury: { address: SAFE } } });
    expect(pot).toMatchObject({ address: POT.toLowerCase(), chainId: 11155111, challenge: 259200, tokens: [EVO] });
    expect(pot?.treasury).toEqual({ address: SAFE.toLowerCase(), kind: 'safe' });
    expect(readPotRecord({})).toBeNull();
    expect(readPotRecord({ pot: { address: 'nope', chainId: 1 } })).toBeNull();
    expect(readPotRecord({ pot: { address: POT, chainId: 'sepolia' } })).toBeNull();
    expect(normalizePotRecord({ address: POT, chainId: 1 })).toMatchObject({ tokens: [] });
    expect(normalizePotRecord({ address: POT, chainId: 1, treasury: { address: 'x' } })).not.toHaveProperty('treasury');
  });

  it('reads listed tokens, dropping the unusable and the duplicate', () => {
    const tokens = readPotTokens({
      tokens: [EVO, { ...EVO, address: EVO.address.toLowerCase(), symbol: 'evo' }, { address: 'nope', symbol: 'X', decimals: 18 }, { address: EVO.address, symbol: '', decimals: 18 }],
    });
    expect(tokens).toEqual([EVO]);
    expect(readPotTokens(null)).toEqual([]);
  });

  it('lists a token once, replacing the entry at its address', () => {
    const base = normalizePotRecord({ address: POT, chainId: 1 })!;
    const once = withPotToken(base, EVO);
    const twice = withPotToken(once, { ...EVO, symbol: 'EVO2', name: 'Olive oil' });
    expect(twice.tokens).toEqual([{ ...EVO, symbol: 'EVO2', name: 'Olive oil' }]);
    expect(withoutPotToken(twice, EVO.address.toLowerCase()).tokens).toEqual([]);
    expect(() => withPotToken(base, { address: 'x', symbol: 'X', decimals: 18 })).toThrow();
  });

  it('saves onto the canonical settings document, keeping the rest of it', async () => {
    const hs = fakeHolosphere({ h1: { id: 'h1', name: 'Oilonics', allocation: { interiorPercent: 100 } } });
    await savePotRecord(hs, 'h1', { address: POT, chainId: 11155111, tokens: [] });
    expect(hs.docs.h1).toMatchObject({ id: 'h1', name: 'Oilonics', allocation: { interiorPercent: 100 } });
    expect(await loadPotRecord(hs, 'h1')).toMatchObject({ address: POT.toLowerCase(), chainId: 11155111, tokens: [] });
    await expect(savePotRecord(hs, 'h1', { address: 'nope', chainId: 1, tokens: [] })).rejects.toThrow();
    // A document that does not exist yet still gets the id stamp.
    await savePotRecord(hs, 'h2', { address: POT, chainId: 1, tokens: [] });
    expect(hs.docs.h2.id).toBe('h2');
  });

  it('tracks and drops tokens on the record; refuses without a Pot', async () => {
    const hs = fakeHolosphere({ h1: { id: 'h1', pot: { address: POT, chainId: 1 } } });
    expect((await addPotToken(hs, 'h1', EVO)).tokens).toEqual([EVO]);
    expect(hs.docs.h1.pot.tokens).toEqual([EVO]);
    expect((await removePotToken(hs, 'h1', EVO.address)).tokens).toEqual([]);
    await expect(addPotToken(hs, 'h2', EVO)).rejects.toThrow(/No Pot/);
  });

  it('sets and clears the treasury', async () => {
    const hs = fakeHolosphere({ h1: { id: 'h1', pot: { address: POT, chainId: 1, tokens: [EVO] } } });
    const set = await savePotTreasury(hs, 'h1', { address: SAFE });
    expect(set.treasury).toMatchObject({ address: SAFE.toLowerCase(), kind: 'safe' });
    expect(set.tokens).toEqual([EVO]);
    expect(typeof hs.docs.h1.pot.treasury.setAt).toBe('number');
    const plain = await savePotTreasury(hs, 'h1', { address: SAFE, kind: 'address' });
    expect(plain.treasury?.kind).toBe('address');
    const cleared = await savePotTreasury(hs, 'h1', null);
    expect(cleared).not.toHaveProperty('treasury');
    await expect(savePotTreasury(hs, 'h1', { address: 'x' })).rejects.toThrow();
    await expect(savePotTreasury(hs, 'nope', { address: SAFE })).rejects.toThrow(/No Pot/);
  });
});
