// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { diamond, F1, F2, J, POT, seats } from './flow-graph.fixture.js';
import { indexFlowGraph } from './flow-graph-index.js';
import {
  FLOW_SPACE_MIN_RADIUS,
  FLOW_SPACE_ROOT_RADIUS,
  flowSpaceLinkId,
  flowSpaceWidth,
  layoutFlowSpace,
  type FlowSpace,
} from './flow-graph-space.js';

const space = (...args: Parameters<typeof diamond>) => layoutFlowSpace(indexFlowGraph(diamond(...args)));
const node = (s: FlowSpace, id: string) => s.nodes.find((n) => n.id === id)!;
const link = (s: FlowSpace, source: string, target: string) => s.links.find((l) => l.id === flowSpaceLinkId(source, target))!;
const apart = (s: FlowSpace, a: string, b: string) => {
  const p = node(s, a);
  const q = node(s, b);
  return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
};

describe('layoutFlowSpace', () => {
  it('places every party once, the root first and at the origin', () => {
    const s = space();
    expect(s.nodes.map((n) => n.id).sort()).toEqual(['111', 'artisan:9', F1, F2, J, POT].sort());
    expect(s.nodes[0]).toMatchObject({ id: POT, x: 0, y: 0, z: 0, depth: 0, parent: null, reached: true });
    expect(s.nodes[0].r).toBe(FLOW_SPACE_ROOT_RADIUS);
    for (const n of s.nodes) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z), n.id).toBe(true);
      expect(Math.hypot(n.x, n.y, n.z) + n.r).toBeLessThanOrEqual(s.radius + 1e-9);
    }
  });

  it("draws a link's width linear in the share of the pot it carries", () => {
    const s = space();
    const direct = link(s, POT, J);
    const curated = link(s, F1, J);
    expect(direct.share).toBeCloseTo(50);
    expect(curated.share).toBeCloseTo(25);
    expect(direct.width / curated.width).toBeCloseTo(direct.share / curated.share);
    expect(direct.width).toBeCloseTo(flowSpaceWidth(50));
    // The whole pot is as wide as the root.
    expect(flowSpaceWidth(100)).toBe(2 * FLOW_SPACE_ROOT_RADIUS);
    expect(flowSpaceWidth(0)).toBe(0);
    expect(s.links.map((l) => l.width)).toEqual([...s.links.map((l) => l.width)].sort((a, b) => b - a));
  });

  it('gives the larger share the larger disc, and the smallest a floor', () => {
    const s = space({ [J]: seats({ '111': 9999, '222': 1 }, 'Project J') });
    expect(node(s, J).r).toBeGreaterThan(node(s, F1).r);
    expect(node(s, '111').r).toBeGreaterThan(node(s, '222').r);
    expect(node(s, '222').r).toBe(FLOW_SPACE_MIN_RADIUS);
    expect(node(s, J).r).toBeLessThan(FLOW_SPACE_ROOT_RADIUS);
  });

  it('stands a party beside whoever pays it most, and still draws the other ways in', () => {
    const s = space();
    // J is seated by the Pot (50) and curated by both funds (25 each).
    expect(node(s, J)).toMatchObject({ parent: POT, depth: 1 });
    expect(node(s, '111')).toMatchObject({ parent: J, depth: 2 });
    expect(link(s, F1, J)).toBeDefined();
    expect(link(s, F2, J)).toBeDefined();
  });

  it('keeps payees clear of their payer and of each other', () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [String(1000 + i), 1]));
    const s = space({ [J]: seats(many, 'Project J') });
    const ids = Object.keys(many);
    for (const id of ids) expect(apart(s, id, J)).toBeGreaterThan(node(s, J).r + node(s, id).r);
    let closest = Infinity;
    for (let i = 0; i < ids.length; i++) for (let k = i + 1; k < ids.length; k++) closest = Math.min(closest, apart(s, ids[i], ids[k]));
    expect(closest).toBeGreaterThan(2 * FLOW_SPACE_MIN_RADIUS);
    expect(apart(s, F1, F2)).toBeGreaterThan(node(s, F1).r + node(s, F2).r);
  });

  it('puts what the pot does not reach outside everything it does, with no width', () => {
    const s = space({}, { extra: { holon_far: seats({ '777': 1 }, 'Far') } });
    const far = node(s, 'holon_far');
    expect(far).toMatchObject({ reached: false, parent: null, share: 0 });
    expect(node(s, '777')).toMatchObject({ reached: false, parent: 'holon_far' });
    const inner = Math.max(...s.nodes.filter((n) => n.reached).map((n) => Math.hypot(n.x, n.y, n.z)));
    expect(Math.hypot(far.x, far.y, far.z)).toBeGreaterThan(inner);
    expect(link(s, 'holon_far', '777').width).toBe(0);
  });

  it('is the same shape every time', () => {
    expect(space()).toEqual(space());
  });

  it('draws nothing for a graph without its root', () => {
    const g = diamond();
    expect(layoutFlowSpace(indexFlowGraph({ ...g, root: 'holon_gone' }))).toEqual({ nodes: [], links: [], radius: FLOW_SPACE_ROOT_RADIUS });
  });
});
