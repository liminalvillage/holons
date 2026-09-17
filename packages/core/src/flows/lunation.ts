// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Lunations — the lunar cycle as a period a holon keeps its books by.
 *
 * Holons count in moons, not months: an epoch runs from one new moon to the
 * next. This module is the one place that says when a cycle begins, so the
 * Flows board, the timeline and anything that labels an epoch all agree.
 *
 * The maths is the classic Meeus/`moontool` correction — mean new moon for a
 * synodic index, then the periodic terms that pull it onto the true new moon.
 * A mean-synodic approximation would have been a dozen lines shorter and up
 * to ~14 hours wrong, which is enough to put a claim raised on the night of a
 * new moon in the neighbouring cycle, and enough to disagree visibly with the
 * moons the kiosk timeline already draws.
 *
 * Ported rather than imported deliberately: `lune`, which the UIs use for the
 * same maths, is CommonJS, and core is ESM consumed as `dist` by five
 * different bundlers. It stays a devDependency instead, and `lunation.test.ts`
 * asserts this module agrees with it — the accuracy is pinned to a reference
 * implementation without the interop.
 *
 * Everything is pure and takes explicit timestamps; nothing here reads a clock
 * except through a default argument.
 */

/** Mean length of a lunar cycle, in days. */
export const SYNODIC_MONTH_DAYS = 29.53058868;

/** Julian day number of the Unix epoch. */
const JULIAN_UNIX_EPOCH = 2440587.5;

const MS_PER_DAY = 86400000;

const julianOf = (ms: number): number => ms / MS_PER_DAY + JULIAN_UNIX_EPOCH;
const msOf = (julian: number): number => (julian - JULIAN_UNIX_EPOCH) * MS_PER_DAY;

/** Sine of an angle given in degrees, which is how the terms below are written. */
const dsin = (degrees: number): number => Math.sin((Math.PI / 180) * degrees);

/**
 * The mean new moon for synodic index `k`, as a Julian day.
 *
 * `k` counts synodic months from 1900; it is not the cycle's name, only the
 * handle the series is indexed by.
 */
function meanNewMoon(k: number): number {
  const t = k / 1236.85;
  return (
    2415020.75933 +
    SYNODIC_MONTH_DAYS * k +
    (0.0001178 - 0.000000155 * t) * t * t +
    0.00033 * dsin(166.56 + (132.87 - 0.009173 * t) * t)
  );
}

/**
 * The true new moon for synodic index `k`, in ms.
 *
 * The mean time, corrected by the sun's and moon's anomalies and the moon's
 * argument of latitude. These are the new/full-moon coefficients; the quarters
 * use a different set, which nothing here needs.
 */
function trueNewMoon(k: number): number {
  const t = k / 1236.85;
  // Sun's mean anomaly, moon's mean anomaly, moon's argument of latitude.
  const m = 359.2242 + 29.10535608 * k - (0.0000333 - 0.00000347 * t) * t * t;
  const mprime = 306.0253 + 385.81691806 * k + (0.0107306 + 0.00001236 * t) * t * t;
  const f = 21.2964 + 390.67050646 * k - (0.0016528 - 0.00000239 * t) * t * t;

  const corrected =
    meanNewMoon(k) +
    (0.1734 - 0.000393 * t) * dsin(m) +
    0.0021 * dsin(2 * m) -
    0.4068 * dsin(mprime) +
    0.0161 * dsin(2 * mprime) -
    0.0004 * dsin(3 * mprime) +
    0.0104 * dsin(2 * f) -
    0.0051 * dsin(m + mprime) -
    0.0074 * dsin(m - mprime) +
    0.0004 * dsin(2 * f + m) -
    0.0004 * dsin(2 * f - m) -
    0.0006 * dsin(2 * f + mprime) +
    0.001 * dsin(2 * f - mprime) +
    0.0005 * dsin(m + 2 * mprime);

  return msOf(corrected);
}

/**
 * The synodic index whose cycle contains `ts`.
 *
 * The seed is the usual 12.3685 cycles a year, which lands within a cycle or
 * two; the walk then steps onto the one that actually contains the moment.
 * Bounded so that a nonsense clock cannot spin here forever.
 */
function indexContaining(ts: number): number {
  const date = new Date(ts);
  let k = Math.floor(12.3685 * (date.getUTCFullYear() + date.getUTCMonth() / 12 - 1900));
  for (let guard = 0; guard < 64; guard++) {
    if (ts < trueNewMoon(k)) {
      k--;
      continue;
    }
    if (ts >= trueNewMoon(k + 1)) {
      k++;
      continue;
    }
    break;
  }
  return k;
}

/**
 * The cycle's number, on the same base and synodic constants the Telegram
 * bot's `/newmoon` counts by, so one cycle carries one name across surfaces.
 *
 * Taken at the new-moon instant itself and rounded: at the boundary the
 * quotient is an integer, and rounding is the only reading that does not
 * wobble with floating point.
 */
function numberOf(newMoonMs: number): number {
  const BASE_JULIAN = 2423436.40347;
  const BASE_SYNODIC = 29.530588861;
  return Math.round((julianOf(newMoonMs) - BASE_JULIAN) / BASE_SYNODIC) - 1200;
}

/** One lunar cycle: when it opens, when it closes, and what it is called. */
export interface Lunation {
  /** The cycle's number. Consecutive cycles differ by one. */
  index: number;
  /** The new moon that opens it, in ms. Inclusive. */
  from: number;
  /** The last millisecond before the next new moon. Inclusive. */
  to: number;
}

/**
 * The lunar cycle containing `ts`.
 *
 * Cycles tile time without gaps or overlaps: the next one is
 * `lunationAt(cycle.to + 1)` and the previous `lunationAt(cycle.from - 1)`,
 * which is why there is no separate "shift" helper.
 */
export function lunationAt(ts: number = Date.now()): Lunation {
  const k = indexContaining(ts);
  const from = trueNewMoon(k);
  return { index: numberOf(from), from, to: trueNewMoon(k + 1) - 1 };
}
