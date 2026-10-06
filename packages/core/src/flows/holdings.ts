// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a holon's Bundle holds on chain, read the same way on every surface.
 *
 * A Bundle's balance is three things at once: what is **held** for members
 * who have not bound a wallet yet (`totalEtherDeposited`, `totalDeposited`
 * per token — paid out by `claim`), what is **free** (received but not
 * divided, because nobody was placed on the ring it fell on; the next
 * `reward()` pushes it through the split), and — for the person looking —
 * what is held for **them** (`etherBalance(id)`, `tokenBalance(id, token)`).
 * One line per unit: the chain's own coin, then every token the record
 * lists (`HolonBundleRecord.tokens`, the EVO voucher for the harvest).
 *
 * No ethers here (rule 2): the surfaces read the raw words with the ABI
 * fragments below and hand the bigints to `foldHoldings`. The pot the
 * boards divide is NOT fed from here — a lot minted in the `flow_mints`
 * log and the same lot's vouchers sitting in the Bundle are one lot, and
 * adding both would count it twice. These are the Bundle's own books,
 * shown beside the split, so a member sees the litres are really there.
 */

import type { BundleToken } from './bundle.js';
import { describeChain } from './chain.js';

/** The Bundle's balance words. */
export const BUNDLE_HOLDINGS_ABI = [
  'function totalEtherDeposited() view returns (uint256)',
  'function totalDeposited(address) view returns (uint256)',
  'function etherBalance(string) view returns (uint256)',
  'function tokenBalance(string, address) view returns (uint256)',
] as const;

/** The ERC-20 words a surface needs to read a token and describe it. */
export const ERC20_META_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function name() view returns (string)',
] as const;

/** One unit's raw balances, in base units. */
export interface RawHolding {
  /** The Bundle's whole balance in this unit. */
  balance: bigint;
  /** The part held for unbound members. */
  deposited: bigint;
  /** Held for the viewer; null when nobody is looking or the id is not on the contract. */
  mine?: bigint | null;
}

export interface RawHoldings {
  chainId: number;
  native: RawHolding;
  tokens: { token: BundleToken; holding: RawHolding }[];
}

/** One unit's balances, in that unit. */
export interface HoldingLine {
  unit: string;
  /** The token's address; null for the chain's own coin. */
  address: string | null;
  decimals: number;
  /** Everything the Bundle holds in this unit. */
  total: number;
  /** Held for members who have not bound a wallet. */
  held: number;
  /** Received and not yet divided: pushed on by the next reward. */
  free: number;
  /** Held for the viewer, or null when unknown. */
  mine: number | null;
}

export interface BundleHoldings {
  chainId: number;
  native: HoldingLine;
  tokens: HoldingLine[];
}

/** A base-unit amount as a plain number in its unit, rounded to 6 places. */
export function fromBaseUnits(value: bigint, decimals: number): number {
  const d = Math.max(0, Math.min(36, Math.floor(Number(decimals) || 0)));
  const scale = 10n ** BigInt(d);
  const whole = value / scale;
  const frac = value % scale;
  const n = Number(whole) + Number(frac) / Number(scale);
  return Math.round(n * 1e6) / 1e6;
}

const line = (unit: string, address: string | null, decimals: number, raw: RawHolding): HoldingLine => {
  const total = fromBaseUnits(raw.balance, decimals);
  const held = fromBaseUnits(raw.deposited > raw.balance ? raw.balance : raw.deposited, decimals);
  return {
    unit,
    address,
    decimals,
    total,
    held,
    free: Math.max(0, Math.round((total - held) * 1e6) / 1e6),
    mine: raw.mine == null ? null : fromBaseUnits(raw.mine, decimals),
  };
};

/** The chain's own coin, named: ETH unless the chain says otherwise. */
export function nativeUnit(chainId: number | bigint | null | undefined): string {
  return describeChain(chainId)?.native ?? 'ETH';
}

/** Raw balances into lines a Fund view prints. */
export function foldHoldings(raw: RawHoldings): BundleHoldings {
  return {
    chainId: raw.chainId,
    native: line(nativeUnit(raw.chainId), null, 18, raw.native),
    tokens: raw.tokens.map(({ token, holding }) => line(token.symbol, token.address, token.decimals, holding)),
  };
}

/** Whether there is anything to show: a balance somewhere, or something held for the viewer. */
export function holdsAnything(holdings: BundleHoldings | null | undefined): boolean {
  if (!holdings) return false;
  return [holdings.native, ...holdings.tokens].some((l) => l.total > 0 || (l.mine ?? 0) > 0);
}

/** The lines worth a row: a unit with a balance, or one held for the viewer. */
export function holdingLines(holdings: BundleHoldings | null | undefined): HoldingLine[] {
  if (!holdings) return [];
  return [holdings.native, ...holdings.tokens].filter((l) => l.total > 0 || (l.mine ?? 0) > 0);
}

/** `12.5 EVO`, trimmed: no trailing zeros, at most 6 places. */
export function formatHolding(value: number, unit: string): string {
  const n = Math.round(value * 1e6) / 1e6;
  const s = Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return `${s} ${unit}`;
}
