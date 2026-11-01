// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The sky over the year window, shared by its two shapes — the straight
// lines (YearTimeline) and the dial (YearDial): the four solar turning
// points, every new/full moon in a span, and the moon on any given night.
// Pure: no layout here, each shape places these its own way.

import { phase } from "lune";
import { MOON_ICONS } from "./icons";
import type { MessageKey } from "./i18n";

export const DAY_MS = 86400000;

export type SolarKey =
  | "cal.springEquinox"
  | "cal.summerSolstice"
  | "cal.autumnEquinox"
  | "cal.winterSolstice";

export function solarPoints(y: number): Array<{ key: SolarKey; date: Date }> {
  return [
    { key: "cal.springEquinox", date: new Date(y, 2, 20) },
    { key: "cal.summerSolstice", date: new Date(y, 5, 21) },
    { key: "cal.autumnEquinox", date: new Date(y, 8, 22) },
    { key: "cal.winterSolstice", date: new Date(y, 11, 21) },
  ];
}

/** The solar turning points inside `[from, to)`. */
export function solarEventsIn(
  from: number,
  to: number,
): Array<{ key: SolarKey; date: Date }> {
  const y0 = new Date(from).getFullYear();
  const y1 = new Date(to).getFullYear();
  const all: Array<{ key: SolarKey; date: Date }> = [];
  for (let y = y0; y <= y1; y++) all.push(...solarPoints(y));
  return all.filter((s) => {
    const time = s.date.getTime();
    return time >= from && time < to;
  });
}

/**
 * Scan the span in 6-hour steps for the moments the phase crosses new
 * (≈0) or full (≈0.5); the 10-day de-dupe window keeps one marker per
 * lunation. Same recipe as the dashboard's timeline.
 */
export function getMoonPhases(
  from: number,
  to: number,
): Array<{ date: Date; isNew: boolean }> {
  const phases: Array<{ date: Date; isNew: boolean }> = [];
  const end = new Date(to);
  let cursor = new Date(from);
  while (cursor < end) {
    const p = phase(cursor).phase;
    if (p < 0.025 || (p > 0.475 && p < 0.525)) {
      const isDuplicate = phases.some(
        (m) => Math.abs(m.date.getTime() - cursor.getTime()) < 10 * DAY_MS,
      );
      if (!isDuplicate)
        phases.push({ date: new Date(cursor), isNew: p < 0.025 });
    }
    cursor = new Date(cursor.getTime() + 6 * 60 * 60 * 1000);
  }
  return phases;
}

/**
 * The new/full moons of a lunation. Its own edges are its new moons,
 * exactly: pin them there rather than trusting the scan's 6-hour steps to
 * land on them.
 */
export function lunationMoonPhases(
  from: number,
  to: number,
): Array<{ date: Date; isNew: boolean }> {
  return [
    { date: new Date(from), isNew: true },
    ...getMoonPhases(from + 2 * DAY_MS, to - 2 * DAY_MS),
    { date: new Date(to), isNew: true },
  ];
}

export const MOON_NAMES: MessageKey[] = [
  "cal.newMoon",
  "cal.moonWaxingCrescent",
  "cal.moonFirstQuarter",
  "cal.moonWaxingGibbous",
  "cal.fullMoon",
  "cal.moonWaningGibbous",
  "cal.moonLastQuarter",
  "cal.moonWaningCrescent",
];

/** The moon on the night of `date`: face, name, illumination, age. */
export function moonStats(date: Date) {
  const p = phase(date);
  // Band the continuous phase into the 8 named faces (centred bands, so
  // 0±1/16 is "new moon" rather than a sliver of crescent).
  const idx = Math.floor(((p.phase + 1 / 16) % 1) * 8);
  return {
    icon: MOON_ICONS[idx],
    nameKey: MOON_NAMES[idx],
    pct: Math.round(p.illuminated * 100),
    age: Math.max(1, Math.round(p.age)),
  };
}

/** The next solar turning point on or after `date` (crossing new year). */
export function nextSolar(date: Date): { key: SolarKey; days: number } {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const all = [
    ...solarPoints(day.getFullYear()),
    ...solarPoints(day.getFullYear() + 1),
  ];
  const next = all.find((s) => s.date.getTime() >= day.getTime()) ?? all[0];
  return {
    key: next.key,
    days: Math.round((next.date.getTime() - day.getTime()) / DAY_MS),
  };
}
