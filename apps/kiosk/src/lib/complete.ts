// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Task completion that records REA accounting through @holons/core — the exact
// sequence the Telegram bot and MCP server use:
//   1. applyTaskCompletion  — permission + status guards, stamps `completed_at`
//   2. planTaskCompletion   — derive REA actions (initiated/completed/
//                             appreciation/timeLogged) + hour-currency expenses
//   3. executeCompletionPlan — persist the task, the REA events, the expenses
// Never flip `status: "completed"` directly: that would skip the accounting.

import {
  applyTaskCompletion,
  planTaskCompletion,
  executeCompletionPlan,
  type Quest,
  type CompleteTaskResult,
} from "@holons/core/tasks";
import { loadEquation, DEFAULT_EQUATION } from "@holons/core/scoring";
import { REAEventStore } from "@holons/core/rea";
import { getReaStore } from "./holosphere";

/**
 * Permission + status pre-check (pure, no writes). Gate the UI on this before
 * playing any completion animation. Returns `{ ok: true, task }` with the
 * stamped task, or `{ ok: false, reason }`.
 */
export function checkComplete(
  task: Quest,
  completerId: string | number,
): CompleteTaskResult {
  return applyTaskCompletion(task, completerId);
}

export interface CompletionRecord {
  ok: boolean;
  actions: number;
  expenses: number;
}

/**
 * Record a completion: persist the completed task plus its REA events and
 * hour-currency expenses, under the logged-in user's identity. Pass the
 * `task` from a successful {@link checkComplete}.
 */
export async function recordCompletion(
  holonId: string,
  completedTask: Quest,
): Promise<CompletionRecord> {
  const store = await getReaStore();
  let equation = DEFAULT_EQUATION;
  try {
    equation = await loadEquation(store, holonId);
  } catch {
    /* fall back to the default value equation */
  }
  const plan = planTaskCompletion(completedTask, equation, {
    holonId,
    now: Date.now(),
  });
  const eventStore = new REAEventStore(store as never);
  const outcome = await executeCompletionPlan(
    store as never,
    eventStore,
    holonId,
    plan,
  );
  return {
    ok: outcome.taskSaved,
    actions: outcome.savedActions,
    expenses: outcome.savedExpenses,
  };
}
