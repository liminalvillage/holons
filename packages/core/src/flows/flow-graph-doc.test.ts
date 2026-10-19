// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { FlowGraph } from './flow-graph.js';
import { decodeFlowGraph, encodeFlowGraph, FLOW_GRAPH_PART_BYTES } from './flow-graph-doc.js';

const small: FlowGraph = {
  v: 1,
  root: 'holon_pot',
  at: 1_700_000_000_000,
  epoch: 321,
  complete: true,
  problems: [],
  nodes: [
    { id: 'holon_pot', label: 'The Pot', kind: 'pot', share: 100, rest: 0, pot: { chainId: 100, address: '0xpot' } },
    { id: 'holon_f1', label: 'Fund One', kind: 'fund', share: 40, rest: 10 },
    { id: 'holon_j', label: 'Proyecto Ñandú — 手作り', kind: 'project', share: 90, rest: 0, unclaimedUntil: 1_800_000_000_000, resources: { material: 2, living: 1, financial: 1 } },
    { id: '111', label: 'Ada', kind: 'person', share: 67.5, rest: 67.5, payout: '0xabc', resources: { intellectual: 4 } },
    { id: 'artisan:9', label: 'artisan:9', kind: 'placeholder', share: 22.5, rest: 22.5 },
  ],
  links: [
    { source: 'holon_pot', target: 'holon_f1', share: 40, local: 40, via: 'interior' },
    { source: 'holon_pot', target: 'holon_j', share: 60, local: 60, via: 'interior' },
    { source: 'holon_f1', target: 'holon_j', share: 30, local: 75, via: 'exterior', zone: 2 },
    { source: 'holon_j', target: '111', share: 67.5, local: 75, via: 'interior' },
    { source: 'holon_j', target: 'artisan:9', share: 22.5, local: 25, via: 'exterior' },
  ],
  aliases: [{ at: 'holon_pot', from: 'holon_old', to: '-100123' }],
  cycles: [['holon_pot', 'holon_j', 'holon_pot']],
};

/** A graph the size of the trial import: every node a 27-byte name, every project seated and curated. */
function large(nodes = 2000, links = 4500): FlowGraph {
  const ids = Array.from({ length: nodes }, (_, i) => `holon_${String(i).padStart(16, 'a')}`);
  return {
    v: 1,
    root: ids[0],
    at: 1,
    complete: true,
    problems: [],
    nodes: ids.map((id, i) => ({ id, label: `A project with a long name ${i}`, kind: i ? 'project' : 'pot', share: 100 / (i + 1), rest: 1 / (i + 3) })),
    links: Array.from({ length: links }, (_, i) => ({
      source: ids[i % 190],
      target: ids[1 + (i % (nodes - 1))],
      share: 100 / (i + 7),
      local: 100 / ((i % 9) + 1),
      via: i % 2 ? ('exterior' as const) : ('interior' as const),
      ...(i % 2 ? { zone: 1 + (i % 3) } : {}),
    })),
    aliases: [],
    cycles: [],
  };
}

const all = (g: FlowGraph, opts?: Parameters<typeof encodeFlowGraph>[1]) => {
  const { head, parts } = encodeFlowGraph(g, opts);
  return { head, parts, items: [head, ...parts] as unknown[] };
};

