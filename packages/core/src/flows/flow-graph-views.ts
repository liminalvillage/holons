// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The flow graph as diagrams — one question per view, each a `ValueFlowTrack`
 * that `layoutSankey` lays out unchanged.
 *
 *   centred    — one party in the middle: who its income comes through on the
 *                left, who it passes it on to on the right. The same drawing
 *                for a person, a project, a fund and the Pot.
 *   ecosystem  — the Pot, its funds, the projects: the whole map on three
 *                columns a phone can show.
 *
 * A centred view reads the graph both ways. Downstream is the party's own
 * split, hop by hop. Upstream asks of every edge how much of what travels it
 * ends up at the focus — the sum, over the ways down, of the splits on the
 * way. That sum is exact on a graph with no loops; on one with a loop it is
 * followed `MAX_HOPS` deep and is a lower bound. A source is drawn once, in
 * the column of its shortest way to the focus: the Pot that seats a project
 * itself stands beside the funds that curate it, not behind them.
 *
 * Pure.
 */

import type { AllocationResult, AllocationSlice } from './allocation.js';
import { partyNodeId } from './allocation-graph.js';
import { resolveCascade, type CascadeInputs } from './cascade.js';
import { childResolver } from './cascade-load.js';
import { buildFlowGraph, classifyParty, type FlowGraph, type FlowGraphLink, type FlowGraphNode, type FlowPartyKind } from './flow-graph.js';
import { indexFlowGraph, type FlowGraphIndex } from './flow-graph-index.js';
import { foldForSearch } from './ledger.js';
import { capitalCounts, capitalsFromCounts, type Capital } from './resources.js';
import type { ValueFlowLink, ValueFlowNode, ValueFlowTrack } from './types.js';

export interface FlowViewLabels {
  /** What the focus holds after passing on. */
  kept: string;
  otherFunds: string;
  otherProjects: string;
  /** What the Pot seats without a fund between. */
  direct: string;
}

export const FLOW_KEPT_ID = '__kept';
export const FLOW_DIRECT_ID = '__direct';
export const FLOW_OTHER_FUNDS_ID = '__other_funds';
export const FLOW_OTHER_PROJECTS_ID = '__other_projects';

/** Hops a path to the focus is followed up. */
const MAX_HOPS = 6;
/** Below this a value is rounding, not a flow. */
const EPSILON = 1e-9;

/**
 * For every party, the fraction of what it receives that ends up at `focusId`,
 * by exact hop count: `byHop[k].get(v)` over paths of k hops, and `all` their sum.
 */
function reachOf(index: FlowGraphIndex, focusId: string): { all: Map<string, number>; byHop: Array<Map<string, number>> } {
  const byHop: Array<Map<string, number>> = [new Map()];
  const all = new Map<string, number>();
  let level = new Map<string, number>();
  for (const link of index.into.get(focusId) ?? []) {
    if (link.source !== focusId && link.local > 0) level.set(link.source, link.local / 100);
  }
  for (let k = 1; k <= MAX_HOPS && level.size > 0; k++) {
    byHop[k] = level;
    for (const [id, r] of level) all.set(id, (all.get(id) ?? 0) + r);
    const next = new Map<string, number>();
    for (const [id, r] of level) {
      for (const link of index.into.get(id) ?? []) {
        // A path that leaves the focus to come back is the loop, not a source.
        if (link.source === focusId || !(link.local > 0)) continue;
        next.set(link.source, (next.get(link.source) ?? 0) + (link.local / 100) * r);
      }
    }
    level = next;
  }
  return { all, byHop };
}

export interface CentredTrackOptions {
  /** Hops of provenance drawn. Default 2. */
  up?: number;
  /** Hops of passing-on drawn. Default 1. */
  down?: number;
  /** `focus`: everything as a percent of what reaches the focus. `root`: of the root pot. */
  scale?: 'focus' | 'root';
  /** Draw amounts: `total` is what reaches the focus, in `unit`. */
  amount?: { unit: string; total: number };
  labels: FlowViewLabels;
}

const emptyTrack = (unit = ''): ValueFlowTrack => ({ id: 'allocation', unit, nodes: [], links: [], totalIn: 0, totalOut: 0, balance: null });

