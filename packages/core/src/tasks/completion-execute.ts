import type { CompletionPlan } from './completion-plan.js';
import type { HoloSphereLike } from './types.js';
import { REAEventFactory } from '../rea/event-factory.js';
import { saveTaskToHolon } from './persistence.js';

export interface ExecuteCompletionOptions {
  recordEvents?: boolean;
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
  const outcome: ExecuteOutcome = { taskSaved: false, savedActions: 0, savedExpenses: 0, errors: [] };

  outcome.taskSaved = await saveTaskToHolon(store, holonId, plan.task);
  if (!outcome.taskSaved) outcome.errors.push({ kind: 'task', message: 'saveTaskToHolon returned false' });

  if (options.recordEvents !== false) {
    for (const action of plan.actions) {
      try {
        const built = buildEvent(action, holonId);
        if (!built) continue;
        // Some factory methods return an array (e.g. appreciationExchange
        // produces a sent + received pair); flatten so every event is stored.
        const events = Array.isArray(built) ? built : [built];
        for (const event of events) {
          await eventStore.put(holonId, event);
          outcome.savedActions++;
        }
      } catch (err) {
        outcome.errors.push({ kind: 'action', message: (err as Error).message ?? String(err) });
      }
    }
  }

  if (options.recordExpenses !== false) {
    for (const expense of plan.expenses) {
      try {
        await store.put(holonId, 'expenses', expense);
        outcome.savedExpenses++;
      } catch (err) {
        outcome.errors.push({ kind: 'expense', message: (err as Error).message ?? String(err) });
      }
    }
  }

  return outcome;
}

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
      // Factory returns a pair of [sent, received] events — both must be persisted.
      return REAEventFactory.appreciationExchange(
        holonId,
        action.user,
        action.receiver,
        action.amount,
        action.taskTitle,
        action.taskId,
      );
    case 'timeLogged':
      return REAEventFactory.timeLogged(
        holonId,
        action.user,
        Number(action.hours ?? 0),
        action.taskId,
        action.taskTitle,
      );
    default:
      return null;
  }
}
