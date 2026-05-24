// @holons/core/expenses — UI-agnostic expense domain types.
//
// Sourced from packages/telegram-ui/src/Expenses.js (authoritative shape) and
// apps/web/src/utils/expenseCalculations.ts. Both bot and web persist expenses
// under HoloSphere/Gun, so IDs may arrive as number or string. We normalize at
// the edges (storage) but accept loose input here.

/** A user/holon ID as it appears on the wire (Gun stores numbers and strings). */
export type AgentId = string | number;

/** A monetary expense within a holon, split among participants. */
export interface Expense {
  /** Stable identifier (telegram message id in the bot, uuid in web). */
  id: AgentId;
  /** ISO 8601 string of when the expense was recorded. Canonical across every domain shape — `created` is the single name we use everywhere. */
  created: string;
  /** Total amount in `currency` units. */
  amount: number;
  /** Currency code; persisted normalized (lowercase, singular, a-z only). */
  currency: string;
  /** Free-form description provided by the payer. */
  description: string;
  /** ID of the user (or holon) who paid. */
  paidBy: AgentId;
  /**
   * IDs of agents that share the cost. May contain the holonId itself when
   * "this holon" is treated as a single participant (legacy bot behaviour).
   * May arrive as a non-array from older records; consumers should normalize
   * via `coerceSplitWith`.
   */
  splitWith: AgentId[];
  /** Optional Telegram file_id for an attached receipt. */
  picture?: string | null;
}

/** Minimal user shape used for balance display. */
export interface User {
  id: AgentId;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

/** Per-user net balance (positive = is owed, negative = owes). */
export interface UserBalance {
  userId: AgentId;
  net: number;
}

/** Result of computing balances across all users in a holon. */
export interface BalancesResult {
  /**
   * NxN matrix where `creditMatrix[i][j]` is the net amount user i is owed by
   * user j (positive) or owes to user j (negative). Rows and columns share the
   * same ordering as `userIds`.
   */
  creditMatrix: number[][];
  /** User IDs in the same order as the matrix axes. */
  userIds: AgentId[];
  /** Per-user net balance derived by summing each row of the matrix. */
  balances: UserBalance[];
}
