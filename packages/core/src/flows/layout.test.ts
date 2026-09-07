import { describe, expect, it } from 'vitest';
import { layoutSankey, nodeBreakdown, rolledUpNodes } from './layout.js';
import { allocate } from './allocation.js';
import { allocationToGraph } from './allocation-graph.js';
import type { ValueFlowTrack } from './types.js';

/** A 3-column movement track: two sources, a hub, two sinks. */
const movement: ValueFlowTrack = {
  id: 'money',
  unit: 'eur',
  nodes: [
    { id: 's1', label: 'Contributions', depth: 0, value: 600 },
    { id: 's2', label: 'Fees', depth: 0, value: 400 },
    { id: '__holon', label: 'Holon', depth: 1, value: 1000 },
    { id: 'k1', label: 'Expenses', depth: 2, value: 700 },
    { id: 'k2', label: 'Deposits', depth: 2, value: 300 },
  ],
  links: [
    { id: 'l1', source: 's1', target: '__holon', value: 600 },
    { id: 'l2', source: 's2', target: '__holon', value: 400 },
    { id: 'l3', source: '__holon', target: 'k1', value: 700 },
    { id: 'l4', source: '__holon', target: 'k2', value: 300 },
  ],
  totalIn: 1000,
  totalOut: 1000,
  balance: null,
};

const allocation = allocationToGraph(
  allocate({
    total: 1000,
    unit: 'eur',
    config: { interiorPercent: 50, steepness: 100, nzones: 2 },
    members: [
      { id: 'a', name: 'Ana', percentage: 60 },
      { id: 'b', name: 'Ben', percentage: 40 },
    ],
    zoned: [
      { id: 'p1', name: 'One', zone: 1 },
      { id: 'p2', name: 'Two', zone: 2 },
    ],
  }),
);

/** Every ribbon on a given node edge, as [top, bottom] pairs. */
function overlaps(ranges: Array<[number, number]>): boolean {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i][0] < sorted[i - 1][1] - 1e-6) return true;
  }
  return false;
}

