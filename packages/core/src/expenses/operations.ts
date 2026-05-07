// Pure expense operations: validation, normalization and split mutations.
//
// Each function returns a *new* Expense (never mutates input) so callers can
// persist the result through whatever storage layer they own. The bot's
// Telegraf class keeps its UI flow but routes data shaping through here.
import { coerceSplitWith, normalizeCurrency } from './balance.js';
import type { AgentId, Expense } from './types.js';

/** Input used to construct a fresh expense before persistence. */
export interface CreateExpenseInput {
  id: AgentId;
  holonId: AgentId;
  amount: number;
  currency: string;
  description: string;
  paidBy: AgentId;
  splitWith?: AgentId[];
  picture?: string | null;
  /** Override timestamp (defaults to `Date.now()`). */
  date?: number;
}

/** Strip leading prepositions in the languages the bot supports. */
function stripDescriptionPreposition(description: string): string {
  return description
    .replace(/^for /i, '')
    .replace(/^per /i, '')
    .replace(/^voor /i, '')
    .replace(/^für /i, '')
    .replace(/^por /i, '')
    .replace(/^pour /i, '');
}

/**
 * Validate inputs and produce a normalized expense. Returns `null` when the
 * amount is non-positive — same contract as the bot's `addExpense` so callers
 * can keep their existing reply-on-failure code paths.
 *
 * Currency is normalized here too, so callers don't have to remember to do it.
 * If `splitWith` is omitted or empty we default to `[holonId]` to match the
 * bot's "this holon eats the cost" sentinel.
 */
export function createExpense(input: CreateExpenseInput): Expense | null {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const currency = normalizeCurrency(input.currency);
  const description = stripDescriptionPreposition(String(input.description ?? ''));
  const splitWith =
    input.splitWith && input.splitWith.length > 0 ? [...input.splitWith] : [input.holonId];

  return {
    id: input.id,
    date: input.date ?? Date.now(),
    amount,
    currency,
    description,
    paidBy: input.paidBy,
    splitWith,
    picture: input.picture ?? null,
  };
}

const sameId = (a: AgentId, b: AgentId): boolean => String(a) === String(b);

/**
 * Toggle a single user in/out of the split. Removing the last participant
 * falls back to `[holonId]` so the expense still has at least one bearer.
 */
export function toggleParticipant(expense: Expense, userId: AgentId, holonId: AgentId): Expense {
  const current = coerceSplitWith(expense.splitWith);
  const isPresent = current.some((id) => sameId(id, userId));
  let next: AgentId[];

  if (isPresent) {
    next = current.filter((id) => !sameId(id, userId));
    if (next.length === 0) next = [holonId];
  } else {
    next = current.filter((id) => !sameId(id, holonId));
    next.push(userId);
  }

  return { ...expense, splitWith: next };
}

/** Ensure `userId` is part of the split (no-op if already there). */
export function addParticipant(expense: Expense, userId: AgentId): Expense {
  const current = coerceSplitWith(expense.splitWith);
  if (current.some((id) => sameId(id, userId))) return { ...expense, splitWith: current };
  return { ...expense, splitWith: [...current, userId] };
}

/** Remove `userId` from the split, if present. */
export function removeParticipant(expense: Expense, userId: AgentId): Expense {
  const next = coerceSplitWith(expense.splitWith).filter((id) => !sameId(id, userId));
  return { ...expense, splitWith: next };
}

/** Replace the split with every known user (excluding the holon sentinel). */
export function splitAmongAll(expense: Expense, userIds: AgentId[]): Expense {
  return { ...expense, splitWith: [...userIds] };
}
