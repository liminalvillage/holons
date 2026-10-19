// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One party's money, as a statement: what it can take out now, what it has
 * asked for, what it was paid, and what is still gathering — per unit, with
 * the line each figure comes from.
 *
 * A party's money sits in two kinds of place, and a unit is only ever in one
 * of them per holon:
 *
 *   chain — a seat in a Pot contract. Collected by the party's row, to the
 *           address the table committed (`potAccount`).
 *   log   — a right over a holon's fund, drawn by a claim in `flow_claims`
 *           that an attester pays and records (`claimHeadroom`).
 *
 * Units never convert, so there is one balance per unit and no grand total.
 * Pure: lines in, balances out.
 */

import type { ClaimRail, ClaimTotals } from './claims.js';
import { normalizeCurrency } from '../expenses/index.js';
import type { PotAccount } from './pot-account.js';

export type AccountPlace = 'chain' | 'log';

export interface AccountLine {
  /** The holon whose Pot or fund holds the money. */
  holon: string;
  unit: string;
  place: AccountPlace;
  /** Can be taken out now: collectable on chain, headroom in the log. */
  available: number;
  /** Asked for and not yet paid. Always zero on chain. */
  pending: number;
  /** Paid out so far. */
  paid: number;
  /** Arrived since the last cut: not owed yet. Always zero in the log. */
  accruing: number;
  /** The token's contract address, on chain. */
  token?: string;
}

export interface AccountBalance {
  unit: string;
  available: number;
  pending: number;
  paid: number;
  accruing: number;
  /** Everything the unit has brought and is bringing. */
  total: number;
  lines: AccountLine[];
}

const unitKey = (u: unknown) => normalizeCurrency(String(u ?? '')).toUpperCase();
const amount = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** A Pot seat as a statement line. */
export function potLine(input: { holon: string; unit: string; token?: string; account: PotAccount }): AccountLine {
  return {
    holon: String(input.holon),
    unit: unitKey(input.unit),
    place: 'chain',
    available: amount(input.account.collectable),
    pending: 0,
    paid: amount(input.account.collected),
    accruing: amount(input.account.accruing),
    ...(input.token ? { token: input.token } : {}),
  };
}

/** A right over a holon's fund as a statement line: the headroom, and what the log holds. */
export function logLine(input: {
  holon: string;
  unit: string;
  /** `claimHeadroom(...)`; null when no ceiling is known. */
  headroom: number | null | undefined;
  totals?: Partial<ClaimTotals> | null;
}): AccountLine {
  const t = input.totals ?? {};
  return {
    holon: String(input.holon),
    unit: unitKey(input.unit),
    place: 'log',
    available: amount(input.headroom),
    pending: amount(t.claimed) + amount(t.pending),
    paid: amount(t.settled),
    accruing: 0,
  };
}

const lineTotal = (l: Pick<AccountLine, 'available' | 'pending' | 'paid' | 'accruing'>) =>
  l.available + l.pending + l.paid + l.accruing;

/**
 * The lines gathered into one balance per unit. Empty lines are dropped. The
 * unit with something to take out comes first, then the one that has brought
 * the most; inside a unit the fullest line leads.
 */
export function accountBalances(lines: Iterable<AccountLine>): AccountBalance[] {
  const byUnit = new Map<string, AccountBalance>();
  for (const line of lines) {
    if (!line.unit || !(lineTotal(line) > 0)) continue;
    const b = byUnit.get(line.unit) ?? { unit: line.unit, available: 0, pending: 0, paid: 0, accruing: 0, total: 0, lines: [] };
    b.available += line.available;
    b.pending += line.pending;
    b.paid += line.paid;
    b.accruing += line.accruing;
    b.total += lineTotal(line);
    b.lines.push(line);
    byUnit.set(line.unit, b);
  }
  const out = [...byUnit.values()];
  for (const b of out) b.lines.sort((a, z) => z.available - a.available || lineTotal(z) - lineTotal(a) || a.holon.localeCompare(z.holon));
  return out.sort(
    (a, z) =>
      Number(z.available > 0) - Number(a.available > 0) || z.total - a.total || a.unit.localeCompare(z.unit),
  );
}

/** Why a rail is closed, as a code the surface puts into words. */
export type RailReason =
  /** No payout address is set. */
  | 'no-wallet'
  /** The unit sits in a Pot: only the Pot can pay it, to the wallet. */
  | 'on-chain'
  /** The holon has linked no collective. */
  | 'no-collective'
  /** The collective holds another currency. */
  | 'other-currency'
  /** Nothing to take out on this line. */
  | 'empty';

export interface RailOption {
  rail: ClaimRail;
  enabled: boolean;
  reason?: RailReason;
  /**
   * `collect` — the party sends the Pot's claim itself, now.
   * `request` — a claim goes on the log and the holon's attesters pay it.
   */
  mode: 'collect' | 'request';
}

/**
 * The four ways out for one line. On chain there is one: the wallet. In the
 * log the wallet is a request to be paid there, and the other three open
 * when the holon's collective holds this very currency.
 */
export function claimRails(input: {
  line: Pick<AccountLine, 'unit' | 'place' | 'available'>;
  /** The party's payout address, when it set one. */
  payoutAddress?: string | null;
  /** The collective linked to the line's holon. */
  collective?: { slug: string; currency: string } | null;
}): RailOption[] {
  const { line } = input;
  const chain = line.place === 'chain';
  const empty = !(line.available > 0);
  const wallet: RailOption = { rail: 'wallet', mode: chain ? 'collect' : 'request', enabled: false };
  if (empty) wallet.reason = 'empty';
  else if (!input.payoutAddress) wallet.reason = 'no-wallet';
  else wallet.enabled = true;

  const slug = String(input.collective?.slug ?? '').trim();
  let closed: RailReason | null = null;
  if (empty) closed = 'empty';
  else if (chain) closed = 'on-chain';
  else if (!slug) closed = 'no-collective';
  else if (unitKey(input.collective?.currency) !== unitKey(line.unit)) closed = 'other-currency';
  const viaCollective = (['opencollective', 'paypal', 'bank'] as const).map(
    (rail): RailOption => ({ rail, mode: 'request', enabled: closed == null, ...(closed ? { reason: closed } : {}) }),
  );
  return [wallet, ...viaCollective];
}
