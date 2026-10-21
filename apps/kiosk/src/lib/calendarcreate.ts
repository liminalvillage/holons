// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

// Where the calendar's ＋ puts a new event. It used to be "now" whatever the
// board showed, so a ＋ pressed while looking at next Tuesday wrote the event
// into today, out of sight — and not in the drawer either, since it had a
// date. The draft belongs to the window on screen: today while today is in
// it, otherwise the window's first day, at the present wall-clock time so
// the form still opens on a sensible hour.

/** The stretch of days a calendar window shows: `[start, end)`. */
export interface DayWindow {
  start: Date;
  end: Date;
}

/** The moment a ＋ pressed over `window` drafts an event at. */
export function createMoment(window: DayWindow, now: Date): Date {
  if (now >= window.start && now < window.end) return now;
  const d = new Date(window.start);
  d.setHours(now.getHours(), now.getMinutes(), 0, 0);
  return d;
}
