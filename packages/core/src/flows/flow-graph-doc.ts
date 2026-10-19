// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The flow graph as stored — one snapshot, in parts.
 *
 * A map of a Pot with two thousand seats is a quarter of a megabyte, and a
 * relay drops an event past 64 KB without a word. So the snapshot is a HEAD
 * and numbered PARTS on the `flow_graph` lens of the Pot holon, each part
 * well under the limit, rows packed as arrays and links naming their ends by
 * index.
 *
 * Parts are replaced in place, so a reader may arrive mid-publish and find
 * parts of two generations. Each part carries the `gen` it belongs to and the
 * head names the one that is whole: `decodeFlowGraph` accepts a full set of
 * that generation whose rows hash to what the head says, or nothing. A
 * reader that gets nothing keeps the graph it had.
 *
 * Pure: a graph in, documents out, and back.
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import type { FlowGraph, FlowGraphLink, FlowGraphNode, FlowPartyKind } from './flow-graph.js';
import { capitalCounts, capitalsFromCounts } from './resources.js';

export const FLOW_GRAPH_LENS = 'flow_graph';
export const FLOW_GRAPH_VERSION = 1;
/** UTF-8 bytes a part's JSON may take: headroom under a relay's 65,536. */
export const FLOW_GRAPH_PART_BYTES = 40_000;
export const FLOW_GRAPH_HEAD_ID = 'head';

type KindCode = 'P' | 'F' | 'J' | 'U' | 'X';
const KIND_CODE: Record<FlowPartyKind, KindCode> = { pot: 'P', fund: 'F', project: 'J', person: 'U', placeholder: 'X' };
const CODE_KIND: Record<string, FlowPartyKind> = { P: 'pot', F: 'fund', J: 'project', U: 'person', X: 'placeholder' };

/**
 * `[id, label, kind, share, rest, payout, potChain, potAddress, unclaimedUntil, resources]`, trailing
 * blanks dropped; `resources` is eight counts in `CAPITALS` order. A reader that predates a trailing
 * field ignores it, so adding one keeps the version.
 */
export type FlowGraphNodeRow = [string, string, KindCode, number, number, ...Array<string | number | number[]>];
/** `[source index, target index, share, local, ring]`; ring 0 is the interior, -1 an exterior with no one ring. */
export type FlowGraphLinkRow = [number, number, number, number, number];

export interface FlowGraphHead {
  id: typeof FLOW_GRAPH_HEAD_ID;
  v: number;
  /** The generation of parts this head describes. */
  gen: string;
  root: string;
  at: number;
  epoch?: number;
  complete: boolean;
  problems: string[];
  parts: number;
  counts: { nodes: number; links: number; aliases: number; cycles: number };
  /** sha256 over every row, in order. */
  hash: string;
}

export interface FlowGraphPart {
  /** `p0`, `p1`, … — the same ids every publish. */
  id: string;
  gen: string;
  i: number;
  n?: FlowGraphNodeRow[];
  l?: FlowGraphLinkRow[];
  /** `[at, from, to]`. */
  a?: Array<[string, string, string]>;
  c?: string[][];
}

export type DecodedFlowGraph =
  | { ok: true; graph: FlowGraph; head: FlowGraphHead }
  | { ok: false; reason: 'missing' | 'incomplete' | 'version' | 'corrupt'; head?: FlowGraphHead };

const bytesOf = (value: unknown) => utf8ToBytes(JSON.stringify(value)).length;
/** Six significant digits: what a diagram can show, a third of the bytes. */
const round = (n: number) => (Number.isFinite(n) ? Number(n.toPrecision(6)) : 0);

function nodeRow(node: FlowGraphNode): FlowGraphNodeRow {
  const counts = capitalCounts(node.resources);
  const tail: Array<string | number | number[]> = [
    node.payout ?? '',
    node.pot?.chainId ?? 0,
    node.pot?.address ?? '',
    node.unclaimedUntil ?? 0,
    counts.some((n) => n > 0) ? counts : 0,
  ];
  while (tail.length && !tail[tail.length - 1]) tail.pop();
  return [node.id, node.label, KIND_CODE[node.kind], round(node.share), round(node.rest), ...tail];
}

type Section = 'n' | 'l' | 'a' | 'c';
const SECTIONS: readonly Section[] = ['n', 'l', 'a', 'c'];

interface Rows {
  n: FlowGraphNodeRow[];
  l: FlowGraphLinkRow[];
  a: Array<[string, string, string]>;
  c: string[][];
}

function rowsOf(graph: FlowGraph): Rows {
  const index = new Map<string, number>();
  graph.nodes.forEach((node, i) => index.set(node.id, i));
  const l: FlowGraphLinkRow[] = [];
  for (const link of graph.links) {
    const s = index.get(link.source);
    const t = index.get(link.target);
    if (s == null || t == null) continue;
    l.push([s, t, round(link.share), round(link.local), link.via === 'interior' ? 0 : (link.zone ?? -1)]);
  }
  return {
    n: graph.nodes.map(nodeRow),
    l,
    a: graph.aliases.map((x) => [x.at, x.from, x.to]),
    c: graph.cycles.map((x) => [...x]),
  };
}

const hashOf = (rows: Rows) => bytesToHex(sha256(utf8ToBytes(JSON.stringify([rows.n, rows.l, rows.a, rows.c]))));

