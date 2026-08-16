// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

// What a quest's schedule MEANS. One place, so every UI agrees on when a card
// starts, when it ends, and which calendar days it covers.
//
// The stored shape (see also @holons/core/datetime — the store is always UTC):
//
//   when   start. A bare `YYYY-MM-DD` is all-day; an ISO instant is timed.
//   ends   end, in the SAME form as `when`:
//            · all-day → a bare `YYYY-MM-DD`, the LAST day, INCLUSIVE. A
//              three-day festival is when=…-20, ends=…-22 — what the user
//              picked in the two date fields, with no off-by-one to remember.
//            · timed   → an ISO instant, which may fall on a later day (an
//              overnight or multi-day event).
//          Empty means "no end" — a single all-day day, or an open-ended
//          timed start the calendar renders at its default length.
//   until  the legacy (bot) alias for `ends`. Read as a fallback, and blanked
//          — never deleted; Gun merges — whenever we write `ends`.
//
// Multi-day quests are what a UI would call an event: one card that occupies a
// span of days rather than a moment. Nothing here changes a quest's `type` —
// spanning days is a property of the schedule, not of the kind of thing.

import {
  localFieldsToStored,
  parseInstant,
  toStoredInstant,
} from '../datetime/index.js';

/**
 * The subset of a quest this module reads. Spelled out rather than `Pick`ed
 * from `Quest`: `until` lives on that type's open index signature, and Pick
 * would turn it into a REQUIRED field no caller can satisfy.
 */
export interface ScheduledQuest {
  when?: unknown;
  ends?: unknown;
  until?: unknown;
}

/** The subset it writes. Blank strings are the "no date" sentinel. */
export interface QuestScheduleFields {
  when: string;
  ends: string;
  until: string;
}

export interface QuestSchedule {
  /** Local start, or null when the quest is undated. */
  start: Date | null;
  /**
   * Local end, or null when open-ended. For an all-day span this is the last
   * day at local midnight (inclusive) — NOT an exclusive boundary.
   */
  end: Date | null;
  /** True when the start carries no time of day. */
  allDay: boolean;
  /** Calendar days covered, inclusive: 1 for a single day, 0 when undated. */
  days: number;
  /** `days > 1` — the card spans a range and reads as an event. */
  multiDay: boolean;
}

const UNDATED: QuestSchedule = {
  start: null,
  end: null,
  allDay: true,
  days: 0,
  multiDay: false,
};

/** True when a stored value carries a time of day (vs. a bare date). */
export function isTimedValue(value: unknown): boolean {
  return /T\d\d:/.test(String(value ?? ''));
}

/**
 * Calendar-day ordinal of a local Date — days since the epoch, counted in the
 * viewer's own timezone. Comparing ordinals answers "same day?" / "which day
 * of the span?" without any DST arithmetic.
 */
export function localDayNumber(d: Date): number {
  return Math.floor(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000,
  );
}

/** Resolve a quest's stored schedule into dates + the span it covers. */
export function questSchedule(q: ScheduledQuest | null | undefined): QuestSchedule {
  const start = parseInstant(q?.when);
  if (!start) return UNDATED;
  const allDay = !isTimedValue(q?.when);
  const rawEnd = parseInstant(q?.ends ?? q?.until);
  // An end at or before the start is no end at all (a stale or mis-picked
  // value); the same for an all-day end that resolves to an earlier day.
  const end = rawEnd && rawEnd.getTime() > start.getTime() ? rawEnd : null;
  const firstDay = localDayNumber(start);
  // A timed event finishing exactly at midnight belongs to the day it ran on,
  // not to the empty minute that opens the next one.
  const lastDay = !end
    ? firstDay
    : localDayNumber(
        allDay || end.getHours() || end.getMinutes()
          ? end
          : new Date(end.getTime() - 1),
      );
  const days = Math.max(1, lastDay - firstDay + 1);
  return { start, end, allDay, days, multiDay: days > 1 };
}

