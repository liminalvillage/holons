// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Mutual credit: the shared-expense ledger read as who owes whom.
 *
 * `balance.ts` builds the credit matrix. This module turns that matrix into
 * the things a person actually wants to see and do — the pairwise debts as
 * recorded, the fewest transfers that would square everyone, and a way to
 * record that a transfer happened.
 *
 * A settlement is deliberately NOT a new record type. It is an expense the
 * debtor "paid" and the creditor alone "shares": run through the same matrix
 * as every other expense it cancels the debt exactly, every UI that already
 * reads the expenses lens (the bot's /balance included) sees it without
 * changes, and the `kind` field only says what it is so lists can label it.
 *
 * Everything here is pure; callers persist what they get back.
 */

import { transportPlan } from '../inventory/transport.js';
import { coerceSplitWith, computeBalances, normalizeCurrency } from './balance.js';
import type { AgentId, Expense, User, UserBalance } from './types.js';

/** Amounts below this are rounding, not money. */
const DUST = 0.005;

/** One debt: `from` owes `to` `amount` in the currency it was computed for. */
export interface CreditPair {
  from: AgentId;
  to: AgentId;
  /** Always > 0. */
  amount: number;
}

/** A holon's mutual-credit position in one currency. */
export interface MutualCredit {
  /** Normalized currency the numbers are in. */
  currency: string;
  /** Same order as the matrix axes. */
  userIds: AgentId[];
  /** Net position per user: positive is owed, negative owes. */
  balances: UserBalance[];
  /** Pairwise debts as they stand, largest first. */
  pairs: CreditPair[];
  /** The fewest transfers that would square everyone, largest first. */
  plan: CreditPair[];
  /**
   * The transfers that square everyone while following the recorded debts
   * as far as the money allows: pay whom you actually owe, then whom they
   * owe. Usually more transfers than `plan`, never a stranger when a chain
   * of debts exists. Largest first.
   */
  knownPlan: CreditPair[];
  /** Sum of every ordinary expense in this currency — settlements excluded. */
  volume: number;
  /** How many ordinary expenses that sum covers. */
  count: number;
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Read a credit matrix as a list of debts.
 *
 * `matrix[i][j] > 0` means user i is owed by user j — so j owes i. Each pair
 * appears once, in the direction the money would move.
 */
export function creditPairs(matrix: number[][], userIds: AgentId[]): CreditPair[] {
  const pairs: CreditPair[] = [];
  for (let i = 0; i < userIds.length; i++) {
    for (let j = 0; j < userIds.length; j++) {
      if (i === j) continue;
      const owed = matrix[i]?.[j] ?? 0;
      if (owed > DUST) pairs.push({ from: userIds[j], to: userIds[i], amount: round(owed) });
    }
  }
  return pairs.sort((a, b) => b.amount - a.amount);
}

/**
 * What one unit of money costs to move from `from` to `to` in a settle-up
 * plan. `Infinity` forbids the transfer. See `debtCost` for the one the
 * ledger itself suggests; a caller may bring its own (same holon, same bank,
 * whatever "settling with people you know" means to it).
 */
export type SettlementCost = (from: AgentId, to: AgentId) => number;

/**
 * Cost by distance along the recorded debts: paying someone you owe costs 1,
 * paying someone they owe costs 2, and so on down the chain; a pair with no
 * chain of debts between them costs more than any chain could (one more
 * than the number of people in debt), so the plan still squares everyone
 * but reaches for a stranger only when no debt leads anywhere useful.
 *
 * When the debts and the balances come from the same ledger the fallback
 * is never needed: the set a debtor can reach is closed under "owes", so
 * its balances sum to what flows in from outside, which is ≥ 0 — the
 * creditors in it can absorb every debtor in it. It is there so rounding
 * at the dust threshold cannot leave anyone unsettled.
 */
export function debtCost(pairs: CreditPair[]): SettlementCost {
  const owesTo = new Map<string, Set<string>>();
  const people = new Set<string>();
  for (const p of pairs ?? []) {
    const from = String(p.from);
    const to = String(p.to);
    people.add(from);
    people.add(to);
    if (!owesTo.has(from)) owesTo.set(from, new Set());
    owesTo.get(from)!.add(to);
  }
  const stranger = people.size + 1;
  const memo = new Map<string, Map<string, number>>();
  const hopsFrom = (start: string): Map<string, number> => {
    const cached = memo.get(start);
    if (cached) return cached;
    const dist = new Map<string, number>([[start, 0]]);
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const u = queue[head];
      for (const v of owesTo.get(u) ?? []) {
        if (dist.has(v)) continue;
        dist.set(v, dist.get(u)! + 1);
        queue.push(v);
      }
    }
    memo.set(start, dist);
    return dist;
  };
  return (from, to) => {
    const a = String(from);
    const b = String(to);
    if (a === b) return 0;
    return hopsFrom(a).get(b) ?? stranger;
  };
}

/**
 * Transfers that settle every balance.
 *
 * Without a cost, the fewest of them: the largest debtor pays the largest
 * creditor as much as either can take, and whoever is left with a
 * remainder goes again. This never needs more than n−1 transfers and is
 * what people do around a table.
 *
 * With a cost, the cheapest of them: debtors are sources, creditors are
 * sinks, and Kantorovich's transportation problem picks the legs. The
 * total moved is the same either way — every creditor is paid in full —
 * only who pays whom changes.
 */
export function settlementPlan(balances: UserBalance[], cost?: SettlementCost): CreditPair[] {
  const creditors = balances
    .filter((b) => b.net > DUST)
    .map((b) => ({ id: b.userId, left: b.net }))
    .sort((a, b) => b.left - a.left);
  const debtors = balances
    .filter((b) => b.net < -DUST)
    .map((b) => ({ id: b.userId, left: -b.net }))
    .sort((a, b) => b.left - a.left);

  if (cost) {
    const byKey = new Map<string, AgentId>();
    for (const x of [...creditors, ...debtors]) byKey.set(String(x.id), x.id);
    return transportPlan(
      debtors.map((d) => ({ id: String(d.id), supply: d.left })),
      creditors.map((c) => ({ id: String(c.id), demand: c.left })),
      (from, to) => cost(byKey.get(from) ?? from, byKey.get(to) ?? to),
    )
      .map((leg) => ({ from: byKey.get(leg.from) ?? leg.from, to: byKey.get(leg.to) ?? leg.to, amount: round(leg.quantity) }))
      .filter((p) => p.amount > DUST)
      .sort((a, b) => b.amount - a.amount);
  }

  const plan: CreditPair[] = [];
  let c = 0;
  let d = 0;
  while (c < creditors.length && d < debtors.length) {
    const creditor = creditors[c];
    const debtor = debtors[d];
    const amount = Math.min(creditor.left, debtor.left);
    if (amount > DUST) plan.push({ from: debtor.id, to: creditor.id, amount: round(amount) });
    creditor.left -= amount;
    debtor.left -= amount;
    if (creditor.left <= DUST) c++;
    if (debtor.left <= DUST) d++;
  }
  return plan.sort((a, b) => b.amount - a.amount);
}

/**
 * The group's standing in one currency, read as one number and a few counts —
 * the mutual-credit equivalent of a bank statement's closing line.
 *
 * `outstanding` is the credit in circulation: everything the creditors are
 * owed, net. It equals what the debtors owe (the matrix balances to zero), so
 * one figure describes the whole group. `gross` sums the pairwise debts as
 * recorded and is never smaller — A owing B who owes C nets down, and the gap
 * between the two is what the settle-up plan saves.
 */
export interface CreditSummary {
  /** Normalized currency the numbers are in. */
  currency: string;
  /** Net credit outstanding: the sum of every positive balance. */
  outstanding: number;
  /** Sum of the pairwise debts as recorded. >= outstanding. */
  gross: number;
  /** How many are owed, how many owe, how many are square. */
  creditors: number;
  debtors: number;
  square: number;
  /** Pairwise debts open, and the fewest transfers that would square them. */
  openDebts: number;
  transfers: number;
  /** The single largest debt, or null when nothing is open. */
  largest: CreditPair | null;
  /** Ordinary spending this credit came from — settlements excluded. */
  volume: number;
  count: number;
}

/** Sum a group's mutual credit up into its closing line. */
export function summarizeMutualCredit(credit: MutualCredit): CreditSummary {
  let outstanding = 0;
  let creditors = 0;
  let debtors = 0;
  let square = 0;
  for (const b of credit.balances) {
    if (b.net > DUST) {
      outstanding += b.net;
      creditors++;
    } else if (b.net < -DUST) {
      debtors++;
    } else {
      square++;
    }
  }
  const gross = credit.pairs.reduce((sum, p) => sum + p.amount, 0);
  return {
    currency: credit.currency,
    outstanding: round(outstanding),
    gross: round(gross),
    creditors,
    debtors,
    square,
    openDebts: credit.pairs.length,
    transfers: credit.plan.length,
    largest: credit.pairs[0] ?? null,
    volume: credit.volume,
    count: credit.count,
  };
}

/** True for a repayment recorded through `createSettlement`. */
export function isSettlement(expense: Pick<Expense, 'kind'> | null | undefined): boolean {
  return expense?.kind === 'settlement';
}

/** Input for `createSettlement`. */
export interface CreateSettlementInput {
  id: AgentId;
  /** Who paid — the debtor. */
  from: AgentId;
  /** Who was paid — the creditor. */
  to: AgentId;
  amount: number;
  currency: string;
  description?: string;
  /** Override creation timestamp (ms since epoch). Mostly for tests. */
  now?: number;
}

/**
 * Record that `from` paid `to` back.
 *
 * Returns `null` for a non-positive amount or a self-payment, the same
 * contract as `createExpense`.
 */
export function createSettlement(input: CreateSettlementInput): Expense | null {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (String(input.from) === String(input.to)) return null;
  const currency = normalizeCurrency(input.currency);
  if (!currency) return null;

  return {
    id: input.id,
    created: new Date(input.now ?? Date.now()).toISOString(),
    amount: round(amount),
    currency,
    description: String(input.description ?? 'Settled up'),
    paidBy: input.from,
    splitWith: [input.to],
    picture: null,
    kind: 'settlement',
  };
}

/** Every id that pays or shares any expense, once, as strings, first seen first. */
export function participantIds(expenses: Expense[]): string[] {
  const ids = new Set<string>();
  for (const e of expenses) {
    if (!e) continue;
    if (e.paidBy != null && String(e.paidBy)) ids.add(String(e.paidBy));
    for (const id of coerceSplitWith(e.splitWith)) {
      if (id != null && String(id)) ids.add(String(id));
    }
  }
  return [...ids];
}

/**
 * The currency an expense is in, normalized. Older time-tracking records
 * carried the unit as `unit` rather than `currency`.
 */
export function expenseCurrency(expense: Expense | null | undefined): string {
  return normalizeCurrency(expense?.currency || expense?.unit || '');
}

/** Every currency the expenses use, normalized, in first-seen order. */
export function expenseCurrencies(expenses: Expense[]): string[] {
  const seen = new Set<string>();
  for (const e of expenses) {
    const c = expenseCurrency(e);
    if (c) seen.add(c);
  }
  return [...seen];
}

/**
 * The whole position in one currency: balances, debts, the settle-up plan
 * and how much was actually spent.
 *
 * `users` decides who appears; pass the roster you want in the picture (the
 * users lens plus `participantIds`, typically). Ids in expenses but not in
 * `users` are skipped by the matrix, exactly as the bot skips them.
 */
export function computeMutualCredit(
  expenses: Expense[],
  users: User[],
  currency: string,
): MutualCredit {
  const wanted = normalizeCurrency(currency);
  if (!wanted || users.length === 0) {
    return {
      currency: wanted,
      userIds: [],
      balances: [],
      pairs: [],
      plan: [],
      knownPlan: [],
      volume: 0,
      count: 0,
    };
  }

  // The matrix only looks at `currency`; fold the legacy `unit` in first.
  const normalized = expenses
    .filter(Boolean)
    .map((e) => (e.currency ? e : { ...e, currency: expenseCurrency(e) }));

  const { creditMatrix, userIds, balances } = computeBalances(normalized, users, wanted);
  const spent = normalized.filter((e) => expenseCurrency(e) === wanted && !isSettlement(e));
  const pairs = creditPairs(creditMatrix, userIds);

  return {
    currency: wanted,
    userIds,
    balances: balances.map((b) => ({ ...b, net: round(b.net) })),
    pairs,
    plan: settlementPlan(balances),
    knownPlan: settlementPlan(balances, debtCost(pairs)),
    volume: round(spent.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)),
    count: spent.length,
  };
}
