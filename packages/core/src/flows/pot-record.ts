// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The holon's Pot on its settings document: where it is, what it is read in,
 * and the treasury that feeds it.
 *
 * A Pot (`Pot.sol`) is the distribution machine: it holds what it was given,
 * counts it, and pays each party what the lunation's rights table says. A
 * TREASURY is where the holon keeps value before it decides to distribute
 * it — a Safe under the owners' threshold, or any address. Moving a
 * lunation's income from the treasury into the Pot is the owners' one
 * decision; from there the cycle runs by the table. The treasury never
 * appears in the log: the Pot's own receipts are the income the table is
 * cut from, so what the owners keep back is simply not yet income.
 *
 * `tokens` are the ERC-20s the Pot is read in besides the chain's own coin
 * (the EVO voucher, say). A token not listed still flows; it is just not
 * shown or divided until it is.
 *
 * Everything lands on the canonical settings document by read-merge-write
 * with the `id` stamp — a bare put would fork a new record (see git
 * history of the former `bundle.ts` for the bug that taught this).
 */

/** Settings field holding the deployed Pot. */
export const POT_KEY = 'pot';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const isAddress = (value: unknown): value is string => typeof value === 'string' && ADDRESS.test(value);

/** A token the Pot is read in. */
export interface PotToken {
  address: string;
  symbol: string;
  decimals: number;
  name?: string;
}

/** Where the holon keeps value before it is distributed. */
export interface TreasuryRecord {
  address: string;
  /** A Safe (threshold of owners) or a plain address. */
  kind: 'safe' | 'address';
  setAt?: number;
}

/** How far the new-moon cut walks the cascade below this Pot. */
export interface PotWalk {
  /** Settings reads allowed in total (`DEFAULT_RIGHTS_HOLONS` when unset). */
  holons?: number;
  /** Hops followed below the root (`DEFAULT_CASCADE_DEPTH` when unset). */
  depth?: number;
  /** Nodes the resolved tree may hold (default: 20 per holon read). */
  nodes?: number;
}

/** The deployed Pot of a holon. */
export interface PotRecord {
  address: string;
  chainId: number;
  /** Seconds a posted root waits before it pays, as deployed. */
  challenge?: number;
  deployedAt?: number;
  txHash?: string;
  /**
   * The contract's owner, lower-cased — the one key that can veto a root
   * and replace the signers. A Safe, if "no single key" is to hold.
   */
  owner?: string;
  /** The ERC-20s the Pot is read in, one per address. */
  tokens: PotToken[];
  /** The treasury that feeds the Pot, on the same chain. */
  treasury?: TreasuryRecord;
  /** Bounds for the cut's walk, for a cascade wider than the defaults. */
  walk?: PotWalk;
}

/** A stored walk made whole, or null when it sets nothing. */
export function normalizePotWalk(raw: unknown): PotWalk | null {
  const w = (raw ?? {}) as Record<string, unknown>;
  const int = (v: unknown) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const holons = int(w.holons);
  const depth = int(w.depth);
  const nodes = int(w.nodes);
  if (holons == null && depth == null && nodes == null) return null;
  return { ...(holons != null ? { holons } : {}), ...(depth != null ? { depth } : {}), ...(nodes != null ? { nodes } : {}) };
}

