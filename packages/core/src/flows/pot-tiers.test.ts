// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { layoutPotTiers, POT_TIERS_MORE_PREFIX, potTierBandPath } from './pot-tiers.js';
import type { ValueFlowTrack } from './types.js';

const track = (
  nodes: Array<[id: string, depth: number, value: number, kind?: string]>,
  links: Array<[source: string, target: string, value: number]>,
): ValueFlowTrack => ({
  id: 'allocation',
  unit: '',
  nodes: nodes.map(([id, depth, value, kind]) => ({ id, label: id.toUpperCase(), depth, value, kind })),
  links: links.map(([source, target, value]) => ({ id: `${source}>${target}`, source, target, value })),
  totalIn: 100,
  totalOut: 0,
  balance: null,
});

// The Pot keeps 10; fund a keeps 10 of its 60; fund b passes all 30 on.
const pot = track(
  [
    ['pot', 0, 100, 'pot'],
    ['a', 1, 60, 'fund'],
    ['b', 1, 30, 'fund'],
    ['p', 2, 50, 'project'],
    ['q', 2, 30, 'project'],
  ],
  [
    ['pot', 'a', 60],
    ['pot', 'b', 30],
    ['a', 'p', 50],
    ['b', 'q', 30],
  ],
);
const vessel = (t: ReturnType<typeof layoutPotTiers>, id: string) => t.vessels.find((v) => v.id === id)!;

describe('layoutPotTiers', () => {
  it('stacks one row per column, the first across the top', () => {
    const t = layoutPotTiers(pot, { gap: 0, minWidth: 0 });
    expect(t.rows).toBe(3);
    expect(vessel(t, 'pot')).toMatchObject({ row: 0, x: 0, y: 0, w: 1 });
    expect(vessel(t, 'a').y).toBeGreaterThan(vessel(t, 'pot').y + vessel(t, 'pot').h);
    expect(vessel(t, 'p').row).toBe(2);
    for (const v of t.vessels) expect(v.y + v.h).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('draws every width on the top vessel’s scale', () => {
    const t = layoutPotTiers(pot, { gap: 0, minWidth: 0 });
    expect(vessel(t, 'a').w).toBeCloseTo(0.6);
    expect(vessel(t, 'b').w).toBeCloseTo(0.3);
    const band = t.bands.find((b) => b.id === 'pot>a')!;
    expect(band.x1 - band.x0).toBeCloseTo(0.6);
    expect(band.x3 - band.x2).toBeCloseTo(0.6);
  });

  it('says what each vessel keeps as its fee', () => {
    const t = layoutPotTiers(pot);
    expect(vessel(t, 'pot')).toMatchObject({ value: 100, passed: 90, kept: 10 });
    expect(vessel(t, 'a')).toMatchObject({ passed: 50, kept: 10 });
    expect(vessel(t, 'b').kept).toBe(0);
  });

  it('leaves the kept part of a bottom edge bare, at its right end', () => {
    const t = layoutPotTiers(pot, { gap: 0, minWidth: 0 });
    const out = t.bands.filter((b) => b.source === 'pot');
    const right = Math.max(...out.map((b) => b.x1));
    expect(right).toBeCloseTo(0.9);
  });

  it('orders a row under its sources so bands do not cross', () => {
    const crossed = track(
      [
        ['pot', 0, 100],
        ['a', 1, 50],
        ['b', 1, 50],
        ['p', 2, 20],
        ['q', 2, 40],
      ],
      [
        ['pot', 'a', 50],
        ['pot', 'b', 50],
        ['a', 'p', 20],
        ['b', 'q', 40],
      ],
    );
    const t = layoutPotTiers(crossed);
    const left = vessel(t, 'a').x < vessel(t, 'b').x ? 'p' : 'q';
    expect(vessel(t, left).x).toBeLessThan(vessel(t, left === 'p' ? 'q' : 'p').x);
  });

  it('rolls a row past topN into one vessel, its bands merged', () => {
    const many = track(
      [['pot', 0, 100], ...[1, 2, 3, 4].map((i): [string, number, number] => [`f${i}`, 1, 25 - i])],
      [1, 2, 3, 4].map((i): [string, string, number] => ['pot', `f${i}`, 25 - i]),
    );
    const t = layoutPotTiers(many, { topN: 2, moreLabel: 'More funds' });
    const more = vessel(t, `${POT_TIERS_MORE_PREFIX}1`);
    expect(more).toMatchObject({ label: 'More funds', value: 21 + 22, rolled: ['f3', 'f4'] });
    expect(t.bands.filter((b) => b.target === more.id)).toHaveLength(1);
    // One extra is only renamed, never rolled.
    expect(layoutPotTiers(many, { topN: 3 }).vessels.some((v) => v.rolled)).toBe(false);
  });

  it('widens a thin vessel to be tappable and keeps the row on the page', () => {
    const thin = track(
      [['pot', 0, 100], ['big', 1, 99], ['tiny', 1, 0.5]],
      [
        ['pot', 'big', 99],
        ['pot', 'tiny', 0.5],
      ],
    );
    const t = layoutPotTiers(thin, { minWidth: 0.08, gap: 0.02 });
    expect(vessel(t, 'tiny').w).toBeGreaterThan(0.05);
    const row = t.vessels.filter((v) => v.row === 1);
    expect(Math.min(...row.map((v) => v.x))).toBeGreaterThanOrEqual(-1e-9);
    expect(Math.max(...row.map((v) => v.x + v.w))).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('draws what a focus keeps as its edge, not as a vessel', () => {
    const withKept = track(
      [['f', 0, 100], ['p', 1, 70], ['__kept', 1, 30, 'retained']],
      [
        ['f', 'p', 70],
        ['f', '__kept', 30],
      ],
    );
    const t = layoutPotTiers(withKept);
    expect(t.vessels.map((v) => v.id)).toEqual(['f', 'p']);
    expect(vessel(t, 'f').kept).toBeCloseTo(30);
  });

  it('is empty for an empty track', () => {
    expect(layoutPotTiers(track([], []))).toMatchObject({ empty: true, rows: 0, vessels: [], bands: [] });
  });

  it('closes a band path', () => {
    const d = potTierBandPath({ x0: 0, x1: 0.5, x2: 0.2, x3: 0.4, y0: 0.3, y1: 0.6 });
    expect(d.startsWith('M0,0.3')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
  });
});
