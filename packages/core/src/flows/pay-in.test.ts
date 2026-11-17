// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { describeSafe, lightningUri, parseLightning, parseSafe, readPayIn, safeChains, savePayIn } from './pay-in.js';

const A = '0x' + 'Ab'.repeat(20);
const a = A.toLowerCase();

function store(initial: Record<string, any> = {}) {
  const docs: Record<string, any> = { ...initial };
  return {
    docs,
    async get(holon: string) {
      return docs[holon] ?? null;
    },
    async put(holon: string, _lens: string, doc: any) {
      docs[holon] = structuredClone(doc);
      return true;
    },
  };
}

describe('parseSafe', () => {
  it('reads a prefixed address, a Safe{Wallet} link, and a bare address on the chain given', () => {
    expect(parseSafe(`gno:${A}`)).toEqual({ chainId: 100, address: a });
    expect(parseSafe(`https://app.safe.global/home?safe=base:${A}&x=1`)).toEqual({ chainId: 8453, address: a });
    expect(parseSafe(A, 1)).toEqual({ chainId: 1, address: a });
    expect(parseSafe(A)).toEqual({ chainId: 100, address: a });
  });

  it('refuses what names no Safe', () => {
    expect(parseSafe('')).toBeNull();
    expect(parseSafe('0x1234')).toBeNull();
    expect(parseSafe(`nope:${A}`)).toBeNull();
    expect(parseSafe(A, 0)).toBeNull();
  });
});

describe('parseLightning', () => {
  it('reads a Lightning address, a lightning: link and an LNURL', () => {
    expect(parseLightning('  Pot@Getalby.com ')).toBe('pot@getalby.com');
    expect(parseLightning('lightning:pot@walletofsatoshi.com')).toBe('pot@walletofsatoshi.com');
    const lnurl = 'lnurl1dp68gurn8ghj7um9wfmxjcm99e3k7mf0v9cxj0m385ekvcenxc6r2c35xvukxefcv5mkvv34x5ekzd3ev56nyd3hxqurzepexejxxepnxscrvwfnv9nxzcn9xq6xyefhvgcxxcmyxymnserxfq5fns';
    expect(parseLightning(lnurl.toUpperCase())).toBe(lnurl);
  });

  it('refuses what is neither', () => {
    expect(parseLightning('')).toBeNull();
    expect(parseLightning('pot@')).toBeNull();
    expect(parseLightning('not an address')).toBeNull();
  });
});

describe('savePayIn / readPayIn', () => {
  it('merges into the settings document, changes only what is given, and removes with null', async () => {
    const hs = store({ h: { id: 'h', name: 'River Pot', openCollective: { slug: 'river' } } });
    await savePayIn(hs, 'h', { safe: { chainId: 100, address: A } });
    await savePayIn(hs, 'h', { lightning: 'pot@getalby.com' });
    expect(hs.docs.h).toMatchObject({ name: 'River Pot', openCollective: { slug: 'river' } });
    expect(readPayIn(hs.docs.h)).toEqual({ safe: { chainId: 100, address: a }, lightning: 'pot@getalby.com' });

    await savePayIn(hs, 'h', { safe: null });
    expect(readPayIn(hs.docs.h)).toEqual({ safe: null, lightning: 'pot@getalby.com' });
  });

  it('refuses a malformed door rather than storing it', async () => {
    const hs = store();
    await expect(savePayIn(hs, 'h', { lightning: 'nope' })).rejects.toThrow(/Lightning/);
    await expect(savePayIn(hs, 'h', { safe: { chainId: 100, address: '0x12' } })).rejects.toThrow(/Safe/);
    expect(hs.docs.h).toBeUndefined();
  });

  it('reads anything malformed as unset', () => {
    expect(readPayIn(null)).toEqual({ safe: null, lightning: null });
    expect(readPayIn({ payIn: { safe: { chainId: 'x', address: 'y' }, lightning: 42 } })).toEqual({ safe: null, lightning: null });
  });
});

describe('links', () => {
  it('opens Lightning wallets and the Safe app', () => {
    expect(lightningUri('pot@getalby.com')).toBe('lightning:pot@getalby.com');
    expect(describeSafe({ chainId: 100, address: a })).toEqual({ chain: 'Gnosis Chain', app: `https://app.safe.global/home?safe=gno:${a}` });
    expect(safeChains()[0]).toEqual({ chainId: 1, name: 'Ethereum' });
    expect(safeChains().at(-1)).toEqual({ chainId: 11155111, name: 'Sepolia' });
  });
});