/** True when `day` falls inside the quest's (inclusive) span. */
export function coversDay(
  schedule: QuestSchedule,
  day: Date | number,
): boolean {
  return dayIndexIn(schedule, day) > 0;
}

/**
 * Which day of the span `day` is: 1 for the first, `schedule.days` for the
 * last, 0 when it falls outside. Lets a UI label continuation days ("2/3").
 */
export function dayIndexIn(
  schedule: QuestSchedule,
  day: Date | number,
): number {
  if (!schedule.start) return 0;
  const n = typeof day === 'number' ? day : localDayNumber(day);
  const first = localDayNumber(schedule.start);
  const i = n - first + 1;
  return i >= 1 && i <= schedule.days ? i : 0;
}

/**
 * Build the stored schedule fields from local form fields — the UI edit edge.
 *
 * All-day-ness is decided by the START time: with no start time the quest is
 * all-day and only the two DATES matter (any end time is ignored — an all-day
 * span has no clock). With a start time, an end date on a later day makes a
 * multi-day timed event, and an end time is carried over from the start when
 * the user didn't pick one.
 *
 * An end that isn't after the start is dropped rather than stored backwards.
 */
export function buildScheduleFields(input: {
  startDate?: string | null;
  startTime?: string | null;
  endDate?: string | null;
  endTime?: string | null;
}): QuestScheduleFields {
  const startDate = (input.startDate ?? '').trim();
  if (!startDate) return { when: '', ends: '', until: '' };
  const startTime = (input.startTime ?? '').trim();
  const when = localFieldsToStored(startDate, startTime);
  if (!when) return { when: '', ends: '', until: '' };

  const endDate = (input.endDate ?? '').trim() || startDate;
  const endTime = (input.endTime ?? '').trim();
  const ends = startTime
    ? localFieldsToStored(endDate, endTime || startTime)
    : endDate > startDate
      ? endDate
      : '';

  const start = parseInstant(when);
  const end = parseInstant(ends);
  const keep = start && end && end.getTime() > start.getTime();
  return { when, ends: keep ? (ends as string) : '', until: '' };
}

/** Split a quest's schedule back into local form fields, for the edit form. */
export function scheduleToFields(q: ScheduledQuest | null | undefined): {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
} {
  const s = questSchedule(q);
  if (!s.start) return { startDate: '', startTime: '', endDate: '', endTime: '' };
  return {
    startDate: dateField(s.start),
    startTime: s.allDay ? '' : timeField(s.start),
    endDate: s.end ? dateField(s.end) : '',
    endTime: s.end && !s.allDay ? timeField(s.end) : '',
  };
}

/**
 * Move a quest to `newWhen` (an already-serialized start — the caller decides
 * whether the drop target is all-day or timed), carrying the end along so the
 * span keeps its length and stays in a consistent FORM. Naively re-serializing
 * the shifted end as an instant would silently turn an all-day range into a
 * timed one, and vice versa.
 *
 * When both the old and new start carry a clock, the exact duration is kept.
 * When either side is all-day there is no duration to keep, so the span holds
 * its number of whole DAYS instead.
 */
export function shiftSchedule(
  q: ScheduledQuest,
  newWhen: string,
): QuestScheduleFields {
  const s = questSchedule(q);
  const start = parseInstant(newWhen);
  const blank = { when: newWhen, ends: '', until: '' };
  if (!start || !s.start || !s.end) return blank;
  const toAllDay = !isTimedValue(newWhen);
  if (!toAllDay && !s.allDay) {
    const delta = start.getTime() - s.start.getTime();
    return {
      when: newWhen,
      ends: toStoredInstant(new Date(s.end.getTime() + delta)),
      until: '',
    };
  }
  if (s.days < 2) return blank; // nothing left to span once the clock is gone
  const last = new Date(start);
  last.setDate(last.getDate() + (s.days - 1));
  return {
    when: newWhen,
    ends: toAllDay ? dateField(last) : toStoredInstant(last),
    until: '',
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function dateField(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function timeField(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
