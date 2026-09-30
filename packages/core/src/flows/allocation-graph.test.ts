// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { allocate, type AllocationConfig } from './allocation.js';
import {
  PASSED_SEGMENT,
  RETAINED_ID,
  allocationToGraph,
  cascadeToGraph,
  partyNodeId,
  segmentTotal,
} from './allocation-graph.js';
import { resolveCascade, type CascadeInputs } from './cascade.js';
import { layoutSankey } from './layout.js';
import type { FundUsage } from './usage.js';

const cfg = (interiorPercent: number): AllocationConfig => ({
  interiorPercent,
  steepness: 50,
  nzones: 3,
  interiorMode: 'custom',
});

const collective = (...ids: string[]): CascadeInputs => ({
  config: cfg(100),
  members: ids.map((id) => ({ id, name: id.toUpperCase(), percentage: 1 })),
  zoned: [],
});

const personal = (keep: number, ...onward: string[]): CascadeInputs => ({
  config: cfg(keep),
  members: [],
  zoned: onward.map((id) => ({ id, name: id.toUpperCase(), zone: 1, kind: 'person' as const })),
});

const cascadeOf = (
  root: CascadeInputs,
  children: Record<string, CascadeInputs>,
  total: number | null = 1000,
) =>
  resolveCascade({
    holonId: 'C',
    total,
    unit: 'EUR',
    root,
    resolveChild: (id) => children[id] ?? null,
  });

const usageOf = (lifetime: Record<string, { spent: number; claimed: number }>): FundUsage => {
  const perParty = Object.fromEntries(Object.entries(lifetime).map(([id, use]) => [id, { eur: use }]));
  return { unit: 'eur', parties: perParty, lifetime: perParty, unattributed: {}, unattributedPayees: [] };
};

describe('cascadeToGraph', () => {
  it('is allocationToGraph when nobody passes anything on', () => {
    const cascade = cascadeOf(collective('u1', 'u2'), {});
    expect(cascadeToGraph(cascade)).toEqual(allocationToGraph(cascade.rootResult));
  });

  it('adds a column per cascade level, with a ribbon out of the party that passes on', () => {
    const cascade = cascadeOf(collective('u1', 'u2'), { u1: personal(60, 'u3'), u3: personal(50, 'u4') });
    const track = cascadeToGraph(cascade);
    const node = (id: string) => track.nodes.find((n) => n.id === partyNodeId(id))!;

    expect(node('u1').depth).toBe(2);
    expect(node('u3').depth).toBe(3);
    expect(node('u4').depth).toBe(4);
    expect(node('u3').label).toBe('U3');

    const out = track.links.find((l) => l.source === partyNodeId('u1'))!;
    expect(out.target).toBe(partyNodeId('u3'));
    expect(out.value).toBeCloseTo(200);
    expect(track.links.find((l) => l.source === partyNodeId('u3'))!.value).toBeCloseTo(100);

    // The bar is everything that reaches the party; what it keeps is the
    // bar less its outflow.
    expect(node('u1').value).toBeCloseTo(500);
    expect(node('u3').value).toBeCloseTo(200);
    expect(layoutSankey(track).columns).toBe(5);
  });

  it('a person reached by two paths is one bar, at the deeper column', () => {
    // u2 is paid by the root AND by u1.
    const cascade = cascadeOf(collective('u1', 'u2'), { u1: personal(50, 'u2') });
    const track = cascadeToGraph(cascade);
    const bars = track.nodes.filter((n) => n.id === partyNodeId('u2'));
    expect(bars).toHaveLength(1);
    expect(bars[0].depth).toBe(3);
    expect(bars[0].value).toBeCloseTo(750);
    expect(track.links.filter((l) => l.target === partyNodeId('u2'))).toHaveLength(2);
  });

  it('two paths through the same pair merge into one ribbon', () => {
    // u3 is reached from the root through u1 twice over: as a member and
    // through u2, who also gives to u1.
    const cascade = cascadeOf(collective('u1', 'u2'), { u1: personal(50, 'u3'), u2: personal(0, 'u1') });
    const track = cascadeToGraph(cascade);
    const ribbons = track.links.filter((l) => l.source === partyNodeId('u1') && l.target === partyNodeId('u3'));
    expect(ribbons).toHaveLength(1);
    expect(ribbons[0].value).toBeCloseTo(500);
  });

  it('a loop draws no backward ribbon, in either direction', () => {
    const cascade = cascadeOf(collective('u1', 'u2'), { u1: personal(60, 'u2'), u2: personal(50, 'u1') });
    const track = cascadeToGraph(cascade);
    const between = track.links.filter(
      (l) => l.source.startsWith('party-') && l.target.startsWith('party-'),
    );
    expect(between).toHaveLength(1);
    const depthOf = (id: string) => track.nodes.find((n) => n.id === id)!.depth;
    for (const link of track.links) expect(depthOf(link.target)).toBeGreaterThan(depthOf(link.source));
    expect(layoutSankey(track).empty).toBe(false);
  });

  it('a share routed back to the root draws no bar for the root', () => {
    const cascade = cascadeOf(collective('u1'), { u1: personal(50, 'C') });
    const track = cascadeToGraph(cascade);
    expect(track.nodes.find((n) => n.id === partyNodeId('C'))).toBeUndefined();
  });

  it('stacks usage against what the party keeps, with the forwarded part as its own slice', () => {
    const cascade = cascadeOf(collective('u1', 'u2'), { u1: personal(60, 'u3') });
    const usage = usageOf({ u1: { spent: 100, claimed: 50 }, u3: { spent: 250, claimed: 0 } });
    const track = cascadeToGraph(cascade, { passed: 'Passed on' }, usage);
    const node = (id: string) => track.nodes.find((n) => n.id === partyNodeId(id))!;

    const u1 = node('u1');
    expect(u1.segments!.map((s) => [s.kind, s.value])).toEqual([
      [PASSED_SEGMENT, 200],
      ['spent', 100],
      ['claimed', 50],
      ['available', 150],
    ]);
    expect(u1.segments![0].label).toBe('Passed on');
    expect(u1.segments!.reduce((s, x) => s + x.value, 0)).toBeCloseTo(u1.value);

    // u3 overran the 200 that reaches them: the bar grows past its ribbon.
    expect(node('u3').value).toBeCloseTo(250);
    expect(segmentTotal(track, 'over')).toBeCloseTo(50);
    // Available is what is left across the fund, net of everything forwarded.
    expect(segmentTotal(track, 'available')).toBeCloseTo(150 + 500);
  });

  it('percentage-only: values are shares of the root pot and no bar is stacked', () => {
    const cascade = cascadeOf(collective('u1', 'u2'), { u1: personal(60, 'u3') }, null);
    const track = cascadeToGraph(cascade, {}, usageOf({ u1: { spent: 10, claimed: 0 } }));
    const u3 = track.nodes.find((n) => n.id === partyNodeId('u3'))!;
    expect(u3.value).toBeCloseTo(20);
    expect(track.nodes.every((n) => !n.segments)).toBe(true);
  });
});