/** Sources → `focusId` → recipients. */
export function centredTrack(index: FlowGraphIndex, focusId: string, opts: CentredTrackOptions): ValueFlowTrack {
  const focus = index.byId.get(focusId);
  if (!focus) return emptyTrack(opts.amount?.unit);
  const up = Math.max(0, Math.floor(opts.up ?? 2));
  const down = Math.max(0, Math.floor(opts.down ?? 1));

  // Worked as a percent of what reaches the focus, scaled once at the end.
  const seated = focus.share > EPSILON;
  const column = new Map<string, number>([[focusId, 0]]);
  const value = new Map<string, number>([[focusId, 100]]);
  const edges: Array<{ source: string; target: string; value: number; link: FlowGraphLink }> = [];

  if (seated && up > 0) {
    const { all, byHop } = reachOf(index, focusId);
    for (let k = 1; k <= up; k++) {
      // A party stands in the column of its SHORTEST way to the focus, so every
      // ribbon runs to the next column and none has to leap over one.
      for (const id of byHop[k]?.keys() ?? []) if (!column.has(id)) column.set(id, -k);
    }
    for (const [id, col] of column) {
      if (col >= 0) continue;
      for (const link of index.out.get(id) ?? []) {
        const to = column.get(link.target);
        // Between two parties of one column — the Pot seating a fund that pays
        // the same project — there is nothing to draw: both are its sources.
        if (to == null || to <= col || to > 0) continue;
        const through = link.target === focusId ? 1 : (all.get(link.target) ?? 0);
        const v = ((link.share * through) / focus.share) * 100;
        if (v > EPSILON) edges.push({ source: id, target: link.target, value: v, link });
      }
    }
  }

  let kept = 0;
  if (down > 0) {
    let level = new Map<string, number>([[focusId, 100]]);
    for (let k = 1; k <= down && level.size > 0; k++) {
      const next = new Map<string, number>();
      for (const [id, reaching] of level) {
        let paid = 0;
        for (const link of index.out.get(id) ?? []) {
          if (!(link.local > 0)) continue;
          paid += link.local;
          const seen = column.get(link.target);
          // Never back toward the sources: a loop is drawn up to where it closes.
          if (seen != null && seen < k) continue;
          const v = (reaching * link.local) / 100;
          if (!(v > EPSILON)) continue;
          column.set(link.target, k);
          next.set(link.target, (next.get(link.target) ?? 0) + v);
          edges.push({ source: id, target: link.target, value: v, link });
        }
        if (id === focusId) kept = Math.max(0, 100 - paid);
      }
      level = next;
    }
  }

  const sums = (side: 'source' | 'target') => {
    const out = new Map<string, number>();
    for (const e of edges) out.set(e[side], (out.get(e[side]) ?? 0) + e.value);
    return out;
  };
  const outSum = sums('source');
  const inSum = sums('target');
  for (const id of column.keys()) {
    if (id === focusId) continue;
    value.set(id, Math.max(inSum.get(id) ?? 0, outSum.get(id) ?? 0));
  }

  const factor = opts.amount ? opts.amount.total / 100 : opts.scale === 'root' && seated ? focus.share / 100 : 1;
  // Columns nothing is drawn in close up, so the diagram starts at its first bar.
  const used = new Set<number>([0]);
  for (const [id, col] of column) if ((value.get(id) ?? 0) > EPSILON) used.add(col);
  const depthOf = new Map([...used].sort((a, b) => a - b).map((c, i) => [c, i] as const));

  const nodes: ValueFlowNode[] = [];
  for (const [id, col] of column) {
    const v = (value.get(id) ?? 0) * factor;
    const depth = depthOf.get(col);
    const party = index.byId.get(id);
    if (!party || depth == null || !(v > 0)) continue;
    nodes.push({ id: partyNodeId(id), label: party.label, depth, value: v, kind: party.kind });
  }
  const links: ValueFlowLink[] = edges.map((e) => ({
    id: `${e.source}>${e.target}`,
    source: partyNodeId(e.source),
    target: partyNodeId(e.target),
    value: e.value * factor,
    kind: e.link.via,
  }));
  // What the focus holds is drawn beside what it passes on, when it passes anything on.
  if (down > 0 && kept > EPSILON && (outSum.get(focusId) ?? 0) > EPSILON) {
    const depth = (depthOf.get(0) ?? 0) + 1;
    nodes.push({ id: FLOW_KEPT_ID, label: opts.labels.kept, depth, value: kept * factor, kind: 'retained' });
    links.push({ id: `${focusId}>${FLOW_KEPT_ID}`, source: partyNodeId(focusId), target: FLOW_KEPT_ID, value: kept * factor, kind: 'retained' });
  }

  return {
    id: 'allocation',
    unit: opts.amount?.unit ?? '',
    nodes,
    links,
    totalIn: 100 * factor,
    totalOut: (outSum.get(focusId) ?? 0) * factor,
    balance: null,
  };
}

