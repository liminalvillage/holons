// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The flow graph, looked up from the other end.
 *
 * A split is stored on whoever pays, so "who seats this project", "whose is
 * this wallet" and "who claimed this seat" have no document to read: they are
 * answered by turning the graph round. One pass builds the lookups; everything
 * after is a map read.
 *
 * Pure.
 */

import { normalizeId } from '../identity/ids.js';
import type { FlowGraph, FlowGraphLink, FlowGraphNode } from './flow-graph.js';

export interface FlowGraphIndex {
  graph: FlowGraph;
  byId: Map<string, FlowGraphNode>;
  /** Party → what it pays. */
  out: Map<string, FlowGraphLink[]>;
  /** Party → who pays it. */
  into: Map<string, FlowGraphLink[]>;
  /** Payout address (lower case) → the parties paid there. */
  byAddress: Map<string, string[]>;
  /** A claimed seat → its claimant. */
  aliasTo: Map<string, string>;
  /** A claimant → the seats it claimed. */
  aliasFrom: Map<string, string[]>;
}

const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

export function indexFlowGraph(graph: FlowGraph): FlowGraphIndex {
  const index: FlowGraphIndex = {
    graph,
    byId: new Map(),
    out: new Map(),
    into: new Map(),
    byAddress: new Map(),
    aliasTo: new Map(),
    aliasFrom: new Map(),
  };
  for (const node of graph.nodes) {
    index.byId.set(node.id, node);
    if (node.payout) push(index.byAddress, node.payout.toLowerCase(), node.id);
  }
  for (const link of graph.links) {
    push(index.out, link.source, link);
    push(index.into, link.target, link);
  }
  for (const { from, to } of graph.aliases) {
    if (index.aliasTo.has(from)) continue;
    index.aliasTo.set(from, to);
    push(index.aliasFrom, to, from);
  }
  return index;
}

export interface Seater {
  holon: string;
  /** Percent of the seating holon's own split. */
  local: number;
  /** Share of the root pot that arrives this way. */
  share: number;
  via: 'interior' | 'exterior';
  zone?: number;
}

/** The holons whose split names `id`, largest first. */
export function seatersOf(index: FlowGraphIndex, id: string): Seater[] {
  return (index.into.get(id) ?? [])
    .map((l) => ({ holon: l.source, local: l.local, share: l.share, via: l.via, ...(l.zone != null ? { zone: l.zone } : {}) }))
    .sort((a, b) => b.share - a.share || b.local - a.local);
}

const ADDRESS = /^0x[0-9a-f]{40}$/i;

/** The parties paid at `address`, in graph order. */
export function partiesByAddress(index: FlowGraphIndex, address: string): string[] {
  return [...(index.byAddress.get(String(address ?? '').trim().toLowerCase()) ?? [])];
}

/**
 * A pasted string to a party of the graph: its id (an npub as its hex), then
 * the claimant of a seat it names, then a payout address. Null when the graph
 * knows nothing by it.
 */
export function resolveParty(
  index: FlowGraphIndex,
  raw: string,
): { id: string; via: 'id' | 'alias' | 'address'; others?: string[] } | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const id = normalizeId(text);
  if (index.byId.has(id)) return { id, via: 'id' };
  const claimant = index.aliasTo.get(id);
  if (claimant && index.byId.has(claimant)) return { id: claimant, via: 'alias' };
  if (ADDRESS.test(text)) {
    const [first, ...others] = partiesByAddress(index, text);
    if (first) return { id: first, via: 'address', ...(others.length ? { others } : {}) };
  }
  return null;
}
