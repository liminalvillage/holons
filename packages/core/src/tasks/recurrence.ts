// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

// What a RECURRING quest means. One place, so the calendar on every surface
// draws the same occurrences and ticks off the same ones.
//
// The stored shape, on the quest record itself (the web dashboard's model):
//
//   frequency             the cadence — one of {@link QUEST_FREQUENCIES}, or
//                         null/absent for a one-off. A cadence with no `when`
//                         is meaningless: the series starts at `when`.
//   completedOccurrences  the occurrences ticked off, each spelled as that
//                         occurrence's `when` (see {@link occurrenceWhen}).
//                         The SERIES stays open; ticking one occurrence never
//                         flips `status`, so no completion accounting runs.
//   recurringTaskId       the Telegram scheduler's handle for the series, when
//                         the bot spawns the occurrences. Dropped whenever the
//                         cadence is cleared, so the scheduler stops too.
//
// A series is expanded on the reading side: nothing stores one record per
// occurrence. `questOccurrences` walks the cadence from `when` across a
// window, and each step keeps the series' own form (a bare date stays a bare
// date, an instant stays an instant) and its length (`shiftSchedule`).
//
// Steps are taken in LOCAL time — a weekly 10:00 stays 10:00 across a DST
// change, and "monthly" lands on the same day-of-month. The scheduler's
// `nextOccurrence` steps in UTC instead, because a reminder fires on a server
// with no viewer; a board always has one.

import { parseInstant, toLocalDateField, toStoredInstant } from '../datetime/index.js';
import {
  isTimedValue,
  localDayNumber,
  questSchedule,
  shiftSchedule,
  type QuestScheduleFields,
  type ScheduledQuest,
} from './schedule.js';

/** The cadences a quest may repeat at, slowest last. */
export const QUEST_FREQUENCIES = [
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'sixmonths',
  'yearly',
] as const;

export type QuestFrequency = (typeof QUEST_FREQUENCIES)[number];

/** The subset of a quest this module reads. */
export interface RecurringQuest extends ScheduledQuest {
  frequency?: unknown;
  completedOccurrences?: unknown;
  recurringTaskId?: unknown;
}

/** One occurrence of a series, as a board draws it. */
export interface QuestOccurrence {
  /**
   * This occurrence's start, in the series' own stored form — a bare
   * `YYYY-MM-DD` for an all-day series, a UTC instant for a timed one. What
   * `completedOccurrences` records, and what a UI hands back to tick it off.
   */
  when: string;
  /** The schedule fields of this occurrence: `when` plus the carried end. */
  schedule: QuestScheduleFields;
  /** Local start. */
  start: Date;
  /** Whether this occurrence has been ticked off. */
  completed: boolean;
}

/** The span a series is expanded over. */
export interface OccurrenceWindow {
  start: Date;
  end: Date;
}

/** Ceiling on the occurrences one series may emit — a runaway guard. */
const MAX_OCCURRENCES = 500;

/**
 * The quest's cadence, or null when it doesn't repeat. Tolerates the
 * spellings older writers used (`Weekly`, ` daily `) and rejects anything
 * outside the vocabulary rather than guessing at it.
 */
export function questFrequency(
  q: RecurringQuest | null | undefined,
): QuestFrequency | null {
  const raw = String(q?.frequency ?? '')
    .trim()
    .toLowerCase();
  return (QUEST_FREQUENCIES as readonly string[]).includes(raw)
    ? (raw as QuestFrequency)
    : null;
}

/** True when the quest repeats: it has a cadence AND a start to count from. */
export function isRecurring(q: RecurringQuest | null | undefined): boolean {
  return questFrequency(q) !== null && parseInstant(q?.when) !== null;
}

/**
 * One cadence step from `from`, in local time. Day-based steps keep the wall
 * clock; month-based steps keep the day of month where the month has it (JS
 * rolls the 31st into the next month, as every calendar app does).
 */
export function advanceOccurrence(from: Date, frequency: QuestFrequency): Date {
  const d = new Date(from.getTime());
  switch (frequency) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'biweekly':
      d.setDate(d.getDate() + 14);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'quarterly':
      d.setMonth(d.getMonth() + 3);
      break;
    case 'sixmonths':
      d.setMonth(d.getMonth() + 6);
      break;
    case 'yearly':
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return d;
}

/**
 * Spell an occurrence's start the way the series spells its own `when`:
 * bare date for an all-day series, UTC instant for a timed one.
 */
export function occurrenceWhen(q: ScheduledQuest, start: Date): string {
  return isTimedValue(q.when) ? toStoredInstant(start) : toLocalDateField(start);
}

/**
 * Whether `when` is among the ticked-off occurrences. The web dashboard keys
 * an all-day occurrence by its UTC-midnight instant (`YYYY-MM-DDT00:00:00.000Z`)
 * where this module keys it by the bare date; both spellings are read, so a
 * tick made on either surface shows on the other.
 */
export function isOccurrenceCompleted(
  q: RecurringQuest | null | undefined,
  when: string,
): boolean {
  return completedSet(q).has(when);
}

function completedSet(q: RecurringQuest | null | undefined): Set<string> {
  const raw = q?.completedOccurrences;
  const out = new Set<string>();
  if (!Array.isArray(raw)) return out;
  for (const v of raw) {
    if (typeof v !== 'string' || !v) continue;
    out.add(v);
    // Fold the dashboard's UTC-midnight spelling of a bare date onto the date.
    const m = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.000)?Z$/.exec(v);
    if (m) out.add(m[1]);
  }
  return out;
}

