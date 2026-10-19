// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { applyStanding } from './buckets.js';
import { resolveCascade, type CascadeInputs } from './cascade.js';
import { buildFlowGraph, classifyParty, isPlaceholderParty, type FlowGraph, type FlowGraphLink } from './flow-graph.js';
import { cfg, F1, F2, fund, J, POT, seats } from './flow-graph.fixture.js';

/** Two funds curate one project, which also has its own seat in the Pot. */
const diamond = (children: Record<string, CascadeInputs> = {}) => {
  const all: Record<string, CascadeInputs> = {
    [F1]: fund(0, J),
    [F2]: fund(0, J),
    [J]: seats({ '111': 3, 'artisan:9': 1 }, 'Project J'),
    ...children,
  };
  return resolveCascade({
    holonId: POT,
    total: null,
    root: seats({ [F1]: 1, [F2]: 1, [J]: 2 }, 'The Pot'),
    resolveChild: (id) => all[id] ?? null,
  });
};

const node = (g: FlowGraph, id: string) => g.nodes.find((n) => n.id === id)!;
const link = (g: FlowGraph, source: string, target: string) =>
  g.links.find((l) => l.source === source && l.target === target)!;
const build = (cascade = diamond(), rest: Partial<Parameters<typeof buildFlowGraph>[0]> = {}) =>
  buildFlowGraph({ cascade, at: 1000, ...rest });

describe('buildFlowGraph', () => {
  it('draws each party once, with every path summed into it', () => {
    const g = build();
    expect(g.nodes.filter((n) => n.id === J)).toHaveLength(1);
    expect(node(g, POT).share).toBeCloseTo(100);
    expect(node(g, F1).share).toBeCloseTo(25);
    // Its own seat (50) and both funds' rings (25 + 25).
    expect(node(g, J).share).toBeCloseTo(100);
    expect(link(g, POT, J).share).toBeCloseTo(50);
    expect(link(g, F1, J).share).toBeCloseTo(25);
    expect(link(g, J, '111').share).toBeCloseTo(75);
    expect(node(g, '111').share).toBeCloseTo(75);
    expect(node(g, '111').rest).toBeCloseTo(75);
    expect(node(g, J).rest).toBe(0);
    expect(g.complete).toBe(true);
  });

  it('says what each edge is of its payer own split, which with what rests comes to 100', () => {
    const g = build(diamond({ [F2]: fund(40, J) }));
    expect(link(g, POT, F1).local).toBeCloseTo(25);
    expect(link(g, F1, J).local).toBeCloseTo(100);
    expect(link(g, F1, J)).toMatchObject({ via: 'exterior', zone: 1 });
    expect(link(g, POT, J).via).toBe('interior');
    expect(link(g, F2, J).local).toBeCloseTo(60);
    // What the fund names nobody for stays with it: not a link.
    expect(g.links.some((l) => l.source === l.target)).toBe(false);
    expect(node(g, F2).rest).toBeCloseTo(10);
    for (const n of g.nodes) {
      const out = g.links.filter((l) => l.source === n.id).reduce((s, l) => s + l.local, 0);
      const kept = n.share > 0 ? (n.rest / n.share) * 100 : 0;
      if (out > 0) expect(out + kept).toBeCloseTo(100);
    }
  });

  it('names a party from what the walk read, then from the cascade', () => {
    const g = build(diamond(), { meta: { [F1]: { name: 'Fund One' } } });
    expect(node(g, F1).label).toBe('Fund One');
    expect(node(g, J).label).toBe('Project J');
    expect(node(g, POT).label).toBe('The Pot');
  });

  it('carries a claimed seat under its claimant and lists the alias', () => {
    const claimed = seats({ '111': 3, '222': 1 }, 'Project J');
    const g = build(diamond({ [J]: claimed }), {
      meta: { [J]: { aliases: { 'artisan:9': '222' }, seats: ['111', 'artisan:9'], claimWindow: { until: 5000, keep: [] } } },
    });
    expect(g.nodes.some((n) => n.id === 'artisan:9')).toBe(false);
    expect(node(g, '222').kind).toBe('person');
    expect(g.aliases).toEqual([{ at: J, from: 'artisan:9', to: '222' }]);
    expect(node(g, '222').unclaimedUntil).toBeUndefined();
  });

  it('marks an unclaimed seat of a windowed holon, and not the seats it keeps', () => {
    const g = build(diamond(), {
      meta: {
        [POT]: { seats: [F1, F2, J], claimWindow: { until: 9000, keep: [F1, F2] } },
        [J]: { seats: ['111', 'artisan:9'], claimWindow: { until: 5000, keep: [] } },
      },
    });
    expect(node(g, 'artisan:9').kind).toBe('placeholder');
    expect(node(g, 'artisan:9').unclaimedUntil).toBe(5000);
    expect(node(g, J).unclaimedUntil).toBe(9000);
    expect(node(g, F1).unclaimedUntil).toBeUndefined();
    expect(node(g, F1).kind).toBe('fund');
  });

  it('ends a loop where the cascade does, and still draws the edge back', () => {
    const g = build(diamond({ [J]: { ...seats({ '111': 1 }), config: cfg(50), zoned: [{ id: F1, name: F1, zone: 1, kind: 'holon' }] } }));
    expect(g.cycles.length).toBeGreaterThan(0);
    expect(link(g, J, F1)).toBeTruthy();
    expect(Number.isFinite(node(g, F1).share)).toBe(true);
    const rested = g.nodes.reduce((s, n) => s + n.rest, 0);
    expect(rested).toBeCloseTo(100);
  });

  it('leaves out who exited and scales the others up', () => {
    const j = seats({ '111': 3, '222': 1 });
    const g = build(diamond({ [J]: { ...j, members: applyStanding(j.members, { exits: ['222'] }) } }));
    expect(g.nodes.some((n) => n.id === '222')).toBe(false);
    expect(link(g, J, '111').local).toBeCloseTo(100);
  });

  it('is one resting node for a pot that names nobody', () => {
    const cascade = resolveCascade({ holonId: POT, total: null, root: seats({}), resolveChild: () => null });
    const g = build(cascade);
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0]).toMatchObject({ id: POT, kind: 'pot', share: 100, rest: 100 });
    expect(g.links).toEqual([]);
  });

  it('adds a holon the root does not reach by its own split, at no share', () => {
    const g = build(diamond(), { extra: { holon_f3: { ...fund(0, J), name: 'Fund Three' }, [F1]: fund(0, J) } });
    expect(node(g, 'holon_f3')).toMatchObject({ label: 'Fund Three', share: 0, kind: 'fund' });
    expect(link(g, 'holon_f3', J)).toMatchObject({ share: 0, via: 'exterior' });
    expect(link(g, 'holon_f3', J).local).toBeCloseTo(100);
    // One the cascade already drew is left as it is.
    expect(node(g, F1).share).toBeCloseTo(25);
    expect(node(g, J).share).toBeCloseTo(100);
  });

  it('carries where a party is paid and its own Pot', () => {
    const g = build(diamond(), {
      meta: { '111': { payout: '0xABCDEF0000000000000000000000000000000001' }, [F1]: { pot: { chainId: 100, address: '0xpot' }, payout: null } },
    });
    expect(node(g, '111').payout).toBe('0xabcdef0000000000000000000000000000000001');
    expect(node(g, F1).pot).toEqual({ chainId: 100, address: '0xpot' });
    expect(node(g, F1).payout).toBeUndefined();
  });

  it('says so when a bound cut the walk', () => {
    const all: Record<string, CascadeInputs> = { [F1]: fund(0, J), [J]: seats({ '111': 1 }) };
    const cut = resolveCascade({
      holonId: POT,
      total: null,
      root: seats({ [F1]: 1 }),
      resolveChild: (id) => all[id] ?? null,
      maxDepth: 1,
    });
    expect(build(cut).complete).toBe(false);
    expect(build(diamond(), { complete: false, problems: ['50 of 80 holons read'] })).toMatchObject({
      complete: false,
      problems: ['50 of 80 holons read'],
    });
  });
});

