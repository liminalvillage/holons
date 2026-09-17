// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The accuracy of this module is pinned to `lune`, the same implementation the
// kiosk timeline draws its moons with. `lune` is CommonJS and stays a
// devDependency: core ships the maths itself (see `lunation.ts`), and these
// tests are what keep the port honest.

import { describe, expect, it } from 'vitest';
import lune from 'lune';
import { SYNODIC_MONTH_DAYS, lunationAt } from './lunation.js';

const DAY = 86400000;
const MINUTE = 60000;

/** Two years of sample moments, roughly one per cycle. */
const samples = Array.from({ length: 24 }, (_, i) =>
  Math.round(Date.UTC(2026, 0, 3) + i * SYNODIC_MONTH_DAYS * DAY),
);

describe('lunationAt', () => {
  it('finds the same new moons as the reference implementation', () => {
    for (const ts of samples) {
      const cycle = lunationAt(ts);
      const reference = lune.phase_hunt(new Date(ts));
      expect(Math.abs(cycle.from - reference.new_date.getTime())).toBeLessThan(MINUTE);
      expect(Math.abs(cycle.to + 1 - reference.nextnew_date.getTime())).toBeLessThan(MINUTE);
    }
  });

  it('contains the moment it was asked about', () => {
    for (const ts of samples) {
      const cycle = lunationAt(ts);
      expect(cycle.from).toBeLessThanOrEqual(ts);
      expect(cycle.to).toBeGreaterThanOrEqual(ts);
    }
  });

  it('runs about a synodic month', () => {
    for (const ts of samples) {
      const cycle = lunationAt(ts);
      const days = (cycle.to + 1 - cycle.from) / DAY;
      // Real cycles wander either side of the mean by a few hours.
      expect(days).toBeGreaterThan(29.2);
      expect(days).toBeLessThan(29.9);
    }
  });

  it('tiles time without a gap or an overlap, numbering as it goes', () => {
    let cycle = lunationAt(samples[0]);
    for (let i = 0; i < 24; i++) {
      const next = lunationAt(cycle.to + 1);
      // The next cycle opens on the millisecond the last one closes.
      expect(next.from).toBe(cycle.to + 1);
      expect(next.index).toBe(cycle.index + 1);
      // …and stepping back from it lands on the cycle we came from.
      expect(lunationAt(cycle.from - 1).index).toBe(cycle.index - 1);
      cycle = next;
    }
  });

  it('is stable exactly on a boundary', () => {
    const cycle = lunationAt(samples[0]);
    // The opening instant belongs to the cycle it opens, not the one before.
    expect(lunationAt(cycle.from).index).toBe(cycle.index);
    expect(lunationAt(cycle.to).index).toBe(cycle.index);
  });
});
