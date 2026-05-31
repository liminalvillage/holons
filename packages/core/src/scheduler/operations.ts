// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/scheduler — pure scheduling math (no I/O, no Date.now()).
//
// All functions take their reference time explicitly so they're deterministic
// and testable.

import type { CronCadence, Frequency, Reminder } from './types.js';

/**
 * Advance a date by one cadence step. Returns a new Date. Uses UTC mutators so
 * results are timezone-independent (no DST-boundary surprises).
 */
export function nextOccurrence(frequency: Frequency, from: Date): Date {
  const d = new Date(from.getTime());
  switch (frequency) {
    case 'hourly':
      d.setUTCHours(d.getUTCHours() + 1);
      break;
    case 'daily':
      d.setUTCDate(d.getUTCDate() + 1);
      break;
    case 'weekly':
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case 'biweekly':
      d.setUTCDate(d.getUTCDate() + 14);
      break;
    case 'monthly':
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case 'quarterly':
      d.setUTCMonth(d.getUTCMonth() + 3);
      break;
    case 'yearly':
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
  }
  return d;
}

/** Reminders whose fire time has arrived (`fireAt <= now`). */
export function dueReminders(reminders: Reminder[], nowIso: string): Reminder[] {
  return reminders.filter(r => r && r.fireAt && r.fireAt <= nowIso);
}

/**
 * Build a 5-field (or 6-field for sub-minute) cron expression that fires at the
 * `when` time-of-day on the cadence's schedule. UTC components, so it's
 * timezone-independent. Returns null for an unparseable date/frequency.
 *
 * Cron runtimes (telegram) consume this; tick runtimes (discord/web) use
 * `nextOccurrence`. Both share the canonical `Frequency` vocabulary; the
 * sub-minute / six-month entries are cron-only extras.
 */
export function cronExpression(
  frequency: CronCadence,
  when: string | Date
): string | null {
  const date = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(date.getTime())) return null;

  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dayOfMonth = date.getUTCDate();
  const month = date.getUTCMonth() + 1; // cron months are 1-indexed
  const dayOfWeek = date.getUTCDay(); // 0 = Sunday

  switch (frequency) {
    case '30sec':
      return '*/30 * * * * *';
    case '1min':
      return '*/1 * * * *';
    case 'hourly':
      return `${minute} * * * *`;
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekly':
      // Cron can't express true bi-weekly; weekly trigger + caller-side week
      // check is how telegram approximates `biweekly` (same here).
      return `${minute} ${hour} * * ${dayOfWeek}`;
    case 'biweekly':
      return `${minute} ${hour} * * ${dayOfWeek}`;
    case 'monthly':
      return `${minute} ${hour} ${dayOfMonth} * *`;
    case 'quarterly':
      return `${minute} ${hour} ${dayOfMonth} */3 *`;
    case 'sixmonths':
      return `${minute} ${hour} ${dayOfMonth} */6 *`;
    case 'yearly':
      return `${minute} ${hour} ${dayOfMonth} ${month} *`;
    default:
      return null;
  }
}

/**
 * After a reminder fires: a recurring one is advanced to the next future
 * occurrence (strictly after `now`); a one-shot returns null (caller deletes).
 */
export function advanceReminder(
  reminder: Reminder,
  nowIso: string
): Reminder | null {
  if (!reminder.frequency) return null;
  const now = new Date(nowIso);
  let next = new Date(reminder.fireAt);
  // Skip past any missed occurrences so we don't fire repeatedly in a tight loop.
  do {
    next = nextOccurrence(reminder.frequency, next);
  } while (next <= now);
  return { ...reminder, fireAt: next.toISOString() };
}
