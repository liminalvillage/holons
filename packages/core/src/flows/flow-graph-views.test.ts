// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { partyNodeId } from './allocation-graph.js';
import { resolveCascade, type CascadeInputs } from './cascade.js';
import { buildFlowGraph } from './flow-graph.js';
import { cfg, diamond, F1, F2, fund, J, POT, seats } from './flow-graph.fixture.js';
import { partyShares } from './ceiling.js';
import { indexFlowGraph } from './flow-graph-index.js';
import {
  centredTrack,
  ecosystemTrack,
  graphRights,
  FLOW_DIRECT_ID,
  FLOW_KEPT_ID,
  FLOW_OTHER_FUNDS_ID,
  FLOW_OTHER_PROJECTS_ID,
  listParties,
  membershipsOf,
  refineFlowGraph,
  refineFlowGraphResources,
  upstreamShares,
  type FlowViewLabels,
} from './flow-graph-views.js';
import { layoutSankey } from './layout.js';
import type { ValueFlowTrack } from './types.js';

const labels: FlowViewLabels = { kept: 'Kept', otherFunds: 'Other funds', otherProjects: 'Other projects', direct: 'Direct' };
const p = partyNodeId;

const node = (t: ValueFlowTrack, id: string) => t.nodes.find((n) => n.id === id);
const link = (t: ValueFlowTrack, source: string, target: string) => t.links.find((l) => l.source === source && l.target === target);
const into = (t: ValueFlowTrack, id: string) => t.links.filter((l) => l.target === id).reduce((s, l) => s + l.value, 0);
const column = (t: ValueFlowTrack, depth: number) => t.nodes.filter((n) => n.depth === depth);
const sum = (rows: Array<{ value: number }>) => rows.reduce((s, r) => s + r.value, 0);

