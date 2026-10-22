// Persistence helpers for tasks/quests. UI-agnostic; only depends on a
// minimal `HoloSphereLike` (`put` / optional `get`).

import type { HoloSphereLike, Quest } from './types.js';

/** Where tasks — and the events the kiosk and web create — live. */
export const QUESTS_LENS = 'quests';

/**
 * Save a single task to a holon. Returns true on success, false on failure
 * (the error is logged but not rethrown — callers loop over many tasks and
 * shouldn't abort the whole batch on one failure).
 *
 * `lens` is the lens the record was read from. The Telegram bot keeps its
 * events in `events`; saving one of those without naming the lens leaves a
 * stray copy in `quests`.
 */
export async function saveTaskToHolon(
  holosphere: HoloSphereLike,
  holonID: string | number,
  task: Quest,
  lens: string = QUESTS_LENS,
): Promise<boolean> {
  try {
    await holosphere.put(String(holonID), lens, task);
    return true;
  } catch (taskError) {
    console.error(`Failed to save task ${task.title}:`, taskError);
    return false;
  }
}

/**
 * Save a batch of tasks to a holon. Returns the count of successful writes.
 * Behavior matches the original web `saveTasksToHolon` 1:1.
 */
export async function saveTasksToHolon(
  holosphere: HoloSphereLike,
  holonID: string | number,
  tasks: Quest[],
  lens: string = QUESTS_LENS,
): Promise<number> {
  let successfulTasks = 0;
  for (const task of tasks) {
    if (await saveTaskToHolon(holosphere, holonID, task, lens)) {
      successfulTasks++;
    }
  }
  return successfulTasks;
}