describe('layoutSankey', () => {
  it('reports an empty graph rather than dividing by zero', () => {
    const out = layoutSankey({ ...movement, nodes: [], links: [] });
    expect(out.empty).toBe(true);
    expect(out.nodes).toHaveLength(0);
  });

  it('treats non-positive nodes as nothing to draw', () => {
    const out = layoutSankey({
      ...movement,
      nodes: [{ id: 'z', label: 'Zero', depth: 0, value: 0 }],
      links: [],
    });
    expect(out.empty).toBe(true);
  });

  describe.each([
    ['movement', movement, 3],
    ['allocation', allocation, 4],
  ] as const)('over a %s graph', (_name, track, columns) => {
    const out = layoutSankey(track);

    it('reports the right column count', () => {
      expect(out.empty).toBe(false);
      expect(out.columns).toBe(columns);
    });

    it('puts the first column flush left and the last flush right', () => {
      const w = out.nodes[0].w;
      const first = out.nodes.filter((n) => n.depth === 0);
      const last = out.nodes.filter((n) => n.depth === columns - 1);
      for (const n of first) expect(n.x).toBeCloseTo(0, 6);
      for (const n of last) expect(n.x).toBeCloseTo(1 - w, 6);
    });

    it('keeps every node inside the viewport', () => {
      for (const n of out.nodes) {
        expect(n.y).toBeGreaterThanOrEqual(-1e-6);
        expect(n.y + n.h).toBeLessThanOrEqual(1 + 1e-6);
      }
    });

    it('emits a closed path for every link', () => {
      for (const l of out.links) {
        expect(l.path.startsWith('M')).toBe(true);
        expect(l.path.endsWith('Z')).toBe(true);
        expect(l.path).not.toContain('NaN');
      }
    });

    it('never overlaps two ribbons on one node edge', () => {
      const outgoing = new Map<string, Array<[number, number]>>();
      const incoming = new Map<string, Array<[number, number]>>();
      for (const l of out.links) {
        // Parse the ribbon's two endpoints back out of the path.
        const [, y0t] = l.path.match(/^M([\d.-]+),([\d.-]+)/)!.slice(1).map(Number);
        const y1t = Number(l.path.match(/C[\d.,\s-]+ ([\d.-]+),([\d.-]+)L/)![2]);
        const y1b = Number(l.path.match(/L([\d.-]+),([\d.-]+)C/)![2]);
        const thickness = Math.abs(y1b - y1t);
        (outgoing.get(l.source) ?? outgoing.set(l.source, []).get(l.source)!).push([
          y0t,
          y0t + thickness,
        ]);
        (incoming.get(l.target) ?? incoming.set(l.target, []).get(l.target)!).push([
          y1t,
          y1b,
        ]);
      }
      for (const ranges of outgoing.values()) expect(overlaps(ranges)).toBe(false);
      for (const ranges of incoming.values()) expect(overlaps(ranges)).toBe(false);
    });
  });

  it('scales heights against the heaviest column', () => {
    const out = layoutSankey(movement, { nodeGap: 0 });
    const col0 = out.nodes.filter((n) => n.depth === 0);
    expect(col0.reduce((s, n) => s + n.h, 0)).toBeCloseTo(1, 4);
  });

  it('keeps a lopsided graph on canvas when flow is not conserved', () => {
    // A holon that spent far more than it took in: scaling to the inputs would
    // push the sink column off the bottom.
    const out = layoutSankey({
      ...movement,
      nodes: [
        { id: 's1', label: 'In', depth: 0, value: 10 },
        { id: '__holon', label: 'Holon', depth: 1, value: 500 },
        { id: 'k1', label: 'Out', depth: 2, value: 500 },
      ],
      links: [
        { id: 'l1', source: 's1', target: '__holon', value: 10 },
        { id: 'l2', source: '__holon', target: 'k1', value: 500 },
      ],
    });
    for (const n of out.nodes) expect(n.y + n.h).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('handles a single node', () => {
    const out = layoutSankey({
      ...movement,
      nodes: [{ id: 'only', label: 'Only', depth: 0, value: 5 }],
      links: [],
    });
    expect(out.columns).toBe(1);
    expect(out.nodes[0].h).toBeCloseTo(1, 6);
    // A lone column is centred rather than pinned to an edge.
    expect(out.nodes[0].x).toBeCloseTo((1 - out.nodes[0].w) / 2, 6);
  });

  it('draws a link that skips a column', () => {
    const out = layoutSankey({
      ...movement,
      nodes: [
        { id: 'a', label: 'A', depth: 0, value: 10 },
        { id: 'b', label: 'B', depth: 1, value: 4 },
        { id: 'c', label: 'C', depth: 2, value: 6 },
      ],
      links: [
        { id: 'l1', source: 'a', target: 'b', value: 4 },
        { id: 'l2', source: 'a', target: 'c', value: 6 },
      ],
    });
    const skipping = out.links.find((l) => l.target === 'c')!;
    expect(skipping.path).not.toContain('NaN');
    expect(out.columns).toBe(3);
  });

  it('rolls the tail of a wide column into one node', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({
      id: `n${i}`,
      label: `N${i}`,
      depth: 0,
      value: 12 - i,
    }));
    const out = layoutSankey(
      { ...movement, nodes, links: [] },
      { topN: 4 },
    );
    expect(out.nodes).toHaveLength(5);
    const other = out.nodes.find((n) => n.kind === 'other')!;
    // The eight smallest: 8+7+6+5+4+3+2+1.
    expect(other.value).toBe(36);
    expect(other.label).toBe('+8 more');
  });

  it('retargets a dropped node’s links onto the rollup', () => {
    const nodes = [
      { id: 'big', label: 'Big', depth: 0, value: 100 },
      { id: 'small', label: 'Small', depth: 0, value: 1 },
      { id: 'hub', label: 'Hub', depth: 1, value: 101 },
    ];
    const out = layoutSankey(
      {
        ...movement,
        nodes,
        links: [
          { id: 'l1', source: 'big', target: 'hub', value: 100 },
          { id: 'l2', source: 'small', target: 'hub', value: 1 },
        ],
      },
      { topN: 1 },
    );
    // The small source rolled up, but its value still reaches the hub.
    const total = out.links.reduce((s, l) => s + l.value, 0);
    expect(total).toBeCloseTo(101, 6);
    expect(out.links.some((l) => l.source === '__other_0')).toBe(true);
  });
});