describe('centredTrack', () => {
  it('draws a project between everyone who pays it and everyone it pays', () => {
    const t = centredTrack(indexFlowGraph(diamond()), J, { labels });
    // The Pot seats the project itself: it stands beside the funds, one hop away.
    expect(column(t, 0).map((n) => n.id).sort()).toEqual([p(F1), p(F2), p(POT)]);
    expect(node(t, p(J))).toMatchObject({ depth: 1, kind: 'project' });
    expect(node(t, p(J))!.value).toBeCloseTo(100);
    expect(into(t, p(J))).toBeCloseTo(100);
    expect(link(t, p(POT), p(J))!.value).toBeCloseTo(50);
    expect(link(t, p(F1), p(J))!.value).toBeCloseTo(25);
    expect(node(t, p(POT))!.value).toBeCloseTo(50);
    // Two sources of one column are not drawn paying each other.
    expect(link(t, p(POT), p(F1))).toBeUndefined();
    expect(link(t, p(J), p('111'))!.value).toBeCloseTo(75);
    expect(node(t, p('artisan:9'))).toMatchObject({ depth: 2, kind: 'placeholder' });
    expect(node(t, FLOW_KEPT_ID)).toBeUndefined();
    // Every ribbon runs to the next column.
    const depth = new Map(t.nodes.map((n) => [n.id, n.depth]));
    for (const l of t.links) expect(depth.get(l.target)! - depth.get(l.source)!).toBe(1);
    expect(layoutSankey(t).empty).toBe(false);
  });

  it('draws a person from the projects that seat them back to where it came from', () => {
    const index = indexFlowGraph(diamond());
    const two = centredTrack(index, '111', { labels });
    expect(column(two, 0).map((n) => n.id).sort()).toEqual([p(F1), p(F2), p(POT)]);
    expect(column(two, 1).map((n) => n.id)).toEqual([p(J)]);
    expect(node(two, p('111'))).toMatchObject({ depth: 2, kind: 'person' });
    expect(into(two, p('111'))).toBeCloseTo(100);
    // Of what reaches them, half came by the project's own seat, a quarter by each fund.
    expect(link(two, p(POT), p(J))!.value).toBeCloseTo(50);
    expect(link(two, p(F2), p(J))!.value).toBeCloseTo(25);

    const one = centredTrack(index, '111', { labels, up: 1 });
    expect(one.nodes.map((n) => [n.id, n.depth])).toEqual([[p('111'), 1], [p(J), 0]]);

    const none = centredTrack(index, '111', { labels, up: 0 });
    expect(none.nodes.map((n) => n.id)).toEqual([p('111')]);
  });

  it('scales to the root pot when asked, and to an amount when given one', () => {
    const index = indexFlowGraph(diamond());
    const root = centredTrack(index, '111', { labels, scale: 'root' });
    expect(node(root, p('111'))!.value).toBeCloseTo(75);
    expect(link(root, p(J), p('111'))!.value).toBeCloseTo(75);
    expect(root.unit).toBe('');

    const amount = centredTrack(index, '111', { labels, amount: { unit: 'EVO', total: 300 } });
    expect(amount.unit).toBe('EVO');
    expect(link(amount, p(J), p('111'))!.value).toBeCloseTo(300);
    expect(link(amount, p(F1), p(J))!.value).toBeCloseTo(75);
    expect(amount.totalIn).toBeCloseTo(300);
  });

  it('shows what a holon keeps beside what it passes on', () => {
    const t = centredTrack(indexFlowGraph(diamond({ [F2]: fund(40, J) })), F2, { labels });
    expect(node(t, FLOW_KEPT_ID)).toMatchObject({ label: 'Kept', kind: 'retained', depth: 2 });
    expect(node(t, FLOW_KEPT_ID)!.value).toBeCloseTo(40);
    expect(link(t, p(F2), p(J))!.value).toBeCloseTo(60);
    expect(t.totalOut).toBeCloseTo(60);
  });

  it('follows the passing-on as far as asked', () => {
    const t = centredTrack(indexFlowGraph(diamond()), F1, { labels, down: 2 });
    expect(node(t, p(J))).toMatchObject({ depth: 2 });
    expect(link(t, p(J), p('111'))!.value).toBeCloseTo(75);
    expect(node(t, p('111'))).toMatchObject({ depth: 3 });
  });

  it('draws a holon the Pot does not reach by its own split alone', () => {
    const index = indexFlowGraph(diamond({}, { extra: { holon_f3: fund(0, J) } }));
    const t = centredTrack(index, 'holon_f3', { labels, scale: 'root' });
    expect(t.nodes.map((n) => [n.id, n.depth]).sort()).toEqual([[p('holon_f3'), 0], [p(J), 1]].sort());
    expect(link(t, p('holon_f3'), p(J))!.value).toBeCloseTo(100);
  });

  it('stays finite round a loop', () => {
    const looped = diamond({ [J]: { ...seats({ '111': 1 }), config: cfg(50), zoned: [{ id: F1, name: F1, zone: 1, kind: 'holon' }] } });
    for (const id of [J, F1, '111', POT]) {
      const t = centredTrack(indexFlowGraph(looped), id, { labels, down: 2 });
      for (const n of t.nodes) expect(Number.isFinite(n.value) && n.value > 0).toBe(true);
      for (const l of t.links) expect(Number.isFinite(l.value) && l.value > 0).toBe(true);
      expect(new Set(t.nodes.map((n) => n.id)).size).toBe(t.nodes.length);
    }
  });

  it('is empty for a party the graph does not know', () => {
    expect(centredTrack(indexFlowGraph(diamond()), 'nobody', { labels }).nodes).toEqual([]);
  });
});

/** A Pot with `funds` funds and `projects` projects, every project seated and curated by two funds. */
function wide(funds: number, projects: number) {
  const fundIds = Array.from({ length: funds }, (_, i) => `holon_fund${i}`);
  const projectIds = Array.from({ length: projects }, (_, i) => `holon_proj${i}`);
  const children: Record<string, CascadeInputs> = {};
  fundIds.forEach((id, i) => {
    children[id] = fund(0, projectIds[i % projects], projectIds[(i + 1) % projects]);
  });
  const shares: Record<string, number> = {};
  fundIds.forEach((id, i) => (shares[id] = funds - i));
  projectIds.forEach((id, i) => (shares[id] = 1 + (i % 3)));
  const cascade = resolveCascade({ holonId: POT, total: null, root: seats(shares, 'The Pot'), resolveChild: (id) => children[id] ?? null });
  return buildFlowGraph({ cascade, at: 1, meta: { [POT]: { claimWindow: { until: 1, keep: fundIds } } } });
}