export function encodeFlowGraph(
  graph: FlowGraph,
  opts: { partBytes?: number; gen?: string } = {},
): { head: FlowGraphHead; parts: FlowGraphPart[] } {
  const rows = rowsOf(graph);
  const hash = hashOf(rows);
  const gen = opts.gen ?? `${graph.at}-${hash.slice(0, 8)}`;
  // Room for the part's own fields around its rows.
  const room = Math.max(1, (opts.partBytes ?? FLOW_GRAPH_PART_BYTES) - bytesOf({ id: 'p9999', gen, i: 9999, n: [], l: [], a: [], c: [] }));

  const parts: FlowGraphPart[] = [];
  let part: FlowGraphPart | null = null;
  let used = 0;
  for (const section of SECTIONS) {
    for (const row of rows[section]) {
      const size = bytesOf(row) + 1;
      if (!part || (used > 0 && used + size > room)) {
        part = { id: `p${parts.length}`, gen, i: parts.length };
        parts.push(part);
        used = 0;
      }
      ((part[section] ??= []) as unknown[]).push(row);
      used += size;
    }
  }

  const head: FlowGraphHead = {
    id: FLOW_GRAPH_HEAD_ID,
    v: FLOW_GRAPH_VERSION,
    gen,
    root: graph.root,
    at: graph.at,
    ...(graph.epoch != null ? { epoch: graph.epoch } : {}),
    complete: graph.complete,
    problems: [...graph.problems],
    parts: parts.length,
    counts: { nodes: rows.n.length, links: rows.l.length, aliases: rows.a.length, cycles: rows.c.length },
    hash,
  };
  return { head, parts };
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** The documents of the lens, in any order, back to the graph — or why not. */
export function decodeFlowGraph(items: readonly unknown[]): DecodedFlowGraph {
  const docs = (Array.isArray(items) ? items : []).filter(isObject);
  const head = docs.find((d) => d.id === FLOW_GRAPH_HEAD_ID) as unknown as FlowGraphHead | undefined;
  if (!head || typeof head.gen !== 'string') return { ok: false, reason: 'missing' };
  if (head.v !== FLOW_GRAPH_VERSION) return { ok: false, reason: 'version', head };

  const byIndex = new Map<number, FlowGraphPart>();
  for (const d of docs) {
    if (d.gen !== head.gen || typeof d.i !== 'number' || d.id !== `p${d.i}`) continue;
    byIndex.set(d.i, d as unknown as FlowGraphPart);
  }
  const rows: Rows = { n: [], l: [], a: [], c: [] };
  for (let i = 0; i < head.parts; i++) {
    const part = byIndex.get(i);
    if (!part) return { ok: false, reason: 'incomplete', head };
    for (const section of SECTIONS) {
      const list = part[section];
      if (Array.isArray(list)) (rows[section] as unknown[]).push(...list);
    }
  }
  const counts = head.counts ?? { nodes: -1, links: -1, aliases: -1, cycles: -1 };
  if (rows.n.length !== counts.nodes || rows.l.length !== counts.links || rows.a.length !== counts.aliases || rows.c.length !== counts.cycles) {
    return { ok: false, reason: 'incomplete', head };
  }
  if (hashOf(rows) !== head.hash) return { ok: false, reason: 'corrupt', head };

  try {
    const nodes: FlowGraphNode[] = rows.n.map((row) => {
      const [id, label, code, share, rest, payout, potChain, potAddress, unclaimedUntil, counts] = row as unknown[];
      const resources = capitalsFromCounts(counts as unknown[]);
      const kind = CODE_KIND[String(code)];
      if (typeof id !== 'string' || !kind) throw new Error('bad node row');
      return {
        id,
        label: String(label ?? id),
        kind,
        share: Number(share) || 0,
        rest: Number(rest) || 0,
        ...(payout ? { payout: String(payout) } : {}),
        ...(potChain && potAddress ? { pot: { chainId: Number(potChain), address: String(potAddress) } } : {}),
        ...(unclaimedUntil ? { unclaimedUntil: Number(unclaimedUntil) } : {}),
        ...(Object.keys(resources).length ? { resources } : {}),
      };
    });
    const links: FlowGraphLink[] = rows.l.map(([s, t, share, local, ring]) => {
      const source = nodes[s];
      const target = nodes[t];
      if (!source || !target) throw new Error('bad link row');
      return {
        source: source.id,
        target: target.id,
        share: Number(share) || 0,
        local: Number(local) || 0,
        via: ring === 0 ? ('interior' as const) : ('exterior' as const),
        ...(ring > 0 ? { zone: ring } : {}),
      };
    });
    const graph: FlowGraph = {
      v: 1,
      root: String(head.root ?? ''),
      at: Number(head.at) || 0,
      ...(head.epoch != null ? { epoch: Number(head.epoch) } : {}),
      complete: head.complete === true,
      problems: Array.isArray(head.problems) ? head.problems.map(String) : [],
      nodes,
      links,
      aliases: rows.a.map(([at, from, to]) => ({ at: String(at), from: String(from), to: String(to) })),
      cycles: rows.c.map((c) => c.map(String)),
    };
    return { ok: true, graph, head };
  } catch {
    return { ok: false, reason: 'corrupt', head };
  }
}
