// Dependency-graph helpers for tasks/quests. Pure and UI-agnostic.
//
// A task's `dependencies` array lists the ids of its predecessors (the tasks
// that must come first). For the graph to read as a sequence — and to render
// cleanly top→bottom on the canvas — it must stay a DAG (no cycles). These
// helpers let callers reject an edge before it closes a loop, and audit an
// existing set for any cycle.

import type { Quest } from './types.js';

/**
 * Build an `id → predecessor-ids` map from a list of quests, dropping
 * self-references and ids that aren't present in the set.
 */
function dependencyMap(quests: Quest[]): Map<string, string[]> {
  const ids = new Set(quests.map((q) => String(q.id)));
  const map = new Map<string, string[]>();
  for (const q of quests) {
    const id = String(q.id);
    const deps = ((q.dependencies as string[] | undefined) ?? [])
      .map(String)
      .filter((d) => d !== id && ids.has(d));
    map.set(id, deps);
  }
  return map;
}

/**
 * Is this quest settled — completed, cancelled, or deleted — so it neither
 * blocks its successors nor is actionable itself? Stopped (vetoed) quests are
 * NOT settled: the work never happened, so successors keep waiting.
 */
export function isQuestSettled(quest: Quest): boolean {
  const s = String(quest.status ?? '').toLowerCase();
  return (
    s === 'completed' ||
    s === 'cancelled' ||
    quest.completed === true ||
    quest._deleted === true
  );
}

/**
 * For every open quest, the ids of its predecessors that are still open — the
 * dependencies actually standing in its way. An empty array means the quest is
 * actionable *now*: self-standing, or every predecessor already settled.
 * Settled quests are omitted entirely, and dangling/self references never
 * block (`dependencyMap` drops them). Only direct predecessors are consulted:
 * a chain blocks each link on the one before it, not transitively.
 */
export function unmetDependencies(quests: Quest[]): Map<string, string[]> {
  const settled = new Set(
    quests.filter(isQuestSettled).map((q) => String(q.id)),
  );
  const map = dependencyMap(quests);
  const out = new Map<string, string[]>();
  for (const [id, deps] of map) {
    if (settled.has(id)) continue;
    out.set(
      id,
      deps.filter((d) => !settled.has(d)),
    );
  }
  return out;
}

/**
 * Would making `fromId` depend on `newDepId` introduce a cycle? True when they
 * are the same task, or when `newDepId` already (transitively) depends on
 * `fromId` — in which case adding the edge would close a loop.
 */
export function wouldCreateDependencyCycle(
  quests: Quest[],
  fromId: string,
  newDepId: string,
): boolean {
  if (fromId === newDepId) return true;
  const map = dependencyMap(quests);
  // Walk newDepId's predecessors; reaching fromId means the edge closes a loop.
  const stack = [newDepId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === fromId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const p of map.get(cur) ?? []) stack.push(p);
  }
  return false;
}

/**
 * Find the first dependency cycle in a set of quests, returned as the ordered
 * ids that form the loop, or `null` if the graph is acyclic.
 */
export function findDependencyCycle(quests: Quest[]): string[] | null {
  const map = dependencyMap(quests);
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of map.keys()) color.set(id, WHITE);
  const path: string[] = [];

  const visit = (id: string): string[] | null => {
    color.set(id, GRAY);
    path.push(id);
    for (const p of map.get(id) ?? []) {
      if (color.get(p) === GRAY) {
        // Back-edge: slice the loop out of the current path.
        return path.slice(path.indexOf(p));
      }
      if (color.get(p) === WHITE) {
        const found = visit(p);
        if (found) return found;
      }
    }
    color.set(id, BLACK);
    path.pop();
    return null;
  };

  for (const id of map.keys()) {
    if (color.get(id) === WHITE) {
      const found = visit(id);
      if (found) return found;
    }
  }
  return null;
}