/** The Pot → its funds → who they and the Pot pay: three columns, a handful of bars each. */
export function ecosystemTrack(
  index: FlowGraphIndex,
  opts: { funds?: number; projects?: number; labels: FlowViewLabels },
): ValueFlowTrack {
  const root = index.byId.get(index.graph.root);
  if (!root) return emptyTrack();
  const topFunds = Math.max(0, Math.floor(opts.funds ?? 6));
  const topProjects = Math.max(0, Math.floor(opts.projects ?? 6));
  const byShare = (a: [string, number], b: [string, number]) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1);

  // Column 1: the funds the Pot seats, and what it seats without one.
  const fundIn = new Map<string, number>();
  const direct = new Map<string, number>();
  for (const link of index.out.get(root.id) ?? []) {
    if (!(link.share > EPSILON)) continue;
    const kind = index.byId.get(link.target)?.kind;
    const into = kind === 'fund' ? fundIn : direct;
    into.set(link.target, (into.get(link.target) ?? 0) + link.share);
  }
  const shown = new Set([...fundIn].sort(byShare).slice(0, topFunds).map(([id]) => id));
  const fundBucket = (id: string) => (shown.has(id) ? partyNodeId(id) : FLOW_OTHER_FUNDS_ID);

  // Column 2: everyone a fund or the Pot pays that is not a fund, by what reaches them here.
  const flows: Array<{ from: string; to: string; value: number }> = [];
  const reaching = new Map<string, number>();
  const add = (from: string, to: string, v: number) => {
    flows.push({ from, to, value: v });
    reaching.set(to, (reaching.get(to) ?? 0) + v);
  };
  for (const [id, v] of direct) add(FLOW_DIRECT_ID, id, v);
  for (const fund of fundIn.keys()) {
    for (const link of index.out.get(fund) ?? []) {
      if (!(link.share > EPSILON) || index.byId.get(link.target)?.kind === 'fund' || link.target === root.id) continue;
      add(fundBucket(fund), link.target, link.share);
    }
  }
  const named = new Set([...reaching].sort(byShare).slice(0, topProjects).map(([id]) => id));
  const projectBucket = (id: string) => (named.has(id) ? partyNodeId(id) : FLOW_OTHER_PROJECTS_ID);

  const nodes = new Map<string, ValueFlowNode>();
  const bar = (id: string, label: string, depth: number, v: number, kind: string) => {
    const seen = nodes.get(id);
    if (seen) seen.value += v;
    else nodes.set(id, { id, label, depth, value: v, kind });
  };
  const links = new Map<string, ValueFlowLink>();
  const ribbon = (source: string, target: string, v: number) => {
    const id = `${source}>${target}`;
    const seen = links.get(id);
    if (seen) seen.value += v;
    else links.set(id, { id, source, target, value: v });
  };

  const potId = partyNodeId(root.id);
  bar(potId, root.label, 0, root.share, 'pot');
  for (const [id, v] of fundIn) {
    const bucket = fundBucket(id);
    bar(bucket, shown.has(id) ? (index.byId.get(id)?.label ?? id) : opts.labels.otherFunds, 1, v, shown.has(id) ? 'fund' : 'other');
    ribbon(potId, bucket, v);
  }
  let directTotal = 0;
  for (const v of direct.values()) directTotal += v;
  if (directTotal > EPSILON) {
    bar(FLOW_DIRECT_ID, opts.labels.direct, 1, directTotal, 'direct');
    ribbon(potId, FLOW_DIRECT_ID, directTotal);
  }
  for (const flow of flows) {
    const bucket = projectBucket(flow.to);
    const party = index.byId.get(flow.to);
    bar(bucket, named.has(flow.to) ? (party?.label ?? flow.to) : opts.labels.otherProjects, 2, flow.value, named.has(flow.to) ? (party?.kind ?? 'project') : 'other');
    ribbon(flow.from, bucket, flow.value);
  }

  return {
    id: 'allocation',
    unit: '',
    nodes: [...nodes.values()],
    links: [...links.values()],
    totalIn: root.share,
    totalOut: root.share - root.rest,
    balance: null,
  };
}

