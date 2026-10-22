// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reading a party's wallet off the store — for the surfaces that hold no
 * board in memory (the bot, the MCP). Walks the same lenses
 * `loadClaimCeilings` walks, adds the expenses lens as mutual credit, and
 * hands `buildWallet` the same shapes the kiosk and the web derive, so the
 * lines agree wherever they are printed.
 */

import { computeMutualCredit, expenseCurrencies, type Expense, type User } from '../expenses/index.js';
import { loadClaimCeilings, type LoadClaimCeilingsOptions } from './ceiling-load.js';
import type { FoldedClaims } from './claims.js';
import { buildWallet, type WalletLine } from './wallet.js';

export interface LoadWalletOptions extends Omit<LoadClaimCeilingsOptions, 'claims'> {
  /** The judged fold, when the surface already has one; the lines then carry `claimable`. */
  claims?: FoldedClaims | null;
  /** The holon's users, for the mutual-credit roster; default reads the lens. */
  users?: User[] | null;
}

export interface LoadedWallet {
  lines: WalletLine[];
  /** Unit → pot, as the ceilings read it. */
  pots: Record<string, number>;
  truncated: boolean;
}

/** The wallet of `partyId` over `holonId`'s fund and ledger, read from the store. */
export async function loadWallet(
  holosphere: any,
  holonId: string,
  partyId: string,
  opts: LoadWalletOptions = {},
): Promise<LoadedWallet> {
  const holon = String(holonId ?? '');
  const party = String(partyId ?? '');
  if (!holosphere || !holon || !party) return { lines: [], pots: {}, truncated: false };
  const quiet = <T>(p: Promise<T>, fallback: T): Promise<T> => p.then((v) => v ?? fallback).catch(() => fallback);

  const [expenses, users] = await Promise.all([
    opts.expenses !== undefined ? Promise.resolve(opts.expenses ?? []) : quiet<Expense[]>(holosphere.getAll(holon, 'expenses'), []),
    opts.users !== undefined ? Promise.resolve(opts.users ?? []) : quiet<User[]>(holosphere.getAll(holon, 'users'), []),
  ]);
  const loaded = await loadClaimCeilings(holosphere, holon, { ...opts, claims: opts.claims ?? null, expenses });
  const roster = (users ?? []).filter((u) => u && u.id != null && String(u.id) !== holon);
  const credit = expenseCurrencies(expenses ?? []).map((c) => computeMutualCredit(expenses ?? [], roster, c));

  const lines = buildWallet({
    partyId: party,
    shares: loaded.shares,
    sources: loaded.sources,
    usage: loaded.usage,
    credit,
    held: loaded.held,
    ceilings: loaded.ceilings,
    claims: opts.claims ?? null,
  });
  return { lines, pots: loaded.pots, truncated: loaded.truncated };
}
