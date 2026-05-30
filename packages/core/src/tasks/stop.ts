// Pure stop/veto transform shared by all UIs.
//
// A quest can be "stopped" (vetoed) by any member to flag a concern. Stoppers
// accumulate; while at least one stopper remains the quest is `stopped` (and
// cannot be completed — see completion.ts). Removing the last stopper returns it
// to `ongoing`. A `completed` quest's status is never changed here.
//
// Extracted from packages/telegram-ui/src/Quests.ts (`stop`), where this lived
// inline.

import type { Quest, QuestParticipant } from './types.js';

export interface ToggleStopperResult {
  task: Quest;
  /** True if the user just added their veto, false if they revoked it. */
  stopped: boolean;
}

/** Toggle a member's veto on a quest, deriving the resulting status. */
export function toggleStopper(
  task: Quest,
  user: QuestParticipant
): ToggleStopperResult {
  const stoppers = Array.isArray(task.stoppers) ? [...task.stoppers] : [];
  const idx = stoppers.findIndex(
    u => u?.id != null && String(u.id) === String(user.id)
  );
  let stopped: boolean;
  if (idx > -1) {
    stoppers.splice(idx, 1);
    stopped = false;
  } else {
    stoppers.push(user);
    stopped = true;
  }
  const status =
    task.status === 'completed'
      ? task.status
      : stoppers.length > 0
        ? 'stopped'
        : 'ongoing';
  return { task: { ...task, stoppers, status }, stopped };
}
