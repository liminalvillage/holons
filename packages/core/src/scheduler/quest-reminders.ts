// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/scheduler — quest/event pre-notification reminders (GLOBAL).
//
// Distinct from the per-holon ad-hoc `Reminder` (types.ts) used by discord's
// `/remind`: a QuestReminder is auto-created to fire shortly before a scheduled
// quest/event and is keyed to that item. Telegram has always stored these in
// the GLOBAL `reminders` table (+ `reminderslookup`); per the no-bulk-rewrite
// policy we keep that location and only make the shape + persistence
// core-owned (created ISO, holonId string).

import type { RecurringScheduleDB } from './recurring.js';

// `reminders` lens is also referenced by persistence.ts; keep this one
// module-local to avoid an ambiguous re-export from the package index.
const REMINDERS_LENS = 'reminders';
export const REMINDERS_LOOKUP_LENS = 'reminderslookup';

/** A scheduled pre-notification for a quest/event. */
export interface QuestReminder {
  id: string;
  questId: string | number;
  holonId: string;
  /** Lens the target item lives in (defaults to 'quests'). */
  lens: string;
  /** ISO time the reminder fires. */
  when: string;
  /** Precomputed cron string for the cron runtime (optional). */
  cronExpression?: string;
  title: string;
  /** Canonical creation timestamp (ISO). */
  created: string;
  [key: string]: unknown;
}

/** Build a canonical quest-reminder record. */
export function createQuestReminder(input: {
  id: string;
  questId: string | number;
  holonId: string | number;
  when: string;
  lens?: string;
  cronExpression?: string;
  title?: string;
}): QuestReminder {
  return {
    id: input.id,
    questId: input.questId,
    holonId: String(input.holonId),
    lens: input.lens ?? 'quests',
    when: input.when,
    ...(input.cronExpression ? { cronExpression: input.cronExpression } : {}),
    title: input.title ?? 'Reminder',
    created: new Date().toISOString(),
  };
}

/** Read-normalize a stored reminder: holonId → string, createdAt → created. */
export function normalizeQuestReminder(raw: unknown): QuestReminder | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.id == null) return null;
  const createdRaw = r.created ?? r.createdAt;
  const created =
    typeof createdRaw === 'string'
      ? createdRaw
      : typeof createdRaw === 'number'
        ? new Date(createdRaw).toISOString()
        : new Date().toISOString();
  return {
    ...(r as QuestReminder),
    holonId: String(r.holonId ?? ''),
    lens: (r.lens as string) ?? 'quests',
    created,
  };
}

/** Lookup key matching telegram's `${holonId}${questId}` convention. */
export function questReminderLookupKey(
  holonId: string | number,
  questId: string | number
): string {
  return `${holonId}${questId}`;
}

// --- GLOBAL persistence -----------------------------------------------------

/** List all quest reminders (normalised). */
export async function listQuestReminders(
  db: RecurringScheduleDB
): Promise<QuestReminder[]> {
  const list = ((await db.getAllGlobal(REMINDERS_LENS)) ?? []) as unknown[];
  return list
    .map(normalizeQuestReminder)
    .filter((r): r is QuestReminder => r !== null);
}

/** Fetch one quest reminder by id (normalised), or null. */
export async function getQuestReminder(
  db: RecurringScheduleDB,
  reminderId: string
): Promise<QuestReminder | null> {
  return normalizeQuestReminder(await db.getGlobal(REMINDERS_LENS, reminderId));
}

/** Persist a quest reminder + its lookup index. */
export async function saveQuestReminder(
  db: RecurringScheduleDB,
  reminder: QuestReminder
): Promise<void> {
  await db.putGlobal(REMINDERS_LENS, reminder);
  await db.putGlobal(REMINDERS_LOOKUP_LENS, {
    id: questReminderLookupKey(reminder.holonId, reminder.questId),
    reminderId: reminder.id,
  });
}

/** Delete a quest reminder + its lookup index. */
export async function deleteQuestReminder(
  db: RecurringScheduleDB,
  reminderId: string
): Promise<void> {
  const existing = await getQuestReminder(db, reminderId);
  if (existing) {
    await db.deleteGlobal(
      REMINDERS_LOOKUP_LENS,
      questReminderLookupKey(existing.holonId, existing.questId)
    );
  }
  await db.deleteGlobal(REMINDERS_LENS, reminderId);
}
