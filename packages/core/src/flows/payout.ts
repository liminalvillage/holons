// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a party is paid — the address a rights row carries.
 *
 * A row of the table names a payout address, and the Pot pays nowhere else.
 * The address is the party's own word: it lives on the party's own settings
 * document (`settings.payout`), which only the party's key — or, for a
 * Telegram id, the bot on their behalf — writes. It takes effect at the
 * next new moon, like everything the table carries; until then a party with
 * no address accrues and cannot collect.
 *
 * A holon that keeps part of its share (a `retained` or `kept` leaf) is paid
 * into its own Pot when it has one on the same chain, so the value lands in
 * its pool and is divided by its own table next moon; a holon with no Pot is
 * paid like anyone else, at its `payout` address.
 */

import { readPotRecord } from './bundle.js';
import { normalizeAddress } from './rights.js';

/** Settings field holding a party's payout address. */
export const PAYOUT_KEY = 'payout';

export interface PayoutRecord {
  address: string;
  /** When it was set (ms). */
  setAt?: number;
}

/** The payout address a settings document carries, or null. */
export function readPayoutAddress(settings: unknown): string | null {
  const doc = (settings ?? {}) as Record<string, unknown>;
  const p = (doc[PAYOUT_KEY] ?? {}) as Record<string, unknown>;
  return normalizeAddress(p.address);
}

/** Persist the party's payout address, merged onto their canonical settings document. */
export async function savePayoutAddress(holosphere: any, partyId: string, address: string | null): Promise<void> {
  const id = String(partyId ?? '');
  if (!id) throw new Error('A party id is required');
  const clean = address == null || address === '' ? null : normalizeAddress(address);
  if (address != null && address !== '' && !clean) throw new Error('A payout address is a 0x address');
  let existing: any = null;
  try {
    existing = await holosphere.get(id, 'settings', id);
  } catch {
    // A failed read must not lose the address: write it alone rather than dropping it.
  }
  const { [PAYOUT_KEY]: _old, ...rest } = (existing ?? {}) as Record<string, unknown>;
  await holosphere.put(id, 'settings', {
    ...rest,
    id,
    ...(clean ? { [PAYOUT_KEY]: { address: clean, setAt: Date.now() } satisfies PayoutRecord } : {}),
  });
}

/**
 * The address a party is paid at on `chainId`: its own Pot when it has one
 * there, else its payout address, else null.
 */
export function payoutAddressOf(settings: unknown, chainId: number): string | null {
  const pot = readPotRecord(settings);
  if (pot && pot.chainId === Math.floor(Number(chainId))) return pot.address;
  return readPayoutAddress(settings);
}

export const DEFAULT_PAYOUT_CONCURRENCY = 4;

/** Party → payout address on `chainId`, read quietly: a party whose document has not arrived has none yet. */
export async function loadPayoutAddresses(
  holosphere: any,
  parties: readonly string[],
  chainId: number,
  opts: { concurrency?: number } = {},
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  const ids = [...new Set(parties.map((p) => String(p ?? '')).filter(Boolean))];
  if (!holosphere) return Object.fromEntries(ids.map((id) => [id, null]));
  const limit = Math.max(1, Math.floor(opts.concurrency ?? DEFAULT_PAYOUT_CONCURRENCY));
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        out[id] = payoutAddressOf(await holosphere.get(id, 'settings', id), chainId);
      } catch {
        out[id] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, ids.length) }, worker));
  return out;
}
