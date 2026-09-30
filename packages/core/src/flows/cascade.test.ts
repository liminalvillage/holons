// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { allocate, resolveInteriorMembers, type AllocationConfig } from './allocation.js';
import {
  cascadeRights,
  resolveCascade,
  summarizeCascade,
  type CascadeInputs,
  type CascadeNode,
  type CascadeResult,
} from './cascade.js';
import { fundAccount } from './usage.js';

const cfg = (interiorPercent: number, extra: Partial<AllocationConfig> = {}): AllocationConfig => ({
  interiorPercent,
  steepness: 50,
  nzones: 3,
  interiorMode: 'custom',
  ...extra,
});

/** A collective dividing everything equally between its members. */
const collective = (...ids: string[]): CascadeInputs => ({
  config: cfg(100),
  members: resolveInteriorMembers({
    config: { interiorMode: 'custom' },
    scored: [],
    shares: Object.fromEntries(ids.map((id) => [id, 1])),
  }),
  zoned: [],
});

/** A personal holon: keeps `keep`%, the rest goes to the people on ring 1. */
const personal = (keep: number, ...onward: string[]): CascadeInputs => ({
  config: cfg(keep),
  members: [],
  zoned: onward.map((id) => ({ id, name: id, zone: 1, kind: 'person' as const })),
});

const resolverOf = (children: Record<string, CascadeInputs>) => (id: string) => children[id] ?? null;

const leafSum = (result: CascadeResult) =>
  Object.values(result.leaves).reduce((s, l) => s + l.percentage, 0);

const flatten = (node: CascadeNode): CascadeNode[] => [node, ...node.children.flatMap(flatten)];

