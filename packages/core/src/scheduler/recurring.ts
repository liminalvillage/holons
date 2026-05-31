// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/scheduler — recurring-task record + GLOBAL persistence.
//
// A recurring task spawns a quest/event instance on its cadence. Telegram has
// always stored these in the GLOBAL `recurring` table (with a `recurringlookup`
// index); per the "read-normalize only, no bulk rewrite" decision we keep that
// location and only make the SHAPE + persistence core-owned, so every UI reads
// the same canonical records. Each UI keeps its own runner (telegram cron,
// discord/web tick) — see operations.ts (cronExpression / nextOccurrence).

import type { Frequency } from './types.js';

export const RECURRING_LENS = 'recurring';
export const RECURRING_LOOKUP_LENS = 'recurringlookup';

/** A recurring task (canonical shape; `created` ISO, holonId string). */
export interface RecurringTask {
  id: string | number;
  holonId: string;
  title: string;
  frequency: Frequency | string;
  /** ISO start time; the cadence is anchored to this time-of-day. */
  when: string;
  /** Canonical creation timestamp (ISO). */
  created: string;
  /** UI-shaped initiator (optional). */
  initiator?: unknown;
  /** Lens the spawned instance lives in (defaults to 'quests'). */
  lens?: string;
  [key: string]: unknown;
}

/** Index entry mapping a holon+quest to its recurring task. */
export interface RecurringLookup {
  id: string;
  taskID: string | number;
  [key: string]: unknown;
}

/** Minimal global-table surface used by the recurring persistence helpers. */
export interface RecurringScheduleDB {
  getGlobal(lens: string, key: string): Promise<unknown>;
  getAllGlobal(lens: string): Promise<unknown[]>;
  putGlobal(lens: string, value: unknown): Promise<unknown>;
  deleteGlobal(lens: string, key: string): Promise<unknown>;
}

/** Build a canonical recurring-task record. */
export function createRecurringTask(input: {
  id: string | number;
  holonId: string | number;
  title: string;
  frequency: Frequency | string;
  when?: string;
  initiator?: unknown;
  lens?: string;
}): RecurringTask {
  const nowIso = new Date().toISOString();
  return {
    id: input.id,
    holonId: String(input.holonId),
    title: input.title,
    frequency: input.frequency,
    when: input.when ?? nowIso,
    created: nowIso,
    ...(input.initiator != null ? { initiator: input.initiator } : {}),
    ...(input.lens ? { lens: input.lens } : {}),
  };
}

/**
 * Coerce a stored record into the canonical shape: holonId → string, and
 * legacy `createdAt` (ISO or ms) promoted to `created`. Read-normalize only —
 * no rewrite. Returns null for non-objects.
 */
export function normalizeRecurringTask(raw: unknown): RecurringTask | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const createdRaw = r.created ?? r.createdAt;
  const created =
    typeof createdRaw === 'string'
      ? createdRaw
      : typeof createdRaw === 'number'
        ? new Date(createdRaw).toISOString()
        : new Date().toISOString();
  return {
    ...(r as RecurringTask),
    holonId: String(r.holonId ?? ''),
    created,
  };
}

/** Lookup key for a holon+quest pair (matches telegram's `${holonId}${questId}`). */
export function recurringLookupKey(
  holonId: string | number,
  questId: string | number
): string {
  return `${holonId}${questId}`;
}

// --- GLOBAL persistence -----------------------------------------------------

/** List all recurring tasks (normalised). */
export async function listRecurringTasks(
  db: RecurringScheduleDB
): Promise<RecurringTask[]> {
  const list = ((await db.getAllGlobal(RECURRING_LENS)) ?? []) as unknown[];
  return list
    .map(normalizeRecurringTask)
    .filter((t): t is RecurringTask => t !== null);
}

/** Fetch one recurring task by id (normalised), or null. */
export async function getRecurringTask(
  db: RecurringScheduleDB,
  taskId: string | number
): Promise<RecurringTask | null> {
  return normalizeRecurringTask(await db.getGlobal(RECURRING_LENS, String(taskId)));
}

/** Persist a recurring task. */
export async function saveRecurringTask(
  db: RecurringScheduleDB,
  task: RecurringTask
): Promise<void> {
  await db.putGlobal(RECURRING_LENS, task);
}

/** Delete a recurring task by id. */
export async function deleteRecurringTask(
  db: RecurringScheduleDB,
  taskId: string | number
): Promise<void> {
  await db.deleteGlobal(RECURRING_LENS, String(taskId));
}
