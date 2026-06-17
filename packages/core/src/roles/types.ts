// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/roles — type definitions.
//
// Authoritative shapes for holon roles, shared across UIs. Extracted from
// packages/telegram-ui/src/Roles.ts, where role logic previously lived inline.

/**
 * A role member. The bot historically stored bare usernames (strings); the
 * canonical shape is an object, and `id` may be null for legacy migrated
 * participants whose Telegram/Discord id was never captured.
 */
export interface RoleParticipant {
  id: string | number | null;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  /** A fixed ("permanent") holder — holds the role every day, overriding the
   *  week schedule. Mirrors the dashboard's `participant.isPermanent`. */
  isPermanent?: boolean;
  assigned_at?: string;
}

/** A user scheduled onto a role for a specific day. */
export interface ScheduledUser {
  id: string | number;
  username?: string | null;
  assignedAt?: string;
  assignedVia?: string;
}

/** One day's holders within a {@link WeekSchedule}. */
export interface DayAssignment {
  /** 0 = Monday … 6 = Sunday. */
  dayOfWeek: number;
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  users: ScheduledUser[];
}

/**
 * A role's holders for one ISO week (e.g. `"2026-W25"`). The same shape the
 * dashboard writes, so the kiosk and dashboard share one schedule.
 */
export interface WeekSchedule {
  weekKey: string;
  assignments: DayAssignment[];
  lastModified?: string;
}

/** A holon role. `id` mirrors `title` (titles are unique per holon). */
export interface Role {
  id: string;
  title: string;
  description?: string;
  participants: RoleParticipant[];
  /** Optional pointer to a linked checklist in the `checklists` lens. */
  checklistId?: string | null;
  /** Optional per-day holders for one ISO week (see {@link WeekSchedule}). */
  weekSchedule?: WeekSchedule;
  created?: string;
  // Open shape so existing call sites that read/write extra fields keep working.
  [key: string]: unknown;
}

/**
 * Minimal Holosphere surface the role persistence helpers use. Both UIs pass
 * the real instance; we only require the methods we actually call so this
 * stays UI-agnostic.
 */
export interface RolesDB {
  get(holonId: string, lens: string, key?: string | number): Promise<unknown>;
  getAll(holonId: string, lens: string): Promise<unknown[]>;
  put(holonId: string, lens: string, value: unknown): Promise<unknown>;
  delete(holonId: string, lens: string, key: string | number): Promise<unknown>;
}

/** A user record carrying a per-role completion tally (`roles[roleId]`). */
export interface RoleCountUser {
  id: string | number;
  roles?: Record<string, number>;
  [key: string]: unknown;
}
