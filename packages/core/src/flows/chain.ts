// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which chain an address is on, said plainly.
 *
 * An address alone is not a location: the same 0x… means nothing on another
 * network, and a wallet on the wrong one sees no contract there and would
 * burn gas calling nothing. So every surface that shows a Pot or a treasury
 * shows its network beside its address, and says so when the wallet is
 * elsewhere. The names, explorers and public endpoints of the chains Holons
 * is deployed to live here so every surface says the same thing.
 */

export interface ChainInfo {
  chainId: number;
  name: string;
  /** Block explorer base, without a trailing slash; null when unknown. */
  explorer: string | null;
  testnet: boolean;
  /** The chain's own coin, as a unit label. */
  native: string;
  /**
   * A public JSON-RPC endpoint for reads when no wallet is in the browser,
   * or the wallet is on another chain; null when none is known.
   */
  rpc: string | null;
  /** The chain prefix Safe{Wallet} uses in its links (`sep:0x…`); null when Safe does not run there. */
  safe: string | null;
}

export const KNOWN_CHAINS: Record<number, Omit<ChainInfo, 'chainId'>> = {
  1: { name: 'Ethereum', explorer: 'https://etherscan.io', testnet: false, native: 'ETH', rpc: 'https://ethereum-rpc.publicnode.com', safe: 'eth' },
  10: { name: 'Optimism', explorer: 'https://optimistic.etherscan.io', testnet: false, native: 'ETH', rpc: 'https://optimism-rpc.publicnode.com', safe: 'oeth' },
  100: { name: 'Gnosis Chain', explorer: 'https://gnosisscan.io', testnet: false, native: 'xDAI', rpc: 'https://rpc.gnosischain.com', safe: 'gno' },
  137: { name: 'Polygon', explorer: 'https://polygonscan.com', testnet: false, native: 'POL', rpc: 'https://polygon-bor-rpc.publicnode.com', safe: 'matic' },
  8453: { name: 'Base', explorer: 'https://basescan.org', testnet: false, native: 'ETH', rpc: 'https://base-rpc.publicnode.com', safe: 'base' },
  42161: { name: 'Arbitrum One', explorer: 'https://arbiscan.io', testnet: false, native: 'ETH', rpc: 'https://arbitrum-one-rpc.publicnode.com', safe: 'arb1' },
  42220: { name: 'Celo', explorer: 'https://celoscan.io', testnet: false, native: 'CELO', rpc: 'https://forno.celo.org', safe: 'celo' },
  11155111: { name: 'Sepolia', explorer: 'https://sepolia.etherscan.io', testnet: true, native: 'ETH', rpc: 'https://ethereum-sepolia-rpc.publicnode.com', safe: 'sep' },
  31337: { name: 'Local chain', explorer: null, testnet: true, native: 'ETH', rpc: 'http://127.0.0.1:8545', safe: null },
};

/** A chain by id; an unknown id is named by its number. */
export function describeChain(chainId: number | bigint | null | undefined): ChainInfo | null {
  const id = Number(chainId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const known = KNOWN_CHAINS[id];
  return known
    ? { chainId: id, ...known }
    : { chainId: id, name: `Chain ${id}`, explorer: null, testnet: false, native: 'ETH', rpc: null, safe: null };
}

/** An address's page on its chain's explorer, when both are known. */
export function explorerAddressUrl(chainId: number | bigint | null | undefined, address: string | null | undefined): string | null {
  if (!address) return null;
  const chain = describeChain(chainId);
  return chain?.explorer ? `${chain.explorer}/address/${address}` : null;
}

/** The Safe{Wallet} page of a Safe on its chain, when Safe runs there. */
export function safeAppUrl(chainId: number | bigint | null | undefined, address: string | null | undefined): string | null {
  if (!address) return null;
  const prefix = describeChain(chainId)?.safe;
  return prefix ? `https://app.safe.global/home?safe=${prefix}:${address}` : null;
}

/**
 * The chain a write to `record` must be sent on: the recorded one. A record
 * that never said constrains nothing here — the caller then falls back to
 * "is there code at the address".
 */
export function requiredChainId(record: { chainId?: number | null } | null | undefined): number | null {
  return describeChain(record?.chainId)?.chainId ?? null;
}