/** A stored token entry made whole, or null when it cannot be used. */
export function normalizePotToken(raw: unknown): PotToken | null {
  const t = (raw ?? {}) as Record<string, unknown>;
  if (!isAddress(t.address)) return null;
  const symbol = String(t.symbol ?? '').trim();
  if (!symbol) return null;
  const decimals = Number(t.decimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const name = typeof t.name === 'string' && t.name.trim() ? t.name.trim() : undefined;
  return { address: t.address, symbol, decimals, ...(name ? { name } : {}) };
}

/** The tokens a list carries, cleaned, one per address. */
export function readPotTokens(record: { tokens?: unknown } | null | undefined): PotToken[] {
  const seen = new Set<string>();
  const out: PotToken[] = [];
  for (const raw of Array.isArray(record?.tokens) ? record.tokens : []) {
    const token = normalizePotToken(raw);
    if (!token) continue;
    const key = token.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

/** A stored treasury made whole, or null. */
export function normalizeTreasury(raw: unknown): TreasuryRecord | null {
  const t = (raw ?? {}) as Record<string, unknown>;
  if (!isAddress(t.address)) return null;
  const setAt = Number(t.setAt);
  return {
    address: t.address.toLowerCase(),
    kind: t.kind === 'address' ? 'address' : 'safe',
    ...(Number.isFinite(setAt) ? { setAt } : {}),
  };
}

/** A stored Pot entry made whole, or null when it cannot be used. */
export function normalizePotRecord(raw: unknown): PotRecord | null {
  const p = (raw ?? {}) as Record<string, unknown>;
  if (!isAddress(p.address)) return null;
  const chainId = Number(p.chainId);
  if (!Number.isInteger(chainId) || chainId <= 0) return null;
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const challenge = num(p.challenge);
  const deployedAt = num(p.deployedAt);
  const treasury = normalizeTreasury(p.treasury);
  const walk = normalizePotWalk(p.walk);
  return {
    address: p.address.toLowerCase(),
    chainId,
    ...(challenge != null ? { challenge } : {}),
    ...(deployedAt != null ? { deployedAt } : {}),
    ...(p.txHash != null ? { txHash: String(p.txHash) } : {}),
    ...(isAddress(p.owner) ? { owner: p.owner.toLowerCase() } : {}),
    tokens: readPotTokens(p as { tokens?: unknown }),
    ...(treasury ? { treasury } : {}),
    ...(walk ? { walk } : {}),
  };
}

/** The holon's Pot as stored on the canonical settings document, or null. */
export function readPotRecord(settings: unknown): PotRecord | null {
  const doc = (settings ?? {}) as Record<string, unknown>;
  return normalizePotRecord(doc[POT_KEY]);
}

/** The deployed Pot for a holon: one keyed lookup, no wallet, no contract call. */
export async function loadPotRecord(holosphere: any, holonId: string): Promise<PotRecord | null> {
  if (!holosphere || !holonId) return null;
  try {
    return readPotRecord(await holosphere.get(String(holonId), 'settings', String(holonId)));
  } catch {
    return null;
  }
}

/** Persist the Pot, merged onto the canonical settings document. */
export async function savePotRecord(holosphere: any, holonId: string, pot: PotRecord): Promise<PotRecord> {
  const clean = normalizePotRecord(pot);
  if (!clean) throw new Error('A Pot needs a 0x address and a chain id');
  let existing: any = null;
  try {
    existing = await holosphere.get(String(holonId), 'settings', String(holonId));
  } catch {
    // A failed read must not lose the deploy: write the Pot alone rather than dropping it.
  }
  await holosphere.put(String(holonId), 'settings', { ...(existing ?? {}), id: String(holonId), [POT_KEY]: clean });
  return clean;
}

/** The record with `token` listed, replacing an entry at the same address. */
export function withPotToken(record: PotRecord, token: PotToken): PotRecord {
  const clean = normalizePotToken(token);
  if (!clean) throw new Error('A token needs a 0x address, a symbol and its decimals');
  const rest = readPotTokens(record).filter((t) => t.address.toLowerCase() !== clean.address.toLowerCase());
  return { ...record, tokens: [...rest, clean] };
}

/** The record without the token at `address`. */
export function withoutPotToken(record: PotRecord, address: string): PotRecord {
  return { ...record, tokens: readPotTokens(record).filter((t) => t.address.toLowerCase() !== String(address).toLowerCase()) };
}

/** List a token on the holon's Pot, so every surface reads it from then on. Needs a Pot to hang it on. */
export async function addPotToken(holosphere: any, holonId: string, token: PotToken): Promise<PotRecord> {
  const record = await loadPotRecord(holosphere, holonId);
  if (!record) throw new Error('No Pot recorded for this holon yet');
  return savePotRecord(holosphere, holonId, withPotToken(record, token));
}

/** Drop a token from the holon's Pot. */
export async function removePotToken(holosphere: any, holonId: string, address: string): Promise<PotRecord> {
  const record = await loadPotRecord(holosphere, holonId);
  if (!record) throw new Error('No Pot recorded for this holon yet');
  return savePotRecord(holosphere, holonId, withoutPotToken(record, address));
}

/** Set (or clear, with null) how far the cut walks below the holon's Pot. */
export async function savePotWalk(holosphere: any, holonId: string, walk: PotWalk | null): Promise<PotRecord> {
  const record = await loadPotRecord(holosphere, holonId);
  if (!record) throw new Error('No Pot recorded for this holon yet');
  const { walk: _old, ...rest } = record;
  const clean = normalizePotWalk(walk);
  return savePotRecord(holosphere, holonId, clean ? { ...rest, walk: clean } : (rest as PotRecord));
}

/** Set (or clear, with null) the treasury that feeds the holon's Pot. */
export async function savePotTreasury(
  holosphere: any,
  holonId: string,
  treasury: { address: string; kind?: 'safe' | 'address' } | null,
): Promise<PotRecord> {
  const record = await loadPotRecord(holosphere, holonId);
  if (!record) throw new Error('No Pot recorded for this holon yet');
  const { treasury: _old, ...rest } = record;
  if (treasury == null) return savePotRecord(holosphere, holonId, rest as PotRecord);
  const clean = normalizeTreasury({ ...treasury, setAt: Date.now() });
  if (!clean) throw new Error('A treasury is a 0x address');
  return savePotRecord(holosphere, holonId, { ...rest, treasury: clean });
}
