// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Task completion that records REA accounting through @holons/core — the exact
// sequence the Telegram bot and MCP server use:
//   1. applyTaskCompletion  — permission + status guards, stamps `completed_at`
//   2. planTaskCompletion   — derive REA actions (initiated/completed/
//                             appreciation/timeLogged) + hour-currency expenses
//   3. executeCompletionPlan — persist the task, the REA events, the expenses
// Never flip `status: "completed"` directly: that would skip the accounting.
//
// Who may complete: the kiosk asks *who took part* on every completion
// (CompleteConfirm), so participation is settled inside that dialog rather than
// demanded up front — requiring a "join the task first" step before the dialog
// even opens would be busywork, and it blocked anyone closing out a task on
// behalf of the people who actually did it. Write access is still enforced
// where it belongs: Holosphere refuses unsigned/unauthorized puts.

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

export type CompletePrecheck =
  | { ok: true }
  | { ok: false; reason: "already-completed" | "stopped" };

/**
 * Status pre-check (pure, no writes). Gate the UI on this before opening the
 * participant dialog, so a task that is already done — or stopped — never gets
 * a pointless popup. Participation is NOT checked here; see the note above.
 */
export function checkComplete(task: Quest): CompletePrecheck {
  if (task.status === "completed")
    return { ok: false, reason: "already-completed" };
  if (task.status === "stopped") return { ok: false, reason: "stopped" };
  return { ok: true };
}

export interface CompletionRecord {
  ok: boolean;
  actions: number;
  expenses: number;
}

/**
 * Record a completion: stamp the task completed, then persist it plus its REA
 * events and hour-currency expenses, under the logged-in user's identity. Pass
 * the task with the participants confirmed in CompleteConfirm — that list is
 * exactly who gets credited.
 */
export async function recordCompletion(
  holonId: string,
  task: Quest,
  completerId: string | number,
): Promise<CompletionRecord> {
  // `isAdmin` skips core's initiator/participant check: the confirm dialog
  // already established who took part, and the completer need not be one of
  // them. The status guards still run.
  const applied: CompleteTaskResult = applyTaskCompletion(task, completerId, {
    isAdmin: true,
  });
  if (!applied.ok) return { ok: false, actions: 0, expenses: 0 };
  const completedTask = applied.task;
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
