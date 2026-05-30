// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/scheduler — pure scheduling math (no I/O, no Date.now()).
//
// All functions take their reference time explicitly so they're deterministic
// and testable.

import type { Frequency, Reminder } from './types.js';

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
