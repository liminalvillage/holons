// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The "Mine" scope: each view's items filtered to the logged-in user.
// Participant ids round-trip through holosphere as number or string depending on the
// writer, so identity is compared stringified — the same rule core's
// membership helpers use (never `===` on raw ids).

import type {
  BacklogTask,
  CalendarEvent,
  ChecklistCard,
  LibraryThing,
} from "./data";

/** Loose id equality: `7` and `"7"` are the same person. */
export function sameId(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): boolean {
  return a != null && b != null && String(a) === String(b);
}

/** Is the user among the item's people? (tasks, events, roles alike) */
export function isParticipant(
  t: { people: { id: string | number | null }[] },
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

/** The events the user participates in — RSVPs toggle participants, so this
 *  IS the "events I'm going to" filter. */
export function personalEvents(
  events: CalendarEvent[],
  uid: string | number | null | undefined,
): CalendarEvent[] {
  if (uid == null) return [];
  return events.filter((e) => isParticipant(e, uid));
}

/** The checklists the user created. Special lists (agenda/shopping) are
 *  communal by nature and stay visible in the personal scope too. */
export function personalChecklists(
  lists: ChecklistCard[],
  uid: string | number | null | undefined,
): ChecklistCard[] {
  if (uid == null) return [];
  return lists.filter((c) => c.special || sameId(c.creator, uid));
}

/** The things currently out with the user. */
export function personalThings(
  things: LibraryThing[],
  uid: string | number | null | undefined,
): LibraryThing[] {
  if (uid == null) return [];
  return things.filter((t) => !t.available && sameId(t.borrowerId, uid));
}
