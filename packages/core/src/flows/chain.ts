// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which chain a Bundle is on, said plainly.
 *
 * An address alone is not a location: the same 0x… means nothing on another
 * network, and a wallet on the wrong one sees no contract there and would
 * burn gas calling nothing. So every surface that shows the Bundle shows its
 * network beside its address, and says so when the wallet is elsewhere.
 * The names and explorers of the chains Holons is deployed to live here so
 * every surface says the same thing.
 */

import type { HolonBundleRecord } from './bundle.js';

export interface ChainInfo {
  chainId: number;
  name: string;
  /** Block explorer base, without a trailing slash; null when unknown. */
  explorer: string | null;
  testnet: boolean;
}

export const KNOWN_CHAINS: Record<number, Omit<ChainInfo, 'chainId'>> = {
  1: { name: 'Ethereum', explorer: 'https://etherscan.io', testnet: false },
  10: { name: 'Optimism', explorer: 'https://optimistic.etherscan.io', testnet: false },
  100: { name: 'Gnosis Chain', explorer: 'https://gnosisscan.io', testnet: false },
  137: { name: 'Polygon', explorer: 'https://polygonscan.com', testnet: false },
  8453: { name: 'Base', explorer: 'https://basescan.org', testnet: false },
  42161: { name: 'Arbitrum One', explorer: 'https://arbiscan.io', testnet: false },
  42220: { name: 'Celo', explorer: 'https://celoscan.io', testnet: false },
  11155111: { name: 'Sepolia', explorer: 'https://sepolia.etherscan.io', testnet: true },
  31337: { name: 'Local chain', explorer: null, testnet: true },
};

/** A chain by id; an unknown id is named by its number. */
export function describeChain(chainId: number | bigint | null | undefined): ChainInfo | null {
  const id = Number(chainId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const known = KNOWN_CHAINS[id];
  return known
    ? { chainId: id, ...known }
    : { chainId: id, name: `Chain ${id}`, explorer: null, testnet: false };
}

/** The Bundle's page on its chain's explorer, when both are known. */
export function bundleExplorerUrl(record: Pick<HolonBundleRecord, 'address' | 'chainId'> | null | undefined): string | null {
  if (!record?.address) return null;
  const chain = describeChain(record.chainId);
  return chain?.explorer ? `${chain.explorer}/address/${record.address}` : null;
}

export type ChainStanding =
  | { kind: 'same'; chain: ChainInfo }
  | { kind: 'elsewhere'; wallet: ChainInfo; bundle: ChainInfo }
  | { kind: 'unrecorded'; wallet: ChainInfo }
  | { kind: 'no-wallet'; bundle: ChainInfo | null };

/**
 * Where the wallet stands relative to the Bundle: on its chain, on another,
 * or with a record that never said which chain (deployed before 2026-09-18).
 */
export function chainStanding(
  record: Pick<HolonBundleRecord, 'chainId'> | null | undefined,
  walletChainId: number | bigint | null | undefined,
): ChainStanding {
  const bundle = describeChain(record?.chainId);
  const wallet = describeChain(walletChainId);
  if (!wallet) return { kind: 'no-wallet', bundle };
  if (!bundle) return { kind: 'unrecorded', wallet };
  return bundle.chainId === wallet.chainId
    ? { kind: 'same', chain: bundle }
    : { kind: 'elsewhere', wallet, bundle };
}

export type SameChain = 'same' | 'different' | 'unknown';

/**
 * Whether two Bundles are on the same chain — the one question that decides
 * if one may be bound as the other's beneficiary. Value never crosses chains:
 * a claim to an address the parent's chain does not know pushes the share to
 * whatever sits there, or to nothing. `unknown` when either record never
 * said, and a surface must then not offer the binding as a cascade.
 */
export function bundlesSameChain(
  a: Pick<HolonBundleRecord, 'chainId'> | null | undefined,
  b: Pick<HolonBundleRecord, 'chainId'> | null | undefined,
): SameChain {
  const x = describeChain(a?.chainId)?.chainId;
  const y = describeChain(b?.chainId)?.chainId;
  if (x == null || y == null) return 'unknown';
  return x === y ? 'same' : 'different';
}

/**
 * The chain a write to `record` must be sent on: the recorded one. A record
 * that never said (deployed before 2026-09-18) constrains nothing here — the
 * caller then falls back to "is there code at the address", and records the
 * chain it found on the first successful write.
 */
export function requiredChainId(
  record: Pick<HolonBundleRecord, 'chainId'> | null | undefined,
): number | null {
  return describeChain(record?.chainId)?.chainId ?? null;
}
