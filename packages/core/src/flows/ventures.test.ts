// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { signedEntry, testKey } from '../protocol/testing.js';
import { QUEST_BOARD_LENS, buildQuestJoin, buildQuestPledge, buildQuestProposal, foldQuestBoard, type BoardQuest } from '../tasks/board.js';
import type { FlowGraph } from './flow-graph.js';
import { indexFlowGraph } from './flow-graph-index.js';
import { alsoIn, buildFractal, fractalPath, fractalWay, ventureBandwidth } from './ventures.js';

const T0 = 1_760_000_000;
const NOW = T0 * 1000;
const UNTIL = NOW + 7 * 86_400_000;
const ana = testKey();
const ben = testKey();

// pot → fund → project → (member) ana → (forwards) cai
const graph: FlowGraph = {
  v: 1,
  root: 'pot',
  at: NOW,
  complete: true,
  problems: [],
  nodes: [
    { id: 'pot', label: 'Pot', kind: 'pot', share: 100, rest: 0 },
    { id: 'fund', label: 'Fund', kind: 'fund', share: 100, rest: 0 },
    { id: 'proj', label: 'Garden', kind: 'project', share: 60, rest: 0 },
    { id: 'other', label: 'Kitchen', kind: 'project', share: 40, rest: 40 },
    { id: 'ana', label: 'Ana', kind: 'person', share: 60, rest: 30 },
    { id: 'cai', label: 'Cai', kind: 'person', share: 30, rest: 30 },
  ],
  links: [
    { source: 'pot', target: 'fund', share: 100, local: 100, via: 'exterior', zone: 0 },
    { source: 'fund', target: 'proj', share: 60, local: 60, via: 'exterior', zone: 0 },
    { source: 'fund', target: 'other', share: 40, local: 40, via: 'exterior', zone: 0 },
    { source: 'proj', target: 'ana', share: 60, local: 100, via: 'interior' },
    { source: 'ana', target: 'cai', share: 30, local: 50, via: 'interior' },
  ],
  aliases: [],
  cycles: [],
};

const entry = (sk: Uint8Array, a: { item: unknown }, at: number) =>
  signedEntry({ sk, item: a.item as never, created_at: at, holon: 'fund', lens: QUEST_BOARD_LENS });

function quests(): BoardQuest[] {
  const p = entry(
    ana.sk,
    buildQuestProposal({
      party: 'ana',
      name: 'Ana',
      title: 'Build raised beds',
      holon: 'proj',
      until: UNTIL,
      needs: [
        { label: 'Hands', quantity: 2, unit: 'people' },
        { label: 'Wood', quantity: 10, unit: 'm' },
      ],
      yields: [{ label: 'Beds', quantity: 4 }],
      at: NOW,
    }),
    T0,
  );
  const loose = entry(ben.sk, buildQuestProposal({ party: 'ben', name: 'Ben', title: 'Seed swap', until: UNTIL, needs: [{ label: 'Table', quantity: 1 }], at: NOW }), T0 + 1);
  const join = entry(ben.sk, buildQuestJoin({ quest: p.id, party: 'ben', name: 'Ben' }), T0 + 2);
  const pledge = entry(ben.sk, buildQuestPledge({ quest: p.id, need: 'n2', party: 'ben', quantity: 10 }), T0 + 3);
  return foldQuestBoard({ entries: [p, loose, join, pledge], now: NOW }).quests.map((q) => ({ ...q, board: 'fund' }));
}

describe('ventureBandwidth', () => {
  it('widens the share by what is committed, never past double', () => {
    expect(ventureBandwidth(10, 0)).toBe(10);
    expect(ventureBandwidth(10, 0.5)).toBe(15);
    expect(ventureBandwidth(10, 3)).toBe(20);
    expect(ventureBandwidth(-1, 1)).toBe(0);
  });
});

