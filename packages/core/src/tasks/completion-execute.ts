// Persist a CompletionPlan: writes the task, records REA events, puts expenses.
// UI-specific side-effects (Telegraf messages, Svelte dispatches, federation
// propagation) stay in the consumer.

import type { CompletionPlan } from './completion-plan.js';
import type { HoloSphereLike } from './types.js';
import { REAEventFactory } from '../rea/event-factory.js';
import { saveTaskToHolon } from './persistence.js';

export interface ExecuteCompletionOptions {
  /** When false, skip writing REA events (useful for dry-run / testing). */
  recordEvents?: boolean;
  /** When false, skip persisting expense docs. */
  recordExpenses?: boolean;
}

export interface ExecuteOutcome {
  taskSaved: boolean;
  savedActions: number;
  savedExpenses: number;
  errors: { kind: 'task' | 'action' | 'expense'; message: string }[];
}

interface EventStoreLike {
  put(holonId: string | number, event: unknown): Promise<unknown>;
}

export async function executeCompletionPlan(
  store: HoloSphereLike,
  eventStore: EventStoreLike,
  holonId: string | number,
  plan: CompletionPlan,
  options: ExecuteCompletionOptions = {},
): Promise<ExecuteOutcome> {
  const outcome: ExecuteOutcome = {
    taskSaved: false,
    savedActions: 0,
    savedExpenses: 0,
    errors: [],
  };

  outcome.taskSaved = await saveTaskToHolon(store, holonId, plan.task);
  if (!outcome.taskSaved) {
    outcome.errors.push({ kind: 'task', message: 'saveTaskToHolon returned false' });
  }

  if (options.recordEvents !== false) {
    for (const action of plan.actions) {
      try {
        const event = buildEvent(action, holonId);
        if (!event) continue;
        // appreciationExchange returns a dual-event array; spread when needed.
        const events = Array.isArray(event) ? event : [event];
        for (const e of events) {
          await eventStore.put(holonId, e);
          outcome.savedActions++;
        }
      } catch (err) {
        outcome.errors.push({
          kind: 'action',
          message: (err as Error).message ?? String(err),
        });
      }
    }
  }

  if (options.recordExpenses !== false) {
    for (const expense of plan.expenses) {
      try {
        await store.put(holonId, 'expenses', expense);
        outcome.savedExpenses++;
      } catch (err) {
        outcome.errors.push({
          kind: 'expense',
          message: (err as Error).message ?? String(err),
        });
      }
    }
  }

  return outcome;
}

// Argument shapes mirror the original `saveUserAction` call sites in
// telegram-ui so resulting events are byte-identical to the pre-unification
// path. `appreciationExchange` returns a dual-event array (sent/received);
// the caller above spreads it before put().
function buildEvent(action: any, holonId: string | number): unknown {
  switch (action.type) {
    case 'questInitiated':
      return REAEventFactory.questInitiated(holonId, action.user, {
        id: action.taskId,
        title: action.taskTitle,
      });
    case 'questCompleted':
      return REAEventFactory.questCompleted(holonId, action.user, {
        id: action.taskId,
        title: action.taskTitle,
      });
    case 'appreciationExchange':
      return REAEventFactory.appreciationExchange(
        holonId,
        action.user,
        action.receiver,
        1,
        action.taskTitle,
        action.taskId,
      );
    case 'timeLogged':
      return REAEventFactory.timeLogged(
        holonId,
        action.user,
        action.hours ?? 0,
        action.taskId,
        action.taskTitle,
      );
    default:
      return null;
  }
}
