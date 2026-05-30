// Pure helpers for task `participants` and `appreciation` arrays.
// Returned tasks are new objects; inputs are not mutated.

import type { Quest, QuestParticipant } from './types.js';

function sameId(a: QuestParticipant | undefined, b: string | number): boolean {
  if (!a || a.id == null) return false;
  return String(a.id) === String(b);
}

export function addParticipant(task: Quest, user: QuestParticipant): Quest {
  if (user.id != null && task.participants.some((p) => sameId(p, user.id!))) {
    return task;
  }
  return { ...task, participants: [...task.participants, user] };
}

export function removeParticipant(task: Quest, userId: string | number): Quest {
  return {
    ...task,
    participants: task.participants.filter((p) => !sameId(p, userId)),
  };
}

export function toggleParticipant(task: Quest, user: QuestParticipant): Quest {
  if (user.id == null) return addParticipant(task, user);
  return task.participants.some((p) => sameId(p, user.id!))
    ? removeParticipant(task, user.id)
    : addParticipant(task, user);
}

export function addAppreciation(task: Quest, user: QuestParticipant): Quest {
  const current = task.appreciation ?? [];
  if (user.id != null && current.some((p: QuestParticipant) => sameId(p, user.id!))) {
    return task;
  }
  return { ...task, appreciation: [...current, user] };
}

export function removeAppreciation(task: Quest, userId: string | number): Quest {
  const current = task.appreciation ?? [];
  return {
    ...task,
    appreciation: current.filter((p: QuestParticipant) => !sameId(p, userId)),
  };
}

export function toggleAppreciation(task: Quest, user: QuestParticipant): Quest {
  if (user.id == null) return addAppreciation(task, user);
  const current = task.appreciation ?? [];
  return current.some((p: QuestParticipant) => sameId(p, user.id!))
    ? removeAppreciation(task, user.id)
    : addAppreciation(task, user);
}

// Participation and appreciation are mutually exclusive per member: someone is
// either a *doer* (participant) or a *thanker* (appreciator) of a quest, never
// both. These composite toggles enforce that invariant. Extracted from the
// Telegram bot's join/appreciate handlers (packages/telegram-ui/src/Quests.ts),
// where the rule previously lived in the UI.

/** Toggle participation; joining or leaving always clears one's appreciation. */
export function toggleParticipationExclusive(
  task: Quest,
  user: QuestParticipant
): Quest {
  const toggled = toggleParticipant(task, user);
  return user.id == null ? toggled : removeAppreciation(toggled, user.id);
}

/** Toggle appreciation; appreciating first removes one from participants. */
export function toggleAppreciationExclusive(
  task: Quest,
  user: QuestParticipant
): Quest {
  const cleared = user.id == null ? task : removeParticipant(task, user.id);
  return toggleAppreciation(cleared, user);
}
