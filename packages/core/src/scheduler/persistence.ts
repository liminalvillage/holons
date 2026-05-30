// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/scheduler — Holosphere persistence helpers (`reminders` lens).

import type { Reminder, SchedulerDB } from './types.js';

export const REMINDERS_LENS = 'reminders';

/** List a holon's reminders, soonest first. */
export async function listReminders(
  db: SchedulerDB,
  holonId: string | number
): Promise<Reminder[]> {
  const list = ((await db.getAll(String(holonId), REMINDERS_LENS)) ??
    []) as Reminder[];
  return list
    .filter(Boolean)
    .sort((a, b) => String(a.fireAt ?? '').localeCompare(String(b.fireAt ?? '')));
}

/** Persist a reminder. */
export async function saveReminder(
  db: SchedulerDB,
  reminder: Reminder
): Promise<void> {
  await db.put(String(reminder.holonId), REMINDERS_LENS, reminder);
}

/** Delete a reminder by id. */
export async function deleteReminder(
  db: SchedulerDB,
  holonId: string | number,
  reminderId: string
): Promise<void> {
  await db.delete(String(holonId), REMINDERS_LENS, reminderId);
}
