// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/roles — week-schedule + fixed-holder logic (pure, no I/O).
//
// One role can be held two ways:
//   • a *fixed* holder  — a participant flagged `isPermanent`, holding every day;
//   • a *day* holder    — scheduled for a single date in `role.weekSchedule`.
// A fixed holder overrides the week schedule. These helpers are wire-compatible
// with the dashboard (apps/web): identical `weekKey` strings, `YYYY-MM-DD` day
// keys, `weekSchedule.assignments[].users` records, and `participant.isPermanent`
// — so the kiosk and dashboard read and write one shared model.

import { normalizeParticipants } from './operations.js';
import type {
  Role,
  RoleParticipant,
  ScheduledUser,
  WeekSchedule,
} from './types.js';

const DAY_MS = 86_400_000;

// ── Date keys (verbatim from the dashboard's weekUtils, for compatibility) ────

/** ISO week key for a date, e.g. `"2026-W25"`. */
export function weekKeyOf(date: Date): string {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  // Shift to the week's Thursday so the year/number follow the ISO-8601 rule.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7
  );
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** ISO date key (`YYYY-MM-DD`) for a date. */
export function isoDateOf(date: Date): string {
  return date.toISOString().split('T')[0];
}

/** The seven dates (Monday → Sunday) of a week key. */
export function weekDaysOf(weekKey: string): Date[] {
  const [year, week] = weekKey.split('-W').map(Number);
  // Jan 4th is always in ISO week 1; walk back to that week's Monday.
  const jan4 = new Date(year, 0, 4);
  const dow = jan4.getDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - dow + 1);
  const start = new Date(week1Monday);
  start.setDate(week1Monday.getDate() + (week - 1) * 7);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    days.push(day);
  }
  return days;
}

// ── Fixed (permanent) holders ─────────────────────────────────────────────────

/** Participants flagged as fixed holders (they hold the role every day). */
export function permanentHolders(role: Role): RoleParticipant[] {
  return normalizeParticipants(role.participants).filter(
    (p) => p.isPermanent === true
  );
}

/** Whether the role has a fixed holder (which overrides the week schedule). */
export function hasPermanent(role: Role): boolean {
  return permanentHolders(role).length > 0;
}

/** Whether `userId` is a fixed holder of the role. */
export function isPermanentHolder(
  role: Role,
  userId: string | number | null
): boolean {
  if (userId == null) return false;
  return permanentHolders(role).some((p) => String(p.id) === String(userId));
}

/**
 * Make `user` the sole fixed holder: drop any other permanents and any prior
 * entry for this user, then add them flagged `isPermanent`. A fixed holder
 * overrides the week schedule for every day.
 */
export function setPermanent(role: Role, user: RoleParticipant): Role {
  const kept = normalizeParticipants(role.participants).filter(
    (p) => p.isPermanent !== true && String(p.id) !== String(user.id)
  );
  return { ...role, participants: [...kept, { ...user, isPermanent: true }] };
}

/** Remove all fixed holders (keeps any non-permanent participants). */
export function clearPermanent(role: Role): Role {
  return {
    ...role,
    participants: normalizeParticipants(role.participants).filter(
      (p) => p.isPermanent !== true
    ),
  };
}

// ── Per-day holders ───────────────────────────────────────────────────────────

/** That date's scheduled users (ignores fixed holders), or `[]`. */
function dayUsers(role: Role, date: Date): ScheduledUser[] {
  const ws = role.weekSchedule;
  if (!ws || ws.weekKey !== weekKeyOf(date)) return [];
  const day = ws.assignments?.find((a) => a.date === isoDateOf(date));
  return day?.users ?? [];
}

/** A fresh week schedule (all seven days empty) for the week containing `date`. */
function emptyWeek(date: Date): WeekSchedule {
  const key = weekKeyOf(date);
  return {
    weekKey: key,
    assignments: weekDaysOf(key).map((day, i) => ({
      dayOfWeek: i,
      date: isoDateOf(day),
      users: [],
    })),
  };
}

/**
 * Who holds the role on `date`: the fixed holder(s) if any (they win every day),
 * else that day's scheduled users, else nobody. Mirrors the dashboard week cell.
 */
export function holdersForDate(role: Role, date: Date): RoleParticipant[] {
  const perm = permanentHolders(role);
  if (perm.length) return perm;
  return dayUsers(role, date).map((u) => ({
    id: u.id,
    username: u.username ?? null,
  }));
}

/**
 * The single holder to feature for `date`: fixed → that day's slot → the first
 * participant (so a role with a lone member still shows them). Mirrors the
 * dashboard card's "today" resolution. `null` when truly unassigned.
 */
export function todayHolder(role: Role, date: Date): RoleParticipant | null {
  const holders = holdersForDate(role, date);
  if (holders.length) return holders[0];
  return normalizeParticipants(role.participants)[0] ?? null;
}

/** Whether `userId` holds the role on `date` (fixed or that day's slot). */
export function isHolderOnDate(
  role: Role,
  date: Date,
  userId: string | number | null
): boolean {
  if (userId == null) return false;
  return holdersForDate(role, date).some((p) => String(p.id) === String(userId));
}

/**
 * Set the holder(s) for a single day, creating or repointing the week schedule
 * for that date's week as needed. Returns a new role; never mutates the input.
 */
export function setDayUsers(
  role: Role,
  date: Date,
  users: ScheduledUser[]
): Role {
  const key = weekKeyOf(date);
  const base: WeekSchedule =
    role.weekSchedule && role.weekSchedule.weekKey === key
      ? {
          ...role.weekSchedule,
          assignments: role.weekSchedule.assignments.map((a) => ({ ...a })),
        }
      : emptyWeek(date);
  const dateStr = isoDateOf(date);
  let idx = base.assignments.findIndex((a) => a.date === dateStr);
  if (idx === -1) {
    base.assignments.push({
      dayOfWeek: (date.getDay() || 7) - 1,
      date: dateStr,
      users: [],
    });
    idx = base.assignments.length - 1;
  }
  base.assignments[idx] = { ...base.assignments[idx], users };
  return { ...role, weekSchedule: base };
}

/** Clear the holder(s) for a single day. */
export function clearDay(role: Role, date: Date): Role {
  return setDayUsers(role, date, []);
}

/**
 * Toggle `user` as the sole holder for `date`: if they already hold that day,
 * clear it; otherwise set them as the day's holder (replacing anyone else).
 */
export function toggleDayUser(
  role: Role,
  date: Date,
  user: ScheduledUser
): { role: Role; assigned: boolean } {
  const mine = dayUsers(role, date).some(
    (u) => String(u.id) === String(user.id)
  );
  if (mine) return { role: clearDay(role, date), assigned: false };
  return { role: setDayUsers(role, date, [user]), assigned: true };
}
