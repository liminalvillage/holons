// Persistence helpers for tasks/quests. UI-agnostic; only depends on a
// minimal `HoloSphereLike` (`put` / optional `get`).

import type { HoloSphereLike, Quest } from './types.js';

/**
 * Save a single task to a holon. Returns true on success, false on failure
 * (the error is logged but not rethrown — callers loop over many tasks and
 * shouldn't abort the whole batch on one failure).
 */
export async function saveTaskToHolon(
  holosphere: HoloSphereLike,
  holonID: string | number,
  task: Quest,
): Promise<boolean> {
  try {
    await holosphere.put(String(holonID), 'quests', task);
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
): Promise<number> {
  let successfulTasks = 0;
  for (const task of tasks) {
    if (await saveTaskToHolon(holosphere, holonID, task)) {
      successfulTasks++;
    }
  }
  return successfulTasks;
}
