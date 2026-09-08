// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The transportation problem, Monge–Kantorovich in its discrete form:
 *
 *   minimise  Σ c(i,j) · x(i,j)
 *   subject to Σ_j x(i,j) ≤ supply(i),  Σ_i x(i,j) ≤ demand(j),  x ≥ 0,
 *   moving as much as either side allows.
 *
 * Solved exactly by successive shortest augmenting paths over the residual
 * graph. The graphs here are a handful of holons a side, so a Bellman–Ford
 * per augmentation is plenty and keeps the code readable.
 *
 * The cost is a function, not a matrix, so the same solver serves stock
 * moving between holons (cost = federation distance) and money moving
 * between people (cost = whatever the settle-up plan prefers).
 */
import { round } from './fold.js';
import type { StockPosition, StockTransfer } from './types.js';

export interface TransportSource {
  id: string;
  /** Units this source can give. */
  supply: number;
}

export interface TransportSink {
  id: string;
  /** Units this sink needs. */
  demand: number;
}

export interface TransportLeg {
  from: string;
  to: string;
  quantity: number;
  cost: number;
}

/** Cost of moving one unit from `from` to `to`. `Infinity` forbids the leg. */
export type TransportCost = (from: string, to: string) => number;

/** Every leg costs the same, so the plan cares about feasibility only. */
export const FLAT_COST: TransportCost = () => 1;

const EPS = 1e-9;

interface Edge {
  to: number;
  rev: number;
  cap: number;
  cost: number;
}

/**
 * Cheapest set of legs that moves `min(Σsupply, Σdemand)` units. Legs come
 * back largest first; sources and sinks with nothing to give or take, and
 * legs the cost function forbids, never appear.
 */
export function transportPlan(
  sources: TransportSource[],
  sinks: TransportSink[],
  cost: TransportCost = FLAT_COST,
): TransportLeg[] {
  const srcs = (sources ?? []).filter((s) => s.supply > EPS);
  const snks = (sinks ?? []).filter((s) => s.demand > EPS);
  if (srcs.length === 0 || snks.length === 0) return [];

  const m = srcs.length;
  const n = snks.length;
  const S = 0;
  const T = m + n + 1;
  const graph: Edge[][] = Array.from({ length: T + 1 }, () => []);
  const addEdge = (u: number, v: number, cap: number, c: number) => {
    graph[u].push({ to: v, rev: graph[v].length, cap, cost: c });
    graph[v].push({ to: u, rev: graph[u].length - 1, cap: 0, cost: -c });
  };
  srcs.forEach((s, i) => addEdge(S, 1 + i, s.supply, 0));
  snks.forEach((s, j) => addEdge(1 + m + j, T, s.demand, 0));
  srcs.forEach((s, i) => {
    snks.forEach((t, j) => {
      const c = cost(s.id, t.id);
      if (Number.isFinite(c) && c >= 0) addEdge(1 + i, 1 + m + j, Infinity, c);
    });
  });

  const flow = new Map<string, number>();
  for (;;) {
    // Bellman–Ford from S over the residual graph.
    const dist = new Array<number>(T + 1).fill(Infinity);
    const prevNode = new Array<number>(T + 1).fill(-1);
    const prevEdge = new Array<number>(T + 1).fill(-1);
    dist[S] = 0;
    let relaxed = true;
    for (let pass = 0; pass <= T && relaxed; pass++) {
      relaxed = false;
      for (let u = 0; u <= T; u++) {
        if (dist[u] === Infinity) continue;
        graph[u].forEach((e, k) => {
          if (e.cap > EPS && dist[u] + e.cost < dist[e.to] - EPS) {
            dist[e.to] = dist[u] + e.cost;
            prevNode[e.to] = u;
            prevEdge[e.to] = k;
            relaxed = true;
          }
        });
      }
    }
    if (dist[T] === Infinity) break;

    let bottleneck = Infinity;
    for (let v = T; v !== S; v = prevNode[v]) {
      bottleneck = Math.min(bottleneck, graph[prevNode[v]][prevEdge[v]].cap);
    }
    for (let v = T; v !== S; v = prevNode[v]) {
      const u = prevNode[v];
      const e = graph[u][prevEdge[v]];
      e.cap -= bottleneck;
      graph[v][e.rev].cap += bottleneck;
      if (u >= 1 && u <= m && v > m && v < T) {
        const key = `${u - 1}:${v - 1 - m}`;
        flow.set(key, (flow.get(key) ?? 0) + bottleneck);
      } else if (v >= 1 && v <= m && u > m && u < T) {
        // Pushing back along a used leg: undo that much of it.
        const key = `${v - 1}:${u - 1 - m}`;
        flow.set(key, (flow.get(key) ?? 0) - bottleneck);
      }
    }
  }

  const legs: TransportLeg[] = [];
  for (const [key, quantity] of flow) {
    if (quantity <= EPS) continue;
    const [i, j] = key.split(':').map(Number);
    legs.push({
      from: srcs[i].id,
      to: snks[j].id,
      quantity: round(quantity),
      cost: cost(srcs[i].id, snks[j].id),
    });
  }
  return legs.sort((a, b) => b.quantity - a.quantity || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

/** Who is federated with whom, either direction. */
export type PartnerGraph = Record<string, ReadonlyArray<string> | undefined>;

/**
 * Cost by federation distance: a direct partner costs 1, a partner's partner
 * 2, and so on; holons with no chain of partnerships between them cannot
 * trade (`Infinity`). Decided 2026-09-08: the nearest partnership is the
 * cheapest leg, and for now that is the only thing the cost looks at.
 */
export function federationCost(partners: PartnerGraph): TransportCost {
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a)!.add(b);
  };
  for (const [holon, list] of Object.entries(partners ?? {})) {
    for (const partner of list ?? []) {
      link(holon, partner);
      link(partner, holon);
    }
  }
  const memo = new Map<string, Map<string, number>>();
  const distancesFrom = (start: string): Map<string, number> => {
    const cached = memo.get(start);
    if (cached) return cached;
    const dist = new Map<string, number>([[start, 0]]);
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const u = queue[head];
      for (const v of adjacency.get(u) ?? []) {
        if (dist.has(v)) continue;
        dist.set(v, dist.get(u)! + 1);
        queue.push(v);
      }
    }
    memo.set(start, dist);
    return dist;
  };
  return (from, to) => (from === to ? 0 : (distancesFrom(from).get(to) ?? Infinity));
}

/**
 * Transfers that clear as much deficit as the surpluses allow, category by
 * category, at the least total cost. Positions come from `positions()` for
 * each holon in a federation.
 */
export function rebalancePlan(positions: StockPosition[], cost: TransportCost): StockTransfer[] {
  const byCategory = new Map<string, StockPosition[]>();
  for (const p of positions ?? []) {
    if (!byCategory.has(p.category)) byCategory.set(p.category, []);
    byCategory.get(p.category)!.push(p);
  }
  const out: StockTransfer[] = [];
  for (const [category, group] of byCategory) {
    const sources = group.filter((p) => p.surplus > 0).map((p) => ({ id: p.holonId, supply: p.surplus }));
    const sinks = group.filter((p) => p.deficit > 0).map((p) => ({ id: p.holonId, demand: p.deficit }));
    for (const leg of transportPlan(sources, sinks, cost)) out.push({ category, ...leg });
  }
  return out.sort((a, b) => a.category.localeCompare(b.category) || b.quantity - a.quantity);
}