describe('layoutSankey with a column-skipping link', () => {
  it('draws a ribbon from depth 2 straight to depth 4', () => {
    // A ribbon may skip columns — the allocation graph runs a contributor's
    // ribbon from the interior branch past the zone column to the party
    // column. Exercised here with an explicit depth-2 → depth-4 link.
    const track = {
      id: 'allocation' as const,
      unit: 'eur',
      nodes: [
        { id: 'pot', label: 'Pot', depth: 0, value: 100 },
        { id: 'int', label: 'Interior', depth: 1, value: 50 },
        { id: 'ext', label: 'Exterior', depth: 1, value: 50 },
        { id: 'm', label: 'Member', depth: 2, value: 50 },
        { id: 'z', label: 'Zone', depth: 2, value: 50 },
        { id: 'p', label: 'Partner', depth: 3, value: 50 },
        { id: 'avail', label: 'Available', depth: 4, value: 100 },
      ],
      links: [
        { id: 'a', source: 'pot', target: 'int', value: 50 },
        { id: 'b', source: 'pot', target: 'ext', value: 50 },
        { id: 'c', source: 'int', target: 'm', value: 50 },
        { id: 'd', source: 'ext', target: 'z', value: 50 },
        { id: 'e', source: 'z', target: 'p', value: 50 },
        { id: 'f', source: 'm', target: 'avail', value: 50 },
        { id: 'g', source: 'p', target: 'avail', value: 50 },
      ],
      totalIn: 100,
      totalOut: 100,
      balance: null,
    };
    const layout = layoutSankey(track);
    expect(layout.columns).toBe(5);
    const skip = layout.links.find((l) => l.id === 'f')!;
    const m = layout.nodes.find((n) => n.id === 'm')!;
    const avail = layout.nodes.find((n) => n.id === 'avail')!;
    // Starts at the member's right edge, ends at the sink's left edge.
    expect(skip.path.startsWith(`M${m.x + m.w},`)).toBe(true);
    expect(skip.path).toContain(`${avail.x},`);
    // The sink is as tall as the whole flow.
    expect(avail.h).toBeGreaterThan(0.99);
  });
});

describe('layoutSankey with stacked bars', () => {
  const stacked = (id: string, value: number, spent: number) => ({
    id,
    label: id,
    depth: 1,
    value,
    kind: 'member',
    segments: [
      { kind: 'spent', label: 'Spent', value: spent },
      { kind: 'available', label: 'Available', value: value - spent },
    ].filter((s) => s.value > 0),
  });
  const track = {
    id: 'allocation' as const,
    unit: 'eur',
    nodes: [
      { id: 'pot', label: 'Pot', depth: 0, value: 60 },
      stacked('a', 30, 10),
      stacked('b', 20, 20),
      stacked('c', 10, 0),
    ],
    links: [
      { id: 'la', source: 'pot', target: 'a', value: 30 },
      { id: 'lb', source: 'pot', target: 'b', value: 20 },
      { id: 'lc', source: 'pot', target: 'c', value: 10 },
    ],
    totalIn: 60,
    totalOut: 60,
    balance: null,
  };

  it('carries a bar\'s stack through to the layout', () => {
    const out = layoutSankey(track);
    const a = out.nodes.find((n) => n.id === 'a')!;
    expect(a.segments!.map((s) => [s.kind, s.value])).toEqual([
      ['spent', 10],
      ['available', 20],
    ]);
    expect(out.nodes.find((n) => n.id === 'pot')!.segments).toBeUndefined();
  });

  it('stacks a rollup from what it rolled up', () => {
    const out = layoutSankey(track, { topN: 1 });
    const other = out.nodes.find((n) => n.id === '__other_1')!;
    expect(other.value).toBe(30);
    expect(other.segments!.map((s) => [s.kind, s.value])).toEqual([
      ['spent', 20],
      ['available', 10],
    ]);
  });
});