describe('buildFractal', () => {
  it('reads every level the same way, pot to people to people', () => {
    const f = buildFractal(indexFlowGraph(graph));
    expect(f.byId.get('pot')!.children).toEqual(['fund']);
    expect(f.byId.get('fund')!.children).toEqual(['proj', 'other']);
    expect(f.byId.get('proj')!).toMatchObject({ kind: 'venture', origin: 'project', children: ['ana'] });
    expect(f.byId.get('ana')!.children).toEqual(['cai']);
    expect(f.byId.get('ana')!.roles).toEqual([{ at: 'proj', role: 'member' }]);
  });

  it('makes a quest a venture like a project, under the project it names or else its fund', () => {
    const f = buildFractal(indexFlowGraph(graph), quests());
    const [beds, swap] = [...f.byId.values()].filter((n) => n.origin === 'quest').sort((a, z) => (a.label < z.label ? -1 : 1));
    expect(beds).toMatchObject({ kind: 'venture', label: 'Build raised beds', parents: ['proj'], board: 'fund' });
    expect(swap.parents).toEqual(['fund']);
    expect(beds.yields).toEqual([{ label: 'Beds', quantity: 4, quest: beds.id }]);
    expect(f.byId.get('proj')!.children).toContain(beds.id);
  });

  it('gives people their roles on a quest, and one node wherever they stand', () => {
    const f = buildFractal(indexFlowGraph(graph), quests());
    const beds = [...f.byId.values()].find((n) => n.label === 'Build raised beds')!;
    const ana = f.byId.get('ana')!;
    expect(ana.roles).toEqual(expect.arrayContaining([{ at: 'proj', role: 'member' }, { at: beds.id, role: 'proposer' }]));
    const ben = f.byId.get('ben')!;
    expect(ben.label).toBe('Ben');
    expect(ben.roles).toEqual(expect.arrayContaining([{ at: beds.id, role: 'in' }, { at: beds.id, role: 'covers', need: 'Wood' }]));
    expect(alsoIn(f, 'ana', 'proj').map((n) => n.id)).toEqual([beds.id]);
  });

  it('widens a project once resources are committed to its quests, and rolls coverage up by share', () => {
    const f = buildFractal(indexFlowGraph(graph), quests());
    const proj = f.byId.get('proj')!;
    // Hands 1/2 (ben is in), Wood 10/10.
    expect(proj.coverage).toBeCloseTo(0.75);
    expect(proj.bandwidth).toBeCloseTo(60 * 1.75);
    expect(proj.needs.map((n) => n.label)).toEqual(['Hands', 'Wood']);
    expect(proj.openNeeds).toBe(1);
    expect(f.byId.get('other')!.bandwidth).toBe(40);
    // Fund: (0.75 × 60 + 0 × 40 + swap 0 × 0) / 100.
    expect(f.byId.get('fund')!.coverage).toBeCloseTo(0.45);
    expect(f.byId.get('pot')!.coverage).toBeCloseTo(0.45);
    // Shown, not paid: the share is untouched.
    expect(proj.share).toBe(60);
  });

  it('survives a cycle and finds a way down to anyone', () => {
    const cyc = { ...graph, links: [...graph.links, { source: 'cai', target: 'ana', share: 1, local: 10, via: 'interior' as const }] };
    const f = buildFractal(indexFlowGraph(cyc));
    expect(f.byId.get('cai')!.children).toEqual(['ana']);
    expect(fractalPath(f, 'cai')).toEqual(['pot', 'fund', 'proj', 'ana', 'cai']);
    expect(fractalPath(f, 'nobody')).toEqual(['pot']);
  });

  it('finds the way down from one party to another under it', () => {
    const f = buildFractal(indexFlowGraph(graph));
    expect(fractalWay(f, 'pot', 'cai')).toEqual(['pot', 'fund', 'proj', 'ana', 'cai']);
    expect(fractalWay(f, 'fund', 'ana')).toEqual(['fund', 'proj', 'ana']);
    expect(fractalWay(f, 'proj', 'proj')).toEqual(['proj']);
    // Not under: a sibling, the way up, a stranger.
    expect(fractalWay(f, 'proj', 'other')).toBeNull();
    expect(fractalWay(f, 'ana', 'pot')).toBeNull();
    expect(fractalWay(f, 'pot', 'nobody')).toBeNull();
    // Too deep for the depth asked.
    expect(fractalWay(f, 'pot', 'cai', 3)).toBeNull();
  });
});