describe('classifyParty', () => {
  const keep = new Set<string>(['holon_kept']);
  const out = (via: 'interior' | 'exterior', target: string): FlowGraphLink => ({ source: 'x', target, share: 1, local: 50, via });
  const kind = (id: string, links: FlowGraphLink[] = []) => classifyParty({ id, rootId: POT, keep, out: links });
  const KEY = 'a'.repeat(64);

  it('reads the kind off the id, the root word and the shape of the split', () => {
    expect(kind(POT)).toBe('pot');
    expect(kind('artisan:42')).toBe('placeholder');
    expect(kind('235114395')).toBe('person');
    expect(kind(KEY)).toBe('person');
    expect(kind(KEY, [out('interior', '111')])).toBe('project');
    expect(kind('holon_kept', [out('interior', '111')])).toBe('fund');
    expect(kind('holon_a', [out('exterior', 'holon_b')])).toBe('fund');
    // Giving to people on a ring is not curating.
    expect(kind('holon_a', [out('exterior', '111')])).toBe('project');
    expect(kind('holon_a', [out('exterior', 'holon_b'), out('interior', '111')])).toBe('project');
    expect(kind('-1001234')).toBe('project');
  });

  it('knows a placeholder from an id', () => {
    expect(isPlaceholderParty('artisan:9')).toBe(true);
    expect(isPlaceholderParty('nostr:npub1abc')).toBe(false);
    expect(isPlaceholderParty('holon_abc')).toBe(false);
    expect(isPlaceholderParty('111')).toBe(false);
  });
});