describe('nodeBreakdown on a twice-fed party', () => {
  it('lists where the bar came from', () => {
    const track = allocationToGraph(
      allocate({
        total: 1000,
        unit: 'eur',
        config: { interiorPercent: 50, steepness: 100, nzones: 1 },
        members: [{ id: 'a', name: 'Ana', percentage: 100 }],
        zoned: [
          { id: 'p1', name: 'One', zone: 1 },
          { id: 'a', name: 'Ana', zone: 1, kind: 'person' },
        ],
      }),
      { interior: 'Contributors share' },
    );
    const b = nodeBreakdown(track, layoutSankey(track), 'party-a');
    expect(b.side).toBe('in');
    expect(b.rows.map((r) => [r.label, r.value])).toEqual([
      ['Contributors share', 500],
      ['Zone 1', 250],
    ]);
  });
});

describe('nodeBreakdown', () => {
  const track = {
    id: 'money' as const,
    unit: 'eur',
    nodes: [
      { id: 'a', label: 'Ada', depth: 0, value: 30 },
      { id: 'b', label: 'Ben', depth: 0, value: 20 },
      { id: 'c', label: 'Cyd', depth: 0, value: 5 },
      { id: 'hub', label: 'Holon', depth: 1, value: 55, kind: 'hub' },
      { id: 'x', label: 'Rent', depth: 2, value: 40 },
      { id: 'y', label: 'Food', depth: 2, value: 15 },
    ],
    links: [
      { id: 'la', source: 'a', target: 'hub', value: 30 },
      { id: 'lb', source: 'b', target: 'hub', value: 20 },
      { id: 'lc', source: 'c', target: 'hub', value: 5 },
      { id: 'lx', source: 'hub', target: 'x', value: 40 },
      { id: 'ly', source: 'hub', target: 'y', value: 15 },
    ],
    totalIn: 55,
    totalOut: 55,
    balance: null,
  };
  const layout = layoutSankey(track);

  it('lists what a hub paid out, largest first', () => {
    const b = nodeBreakdown(track, layout, 'hub');
    expect(b.side).toBe('out');
    expect(b.rows.map((r) => [r.label, r.value])).toEqual([['Rent', 40], ['Food', 15]]);
  });

  it('yields nothing for a leaf whose only link is the hub', () => {
    expect(nodeBreakdown(track, layout, 'a').rows).toEqual([]);
    expect(nodeBreakdown(track, layout, 'x').rows).toEqual([]);
  });

  it('lists who fed a terminal bar', () => {
    const t = {
      ...track,
      nodes: [
        { id: 'm1', label: 'Ana', depth: 0, value: 10 },
        { id: 'm2', label: 'Bo', depth: 0, value: 6 },
        { id: 'spent', label: 'Spent', depth: 1, value: 16, kind: 'spent' },
      ],
      links: [
        { id: '1', source: 'm1', target: 'spent', value: 10 },
        { id: '2', source: 'm2', target: 'spent', value: 6 },
      ],
    };
    const b = nodeBreakdown(t, layoutSankey(t), 'spent');
    expect(b.side).toBe('in');
    expect(b.rows.map((r) => r.label)).toEqual(['Ana', 'Bo']);
  });

  it('names the single partner behind a zone', () => {
    const t = {
      ...track,
      nodes: [
        { id: 'z', label: 'Zone 1', depth: 0, value: 10, kind: 'zone' },
        { id: 'p', label: 'Kitchen', depth: 1, value: 10, kind: 'partner' },
      ],
      links: [{ id: '1', source: 'z', target: 'p', value: 10 }],
    };
    expect(nodeBreakdown(t, layoutSankey(t), 'z').rows.map((r) => r.label)).toEqual(['Kitchen']);
  });

  it('lists what a rollup swallowed', () => {
    const many = {
      ...track,
      nodes: [
        ...Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, label: `S${i}`, depth: 0, value: 10 - i })),
        { id: 'hub', label: 'Holon', depth: 1, value: 55, kind: 'hub' },
      ],
      links: Array.from({ length: 10 }, (_, i) => ({ id: `l${i}`, source: `s${i}`, target: 'hub', value: 10 - i })),
    };
    const l = layoutSankey(many);
    const rows = rolledUpNodes(many, l, '__other_0');
    expect(rows.map((r) => r.label)).toEqual(['S8', 'S9']);
    expect(nodeBreakdown(many, l, '__other_0').rows).toEqual(rows);
    expect(rolledUpNodes(many, l, 'hub')).toEqual([]);
  });
});
