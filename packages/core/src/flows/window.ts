// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The period a flows picture covers — one rule for the movement ledger, the
// people chord and the fund usage, so the three describe the same records.
//
// Two ways to say it: `windowDays` (the older relative form: "the last N
// days", `null` for all time) or an explicit `window` with absolute
// millisecond bounds, either end open. A UI's named choice ("this month",
// "custom from/to") resolves to the explicit form through `windowFromChoice`.

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Absolute bounds in ms, inclusive; a missing or null end is open. */
export interface FlowsWindow {
  from?: number | null;
  to?: number | null;
}

/** The inputs every windowed builder shares. */
export interface WindowedInput {
  now?: number;
  /** `null` means all time. Ignored when `window` is given. */
  windowDays?: number | null;
  /** Absolute bounds; wins over `windowDays`. */
  window?: FlowsWindow | null;
}

/**
 * The closed window a builder filters on. An open start is the epoch, an
 * open end is `now`; a window that would end before it starts collapses to
 * its start, so nothing is ever included by mistake.
 */
export function resolveWindow(
  input: WindowedInput,
  defaultDays: number | null,
): { from: number; to: number } {
  const now = input.now ?? Date.now();
  if (input.window) {
    const from = input.window.from ?? 0;
    const to = input.window.to ?? now;
    return { from, to: Math.max(from, to) };
  }
  const days = input.windowDays === undefined ? defaultDays : input.windowDays;
  return { from: days == null ? 0 : now - days * DAY_MS, to: now };
}

/**
 * A named period: the calendar unit we are in, a count of days back from
 * now, all time, or bounds someone typed. Relative presets resolve against
 * `now` each time, so a kiosk left on "this month" rolls over at midnight.
 */
export type FlowsWindowPreset = 'week' | 'month' | '30' | '90' | 'year' | 'all' | 'custom';

export const FLOWS_WINDOW_PRESETS: readonly FlowsWindowPreset[] = [
  'week',
  'month',
  '30',
  '90',
  'year',
  'all',
  'custom',
];

export const DEFAULT_WINDOW_PRESET: FlowsWindowPreset = '90';

export interface FlowsWindowChoice {
  preset: FlowsWindowPreset;
  /** Custom bounds as local calendar dates, `YYYY-MM-DD`; either optional. */
  from?: string | null;
  to?: string | null;
}

export function isWindowPreset(value: unknown): value is FlowsWindowPreset {
  return typeof value === 'string' && (FLOWS_WINDOW_PRESETS as string[]).includes(value);
}

/** Resolve a named choice to absolute bounds. Presets leave the end open. */
export function windowFromChoice(choice: FlowsWindowChoice, now = Date.now()): FlowsWindow {
  const at = new Date(now);
  switch (choice.preset) {
    case 'week': {
      // Weeks start on Monday: Sunday counts as the seventh day, not the first.
      const back = (at.getDay() + 6) % 7;
      return { from: new Date(at.getFullYear(), at.getMonth(), at.getDate() - back).getTime(), to: null };
    }
    case 'month':
      return { from: new Date(at.getFullYear(), at.getMonth(), 1).getTime(), to: null };
    case 'year':
      return { from: new Date(at.getFullYear(), 0, 1).getTime(), to: null };
    case '30':
      return { from: now - 30 * DAY_MS, to: null };
    case 'all':
      return { from: null, to: null };
    case 'custom': {
      const from = parseLocalDate(choice.from);
      const to = parseLocalDate(choice.to);
      return { from, to: to == null ? null : to + DAY_MS - 1 };
    }
    default:
      return { from: now - 90 * DAY_MS, to: null };
  }
}

/** `YYYY-MM-DD` in local time, the form `<input type="date">` speaks. */
export function formatLocalDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight of a `YYYY-MM-DD` string, or null for anything else. */
export function parseLocalDate(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  // Reject overflowed dates (Feb 30 rolls into March) rather than accept them.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date.getTime();
}

/** How many whole days a window spans, both ends counted; null when unbounded. */
export function windowSpanDays(window: FlowsWindow, now = Date.now()): number | null {
  if (window.from == null) return null;
  const to = window.to ?? now;
  return Math.max(1, Math.round((to - window.from) / DAY_MS));
}