describe('ecosystemTrack', () => {
  it('fits the whole map on three short columns that still add up', () => {
    const g = wide(10, 30);
    const index = indexFlowGraph(g);
    const t = ecosystemTrack(index, { labels });

    expect(column(t, 0).map((n) => n.id)).toEqual([p(POT)]);
    expect(column(t, 1).length).toBe(8); // six funds, the other funds, the direct seats
    expect(column(t, 2).length).toBe(7); // six projects, the others
    expect(node(t, FLOW_OTHER_FUNDS_ID)).toMatchObject({ label: 'Other funds', kind: 'other' });
    expect(node(t, FLOW_OTHER_PROJECTS_ID)).toMatchObject({ label: 'Other projects', kind: 'other' });

    const direct = g.links.filter((l) => l.source === POT && l.target.startsWith('holon_proj')).reduce((s, l) => s + l.share, 0);
    expect(node(t, FLOW_DIRECT_ID)!.value).toBeCloseTo(direct);
    expect(sum(column(t, 1))).toBeCloseTo(100);
    expect(sum(column(t, 2))).toBeCloseTo(100);
    for (const n of column(t, 1)) {
      expect(into(t, n.id)).toBeCloseTo(n.value);
      expect(sum(t.links.filter((l) => l.source === n.id))).toBeCloseTo(n.value);
    }
    // The six largest funds are the ones named.
    expect(column(t, 1).filter((n) => n.kind === 'fund').map((n) => n.id).sort()).toEqual(
      Array.from({ length: 6 }, (_, i) => p(`holon_fund${i}`)).sort(),
    );
    expect(layoutSankey(t, { topN: 8 }).nodes.some((n) => n.id.startsWith('__other_'))).toBe(true);
  });

  it('names the same bars every time when shares tie', () => {
    const g = wide(10, 30);
    const a = ecosystemTrack(indexFlowGraph(g), { labels });
    const b = ecosystemTrack(indexFlowGraph({ ...g, nodes: [...g.nodes].reverse(), links: [...g.links].reverse() }), { labels });
    expect(a.nodes.map((n) => n.id).sort()).toEqual(b.nodes.map((n) => n.id).sort());
  });

  it('needs no rollup for a small Pot, and takes a narrower cut', () => {
    const index = indexFlowGraph(diamond({}, { meta: { [POT]: { claimWindow: { until: 1, keep: [F1, F2] } } } }));
    const t = ecosystemTrack(index, { labels });
    expect(t.nodes.map((n) => n.id).sort()).toEqual([FLOW_DIRECT_ID, p(F1), p(F2), p(J), p(POT)].sort());
    expect(node(t, p(J))!.value).toBeCloseTo(100);
    const narrow = ecosystemTrack(index, { labels, funds: 1 });
    expect(column(narrow, 1).map((n) => n.id).sort()).toEqual([FLOW_DIRECT_ID, FLOW_OTHER_FUNDS_ID, p(F1)].sort());
  });
});

describe('lists over the graph', () => {
  const index = indexFlowGraph(diamond({}, { meta: { '111': { name: 'Ada Ñandú', payout: '0xabc' } } }));

  it('says through whom a party income came', () => {
    const rows = upstreamShares(index, '111');
    expect(rows.map((r) => [r.id, Math.round(r.share)])).toEqual([[J, 100], [POT, 100], [F1, 25], [F2, 25]]);
    expect(upstreamShares(index, POT)).toEqual([]);
    expect(upstreamShares(index, 'nobody')).toEqual([]);
  });

  it('lists the holons that seat a party, with its seat in each', () => {
    expect(membershipsOf(index, '111')).toEqual([{ id: J, label: 'Project J', kind: 'project', share: 100, local: 75 }]);
    const rows = membershipsOf(index, J);
    expect(rows.map((r) => r.id)).toEqual([POT, F1, F2]);
    expect(rows[0].share).toBeCloseTo(50);
    expect(rows[1].local).toBeCloseTo(100);
  });

  it('searches parties by name, id or address, without minding accents', () => {
    expect(listParties(index, { query: 'nandu' }).map((r) => r.id)).toEqual(['111']);
    expect(listParties(index, { query: '0xABC' }).map((r) => r.id)).toEqual(['111']);
    expect(listParties(index, { query: 'holon_f' }).map((r) => r.id)).toEqual([F1, F2]);
    expect(listParties(index, { kind: 'placeholder' }).map((r) => r.id)).toEqual(['artisan:9']);
    expect(listParties(index).map((r) => r.id).slice(0, 2).sort()).toEqual([J, POT].sort());
    expect(listParties(index, { limit: 2, offset: 2 })).toHaveLength(2);
    expect(listParties(index, { query: 'zzz' })).toEqual([]);
  });
});

