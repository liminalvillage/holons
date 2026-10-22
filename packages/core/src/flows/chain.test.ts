// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { describeChain, explorerAddressUrl, requiredChainId, safeAppUrl } from './chain.js';

const addr = '0xdA20c942FE60dC6bb7E9cfa3297bEad815ec275F';

describe('describeChain', () => {
  it('names the chains Holons deploys to, and numbers the rest', () => {
    expect(describeChain(11155111)).toMatchObject({ name: 'Sepolia', testnet: true, safe: 'sep' });
    expect(describeChain(31337n)).toMatchObject({ name: 'Local chain', explorer: null, safe: null });
    expect(describeChain(424242)).toEqual({ chainId: 424242, name: 'Chain 424242', explorer: null, testnet: false, native: 'ETH', rpc: null, safe: null });
    expect(describeChain(100)).toMatchObject({ native: 'xDAI', rpc: expect.stringMatching(/^https:/) });
    expect(describeChain(undefined)).toBeNull();
    expect(describeChain(0)).toBeNull();
  });
});

describe('explorerAddressUrl / safeAppUrl', () => {
  it('links the address on its chain, and nowhere without one', () => {
    expect(explorerAddressUrl(11155111, addr)).toBe(`https://sepolia.etherscan.io/address/${addr}`);
    expect(explorerAddressUrl(undefined, addr)).toBeNull();
    expect(explorerAddressUrl(31337, addr)).toBeNull();
    expect(explorerAddressUrl(1, null)).toBeNull();
  });

  it('opens Safe{Wallet} with the chain prefix, and nowhere Safe does not run', () => {
    expect(safeAppUrl(11155111, addr)).toBe(`https://app.safe.global/home?safe=sep:${addr}`);
    expect(safeAppUrl(1, addr)).toBe(`https://app.safe.global/home?safe=eth:${addr}`);
    expect(safeAppUrl(31337, addr)).toBeNull();
    expect(safeAppUrl(1, '')).toBeNull();
  });
});

describe('requiredChainId', () => {
  it('requires the recorded chain and nothing for an unrecorded one', () => {
    expect(requiredChainId({ chainId: 11155111 })).toBe(11155111);
    expect(requiredChainId({})).toBeNull();
    expect(requiredChainId(null)).toBeNull();
  });
});