/**
 * The occurrences of a series that touch `window`, in order. A one-off quest
 * yields nothing here — draw it as itself. An occurrence is emitted when any
 * part of its span (start through carried end) falls inside the window, the
 * same rule an external feed's expansion follows.
 */
export function questOccurrences(
  q: RecurringQuest,
  window: OccurrenceWindow,
  limit = MAX_OCCURRENCES,
): QuestOccurrence[] {
  const frequency = questFrequency(q);
  const base = questSchedule(q);
  if (!frequency || !base.start) return [];
  const done = completedSet(q);
  // The length of the span, carried onto every step: the same number of
  // whole days for an all-day series, the same duration for a timed one.
  const spanMs = base.end ? base.end.getTime() - base.start.getTime() : 0;

  const out: QuestOccurrence[] = [];
  let cur = base.start;
  let steps = 0;
  while (cur <= window.end && steps++ < limit) {
    const endMs = cur.getTime() + spanMs;
    if (endMs >= window.start.getTime()) {
      const when = occurrenceWhen(q, cur);
      out.push({
        when,
        schedule: shiftSchedule(q, when),
        start: cur,
        completed: done.has(when),
      });
    }
    const next = advanceOccurrence(cur, frequency);
    if (next.getTime() <= cur.getTime()) break;
    cur = next;
  }
  return out;
}

/**
 * The next occurrence still to do, on or after the calendar day of `now`:
 * the series' due date as a task wall shows it. Null when the series has
 * nothing open ahead within `limit` steps.
 */
export function nextOpenOccurrence(
  q: RecurringQuest,
  now: Date,
  limit = MAX_OCCURRENCES,
): QuestOccurrence | null {
  const frequency = questFrequency(q);
  const base = questSchedule(q);
  if (!frequency || !base.start) return null;
  const done = completedSet(q);
  const today = localDayNumber(now);
  let cur = base.start;
  for (let i = 0; i < limit; i++) {
    if (localDayNumber(cur) >= today) {
      const when = occurrenceWhen(q, cur);
      if (!done.has(when)) {
        return { when, schedule: shiftSchedule(q, when), start: cur, completed: false };
      }
    }
    const next = advanceOccurrence(cur, frequency);
    if (next.getTime() <= cur.getTime()) break;
    cur = next;
  }
  return null;
}

/**
 * Tick one occurrence off, or un-tick it: the `completedOccurrences` list to
 * store. Both spellings of an all-day occurrence are cleared on an un-tick
 * (see {@link isOccurrenceCompleted}); a tick writes this module's spelling.
 */
export function toggleOccurrenceCompleted(
  q: RecurringQuest,
  when: string,
): string[] {
  const raw = Array.isArray(q.completedOccurrences)
    ? q.completedOccurrences.filter((v): v is string => typeof v === 'string' && !!v)
    : [];
  const alt = /^\d{4}-\d{2}-\d{2}$/.test(when) ? `${when}T00:00:00.000Z` : null;
  const without = raw.filter((v) => v !== when && v !== alt);
  return isOccurrenceCompleted(q, when) ? without : [...without, when];
}

/** The list with `when` ticked off — unchanged when it already was. */
export function markOccurrenceCompleted(q: RecurringQuest, when: string): string[] {
  const raw = Array.isArray(q.completedOccurrences)
    ? q.completedOccurrences.filter((v): v is string => typeof v === 'string' && !!v)
    : [];
  return isOccurrenceCompleted(q, when) ? raw : [...raw, when];
}

/**
 * The fields that set (or clear) a quest's cadence. Clearing also drops the
 * scheduler's handle so the bot stops spawning occurrences; only written
 * when there was one, so an unrelated record gains no null field.
 */
export function setQuestFrequency(
  q: RecurringQuest,
  frequency: QuestFrequency | null,
): { frequency: QuestFrequency | null; recurringTaskId?: null } {
  const out: { frequency: QuestFrequency | null; recurringTaskId?: null } = {
    frequency,
  };
  if (frequency === null && q.recurringTaskId) out.recurringTaskId = null;
  return out;
}

/**
 * Move the WHOLE series so that the occurrence at `from` lands on `to` — what
 * dragging one occurrence across a calendar means: the meeting moved, not
 * just this week's. `to` decides the form of the result (an already-serialized
 * start, like {@link shiftSchedule} takes); a timed target moves the series by
 * the exact interval, an all-day one by whole days. The carried end follows.
 * Returns the series' schedule fields to store, or null when a start is
 * unreadable.
 */
export function moveOccurrence(
  q: RecurringQuest,
  from: string,
  to: string,
): QuestScheduleFields | null {
  const base = questSchedule(q);
  const fromStart = parseInstant(from);
  const toStart = parseInstant(to);
  if (!base.start || !fromStart || !toStart) return null;
  let seriesStart: Date;
  if (isTimedValue(to)) {
    seriesStart = new Date(
      base.start.getTime() + (toStart.getTime() - fromStart.getTime()),
    );
    return shiftSchedule(q, toStoredInstant(seriesStart));
  }
  seriesStart = new Date(base.start);
  seriesStart.setDate(
    seriesStart.getDate() + (localDayNumber(toStart) - localDayNumber(fromStart)),
  );
  return shiftSchedule(q, toLocalDateField(seriesStart));
}
