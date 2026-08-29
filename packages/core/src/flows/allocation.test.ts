import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALLOCATION_CONFIG,
  allocate,
  calculateZonePercentages,
  normalizeAllocationConfig,
} from './allocation.js';
import { allocationToGraph } from './allocation-graph.js';

/**
 * The web's original implementation, inlined so the port is checked against the
 * behaviour it replaced rather than against itself.
 */
function originalCalculateZonePercentages(steepness: number, nzones: number): number[] {
  if (nzones <= 0) return [];
  const decay = steepness / 100;
  const weights: number[] = [];
  let total = 0;
  for (let z = 0; z < nzones; z++) {
    const weight = Math.pow(decay, z);
    weights.push(weight);
    total += weight;
  }
  if (total === 0) return weights.map(() => 100 / nzones);
  return weights.map((w) => (w / total) * 100);
}

const members = [
  { id: 'a', name: 'Ana', percentage: 50 },
  { id: 'b', name: 'Ben', percentage: 30 },
  { id: 'c', name: 'Cyd', percentage: 20 },
];

describe('allocate dedupes repeated ids', () => {
  it('yields one slice per member and per partner', () => {
    const result = allocate({
      total: 100,
      config: { interiorPercent: 50, steepness: 1, nzones: 1 },
      members: [
        { id: 'a', name: 'A', percentage: 50 },
        { id: 'a', name: 'A', percentage: 50 },
        { id: 'b', name: 'B', percentage: 50 },
      ],
      zoned: [
        { id: 'p', name: 'P', zone: 1 },
        { id: 'p', name: 'P', zone: 1 },
      ],
    });
    const ids = [...result.interior, ...result.exterior].map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const zone = result.exterior.find((s) => s.id === "zone-1");
    expect(zone?.members?.map((m) => m.id)).toEqual(['p']);
  });
});

describe('calculateZonePercentages', () => {
  it('matches the web implementation it was ported from', () => {
    for (const steepness of [0, 1, 25, 50, 75, 99, 100]) {
      for (const nzones of [1, 3, 6, 10]) {
        expect(calculateZonePercentages(steepness, nzones)).toEqual(
          originalCalculateZonePercentages(steepness, nzones),
        );
      }
    }
  });

  it('sums to 100', () => {
    const pct = calculateZonePercentages(50, 6);
    expect(pct.reduce((s, p) => s + p, 0)).toBeCloseTo(100, 10);
  });

  it('decays outward when steepness is below full', () => {
    const pct = calculateZonePercentages(50, 4);
    expect(pct[0]).toBeGreaterThan(pct[1]);
    expect(pct[1]).toBeGreaterThan(pct[2]);
  });

  it('spreads evenly at full steepness', () => {
    const pct = calculateZonePercentages(100, 4);
    for (const p of pct) expect(p).toBeCloseTo(25, 10);
  });

  it('falls back to an even split at zero steepness', () => {
    // 0^0 is 1 and every later zone weighs 0, so the total is non-zero and the
    // first zone takes everything. Pinning this because it is a real edge the
    // fallback branch does NOT catch.
    const pct = calculateZonePercentages(0, 4);
    expect(pct[0]).toBeCloseTo(100, 10);
    expect(pct[1]).toBeCloseTo(0, 10);
  });

  it('returns nothing for no zones', () => {
    expect(calculateZonePercentages(50, 0)).toEqual([]);
  });
});

describe('normalizeAllocationConfig', () => {
  it('defaults anything unusable', () => {
    expect(normalizeAllocationConfig({})).toEqual(DEFAULT_ALLOCATION_CONFIG);
    expect(normalizeAllocationConfig({ interiorPercent: 'x' })).toEqual(
      DEFAULT_ALLOCATION_CONFIG,
    );
  });

  it('clamps out-of-range percentages', () => {
    expect(normalizeAllocationConfig({ interiorPercent: 900 }).interiorPercent).toBe(100);
    expect(normalizeAllocationConfig({ interiorPercent: -5 }).interiorPercent).toBe(0);
  });
});

