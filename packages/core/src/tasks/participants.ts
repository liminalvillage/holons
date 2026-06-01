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

/**
 * Toggle participation. Participation and appreciation are mutually exclusive
 * per member — someone is either a *doer* (participant) or a *thanker*
 * (appreciator) of a quest, never both — so joining always clears that member's
 * appreciation.
 */
export function toggleParticipant(task: Quest, user: QuestParticipant): Quest {
  if (user.id == null) return addParticipant(task, user);
  const isParticipant = task.participants.some((p) => sameId(p, user.id!));
  const next = isParticipant
    ? removeParticipant(task, user.id)
    : addParticipant(task, user);
  return removeAppreciation(next, user.id);
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

/**
 * Toggle appreciation. Mutually exclusive with participation (see
 * {@link toggleParticipant}) — appreciating always removes the member from the
 * participants first.
 */
export function toggleAppreciation(task: Quest, user: QuestParticipant): Quest {
  if (user.id == null) return addAppreciation(task, user);
  const cleared = removeParticipant(task, user.id);
  const current = cleared.appreciation ?? [];
  return current.some((p: QuestParticipant) => sameId(p, user.id!))
    ? removeAppreciation(cleared, user.id)
    : addAppreciation(cleared, user);
}
