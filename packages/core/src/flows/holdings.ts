// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Units on chain, read the same way on every surface: the chain's own coin
 * named by its chain, a base-unit amount as a number, and what a treasury
 * holds per unit.
 *
 * No ethers here (rule 2): the surfaces read raw balances with the ABI
 * fragments below and hand the bigints to `treasuryLines`. What a treasury
 * holds is NOT the pot the boards divide — value becomes income the moment
 * it reaches the Pot, not before — so these lines are shown beside the Pot
 * as the owners' reserve, never added to anything.
 */

import { describeChain } from './chain.js';
import type { PotToken } from './pot-record.js';

/** The ERC-20 words a surface needs to read a token and describe it. */
export const ERC20_META_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function name() view returns (string)',
] as const;

/** One unit's balance at an address, in that unit. */
export interface TreasuryLine {
  unit: string;
  /** The token's address; null for the chain's own coin. */
  address: string | null;
  decimals: number;
  balance: number;
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

/** The chain's own coin, named: ETH unless the chain says otherwise. */
export function nativeUnit(chainId: number | bigint | null | undefined): string {
  return describeChain(chainId)?.native ?? 'ETH';
}

/**
 * Raw balances into lines a panel prints: the coin first, then every listed
 * token, in the order listed. `balances` is keyed by lower-cased token
 * address, with `native` for the coin; a unit with no reading is 0.
 */
export function treasuryLines(
  chainId: number,
  tokens: readonly PotToken[],
  balances: { native?: bigint | null; tokens?: Record<string, bigint | null | undefined> } | null | undefined,
): TreasuryLine[] {
  const native = balances?.native ?? 0n;
  const out: TreasuryLine[] = [{ unit: nativeUnit(chainId), address: null, decimals: 18, balance: fromBaseUnits(native, 18) }];
  for (const t of tokens) {
    const raw = balances?.tokens?.[t.address.toLowerCase()] ?? balances?.tokens?.[t.address] ?? 0n;
    out.push({ unit: t.symbol, address: t.address, decimals: t.decimals, balance: fromBaseUnits(raw, t.decimals) });
  }
  return out;
}

/** `12.5 EVO`, trimmed: no trailing zeros, at most 6 places. */
export function formatHolding(value: number, unit: string): string {
  const n = Math.round(value * 1e6) / 1e6;
  const s = Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return `${s} ${unit}`;
}