describe('resolveCascade', () => {
  it('equals allocate, leaf for leaf, when nobody passes anything on', () => {
    const root: CascadeInputs = {
      config: cfg(60, { interiorMode: 'equation' }),
      members: [
        { id: 'a', name: 'Ana', percentage: 75 },
        { id: 'b', name: 'Ben', percentage: 25 },
      ],
      zoned: [{ id: 'p', name: 'Partner', zone: 1, kind: 'holon' }],
    };
    const result = resolveCascade({ holonId: 'C', total: 1000, unit: 'EUR', root, resolveChild: () => null });
    const plain = allocate({ total: 1000, unit: 'EUR', ...root });

    expect(result.rootResult).toEqual(plain);
    expect(result.leaves.a.percentage).toBeCloseTo(45);
    expect(result.leaves.b.percentage).toBeCloseTo(15);
    expect(result.leaves.p.percentage).toBeCloseTo(40);
    expect(result.leaves.a.amount).toBeCloseTo(450);
    expect(result.root.children.every((c) => c.reason === 'terminal')).toBe(true);
    expect(result.cycles).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('an equal split is custom equal weights — no mode of its own', () => {
    const result = resolveCascade({
      holonId: 'C',
      total: 900,
      root: collective('u1', 'u2', 'u3'),
      resolveChild: () => null,
    });
    for (const id of ['u1', 'u2', 'u3']) expect(result.leaves[id].amount).toBeCloseTo(300);
  });

  it('a personal holon with no roster keeps its contributors share and passes the zones on', () => {
    const result = resolveCascade({
      holonId: 'C',
      total: 1000,
      root: collective('u1', 'u2'),
      resolveChild: resolverOf({ u1: personal(60, 'u3') }),
    });

    expect(result.leaves.u1.amount).toBeCloseTo(300);
    expect(result.leaves.u3.amount).toBeCloseTo(200);
    expect(result.leaves.u2.amount).toBeCloseTo(500);
    const u1 = result.root.children.find((c) => c.id === 'u1')!;
    expect(u1.reason).toBeUndefined();
    expect(u1.children.map((c) => [c.id, c.reason])).toEqual([
      ['u3', 'terminal'],
      ['u1', 'retained'],
    ]);
    expect(leafSum(result)).toBeCloseTo(100);
  });

  it('the owner seated as their own only contributor yields the same leaf, as kept', () => {
    const seated: CascadeInputs = {
      ...personal(60, 'u3'),
      members: [{ id: 'u1', name: 'Una', percentage: 100 }],
    };
    const result = resolveCascade({
      holonId: 'C',
      total: 1000,
      root: collective('u1', 'u2'),
      resolveChild: resolverOf({ u1: seated }),
    });
    expect(result.leaves.u1.amount).toBeCloseTo(300);
    const u1 = result.root.children.find((c) => c.id === 'u1')!;
    expect(u1.children.find((c) => c.id === 'u1')!.reason).toBe('kept');
  });

  it('divides onward by the contract ring weights', () => {
    const child: CascadeInputs = {
      config: cfg(0, { steepness: 50 }),
      members: [],
      zoned: [
        { id: 'near', name: 'near', zone: 1 },
        { id: 'far', name: 'far', zone: 2 },
      ],
    };
    const result = resolveCascade({
      holonId: 'C',
      total: null,
      root: collective('u1'),
      resolveChild: resolverOf({ u1: child }),
    });
    // weights 1 and 0.5 over the placed partners only
    expect(result.leaves.near.percentage).toBeCloseTo((1 / 1.5) * 100);
    expect(result.leaves.far.percentage).toBeCloseTo((0.5 / 1.5) * 100);
    expect(result.leaves.u1).toBeUndefined();
  });

  it('a diamond is not a cycle: both paths add into one leaf', () => {
    const result = resolveCascade({
      holonId: 'C',
      total: 1000,
      root: collective('u1', 'u2'),
      resolveChild: resolverOf({ u1: personal(50, 'u3'), u2: personal(50, 'u3') }),
    });
    expect(result.cycles).toEqual([]);
    expect(result.leaves.u3.amount).toBeCloseTo(500);
    expect(leafSum(result)).toBeCloseTo(100);
  });

  it('A → B → A stops at A, flagged, and the path is reported', () => {
    const result = resolveCascade({
      holonId: 'C',
      total: 1000,
      root: collective('u1'),
      resolveChild: resolverOf({ u1: personal(60, 'u2'), u2: personal(50, 'u1') }),
    });
    const back = flatten(result.root).find((n) => n.reason === 'cycle')!;
    expect(back.id).toBe('u1');
    expect(back.depth).toBe(3);
    expect(result.cycles).toEqual([['C', 'u1', 'u2', 'u1']]);
    // u1 keeps 600, and the 200 that u2 sends back stops with u1
    expect(result.leaves.u1.amount).toBeCloseTo(800);
    expect(result.leaves.u2.amount).toBeCloseTo(200);
    expect(leafSum(result)).toBeCloseTo(100);
  });

  it('a share routed back to the root is a cycle, held by the root', () => {
    const result = resolveCascade({
      holonId: 'C',
      total: 100,
      root: collective('u1'),
      resolveChild: resolverOf({ u1: personal(0, 'C') }),
    });
    expect(result.cycles).toEqual([['C', 'u1', 'C']]);
    expect(result.leaves.C.amount).toBeCloseTo(100);
  });

  it('what the root itself leaves undistributed is retained by the root', () => {
    const root: CascadeInputs = { config: cfg(70), members: [{ id: 'a', name: 'a', percentage: 1 }], zoned: [] };
    const result = resolveCascade({ holonId: 'C', total: 100, root, resolveChild: () => null });
    expect(result.leaves.a.amount).toBeCloseTo(70);
    expect(result.leaves.C.amount).toBeCloseTo(30);
    expect(leafSum(result)).toBeCloseTo(100);
  });

  it('maxDepth cuts to a flagged leaf and still conserves', () => {
    const chain = resolverOf({
      u1: personal(0, 'u2'),
      u2: personal(0, 'u3'),
      u3: personal(0, 'u4'),
    });
    const result = resolveCascade({
      holonId: 'C',
      total: 100,
      root: collective('u1'),
      resolveChild: chain,
      maxDepth: 2,
    });
    expect(result.truncated).toBe(true);
    expect(result.leaves.u3.amount).toBeCloseTo(100);
    expect(flatten(result.root).find((n) => n.id === 'u3')!.reason).toBe('depth');
    expect(result.leaves.u4).toBeUndefined();
  });

  it('maxNodes cuts to a flagged leaf and still conserves', () => {
    const result = resolveCascade({
      holonId: 'C',
      total: 100,
      root: collective('u1', 'u2'),
      resolveChild: resolverOf({ u1: personal(0, 'x'), u2: personal(0, 'y') }),
      maxNodes: 4,
    });
    expect(result.truncated).toBe(true);
    expect(flatten(result.root).some((n) => n.reason === 'budget')).toBe(true);
    expect(leafSum(result)).toBeCloseTo(100);
  });

  it('percentage-only: every amount is null', () => {
    const result = resolveCascade({
      holonId: 'C',
      total: null,
      root: collective('u1', 'u2'),
      resolveChild: resolverOf({ u1: personal(60, 'u3') }),
    });
    expect(result.total).toBeNull();
    expect(flatten(result.root).every((n) => n.amount === null)).toBe(true);
    expect(Object.values(result.leaves).every((l) => l.amount === null)).toBe(true);
    expect(result.leaves.u3.percentage).toBeCloseTo(20);
  });

  it('a party seated twice in one holon cascades once, over both seats', () => {
    const root: CascadeInputs = {
      config: cfg(50),
      members: [{ id: 'u1', name: 'Una', percentage: 1 }],
      zoned: [{ id: 'u1', name: 'Una', zone: 1, kind: 'person' }],
    };
    const result = resolveCascade({
      holonId: 'C',
      total: 100,
      root,
      resolveChild: resolverOf({ u1: personal(50, 'u3') }),
    });
    expect(result.root.children.filter((c) => c.id === 'u1')).toHaveLength(1);
    expect(result.leaves.u1.amount).toBeCloseTo(50);
    expect(result.leaves.u3.amount).toBeCloseTo(50);
  });
});

describe('summarizeCascade', () => {
  it('reports cycles, size, depth and where funds would be stranded on-chain', () => {
    const result = resolveCascade({
      holonId: 'C',
      total: null,
      root: collective('u1', 'u2'),
      resolveChild: resolverOf({
        u1: personal(60, 'u2'),
        u2: { ...personal(50, 'u1'), members: [{ id: 'u2', name: 'u2', percentage: 1 }] },
      }),
    });
    const summary = summarizeCascade(result);
    expect(summary.cycles.length).toBeGreaterThan(0);
    expect(summary.nodeCount).toBe(result.nodeCount);
    expect(summary.maxDepth).toBe(result.maxDepthReached);
    // u1 has no roster: its contributors share has nobody to be paid to.
    // u2 seats its owner, so nothing is stranded there.
    expect(summary.stuck).toEqual(['u1']);
  });
});

describe('cascadeRights', () => {
  it('lets fundAccount read a right net of what was passed on, and find downstream holders', () => {
    const result = resolveCascade({
      holonId: 'C',
      total: 1000,
      unit: 'EUR',
      root: collective('u1', 'u2'),
      resolveChild: resolverOf({ u1: personal(60, 'u3') }),
    });
    const rights = cascadeRights(result);

    const u1 = fundAccount(rights, null, 'u1')!;
    expect(u1.side).toBe('interior');
    expect(u1.right).toBeCloseTo(300);

    const u3 = fundAccount(rights, null, 'u3')!;
    expect(u3.side).toBe('exterior');
    expect(u3.zone).toBeUndefined();
    expect(u3.right).toBeCloseTo(200);

    // The root holding something back is not a rights-holder of its own fund.
    expect(fundAccount(rights, null, 'C')).toBeNull();
  });

  it('keeps the ring of a partner seated by the root', () => {
    const root: CascadeInputs = {
      config: cfg(0),
      members: [],
      zoned: [{ id: 'p', name: 'Partner', zone: 2, kind: 'holon' }],
    };
    const result = resolveCascade({ holonId: 'C', total: 100, root, resolveChild: () => null });
    expect(fundAccount(cascadeRights(result), null, 'p')!.zone).toBe(2);
  });
});
