// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { FlowGraph, FlowGraphLink, FlowGraphNode } from './flow-graph.js';
import { diamond, F1, F2, J, POT } from './flow-graph.fixture.js';
import { indexFlowGraph } from './flow-graph-index.js';
import { layoutFlowForce } from './flow-graph-force.js';
import { flowSpaceLinkId, flowSpaceRadius, flowSpaceWidth, type FlowSpace } from './flow-graph-space.js';

const node = (s: FlowSpace, id: string) => s.nodes.find((n) => n.id === id)!;
const apart = (s: FlowSpace, a: string, b: string) => {
  const p = node(s, a);
  const q = node(s, b);
  return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
};

/** Funds A and B share project AB; each also has projects of its own; fund C shares nothing. */
function network(): FlowGraph {
  const nodes: FlowGraphNode[] = [{ id: 'pot', label: 'Pot', kind: 'pot', share: 100, rest: 0 }];
  const links: FlowGraphLink[] = [];
  const add = (id: string, kind: FlowGraphNode['kind'], share: number) =>
    nodes.push({ id, label: id.toUpperCase(), kind, share, rest: 0 });
  const pay = (source: string, target: string, share: number) =>
    links.push({ source, target, share, local: share, via: 'interior' });
  for (const f of ['fa', 'fb', 'fc']) {
    add(f, 'fund', 30);
    pay('pot', f, 30);
  }
  add('ab', 'project', 10);
  pay('fa', 'ab', 5);
  pay('fb', 'ab', 5);
  for (const f of ['fa', 'fb', 'fc'])
    for (let i = 0; i < 6; i++) {
      add(`${f}${i}`, 'project', 4);
      pay(f, `${f}${i}`, 4);
    }
  add('person', 'person', 1);
  pay('ab', 'person', 1);
  return { root: 'pot', nodes, links, aliases: [], cycles: [] } as unknown as FlowGraph;
}

describe('layoutFlowForce', () => {
  it('takes the funds and the projects, and only the links between them', () => {
    const s = layoutFlowForce(indexFlowGraph(network()));
    expect(s.nodes.map((n) => n.kind).every((k) => k === 'fund' || k === 'project')).toBe(true);
    expect(s.nodes).toHaveLength(3 + 1 + 18);
    expect(s.links.some((l) => l.source === 'pot' || l.target === 'person')).toBe(false);
    expect(s.links).toHaveLength(2 + 18);
    for (const n of s.nodes) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z), n.id).toBe(true);
      expect(Math.hypot(n.x, n.y, n.z) + n.r).toBeLessThanOrEqual(s.radius + 1e-9);
      // Never the root: a surface goes in to whatever is chosen.
      expect(n.depth).toBeGreaterThan(0);
    }
  });

  it('draws the same discs and line widths as the tree', () => {
    const s = layoutFlowForce(indexFlowGraph(network()));
    expect(node(s, 'ab').r).toBe(flowSpaceRadius(10));
    const l = s.links.find((x) => x.id === flowSpaceLinkId('fa', 'ab'))!;
    expect(l.width).toBe(flowSpaceWidth(5));
    expect(s.links.map((x) => x.width)).toEqual([...s.links.map((x) => x.width)].sort((a, b) => b - a));
  });

  it('pulls a shared project between its funds, and funds that share close together', () => {
    const s = layoutFlowForce(indexFlowGraph(network()));
    // AB sits nearer each of its funds than those funds are to each other.
    expect(apart(s, 'ab', 'fa')).toBeLessThan(apart(s, 'fa', 'fb'));
    expect(apart(s, 'ab', 'fb')).toBeLessThan(apart(s, 'fa', 'fb'));
    // A fund's own projects stand nearer to it than to a fund it shares nothing with.
    expect(apart(s, 'fc0', 'fc')).toBeLessThan(apart(s, 'fc0', 'fa'));
    expect(node(s, 'ab').parent).toMatch(/^f[ab]$/);
    expect(node(s, 'fa').parent).toBeNull();
  });

  it('is the same shape every time', () => {
    const one = layoutFlowForce(indexFlowGraph(network()));
    const two = layoutFlowForce(indexFlowGraph(network()));
    expect(two).toEqual(one);
  });

  it('keeps no two parties on one spot', () => {
    const s = layoutFlowForce(indexFlowGraph(network()));
    for (let i = 0; i < s.nodes.length; i++)
      for (let j = i + 1; j < s.nodes.length; j++) {
        const a = s.nodes[i];
        const b = s.nodes[j];
        expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), `${a.id}~${b.id}`).toBeGreaterThan((a.r + b.r) * 0.5);
      }
  });

  it('works on a cascade, and is empty when nothing links the chosen kinds', () => {
    const s = layoutFlowForce(indexFlowGraph(diamond()));
    expect(s.nodes.map((n) => n.id).sort()).toEqual([F1, F2, J].sort());
    expect(s.links.map((l) => l.source).sort()).toEqual([F1, F2]);
    expect(layoutFlowForce(indexFlowGraph(diamond()), { kinds: ['person'] }).nodes).toEqual([]);
    // The kinds are a choice: with the Pot, its links to the funds come in.
    const withPot = layoutFlowForce(indexFlowGraph(diamond()), { kinds: ['pot', 'fund', 'project'] });
    expect(withPot.nodes.map((n) => n.id)).toContain(POT);
  });
});
