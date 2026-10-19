// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The flow graph — a whole cascade as one node per party.
 *
 * `resolveCascade` answers where a pot ends up as a TREE: a project two funds
 * curate, seated in the Pot besides, appears three times, once per path. That
 * is what a cut needs and what one holon's diagram draws. A map of everyone
 * needs the other shape: each party once, each "A pays B" once, and how much
 * of the root pot travels it.
 *
 * This folds the tree into that graph and adds nothing of its own: a node's
 * `share` is the sum of its occurrences, a link's `share` the sum of the tree
 * edges it stands for. So the map says exactly what the cut pays — same
 * function, same `kept` / `retained` / `cycle` / `depth` / `budget` rules.
 *
 * Nothing on a holon says "fund" or "project"; `classifyParty` reads it off
 * the shape of the split and the root's own word about which seats stand
 * without a claim.
 *
 * Pure: a cascade in, a graph out.
 */

import { idKind } from '../identity/ids.js';
import type { Aliases, ClaimWindow } from './buckets.js';
import { resolveCascade, type CascadeInputs, type CascadeNode, type CascadeResult } from './cascade.js';
import { capitalsFromCounts, capitalCounts, type Capital } from './resources.js';

export type FlowPartyKind = 'pot' | 'fund' | 'project' | 'person' | 'placeholder';

export interface FlowGraphNode {
  id: string;
  label: string;
  kind: FlowPartyKind;
  /** Share of the root pot that reaches this party, 0..100, all paths summed. */
  share: number;
  /** Share of the root pot that rests here — what it holds after passing on. */
  rest: number;
  /** Where it is paid, lower-cased. */
  payout?: string;
  /** Its own Pot, when it has one. */
  pot?: { chainId: number; address: string };
  /** A hand-set seat nobody has claimed: claims close at this instant (ms). */
  unclaimedUntil?: number;
  /** Received resource gifts per capital (`resources.ts`), when it has any. */
  resources?: Partial<Record<Capital, number>>;
}

export interface FlowGraphLink {
  source: string;
  target: string;
  /** Share of the ROOT pot travelling this edge. 0 for a holon the root does not reach. */
  share: number;
  /** Percent of the SOURCE's own split this edge is. */
  local: number;
  via: 'interior' | 'exterior';
  /** Exterior only: the ring. */
  zone?: number;
}

export interface FlowGraph {
  v: 1;
  root: string;
  /** When the graph was read (ms). */
  at: number;
  /** The lunation it was read in, when the caller knows. */
  epoch?: number;
  /** False when a bound cut the walk: shares are lower bounds. */
  complete: boolean;
  problems: string[];
  nodes: FlowGraphNode[];
  links: FlowGraphLink[];
  /** One hop each: at holon `at`, the seat `from` was claimed by `to`. */
  aliases: Array<{ at: string; from: string; to: string }>;
  cycles: string[][];
}

/** What a walk learned about a party it read, beyond its split. */
export interface FlowPartyMeta {
  name?: string;
  payout?: string | null;
  pot?: { chainId: number; address: string } | null;
  aliases?: Aliases | null;
  claimWindow?: ClaimWindow | null;
  /** The hand-set seats of its split, as stored (before any alias). */
  seats?: string[];
  /** Received resource gifts per capital. */
  resources?: Partial<Record<Capital, number>> | null;
}

/** A seat the importer could not key: `artisan:<id>`, not a person or a holon yet. */
export function isPlaceholderParty(id: string): boolean {
  const s = String(id ?? '').trim();
  return /^[a-z][a-z0-9_-]*:/i.test(s) && !/^nostr:/i.test(s);
}

/**
 * What a party is, read off what it does:
 *
 *   pot         — the root
 *   placeholder — a seat nobody has claimed yet
 *   person      — a Telegram id, or a key that passes nothing on
 *   fund        — a seat the root keeps without a claim, or a holon that only
 *                 curates: partners on its rings, no contributors of its own
 *   project     — everything else
 */
export function classifyParty(input: {
  id: string;
  rootId: string;
  /** The root's `claimWindow.keep`: the seats that stand without a claim. */
  keep: ReadonlySet<string>;
  /** The party's own out-links. */
  out: readonly FlowGraphLink[];
}): FlowPartyKind {
  const { id, rootId, keep, out } = input;
  if (id === rootId) return 'pot';
  if (isPlaceholderParty(id)) return 'placeholder';
  const shape = idKind(id);
  if (shape === 'person') return 'person';
  if (shape === 'key' && out.length === 0) return 'person';
  if (keep.has(id)) return 'fund';
  const curates = out.some((l) => l.via === 'exterior' && l.local > 0 && idKind(l.target) !== 'person');
  const contributors = out.some((l) => l.via === 'interior' && l.local > 0);
  if (curates && !contributors) return 'fund';
  return 'project';
}

const linkKey = (source: string, target: string) => `${source}\u0000${target}`;