describe('what a split names nobody for', () => {
  // A personal holon: the owner is not scored as a member of themselves, so
  // the contributors share has no roster — it is what they keep.
  const own = allocate({
    total: 1000,
    unit: 'EUR',
    config: cfg(60),
    members: [],
    zoned: [{ id: 'u3', name: 'U3', zone: 1, kind: 'person' }],
  });

  it('is left out unless the surface names it, as it always was', () => {
    const track = allocationToGraph(own);
    expect(track.nodes.find((n) => n.id === RETAINED_ID)).toBeUndefined();
    expect(track.totalIn).toBeCloseTo(400);
  });

  it('is its own branch off the pot once named, so the diagram shows the whole fund', () => {
    const track = allocationToGraph(own, { retained: 'Kept' });
    const kept = track.nodes.find((n) => n.id === RETAINED_ID)!;
    expect(kept.label).toBe('Kept');
    expect(kept.depth).toBe(1);
    expect(kept.value).toBeCloseTo(600);
    expect(track.totalIn).toBeCloseTo(1000);
    expect(track.links.find((l) => l.target === RETAINED_ID)!.value).toBeCloseTo(600);
  });

  it('does not double-draw zones that are only a preview', () => {
    // Nobody placed: the zones keep their decay shares as a structural
    // preview, and those bars already stand for the exterior.
    const preview = allocate({ total: null, config: cfg(60), members: [], zoned: [] });
    const track = allocationToGraph(preview, { retained: 'Kept' });
    expect(track.nodes.find((n) => n.id === RETAINED_ID)!.value).toBeCloseTo(60);
    expect(track.totalIn).toBeCloseTo(100);
  });

  it('draws nothing extra for a split that names everyone', () => {
    const full = allocate({
      total: 100,
      config: cfg(100),
      members: [{ id: 'a', name: 'A', percentage: 1 }],
      zoned: [],
    });
    expect(allocationToGraph(full, { retained: 'Kept' }).nodes.find((n) => n.id === RETAINED_ID)).toBeUndefined();
  });
});
