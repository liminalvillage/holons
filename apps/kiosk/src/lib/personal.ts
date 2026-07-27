// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "My tasks": the holon's backlog filtered to the logged-in user. Participant
// ids round-trip through Gun as number or string depending on the writer, so
// identity is compared stringified — the same rule core's membership helpers
// use (never `===` on raw ids).

import type { BacklogTask } from "./data";

/** Loose id equality: `7` and `"7"` are the same person. */
export function sameId(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): boolean {
  return a != null && b != null && String(a) === String(b);
}

/** Is the user one of the task's participants? */
export function isParticipant(
  t: BacklogTask,
  uid: string | number | null | undefined,
): boolean {
  return uid != null && t.people.some((p) => sameId(p.id, uid));
}

/** The tasks the user participates in, in backlog order. */
export function personalTasks(
  tasks: BacklogTask[],
  uid: string | number | null | undefined,
): BacklogTask[] {
  if (uid == null) return [];
  return tasks.filter((t) => isParticipant(t, uid));
}