export interface FlowRow {
  id: string;
  label: string;
  kind: FlowPartyKind;
  /** See each selector: a percent, largest first. */
  share: number;
  /** Percent of the other party's own split, where one edge is meant. */
  local?: number;
}

const row = (node: FlowGraphNode, share: number, local?: number): FlowRow => ({
  id: node.id,
  label: node.label,
  kind: node.kind,
  share,
  ...(local != null ? { local } : {}),
});
const byShareThenLabel = (a: FlowRow, b: FlowRow) => b.share - a.share || a.label.localeCompare(b.label) || (a.id < b.id ? -1 : 1);

/** Everyone `id`'s income passes through, with the percent of that income that did. */
export function upstreamShares(index: FlowGraphIndex, id: string): FlowRow[] {
  const focus = index.byId.get(id);
  if (!focus || !(focus.share > EPSILON)) return [];
  const rows: FlowRow[] = [];
  for (const [source, r] of reachOf(index, id).all) {
    const node = index.byId.get(source);
    if (!node) continue;
    const share = Math.min(100, ((node.share * r) / focus.share) * 100);
    if (share > EPSILON) rows.push(row(node, share));
  }
  return rows.sort(byShareThenLabel);
}

/** The holons that seat `id` themselves: the percent of its income each sends, and its seat there. */
export function membershipsOf(index: FlowGraphIndex, id: string): FlowRow[] {
  const focus = index.byId.get(id);
  if (!focus) return [];
  const rows: FlowRow[] = [];
  for (const link of index.into.get(id) ?? []) {
    const node = index.byId.get(link.source);
    if (node) rows.push(row(node, focus.share > EPSILON ? (link.share / focus.share) * 100 : 0, link.local));
  }
  return rows.sort(byShareThenLabel);
}

/** How deep `graphRights` follows a split; past it, what is left stays where it is. */
const RIGHTS_DEPTH = 8;

/**
 * Who ends up holding what share of `holonId`'s income, read off the map:
 * every party below it, with the part of the holon's income that RESTS with
 * them once each split on the way has passed its share on. The same answer
 * `cascadeRights` gives from a live walk — in the shape `claimCeilings`
 * takes — for a surface that has the published map and should not walk a
 * Pot of thousands again.
 *
 * The holon itself is not in it: what it keeps for nobody is nobody's
 * right. A loop is cut where it closes, like the cascade cuts it.
 */
export function graphRights(index: FlowGraphIndex, holonId: string): AllocationResult {
  const root = String(holonId ?? '');
  const held = new Map<string, number>();
  const walk = (id: string, flow: number, path: Set<string>, depth: number) => {
    const links = (index.out.get(id) ?? []).filter((l) => l.local > 0 && !path.has(l.target));
    const passed = depth >= RIGHTS_DEPTH ? 0 : Math.min(100, links.reduce((sum, l) => sum + l.local, 0));
    if (id !== root) {
      const rests = (flow * (100 - passed)) / 100;
      if (rests > 0) held.set(id, (held.get(id) ?? 0) + rests);
    }
    if (!(passed > 0)) return;
    path.add(id);
    for (const l of links) walk(l.target, (flow * l.local) / 100, path, depth + 1);
    path.delete(id);
  };
  if (root && index.byId.has(root)) walk(root, 100, new Set(), 0);
  const interior: AllocationSlice[] = [...held.entries()]
    .filter(([, percentage]) => percentage > 1e-9)
    .sort((a, z) => z[1] - a[1] || a[0].localeCompare(z[0]))
    .map(([id, percentage]) => ({ id, label: index.byId.get(id)?.label ?? id, percentage, amount: null, side: 'interior' as const }));
  return { config: { interiorPercent: 100, steepness: 0, nzones: 0 }, unit: '', total: null, interior, exterior: [] };
}

