// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

// @holons/core/datetime — canonical datetime conventions for Holons.
//
// THE INVARIANT: the store is always UTC. Every timed `when`/`ends`/scheduled
// timestamp persisted to Holosphere is an ISO-8601 instant with an explicit
// timezone (`Z` or `±hh:mm`). UIs convert to/from the viewer's local time at
// their edges — never the other way around.
//
// All-day events are the one exception: they are timezone-less by nature, so
// they're stored as a bare `YYYY-MM-DD` date with no time component. Rendering
// such a value at local midnight keeps it on the same calendar day everywhere.
//
// Subpath import: `import { parseInstant, toStoredInstant } from '@holons/core/datetime'`.

// A timezone-less date or datetime: "2026-06-26" or "2026-06-26T12:00[:ss]".
// The separator may be `T` or a space; fractional seconds are ignored.
const NAIVE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Parse a stored `when`/`ends` value into a Date.
 *
 * A timezone-qualified ISO string (trailing `Z` or `±hh:mm`) is an unambiguous
 * instant — left to the engine and shown in the viewer's local time. A
 * timezone-LESS date/datetime is legacy data (older wall-clock writes) and is
 * interpreted as LOCAL explicitly, because browsers disagree on bare ISO (a
 * bare date is treated as UTC, a seconds-less datetime varies by engine). That
 * ambiguity is what landed event cards on the wrong hour line / day.
 *
 * Returns `null` for empty/invalid input so callers can branch cleanly.
 */
export function parseInstant(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const s = String(value).trim();
  if (!s) return null;
  const m = NAIVE.exec(s);
  const d = m
    ? new Date(
        +m[1],
        +m[2] - 1,
        +m[3],
        +(m[4] ?? 0),
        +(m[5] ?? 0),
        +(m[6] ?? 0),
      )
    : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Serialize a Date to the canonical stored form: a UTC ISO-8601 instant.
 * This is the ONLY way a timed value should be written to the store.
 */
export function toStoredInstant(date: Date): string {
  return date.toISOString();
}

/**
 * Build the canonical stored value from local form fields, as a UI edit edge.
 *
 * - `dateStr` is a local `YYYY-MM-DD` (an `<input type=date>` value).
 * - `timeStr` is a local `HH:MM` (an `<input type=time>` value), optional.
 *
 * With a time, returns a UTC ISO instant (the local wall-clock the user picked,
 * converted to UTC). Without a time, returns the bare date unchanged (all-day).
 * Returns `null` for an empty/invalid date.
 */
export function localFieldsToStored(
  dateStr: string | null | undefined,
  timeStr?: string | null,
): string | null {
  if (!dateStr) return null;
  const [y, mo, d] = dateStr.split('-').map(Number);
  if (!y || !mo || !d) return null;
  if (!timeStr) return `${pad2(y)}-${pad2(mo)}-${pad2(d)}`;
  const [h, min] = timeStr.split(':').map(Number);
  const local = new Date(y, mo - 1, d, h || 0, min || 0);
  if (Number.isNaN(local.getTime())) return null;
  return toStoredInstant(local);
}

/**
 * Split a stored value into the local `YYYY-MM-DD` for an `<input type=date>`.
 * Returns '' when unparseable.
 */
export function toLocalDateField(value: unknown): string {
  const d = parseInstant(value);
  if (!d) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Split a stored value into the local `HH:MM` for an `<input type=time>`.
 * Returns '' when unparseable.
 */
export function toLocalTimeField(value: unknown): string {
  const d = parseInstant(value);
  if (!d) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
