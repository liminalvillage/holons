// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bundleExplorerUrl, bundlesSameChain, chainStanding, describeChain, requiredChainId } from './chain.js';
import { readBundleRecord } from './bundle.js';

const addr = '0xdA20c942FE60dC6bb7E9cfa3297bEad815ec275F';

describe('describeChain', () => {
  it('names the chains Holons deploys to, and numbers the rest', () => {
    expect(describeChain(11155111)).toMatchObject({ name: 'Sepolia', testnet: true });
    expect(describeChain(31337n)).toMatchObject({ name: 'Local chain', explorer: null });
    expect(describeChain(424242)).toEqual({ chainId: 424242, name: 'Chain 424242', explorer: null, testnet: false });
    expect(describeChain(undefined)).toBeNull();
    expect(describeChain(0)).toBeNull();
  });
});

describe('bundleExplorerUrl', () => {
  it('links the address on its chain, and nowhere without one', () => {
    expect(bundleExplorerUrl({ address: addr, chainId: 11155111 })).toBe(`https://sepolia.etherscan.io/address/${addr}`);
    expect(bundleExplorerUrl({ address: addr })).toBeNull();
    expect(bundleExplorerUrl({ address: addr, chainId: 31337 })).toBeNull();
    expect(bundleExplorerUrl(null)).toBeNull();
  });
});

describe('chainStanding', () => {
  it('tells same, elsewhere, unrecorded and no wallet apart', () => {
    expect(chainStanding({ chainId: 11155111 }, 11155111n)).toMatchObject({ kind: 'same', chain: { name: 'Sepolia' } });
    expect(chainStanding({ chainId: 11155111 }, 1)).toMatchObject({ kind: 'elsewhere', wallet: { name: 'Ethereum' }, bundle: { name: 'Sepolia' } });
    expect(chainStanding({}, 1)).toMatchObject({ kind: 'unrecorded', wallet: { name: 'Ethereum' } });
    expect(chainStanding({ chainId: 100 }, null)).toMatchObject({ kind: 'no-wallet', bundle: { name: 'Gnosis Chain' } });
  });
});

describe('bundle record chainId', () => {
  it('is read when stored and left out when not, or nonsense', () => {
    expect(readBundleRecord({ bundle: { address: addr, chainId: 11155111 } })?.chainId).toBe(11155111);
    expect(readBundleRecord({ bundle: { address: addr, chainId: '100' } })?.chainId).toBe(100);
    expect(readBundleRecord({ bundle: { address: addr } })).not.toHaveProperty('chainId');
    expect(readBundleRecord({ bundle: { address: addr, chainId: 'sepolia' } })).not.toHaveProperty('chainId');
  });
});

describe('bundlesSameChain / requiredChainId', () => {
  it('only calls two recorded chains the same, never guesses', () => {
    expect(bundlesSameChain({ chainId: 100 }, { chainId: 100 })).toBe('same');
    expect(bundlesSameChain({ chainId: 100 }, { chainId: 11155111 })).toBe('different');
    expect(bundlesSameChain({ chainId: 100 }, {})).toBe('unknown');
    expect(bundlesSameChain(null, { chainId: 100 })).toBe('unknown');
  });

  it('requires the recorded chain and nothing for an unrecorded one', () => {
    expect(requiredChainId({ chainId: 11155111 })).toBe(11155111);
    expect(requiredChainId({})).toBeNull();
    expect(requiredChainId(null)).toBeNull();
  });
});
