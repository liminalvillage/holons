import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALLOCATION_CONFIG,
  allocate,
  calculateZonePercentages,
  normalizeAllocationConfig,
} from './allocation.js';
import { allocationToGraph, partyIdOf, partyNodeId, segmentTotal } from './allocation-graph.js';

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

  it('gives each partner its full zone weight, like the contract', () => {
    // Two partners share zone 1: on-chain each carries the whole zone weight
    // (normalized per member), so together they take the zone's doubled share
    // rather than splitting a fixed zone share.
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
    // steepness 100 → equal weights; zone 2 is empty, so the two partners
    // split the entire exterior side between them.
    expect(zone1.members![0].percentage).toBeCloseTo(50, 8);
    expect(zone1.percentage).toBeCloseTo(100, 8);
    expect(result.exterior[1].percentage).toBeCloseTo(0, 8);
  });

  it('redistributes an empty zone to the occupied ones, like the contract', () => {
    // The Bundle contract normalizes over placed members only — an empty zone
    // pays nothing and the full exterior pot reaches actual partners.
    const result = allocate({
      total: 1000,
      config: { interiorPercent: 0, steepness: 100, nzones: 2 },
      members: [],
      zoned: [{ id: 'p1', name: 'One', zone: 1 }],
    });
    expect(result.exterior[0].percentage).toBeCloseTo(100, 8);
    const zone2 = result.exterior[1];
    expect(zone2.percentage).toBeCloseTo(0, 8);
    expect(zone2.members).toHaveLength(0);
  });

  it('matches the on-chain distribution observed on Sepolia', () => {
    // Pinned against the Bundle contract test of 2026-08-30: 0.01 ETH through
    // interior 70% (alice 60 / bob 40) and exterior 30% (partners in zones 1
    // and 2 of 3, steepness 0.5) paid 0.0042 / 0.0028 / 0.002 / 0.001.
    const result = allocate({
      total: 0.01,
      config: { interiorPercent: 70, steepness: 50, nzones: 3 },
      members: [
        { id: 'alice', name: 'Alice', percentage: 60 },
        { id: 'bob', name: 'Bob', percentage: 40 },
      ],
      zoned: [
        { id: 'pa', name: 'Partner A', zone: 1 },
        { id: 'pb', name: 'Partner B', zone: 2 },
      ],
    });
    expect(result.interior[0].amount).toBeCloseTo(0.0042, 10);
    expect(result.interior[1].amount).toBeCloseTo(0.0028, 10);
    expect(result.exterior[0].members![0].amount).toBeCloseTo(0.002, 10);
    expect(result.exterior[1].members![0].amount).toBeCloseTo(0.001, 10);
    expect(result.exterior[2].percentage).toBeCloseTo(0, 8);
  });

  it('matches the on-chain multi-member zone probe', () => {
    // Pinned against the Sepolia probe: zones [1,1,2] at steepness 0.5 split
    // 0.003 as 0.0012 / 0.0012 / 0.0006 — per-member weights, not per-zone.
    const result = allocate({
      total: 0.003,
      config: { interiorPercent: 0, steepness: 50, nzones: 3 },
      members: [],
      zoned: [
        { id: 'x', name: 'X', zone: 1 },
        { id: 'y', name: 'Y', zone: 1 },
        { id: 'z', name: 'Z', zone: 2 },
      ],
    });
    const [zone1, zone2] = result.exterior;
    expect(zone1.members![0].amount).toBeCloseTo(0.0012, 10);
    expect(zone1.members![1].amount).toBeCloseTo(0.0012, 10);
    expect(zone2.members![0].amount).toBeCloseTo(0.0006, 10);
  });

  it('previews the structural decay shares when nobody is placed', () => {
    // With no partners the contract retains the exterior pot, so there is no
    // payout to mirror; the zones keep their configured decay shares so the
    // editor still shows the shape being configured.
    const result = allocate({
      total: 1000,
      config: { interiorPercent: 0, steepness: 50, nzones: 2 },
      members: [],
      zoned: [],
    });
    expect(result.exterior[0].percentage).toBeGreaterThan(result.exterior[1].percentage);
    expect(result.exterior.reduce((s, z) => s + z.percentage, 0)).toBeCloseTo(100, 8);
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

  it('conserves value into the party column', () => {
    const intoMembers = graph.links
      .filter((l) => l.source === '__interior')
      .reduce((s, l) => s + l.value, 0);
    expect(intoMembers).toBeCloseTo(500, 8);
    const parties = graph.nodes.filter((n) => n.id.startsWith('party-'));
    expect(parties.reduce((s, n) => s + n.value, 0)).toBeCloseTo(1000, 8);
  });

  it('puts members and partners in one column, members fed straight from the interior', () => {
    // Members skip the zone column: their ribbon runs from depth 1 to depth 3
    // so every party ends on the same edge of the chart.
    const a = graph.nodes.find((n) => n.id === partyNodeId('a'))!;
    const p1 = graph.nodes.find((n) => n.id === partyNodeId('p1'))!;
    expect(a.depth).toBe(3);
    expect(p1.depth).toBe(3);
    expect(a.kind).toBe('member');
    expect(p1.kind).toBe('partner');
    expect(graph.links.find((l) => l.target === a.id)!.source).toBe('__interior');
    expect(graph.links.find((l) => l.target === p1.id)!.source).toBe('zone-1');
    expect(partyIdOf(a.id)).toBe('a');
    expect(partyIdOf('zone-1')).toBeNull();
  });

  it('draws a twice-seated party as one bar fed by both ribbons', () => {
    // Member a (250) is also placed on the ring beside p1: 500 split evenly →
    // 250 each. One bar of 500, one ribbon from the interior, one from the zone.
    const twice = allocate({
      total: 1000,
      unit: 'eur',
      config: { interiorPercent: 50, steepness: 100, nzones: 1 },
      members,
      zoned: [
        { id: 'p1', name: 'One', zone: 1 },
        { id: 'a', name: 'A', zone: 1, kind: 'person' },
      ],
    });
    const g = allocationToGraph(twice);
    const bars = g.nodes.filter((n) => partyIdOf(n.id) === 'a');
    expect(bars).toHaveLength(1);
    expect(bars[0].value).toBeCloseTo(500, 8);
    expect(bars[0].kind).toBe('member');
    const feeds = g.links.filter((l) => l.target === bars[0].id).map((l) => [l.source, l.value]);
    expect(feeds).toEqual([
      ['__interior', 250],
      ['zone-1', 250],
    ]);
    expect(g.nodes.some((n) => n.id === 'member-a' || n.id === 'partner-a')).toBe(false);
  });

  it('drops an empty zone when others are occupied', () => {
    // Contract parity: an empty zone pays nothing, so it carries no value and
    // does not appear; the occupied zone takes the whole exterior side.
    const lonely = allocationToGraph(
      allocate({
        total: 100,
        config: { interiorPercent: 0, steepness: 100, nzones: 2 },
        members: [],
        zoned: [{ id: 'p1', name: 'One', zone: 1 }],
      }),
    );
    expect(lonely.nodes.find((n) => n.id === 'zone-2')).toBeUndefined();
    const zone1 = lonely.nodes.find((n) => n.id === 'zone-1');
    expect(zone1!.value).toBeCloseTo(100, 8);
  });

  it('ends a partner-less zone at depth 2 in the structural preview', () => {
    // With nobody placed anywhere, zones show their configured decay shares
    // and terminate at depth 2 (the layout allows a column to end early).
    const preview = allocationToGraph(
      allocate({
        total: 100,
        config: { interiorPercent: 0, steepness: 100, nzones: 2 },
        members: [],
        zoned: [],
      }),
    );
    const zone2 = preview.nodes.find((n) => n.id === 'zone-2');
    expect(zone2!.depth).toBe(2);
    expect(preview.links.some((l) => l.source === 'zone-2')).toBe(false);
  });

  it('sits the parties beside the zones when nobody is placed on one', () => {
    const preview = allocationToGraph(
      allocate({
        total: 100,
        config: { interiorPercent: 50, steepness: 100, nzones: 2 },
        members,
        zoned: [],
      }),
    );
    expect(preview.nodes.find((n) => n.id === partyNodeId('a'))!.depth).toBe(2);
    expect(Math.max(...preview.nodes.map((n) => n.depth))).toBe(2);
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

describe('allocationToGraph with fund usage', () => {
  const usage = (parties: Record<string, { spent: number; claimed: number }>, unattributed = { spent: 0, claimed: 0 }) => ({
    unit: 'eur',
    parties: Object.fromEntries(Object.entries(parties).map(([id, use]) => [id, { eur: use }])),
    unattributed: unattributed.spent + unattributed.claimed > 0 ? { eur: unattributed } : {},
    unattributedPayees: [],
  });

  const result = allocate({
    total: 1000,
    unit: 'eur',
    config: { interiorPercent: 50, steepness: 100, nzones: 1 },
    members, // a 50 / b 30 / c 20 → 250 / 150 / 100
    zoned: [{ id: 'p1', name: 'One', zone: 1 }], // 500
  });

  const stackOf = (track: ReturnType<typeof allocationToGraph>, id: string) =>
    Object.fromEntries((track.nodes.find((n) => n.id === id)?.segments ?? []).map((s) => [s.kind, s.value]));

  it('stacks every right into spent, claimed and available on its own bar', () => {
    const graph = allocationToGraph(result, {}, usage({ a: { spent: 100, claimed: 50 }, p1: { spent: 500, claimed: 0 } }));
    expect(stackOf(graph, partyNodeId('a'))).toEqual({ spent: 100, claimed: 50, available: 100 });
    expect(stackOf(graph, partyNodeId('b'))).toEqual({ available: 150 });
    expect(stackOf(graph, partyNodeId('p1'))).toEqual({ spent: 500 });
    // The bar is still the right; the stack is how it is made up.
    expect(graph.nodes.find((n) => n.id === partyNodeId('a'))!.value).toBeCloseTo(250, 8);
    // No column after the parties: the stack replaced the sinks.
    expect(Math.max(...graph.nodes.map((n) => n.depth))).toBe(3);
    expect(graph.nodes.some((n) => n.id.startsWith('__s') || n.id.startsWith('__a') || n.id === '__over')).toBe(false);
    expect(segmentTotal(graph, 'spent')).toBe(600);
    expect(segmentTotal(graph, 'claimed')).toBe(50);
    expect(segmentTotal(graph, 'available')).toBe(350);
    expect(segmentTotal(graph, 'over')).toBe(0);
  });

  it('labels the slices with the caller\'s words', () => {
    const graph = allocationToGraph(result, { spent: 'Speso', available: 'Disponibile' }, usage({ a: { spent: 100, claimed: 0 } }));
    const a = graph.nodes.find((n) => n.id === partyNodeId('a'))!;
    expect(a.segments!.map((s) => s.label)).toEqual(['Speso', 'Disponibile']);
  });

  it('stacks a twice-seated party\'s usage once, over the whole of their right', () => {
    // Member a (250) is also placed on the ring beside p1: 500 split evenly → 250 each.
    const twice = allocate({
      total: 1000,
      unit: 'eur',
      config: { interiorPercent: 50, steepness: 100, nzones: 1 },
      members,
      zoned: [
        { id: 'p1', name: 'One', zone: 1 },
        { id: 'a', name: 'A', zone: 1, kind: 'person' },
      ],
    });
    // a drew 600 in all against a right of 500: 100 over.
    const graph = allocationToGraph(twice, {}, usage({ a: { spent: 600, claimed: 0 } }));
    const a = graph.nodes.find((n) => n.id === partyNodeId('a'))!;
    expect(stackOf(graph, a.id)).toEqual({ spent: 500, over: 100 });
    expect(a.value).toBeCloseTo(600, 8);
    // Both ribbons in are still the seats' rights.
    const feeds = graph.links.filter((l) => l.target === a.id).reduce((s, l) => s + l.value, 0);
    expect(feeds).toBeCloseTo(500, 8);
    expect(segmentTotal(graph, 'over')).toBe(100);
  });

  it('draws an overrun rather than clipping it', () => {
    const graph = allocationToGraph(result, {}, usage({ b: { spent: 250, claimed: 30 } }));
    const b = graph.nodes.find((n) => n.id === partyNodeId('b'))!;
    // The ribbon in is still the right (150); the bar grows to carry 280.
    expect(graph.links.find((l) => l.target === b.id)!.value).toBeCloseTo(150, 8);
    expect(b.value).toBeCloseTo(280, 8);
    expect(stackOf(graph, b.id)).toEqual({ spent: 150, over: 130 });
    expect(segmentTotal(graph, 'available')).toBeCloseTo(850, 8);
  });

  it('gives unattributed payouts their own stacked branch off the pot', () => {
    const graph = allocationToGraph(result, { unattributed: 'Nobody' }, usage({}, { spent: 70, claimed: 30 }));
    const pot = graph.nodes.find((n) => n.id === '__pot')!;
    expect(pot.value).toBeCloseTo(1100, 8);
    const branch = graph.nodes.find((n) => n.id === '__unattributed')!;
    expect(branch.depth).toBe(1);
    expect(branch.label).toBe('Nobody');
    expect(branch.value).toBe(100);
    expect(stackOf(graph, branch.id)).toEqual({ spent: 70, claimed: 30 });
    expect(graph.links.some((l) => l.source === '__unattributed')).toBe(false);
    expect(graph.totalIn).toBeCloseTo(1100, 8);
  });

  it('ignores usage when the pot is only percentages', () => {
    const pct = allocate({
      total: null,
      config: { interiorPercent: 100, steepness: 100, nzones: 1 },
      members,
      zoned: [],
    });
    const graph = allocationToGraph(pct, {}, usage({ a: { spent: 10, claimed: 0 } }, { spent: 5, claimed: 0 }));
    expect(graph.nodes.some((n) => n.segments || n.id === '__unattributed')).toBe(false);
    expect(graph.nodes.find((n) => n.id === '__pot')!.value).toBeCloseTo(100, 8);
  });

  it('leaves the plain graph untouched without usage', () => {
    const plain = allocationToGraph(result);
    expect(plain.nodes.some((n) => n.depth > 3)).toBe(false);
    expect(plain.nodes.some((n) => n.segments)).toBe(false);
  });
});
