// Pure helpers for task `participants` and `appreciation` arrays.
// Returned tasks are new objects; inputs are not mutated.
//
// Mutex rule (mirrors the Telegram bot's quest interaction model in
// `packages/telegram-ui/src/Quests.ts` ~lines 489–518):
//   - A user is in at most ONE of {participants, appreciation} at a time.
//   - `addParticipant` / `toggleParticipant` (when adding) clear the user
//     from `appreciation`.
//   - `addAppreciation` / `toggleAppreciation` (when adding) clear the user
//     from `participants`, with a completion guard: when `status === 'completed'`,
//     adding to appreciation does not strip an existing participant entry
//     (and existing entries cannot be removed either).
//   - Low-level `removeParticipant` / `removeAppreciation` only touch the
//     named array — they don't enforce the mutex (use them to surgically
//     repair invariant violations).

import type { Quest, QuestParticipant } from './types.js';

function sameId(a: QuestParticipant | undefined, b: string | number): boolean {
  if (!a || a.id == null) return false;
  return String(a.id) === String(b);
}

function withoutId(list: QuestParticipant[], id: string | number): QuestParticipant[] {
  return list.filter((p) => !sameId(p, id));
}

export function addParticipant(task: Quest, user: QuestParticipant): Quest {
  if (user.id == null) {
    return { ...task, participants: [...task.participants, user] };
  }
  const alreadyIn = task.participants.some((p) => sameId(p, user.id!));
  const nextParticipants = alreadyIn ? task.participants : [...task.participants, user];
  const nextAppreciation = withoutId(task.appreciation ?? [], user.id);
  return { ...task, participants: nextParticipants, appreciation: nextAppreciation };
}

export function removeParticipant(task: Quest, userId: string | number): Quest {
  return { ...task, participants: withoutId(task.participants, userId) };
}

export function toggleParticipant(task: Quest, user: QuestParticipant): Quest {
  if (user.id == null) return addParticipant(task, user);
  const isIn = task.participants.some((p) => sameId(p, user.id!));
  return isIn ? removeParticipant(task, user.id) : addParticipant(task, user);
}

export function addAppreciation(task: Quest, user: QuestParticipant): Quest {
  if (user.id == null) {
    return { ...task, appreciation: [...(task.appreciation ?? []), user] };
  }
  const current = task.appreciation ?? [];
  const alreadyIn = current.some((p) => sameId(p, user.id!));
  const inParticipants = task.participants.some((p) => sameId(p, user.id!));
  // Completion guard: if completed AND user is in either list, no-op
  // (matches the bot's early-return for "appreciate" on a completed quest).
  const completed = task.status === 'completed';
  if (completed && (alreadyIn || inParticipants)) return task;

  const nextParticipants = inParticipants ? withoutId(task.participants, user.id) : task.participants;
  const nextAppreciation = alreadyIn ? current : [...current, user];
  return { ...task, participants: nextParticipants, appreciation: nextAppreciation };
}

export function removeAppreciation(task: Quest, userId: string | number): Quest {
  return { ...task, appreciation: withoutId(task.appreciation ?? [], userId) };
}

export function toggleAppreciation(task: Quest, user: QuestParticipant): Quest {
  if (user.id == null) return addAppreciation(task, user);
  const current = task.appreciation ?? [];
  const isIn = current.some((p) => sameId(p, user.id!));
  return isIn ? removeAppreciation(task, user.id) : addAppreciation(task, user);
}