export function buildFlowGraph(input: {
  /** The cascade from the root, percentage-only or not: amounts are not read. */
  cascade: CascadeResult;
  meta?: Record<string, FlowPartyMeta>;
  /** Holons the cascade does not reach but that belong on the map, with their splits. */
  extra?: Record<string, CascadeInputs>;
  at: number;
  epoch?: number;
  /** False when the caller's own walk was cut short. */
  complete?: boolean;
  problems?: string[];
}): FlowGraph {
  const { cascade } = input;
  const meta = input.meta ?? {};
  const rootId = cascade.root.id;

  const shares = new Map<string, { label: string; share: number }>();
  const links = new Map<string, FlowGraphLink>();
  let bounded = cascade.truncated;

  const seat = (id: string, label: string, share: number) => {
    const seen = shares.get(id);
    if (!seen) shares.set(id, { label, share });
    else {
      seen.share += share;
      // A divided occurrence carries the holon's own name; a leaf may only carry the id.
      if (seen.label === id && label !== id) seen.label = label;
    }
  };

  const edge = (parent: CascadeNode, child: CascadeNode, share: number, local: number) => {
    const key = linkKey(parent.id, child.id);
    const seen = links.get(key);
    if (seen) {
      seen.share += share;
      return;
    }
    links.set(key, {
      source: parent.id,
      target: child.id,
      share,
      local,
      via: child.via === 'exterior' ? 'exterior' : 'interior',
      ...(child.zone != null ? { zone: child.zone } : {}),
    });
  };

  const walk = (node: CascadeNode) => {
    for (const child of node.children) {
      if (child.reason === 'depth' || child.reason === 'budget') bounded = true;
      // What a holon keeps or names nobody for is not a payment: it is in `rest`.
      if (child.id === node.id) continue;
      seat(child.id, child.label, child.percentage);
      edge(node, child, child.percentage, node.percentage > 0 ? (child.percentage / node.percentage) * 100 : 0);
      walk(child);
    }
  };
  seat(rootId, cascade.root.label, cascade.root.percentage);
  walk(cascade.root);

  // A holon the root does not reach is drawn by its own split alone.
  for (const [id, inputs] of Object.entries(input.extra ?? {})) {
    if (shares.has(id)) continue;
    const own = resolveCascade({ holonId: id, total: null, root: inputs, resolveChild: () => null, maxDepth: 0 });
    seat(id, inputs.name || id, 0);
    for (const child of own.root.children) {
      if (child.id === id) continue;
      seat(child.id, child.label, 0);
      edge(own.root, child, 0, child.percentage);
    }
  }

  const out = new Map<string, FlowGraphLink[]>();
  for (const link of links.values()) {
    const list = out.get(link.source);
    if (list) list.push(link);
    else out.set(link.source, [link]);
  }

  const rootMeta = meta[rootId];
  const keep = new Set<string>();
  for (const id of rootMeta?.claimWindow?.keep ?? []) keep.add(rootMeta?.aliases?.[id] ?? id);

  // A hand-set seat of a windowed holon that no alias points at a claimant.
  const unclaimed = new Map<string, number>();
  for (const m of Object.values(meta)) {
    const window = m.claimWindow;
    if (!window || !(window.until > 0)) continue;
    const kept = new Set(window.keep ?? []);
    for (const id of m.seats ?? []) {
      if (kept.has(id) || m.aliases?.[id]) continue;
      const seen = unclaimed.get(id);
      unclaimed.set(id, seen == null ? window.until : Math.min(seen, window.until));
    }
  }

  const aliases: FlowGraph['aliases'] = [];
  for (const [at, m] of Object.entries(meta)) {
    for (const [from, to] of Object.entries(m.aliases ?? {})) {
      if (from && to && from !== to) aliases.push({ at, from, to });
    }
  }

  const nodes: FlowGraphNode[] = [...shares.entries()].map(([id, seen]) => {
    const m = meta[id];
    const payout = typeof m?.payout === 'string' && m.payout ? m.payout.toLowerCase() : undefined;
    const until = unclaimed.get(id);
    const resources = capitalsFromCounts(capitalCounts(m?.resources));
    return {
      id,
      label: m?.name || seen.label || id,
      kind: classifyParty({ id, rootId, keep, out: out.get(id) ?? [] }),
      share: seen.share,
      rest: cascade.leaves[id]?.percentage ?? 0,
      ...(payout ? { payout } : {}),
      ...(m?.pot ? { pot: { chainId: m.pot.chainId, address: m.pot.address } } : {}),
      ...(until != null ? { unclaimedUntil: until } : {}),
      ...(Object.keys(resources).length ? { resources } : {}),
    };
  });

  return {
    v: 1,
    root: rootId,
    at: input.at,
    ...(input.epoch != null ? { epoch: input.epoch } : {}),
    complete: (input.complete ?? true) && !bounded,
    problems: [...(input.problems ?? [])],
    nodes,
    links: [...links.values()],
    aliases,
    cycles: cascade.cycles.map((c) => [...c]),
  };
}
