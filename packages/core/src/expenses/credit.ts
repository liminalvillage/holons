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
 * The fewest transfers that settle every balance.
 *
 * Greedy: the largest debtor pays the largest creditor as much as either can
 * take, and whoever is left with a remainder goes again. This never needs
 * more than n−1 transfers and is what people do around a table.
 */
export function settlementPlan(balances: UserBalance[]): CreditPair[] {
  const creditors = balances
    .filter((b) => b.net > DUST)
    .map((b) => ({ id: b.userId, left: b.net }))
    .sort((a, b) => b.left - a.left);
  const debtors = balances
    .filter((b) => b.net < -DUST)
    .map((b) => ({ id: b.userId, left: -b.net }))
    .sort((a, b) => b.left - a.left);

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

  return {
    currency: wanted,
    userIds,
    balances: balances.map((b) => ({ ...b, net: round(b.net) })),
    pairs: creditPairs(creditMatrix, userIds),
    plan: settlementPlan(balances),
    volume: round(spent.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)),
    count: spent.length,
  };
}