/** The parties of the graph, by share of the root pot, filtered by kind and by free text. */
export function listParties(
  index: FlowGraphIndex,
  opts: { kind?: FlowPartyKind; query?: string; limit?: number; offset?: number } = {},
): FlowRow[] {
  const words = foldForSearch(String(opts.query ?? '')).split(/\s+/).filter(Boolean);
  const rows: FlowRow[] = [];
  for (const node of index.graph.nodes) {
    if (opts.kind && node.kind !== opts.kind) continue;
    if (words.length) {
      const text = foldForSearch(`${node.label} ${node.id} ${node.payout ?? ''}`);
      if (!words.every((w) => text.includes(w))) continue;
    }
    rows.push(row(node, node.share));
  }
  rows.sort(byShareThenLabel);
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  return opts.limit == null ? rows.slice(offset) : rows.slice(offset, offset + Math.max(0, Math.floor(opts.limit)));
}

export interface FlowGraphDrift {
  source: string;
  target: string;
  /** Percent of the source's split, in the snapshot and now. */
  before: number;
  after: number;
}

/** A change of split smaller than this is rounding. */
const DRIFT = 0.5;

/**
 * A snapshot with one holon's split read afresh.
 *
 * The out-links of `holonId` and of each child in `live.children` are
 * replaced by what their splits say now. Nothing upstream moves and shares
 * are not propagated further: a centred view draws downstream from `local`
 * alone, so the diagram of the refreshed holon is right, and `drift` says
 * how far the snapshot was from it.
 */
export function refineFlowGraph(
  graph: FlowGraph,
  live: { holonId: string; root: CascadeInputs; children: Record<string, CascadeInputs> },
): { graph: FlowGraph; refreshed: string[]; drift: FlowGraphDrift[] } {
  const holon = String(live.holonId ?? '');
  const fresh = buildFlowGraph({
    cascade: resolveCascade({ holonId: holon, total: null, root: live.root, resolveChild: childResolver(live.children), maxDepth: MAX_HOPS }),
    at: graph.at,
  });
  const freshOut = indexFlowGraph(fresh).out;
  const refreshed = [holon, ...Object.keys(live.children).filter((id) => id !== holon && freshOut.has(id))];
  const replaced = new Set(refreshed);

  const before = new Map<string, number>();
  for (const link of graph.links) if (link.source === holon) before.set(link.target, link.local);

  const nodes = new Map<string, FlowGraphNode>(graph.nodes.map((n) => [n.id, { ...n }]));
  const links = graph.links.filter((l) => !replaced.has(l.source)).map((l) => ({ ...l }));
  for (const source of refreshed) {
    const reaching = nodes.get(source)?.share ?? 0;
    for (const link of freshOut.get(source) ?? []) {
      const share = (reaching * link.local) / 100;
      links.push({ ...link, share });
      if (!nodes.has(link.target)) {
        const seen = fresh.nodes.find((n) => n.id === link.target);
        nodes.set(link.target, {
          id: link.target,
          label: seen?.label ?? link.target,
          kind: classifyParty({ id: link.target, rootId: graph.root, keep: new Set(), out: freshOut.get(link.target) ?? [] }),
          share,
          rest: 0,
        });
      }
    }
  }
  if (live.root.name && nodes.has(holon)) nodes.get(holon)!.label = live.root.name;

  const drift: FlowGraphDrift[] = [];
  const after = new Map((freshOut.get(holon) ?? []).map((l) => [l.target, l.local] as const));
  for (const target of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(target) ?? 0;
    const now = after.get(target) ?? 0;
    if (Math.abs(was - now) > DRIFT) drift.push({ source: holon, target, before: was, after: now });
  }

  return { graph: { ...graph, nodes: [...nodes.values()], links }, refreshed, drift };
}

/**
 * A snapshot with one party's resource base read afresh: its `resources`
 * replaced by what its log says now (dropped when it has none). The snapshot
 * counts gifts as they were when it was published; a gift given, received or
 * disputed since moves the ranking only through this. A party the snapshot
 * does not know is left out — nothing else moves.
 */
export function refineFlowGraphResources(
  graph: FlowGraph,
  partyId: string,
  byCapital: Partial<Record<Capital, number>> | null | undefined,
): FlowGraph {
  const id = String(partyId ?? '');
  if (!graph.nodes.some((n) => n.id === id)) return graph;
  const resources = capitalsFromCounts(capitalCounts(byCapital));
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      if (n.id !== id) return n;
      const { resources: _was, ...rest } = n;
      return Object.keys(resources).length ? { ...rest, resources } : rest;
    }),
  };
}
