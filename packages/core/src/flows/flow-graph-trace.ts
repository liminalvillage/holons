// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Every flow, traceable: an amount put in at one party, followed down the
 * map to another, path by path.
 *
 * €1,000 into the Pot reaches Kofi through the funds that curate his project
 * and through the project's own seat; each path is the product of the
 * percent each split on it passes on (`FlowGraphLink.local`). The paths sum
 * to what the map says reaches him — the same numbers the cut pays, read off
 * the published graph instead of a fresh walk.
 *
 * Pure: a graph index in, paths out.
 */

import type { FlowGraphIndex } from './flow-graph-index.js';

export interface TraceHop {
  id: string;
  label: string;
  /** Percent of the previous hop's income this hop receives (100 for the first). */
  local: number;
  /** What reaches this hop along this path. */
  amount: number;
}

export interface TracePath {
  hops: TraceHop[];
  /** What reaches the target along this path. */
  amount: number;
}

export interface Trace {
  from: string;
  to: string;
  /** What was put in at `from`. */
  amount: number;
  /** What reaches `to`, all paths summed. */
  reached: number;
  /** Largest first. */
  paths: TracePath[];
  /** A bound stopped the search: `reached` is a lower bound. */
  truncated: boolean;
}

export const TRACE_MAX_PATHS = 50;
export const TRACE_MAX_DEPTH = 8;

/**
 * Follow `amount` from `from` (default: the map's root) to `to`. A loop is
 * cut where it closes; a path below `minAmount` is dropped as dust.
 */
export function traceAmount(
  index: FlowGraphIndex,
  to: string,
  amount: number,
  opts: { from?: string; maxPaths?: number; maxDepth?: number; minAmount?: number } = {},
): Trace {
  const from = String(opts.from ?? index.graph.root);
  const target = String(to ?? '');
  const total = Number.isFinite(amount) && amount > 0 ? amount : 0;
  const maxPaths = Math.max(1, Math.floor(opts.maxPaths ?? TRACE_MAX_PATHS));
  const maxDepth = Math.max(1, Math.floor(opts.maxDepth ?? TRACE_MAX_DEPTH));
  const minAmount = Math.max(0, opts.minAmount ?? 0);
  const labelOf = (id: string) => index.byId.get(id)?.label ?? id;

  const paths: TracePath[] = [];
  let truncated = false;
  if (!total || !target || !index.byId.has(from) || from === target) {
    return { from, to: target, amount: total, reached: from === target ? total : 0, paths, truncated };
  }

  const onPath = new Set<string>([from]);
  const walk = (id: string, hops: TraceHop[], value: number) => {
    if (hops.length - 1 >= maxDepth) {
      truncated = true;
      return;
    }
    for (const link of index.out.get(id) ?? []) {
      if (onPath.has(link.target) || !(link.local > 0)) continue;
      const next = (value * link.local) / 100;
      if (next <= minAmount) continue;
      const hop: TraceHop = { id: link.target, label: labelOf(link.target), local: link.local, amount: next };
      if (link.target === target) {
        if (paths.length >= maxPaths) {
          truncated = true;
          continue;
        }
        paths.push({ hops: [...hops, hop], amount: next });
        continue;
      }
      onPath.add(link.target);
      walk(link.target, [...hops, hop], next);
      onPath.delete(link.target);
    }
  };
  walk(from, [{ id: from, label: labelOf(from), local: 100, amount: total }], total);

  paths.sort((a, z) => z.amount - a.amount || z.hops.length - a.hops.length);
  return { from, to: target, amount: total, reached: paths.reduce((s, p) => s + p.amount, 0), paths, truncated };
}