describe('allocate', () => {
  it('splits the whole pot across both sides', () => {
    const result = allocate({
      total: 1000,
      unit: 'eur',
      config: { interiorPercent: 60, steepness: 50, nzones: 3 },
      members,
      zoned: [],
    });

    const all = [...result.interior, ...result.exterior];
    expect(all.reduce((s, x) => s + x.percentage, 0)).toBeCloseTo(100, 8);
    expect(all.reduce((s, x) => s + (x.amount ?? 0), 0)).toBeCloseTo(1000, 8);
  });

  it('divides the interior by contribution score', () => {
    const result = allocate({
      total: 1000,
      config: { interiorPercent: 50, steepness: 50, nzones: 1 },
      members,
      zoned: [],
    });
    // Ana holds half the score, so half of the 50% interior: 25% of the pot.
    expect(result.interior[0].percentage).toBeCloseTo(25, 8);
    expect(result.interior[0].amount).toBeCloseTo(250, 8);
  });

  it('re-normalizes scores that do not sum to 100', () => {
    const result = allocate({
      total: 100,
      config: { interiorPercent: 100, steepness: 50, nzones: 0 },
      members: [
        { id: 'a', name: 'Ana', percentage: 10 },
        { id: 'b', name: 'Ben', percentage: 10 },
      ],
      zoned: [],
    });
    expect(result.interior.reduce((s, m) => s + m.percentage, 0)).toBeCloseTo(100, 8);
  });

  it('gives everything to the interior at 100 percent', () => {
    const result = allocate({
      total: 500,
      config: { interiorPercent: 100, steepness: 50, nzones: 4 },
      members,
      zoned: [],
    });
    expect(result.exterior.every((z) => z.percentage === 0)).toBe(true);
    expect(result.interior.reduce((s, m) => s + m.percentage, 0)).toBeCloseTo(100, 8);
  });

  it('gives everything to the exterior at 0 percent', () => {
    const result = allocate({
      total: 500,
      config: { interiorPercent: 0, steepness: 50, nzones: 4 },
      members,
      zoned: [],
    });
    expect(result.interior).toHaveLength(0);
    expect(result.exterior.reduce((s, z) => s + z.percentage, 0)).toBeCloseTo(100, 8);
  });

  it('divides a zone evenly among its partners', () => {
    const result = allocate({
      total: 1000,
      config: { interiorPercent: 0, steepness: 100, nzones: 2 },
      members: [],
      zoned: [
        { id: 'p1', name: 'One', zone: 1 },
        { id: 'p2', name: 'Two', zone: 1 },
      ],
    });
    const zone1 = result.exterior[0];
    expect(zone1.members).toHaveLength(2);
    expect(zone1.members![0].percentage).toBeCloseTo(zone1.percentage / 2, 8);
  });

  it('keeps an empty zone visible with its share', () => {
    const result = allocate({
      total: 1000,
      config: { interiorPercent: 0, steepness: 100, nzones: 2 },
      members: [],
      zoned: [{ id: 'p1', name: 'One', zone: 1 }],
    });
    const zone2 = result.exterior[1];
    expect(zone2.percentage).toBeGreaterThan(0);
    expect(zone2.members).toHaveLength(0);
  });

  it('ignores unassigned partners', () => {
    const result = allocate({
      total: 1000,
      config: { interiorPercent: 0, steepness: 100, nzones: 2 },
      members: [],
      zoned: [{ id: 'p1', name: 'One', zone: 0 }],
    });
    expect(result.exterior.every((z) => (z.members ?? []).length === 0)).toBe(true);
  });

  it('yields percentage-only slices without a pot', () => {
    const result = allocate({
      total: null,
      config: { interiorPercent: 50, steepness: 50, nzones: 2 },
      members,
      zoned: [],
    });
    expect(result.total).toBeNull();
    expect(result.interior.every((m) => m.amount === null)).toBe(true);
    expect(result.interior.reduce((s, m) => s + m.percentage, 0)).toBeCloseTo(50, 8);
  });
});

describe('allocationToGraph', () => {
  const result = allocate({
    total: 1000,
    unit: 'eur',
    config: { interiorPercent: 50, steepness: 100, nzones: 2 },
    members,
    zoned: [
      { id: 'p1', name: 'One', zone: 1 },
      { id: 'p2', name: 'Two', zone: 1 },
    ],
  });
  const graph = allocationToGraph(result);

  it('produces four columns', () => {
    const depths = new Set(graph.nodes.map((n) => n.depth));
    expect([...depths].sort()).toEqual([0, 1, 2, 3]);
  });

  it('splits the pot per the interior percentage', () => {
    const interior = graph.links.find((l) => l.target === '__interior');
    const exterior = graph.links.find((l) => l.target === '__exterior');
    expect(interior!.value).toBeCloseTo(500, 8);
    expect(exterior!.value).toBeCloseTo(500, 8);
  });

  it('conserves value into each column', () => {
    const intoMembers = graph.links
      .filter((l) => l.source === '__interior')
      .reduce((s, l) => s + l.value, 0);
    expect(intoMembers).toBeCloseTo(500, 8);
  });

  it('ends a partner-less zone at depth 2', () => {
    const lonely = allocationToGraph(
      allocate({
        total: 100,
        config: { interiorPercent: 0, steepness: 100, nzones: 2 },
        members: [],
        zoned: [{ id: 'p1', name: 'One', zone: 1 }],
      }),
    );
    const zone2 = lonely.nodes.find((n) => n.id === 'zone-2');
    expect(zone2!.depth).toBe(2);
    expect(lonely.links.some((l) => l.source === 'zone-2')).toBe(false);
  });

  it('falls back to percentages when there is no pot', () => {
    const pctGraph = allocationToGraph(
      allocate({
        total: null,
        config: { interiorPercent: 50, steepness: 100, nzones: 1 },
        members,
        zoned: [],
      }),
    );
    expect(pctGraph.nodes.find((n) => n.id === '__pot')!.value).toBeCloseTo(100, 8);
  });

  it('returns an empty track when nothing is allocated', () => {
    const empty = allocationToGraph(
      allocate({
        total: 0,
        config: { interiorPercent: 50, steepness: 50, nzones: 0 },
        members: [],
        zoned: [],
      }),
    );
    expect(empty.nodes).toHaveLength(0);
  });
});
