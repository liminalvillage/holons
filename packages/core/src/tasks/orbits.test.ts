// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import { QUEST_FREQUENCIES } from './recurrence.js';
import { orbitAngle, orbitPhase, orbitRing } from './orbits.js';

const local = (y: number, mo: number, d: number, h = 0, mi = 0): Date =>
  new Date(y, mo - 1, d, h, mi);

describe('orbitPhase', () => {
  it('has no orbit for a one-off quest', () => {
    expect(orbitPhase({ when: '2026-09-01' }, local(2026, 9, 5))).toBeNull();
    expect(orbitPhase({ frequency: 'weekly' }, local(2026, 9, 5))).toBeNull();
    expect(orbitPhase(null, local(2026, 9, 5))).toBeNull();
  });

  it('places a weekly timed series by the fraction of its lap', () => {
    // Every Tuesday 10:00 from 1 Sep 2026; now = Sat 5 Sep 10:00 → next Tue 8 Sep.
    const q = { frequency: 'weekly', when: local(2026, 9, 1, 10).toISOString() };
    const p = orbitPhase(q, local(2026, 9, 5, 10))!;
    expect(p.frequency).toBe('weekly');
    expect(p.next).toEqual(local(2026, 9, 8, 10));
    expect(p.previous).toEqual(local(2026, 9, 1, 10));
    expect(p.progress).toBeCloseTo(4 / 7, 5);
    expect(p.due).toBe(false);
  });

  it('is due on the day of an all-day occurrence', () => {
    const q = { frequency: 'daily', when: '2026-09-01' };
    const p = orbitPhase(q, local(2026, 9, 3, 15))!;
    expect(p.next).toEqual(local(2026, 9, 3));
    expect(p.nextWhen).toBe('2026-09-03');
    expect(p.progress).toBe(1);
    expect(p.due).toBe(true);
  });

  it('moves on to the next lap once the occurrence is ticked off', () => {
    const q = {
      frequency: 'daily',
      when: '2026-09-01',
      completedOccurrences: ['2026-09-03'],
    };
    const p = orbitPhase(q, local(2026, 9, 3, 12))!;
    expect(p.next).toEqual(local(2026, 9, 4));
    expect(p.progress).toBeCloseTo(0.5, 5);
    expect(p.due).toBe(false);
  });

  it('uses the real month length for a monthly lap', () => {
    const q = { frequency: 'monthly', when: '2026-01-15' };
    const p = orbitPhase(q, local(2026, 2, 20))!;
    expect(p.previous).toEqual(local(2026, 2, 15));
    expect(p.next).toEqual(local(2026, 3, 15));
    // February 2026: 28 days.
    expect(Math.round(p.periodMs / 86_400_000)).toBe(28);
  });

  it('counts the first lap back from the series start', () => {
    const q = { frequency: 'weekly', when: '2026-09-10' };
    const p = orbitPhase(q, local(2026, 9, 6))!;
    expect(p.next).toEqual(local(2026, 9, 10));
    expect(p.previous).toEqual(local(2026, 9, 3));
    expect(p.progress).toBeCloseTo(3 / 7, 5);
  });
});

describe('orbitRing / orbitAngle', () => {
  it('rings fastest cadences nearest the sun, every cadence its own', () => {
    const rings = QUEST_FREQUENCIES.map(orbitRing);
    expect(rings).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(orbitRing('daily')).toBeLessThan(orbitRing('yearly'));
  });

  it('turns progress into a clockwise angle from 12 o\'clock', () => {
    expect(orbitAngle({ progress: 0 })).toBe(0);
    expect(orbitAngle({ progress: 0.25 })).toBeCloseTo(Math.PI / 2, 10);
  });
});
