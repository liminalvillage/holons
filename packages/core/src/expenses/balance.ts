// Pure balance computation for shared expenses.
//
// All functions are deterministic and side-effect free; storage and i18n are
// caller responsibilities. Behaviour mirrors the bot's
// `Expenses.calculateCredits` / `getUserCurrencyBalance` and the web's
// `expenseCalculations.calculateCurrencyBalance`.
import type { AgentId, BalancesResult, Expense, User, UserBalance } from './types.js';

/**
 * Lowercase, strip a trailing 's' (naive de-pluralization) and remove any
 * non-letter characters. Matches both the bot and the web normalization rules
 * so that expenses recorded via either UI compare equal.
 */
export function normalizeCurrency(currency: string | null | undefined): string {
  if (!currency || typeof currency !== 'string') return '';
  return currency.toLowerCase().replace(/s$/, '').replace(/[^a-z]/g, '');
}

/**
 * Coerce a stored `splitWith` value into an array. Older records sometimes
 * store a single id as a number/string, or a JSON-encoded string.
 */
export function coerceSplitWith(value: unknown): AgentId[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value as AgentId[];
  if (typeof value === 'number') return [value];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as AgentId[]) : [parsed as AgentId];
    } catch {
      return [value];
    }
  }
  return [];
}

/**
 * Build the NxN credit matrix for `currency` over `expenses`.
 *
 * Convention: `matrix[payer][debtor] += share` and the inverse is decremented,
 * so summing a user's row yields their net position (positive = others owe
 * them, negative = they owe others).
 *
 * - Expenses in other currencies are skipped.
 * - `allowedCurrencies`, when non-empty, gates which currencies count.
 * - Expenses whose payer is unknown are skipped.
 * - Self-shares (payer in their own splitWith) are not double-counted.
 */
export function computeCreditMatrix(
  expenses: Expense[],
  users: User[],
  currency: string,
  allowedCurrencies: string[] = []
): { creditMatrix: number[][]; userIds: AgentId[] } {
  const userIds = users.map((u) => u.id);
  if (userIds.length === 0) return { creditMatrix: [], userIds: [] };

  const normalizedCurrency = normalizeCurrency(currency);
  if (!normalizedCurrency) return { creditMatrix: [], userIds };

  const indexById = new Map<string, number>(userIds.map((id, i) => [String(id), i]));
  const matrix: number[][] = userIds.map(() => new Array(userIds.length).fill(0));

  for (const expense of expenses) {
    if (!expense) continue;
    const expenseCurrency = normalizeCurrency(expense.currency);
    if (expenseCurrency !== normalizedCurrency) continue;
    if (allowedCurrencies.length > 0 && !allowedCurrencies.includes(expenseCurrency)) continue;

    const payerIdx = indexById.get(String(expense.paidBy)) ?? -1;
    if (payerIdx === -1) continue;

    const splitWith = coerceSplitWith(expense.splitWith);
    const share = expense.amount / (splitWith.length > 0 ? splitWith.length : 1);

    for (const memberId of splitWith) {
      const memberIdx = indexById.get(String(memberId)) ?? -1;
      if (memberIdx === -1 || memberIdx === payerIdx) continue;
      matrix[payerIdx][memberIdx] += share;
      matrix[memberIdx][payerIdx] -= share;
    }
  }

  return { creditMatrix: matrix, userIds };
}

/**
 * Compute net per-user balances for a currency. The credit matrix is also
 * returned so callers (e.g. the bot's image renderer) can show pairwise debts
 * without recomputing.
 */
export function computeBalances(
  expenses: Expense[],
  users: User[],
  currency: string,
  allowedCurrencies: string[] = []
): BalancesResult {
  const { creditMatrix, userIds } = computeCreditMatrix(expenses, users, currency, allowedCurrencies);
  const balances: UserBalance[] = userIds.map((userId, i) => ({
    userId,
    net: creditMatrix[i].reduce((sum, val) => sum + val, 0),
  }));
  return { creditMatrix, userIds, balances };
}

/**
 * Net balance for a single user using the bot's payer/sharer accounting. This
 * does not require a full user list — useful for "what do I owe?" lookups.
 *
 * Sign matches `computeBalances`: positive = user is owed; negative = owes.
 */
export function computeUserCurrencyBalance(
  expenses: Expense[],
  userId: AgentId,
  currency: string
): number {
  const normalizedCurrency = normalizeCurrency(currency);
  if (!normalizedCurrency || !expenses?.length) return 0;

  const userKey = String(userId);
  let net = 0;
  for (const expense of expenses) {
    if (!expense || normalizeCurrency(expense.currency) !== normalizedCurrency) continue;

    const splitWith = coerceSplitWith(expense.splitWith);
    const share = expense.amount / (splitWith.length > 0 ? splitWith.length : 1);
    const userInSplit = splitWith.some((id) => String(id) === userKey);
    const isPayer = String(expense.paidBy) === userKey;

    if (isPayer) {
      net += expense.amount;
      if (userInSplit) net -= share;
    } else if (userInSplit) {
      net -= share;
    }
  }
  return net;
}

// Aliases kept to match the smoke-test contract (`computeBalances` OR
// `calculateBalance`) and the existing web utility's naming.
export const calculateBalance = computeUserCurrencyBalance;
export const calculateCreditMatrix = computeCreditMatrix;
