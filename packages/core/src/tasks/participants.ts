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
 * bot writes / wire round-trips). Never throws — a quest fresh off the graph
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

/**
 * Replace the roster wholesale — the shape an edit form saves: whoever is on
 * the new list is a participant, whoever isn't is gone. Duplicate ids fold to
 * the first spelling, and the participate-XOR-appreciate rule still holds:
 * every member put on the roster leaves the appreciation list.
 */
export function setParticipants(task: Quest, participants: QuestParticipant[]): Quest {
  const seen = new Set<string>();
  const roster: QuestParticipant[] = [];
  for (const p of participants) {
    if (p?.id == null) continue;
    const key = String(p.id);
    if (seen.has(key)) continue;
    seen.add(key);
    roster.push(p);
  }
  const appreciation = listOf(task.appreciation).filter(
    (p) => p?.id == null || !seen.has(String(p.id))
  );
  return { ...task, participants: roster, appreciation };
}

/**
 * Who joined and who left between two rosters, by id. The UI mirrors each
 * change into the person's own holon (`reflectJoin` / `reflectLeave`) exactly
 * as a self-service join would.
 */
export function rosterDiff(
  before: QuestParticipant[] | undefined,
  after: QuestParticipant[] | undefined
): { joined: QuestParticipant[]; left: QuestParticipant[] } {
  const was = new Set(listOf(before).map((p) => String(p?.id)));
  const now = new Set(listOf(after).map((p) => String(p?.id)));
  return {
    joined: listOf(after).filter((p) => p?.id != null && !was.has(String(p.id))),
    left: listOf(before).filter((p) => p?.id != null && !now.has(String(p.id))),
  };
}