describe('flow graph documents', () => {
  it('round-trips a graph', () => {
    const { items, head } = all(small);
    const back = decodeFlowGraph([...items].reverse());
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.graph).toEqual(small);
    expect(back.head).toEqual(head);
    expect(head.counts).toEqual({ nodes: 5, links: 5, aliases: 1, cycles: 1 });
  });

  it('keeps every part under the bound, counting bytes and not characters', () => {
    const g = large();
    const { parts, items } = all(g);
    const sizes = parts.map((p) => new TextEncoder().encode(JSON.stringify(p)).length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(FLOW_GRAPH_PART_BYTES);
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.length).toBeLessThan(16);
    expect(parts.map((p) => p.id)).toEqual(parts.map((_, i) => `p${i}`));
    const back = decodeFlowGraph(items);
    expect(back.ok && back.graph.nodes.length).toBe(2000);
    expect(back.ok && back.graph.links.length).toBe(4500);

    const wide: FlowGraph = { ...small, nodes: small.nodes.map((n) => ({ ...n, label: '手'.repeat(40) })) };
    const tight = encodeFlowGraph(wide, { partBytes: 400 });
    expect(tight.parts.length).toBeGreaterThan(1);
    for (const p of tight.parts) expect(new TextEncoder().encode(JSON.stringify(p)).length).toBeLessThanOrEqual(400);
    expect(decodeFlowGraph([tight.head, ...tight.parts])).toMatchObject({ ok: true });
  });

  it('rounds to what a diagram shows', () => {
    const { items } = all({ ...small, nodes: small.nodes.map((n) => ({ ...n, share: 33.333333333333336 })) });
    const back = decodeFlowGraph(items);
    expect(back.ok && back.graph.nodes[0].share).toBe(33.3333);
  });

  it('is missing with no head', () => {
    expect(decodeFlowGraph([])).toEqual({ ok: false, reason: 'missing' });
    expect(decodeFlowGraph(all(small).parts)).toEqual({ ok: false, reason: 'missing' });
    expect(decodeFlowGraph(null as unknown as unknown[])).toEqual({ ok: false, reason: 'missing' });
  });

  it('is incomplete while a publish is half-way: parts of another generation do not count', () => {
    const g = large(600, 900);
    const old = all(g, { gen: 'old' });
    const next = all({ ...g, at: 2 }, { gen: 'new' });
    expect(next.parts.length).toBeGreaterThan(1);
    // The new head has landed, one part is still the old one.
    const torn = [next.head, old.parts[0], ...next.parts.slice(1)];
    expect(decodeFlowGraph(torn)).toMatchObject({ ok: false, reason: 'incomplete' });
    // The old head with new parts under it: the same.
    expect(decodeFlowGraph([old.head, ...next.parts])).toMatchObject({ ok: false, reason: 'incomplete' });
    expect(decodeFlowGraph([next.head, ...next.parts.slice(1)])).toMatchObject({ ok: false, reason: 'incomplete' });
  });

  it('ignores parts past the head count and documents that are not parts', () => {
    const { head, parts } = all(small);
    const stray = { id: 'p7', gen: head.gen, i: 7, n: [['x', 'x', 'J', 1, 1]] };
    expect(decodeFlowGraph([head, ...parts, stray, { id: 'note' }, null, 'text'])).toMatchObject({ ok: true });
  });

  it('is corrupt when the rows are not the ones the head hashed', () => {
    const { head, parts } = all(small);
    const bent = parts.map((p) => ({ ...p, n: p.n?.map((row, i) => (i === 1 ? [row[0], 'Another name', ...row.slice(2)] : row)) }));
    expect(decodeFlowGraph([head, ...bent])).toMatchObject({ ok: false, reason: 'corrupt' });
  });

  it('refuses a version it does not know', () => {
    const { head, parts } = all(small);
    expect(decodeFlowGraph([{ ...head, v: 2 }, ...parts])).toMatchObject({ ok: false, reason: 'version' });
  });
});

describe('resources on the stored graph', () => {
  it('ride as eight counts at the end of a node row, and a node with none adds nothing', () => {
    const { parts } = encodeFlowGraph(small);
    const rows = parts.flatMap((p) => p.n ?? []);
    expect(rows.find((r) => r[0] === 'holon_j')?.[9]).toEqual([2, 1, 0, 0, 0, 0, 0, 1]);
    expect(rows.find((r) => r[0] === 'holon_f1')).toHaveLength(5);
    // Between: blanks keep their place so the counts stay at index 9.
    expect(rows.find((r) => r[0] === '111')).toEqual(['111', 'Ada', 'U', 67.5, 67.5, '0xabc', 0, '', 0, [0, 0, 0, 4, 0, 0, 0, 0]]);
  });
});
