// Thin facade over @holons/core/expenses.
//
// We keep this module so existing call sites (`Status.svelte`, `Expenses.svelte`)
// don't need to change shape: web stores expenses as a Gun-style
// Record<id, Expense> rather than the Expense[] core works with, and the
// legacy `unit` field needs to be folded into `currency` before delegating.
import {
  computeCreditMatrix,
  computeUserCurrencyBalance,
  normalizeCurrency as coreNormalizeCurrency,
  type Expense as CoreExpense,
  type User as CoreUser,
} from "@holons/core/expenses";

interface Expense {
  id: string;
  amount: number;
  currency: string;
  /** Legacy field used by older time-tracking entries; treated as `currency`. */
  unit?: string;
  description: string;
  paidBy: string;
  splitWith: string[];
  /** Canonical creation timestamp (ISO). */
  created: string;
}

interface User {
  id: number | string;
  first_name: string;
}

export function normalizeCurrency(c: string): string {
  return coreNormalizeCurrency(c);
}

/**
 * Returns the canonical currency code for an expense, preferring the
 * `currency` field and falling back to the legacy `unit` field used by
 * older time-tracking entries (currency: 'hour').
 */
export function expenseCurrency(e: Expense): string {
  return coreNormalizeCurrency((e?.currency || e?.unit || "") as string);
}

/**
 * Fold the legacy `unit` field into `currency` so core (which only inspects
 * `currency`) sees the same value `expenseCurrency()` would return.
 */
function toCoreExpenses(expenses: Record<string, Expense>): CoreExpense[] {
  return Object.values(expenses)
    .filter((e): e is Expense => Boolean(e))
    .map((e) => ({
      ...(e as unknown as CoreExpense),
      currency: e.currency || e.unit || "",
    }));
}

export function calculateCurrencyBalance(
  userId: string | number,
  currency: string,
  expenses: Record<string, Expense>,
  users: User[],
): number {
  if (!currency || !userId || users.length === 0) return 0;
  if (!users.some((u) => String(u.id) === String(userId))) return 0;
  return computeUserCurrencyBalance(toCoreExpenses(expenses), userId, currency);
}

export function calculateCreditMatrix(
  currency: string,
  expenses: Record<string, Expense>,
  users: User[],
): number[][] {
  if (!currency || users.length === 0) return [];
  const coreUsers: CoreUser[] = users.map((u) => ({ id: u.id }));
  const { creditMatrix } = computeCreditMatrix(
    toCoreExpenses(expenses),
    coreUsers,
    currency,
  );
  return creditMatrix;
}