describe('refineFlowGraph', () => {
  it('finds no drift in a split that did not move', () => {
    const g = diamond();
    const out = refineFlowGraph(g, { holonId: F1, root: fund(0, J), children: { [J]: seats({ '111': 3, 'artisan:9': 1 }) } });
    expect(out.drift).toEqual([]);
    expect(out.refreshed).toEqual([F1, J]);
    expect(out.graph.links).toHaveLength(g.links.length);
    expect(out.graph.nodes.map((n) => n.id).sort()).toEqual(g.nodes.map((n) => n.id).sort());
  });

  it('replaces a holon split by what it is now and says how far the snapshot was', () => {
    const g = diamond();
    const out = refineFlowGraph(g, { holonId: F1, root: { ...fund(0, J, 'holon_new'), name: 'Fund One' }, children: {} });
    expect(out.drift.sort((a, b) => (a.target < b.target ? -1 : 1))).toEqual([
      { source: F1, target: J, before: 100, after: 50 },
      { source: F1, target: 'holon_new', before: 0, after: 50 },
    ]);
    const fresh = out.graph.links.filter((l) => l.source === F1);
    expect(fresh.map((l) => [l.target, l.local, l.share])).toEqual([[J, 50, 12.5], ['holon_new', 50, 12.5]]);
    expect(out.graph.nodes.find((n) => n.id === 'holon_new')).toMatchObject({ kind: 'project', share: 12.5 });
    expect(out.graph.nodes.find((n) => n.id === F1)!.label).toBe('Fund One');
    // Nothing upstream moved, and the snapshot is left as it was.
    expect(out.graph.links.find((l) => l.source === POT && l.target === F1)).toEqual(g.links.find((l) => l.source === POT && l.target === F1));
    expect(g.links.filter((l) => l.source === F1)).toHaveLength(1);

    const t = centredTrack(indexFlowGraph(out.graph), F1, { labels });
    expect(link(t, p(F1), p('holon_new'))!.value).toBeCloseTo(50);
  });
});

describe('refineFlowGraphResources', () => {
  it('replaces one party\'s resources by what its log says now', () => {
    const g = diamond();
    const out = refineFlowGraphResources(g, J, { material: 2, living: 1, financial: 3 });
    expect(out.nodes.find((n) => n.id === J)!.resources).toEqual({ material: 2, living: 1, financial: 3 });
    expect(g.nodes.find((n) => n.id === J)!.resources).toBeUndefined();
    expect(out.nodes.filter((n) => n.id !== J)).toEqual(g.nodes.filter((n) => n.id !== J));
  });

  it('drops resources a party no longer has, and leaves an unknown party alone', () => {
    const g = refineFlowGraphResources(diamond(), J, { social: 1 });
    expect(refineFlowGraphResources(g, J, {}).nodes.find((n) => n.id === J)).not.toHaveProperty('resources');
    expect(refineFlowGraphResources(g, 'holon_nobody', { social: 4 })).toBe(g);
  });
});

describe('graphRights', () => {
  const rights = (index: ReturnType<typeof indexFlowGraph>, id: string) =>
    Object.fromEntries([...partyShares(graphRights(index, id))].map(([k, v]) => [k, Math.round(v * 1000) / 1000]));

  it('gives every party below a holon what rests with them, across every path', () => {
    const index = indexFlowGraph(diamond());
    // The funds and the project pass everything on: the right sits with the people.
    expect(rights(index, POT)).toEqual({ '111': 75, 'artisan:9': 25 });
    expect(rights(index, F1)).toEqual({ '111': 75, 'artisan:9': 25 });
    expect(rights(index, J)).toEqual({ '111': 75, 'artisan:9': 25 });
  });

  it('leaves with a holon what it keeps, and never seats the holon in its own fund', () => {
    const index = indexFlowGraph(diamond({ [F1]: fund(40, J) }));
    // F1 holds 25 of the Pot and keeps 40% of it; the other 60% goes on to J.
    expect(rights(index, POT)).toEqual({ [F1]: 10, '111': 67.5, 'artisan:9': 22.5 });
    // Of F1's own income, the 40 it keeps is nobody's right.
    expect(rights(index, F1)).toEqual({ '111': 45, 'artisan:9': 15 });
  });

  it('cuts a loop where it closes, and has nothing for a party it does not know or a leaf', () => {
    const loop = indexFlowGraph(diamond({ [J]: { config: cfg(50), members: seats({ '111': 1 }).members, zoned: [{ id: F1, name: F1, zone: 1, kind: 'holon' }] } }));
    const r = rights(loop, F1);
    expect(Object.values(r).every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
    expect(Object.values(r).reduce((s, v) => s + v, 0)).toBeLessThanOrEqual(100.001);
    expect(rights(loop, 'nobody')).toEqual({});
    expect(rights(indexFlowGraph(diamond()), '111')).toEqual({});
  });
});
