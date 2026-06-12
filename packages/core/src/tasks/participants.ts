// Pure helpers for task `participants` and `appreciation` arrays.
// Returned tasks are new objects; inputs are not mutated.

import type { Quest, QuestParticipant } from './types.js';

function sameId(a: QuestParticipant | undefined, b: string | number): boolean {
  if (!a || a.id == null) return false;
  return String(a.id) === String(b);
}

/**
 * A quest's people list as an array, tolerating wire-format records where the
 * field is missing (no one has joined yet) or arrives as a JSON string (older
 * bot writes / Gun round-trips). Never throws — a quest fresh off the graph
 * must be joinable.
 */
function listOf(value: unknown): QuestParticipant[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* not JSON — treat as empty */
    }
  }
  return [];
}

export function addParticipant(task: Quest, user: QuestParticipant): Quest {
  const participants = listOf(task.participants);
  if (user.id != null && participants.some((p) => sameId(p, user.id!))) {
    return { ...task, participants };
  }
  return { ...task, participants: [...participants, user] };
}

export function removeParticipant(task: Quest, userId: string | number): Quest {
  return {
    ...task,
    participants: listOf(task.participants).filter((p) => !sameId(p, userId)),
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
  const isParticipant = listOf(task.participants).some((p) =>
    sameId(p, user.id!)
  );
  const next = isParticipant
    ? removeParticipant(task, user.id)
    : addParticipant(task, user);
  return removeAppreciation(next, user.id);
}

export function addAppreciation(task: Quest, user: QuestParticipant): Quest {
  const current = listOf(task.appreciation);
  if (user.id != null && current.some((p: QuestParticipant) => sameId(p, user.id!))) {
    return { ...task, appreciation: current };
  }
  return { ...task, appreciation: [...current, user] };
}

export function removeAppreciation(task: Quest, userId: string | number): Quest {
  return {
    ...task,
    appreciation: listOf(task.appreciation).filter(
      (p: QuestParticipant) => !sameId(p, userId)
    ),
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
  const current = listOf(cleared.appreciation);
  return current.some((p: QuestParticipant) => sameId(p, user.id!))
    ? removeAppreciation(cleared, user.id)
    : addAppreciation(cleared, user);
}
