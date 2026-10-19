// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The map every screen draws from: the Pot's published flow graph, loaded
// once, kept in a store, and remembered on the device.
//
// The last whole snapshot is cached so the app paints before the relays
// answer, works offline, and never goes blank because a publish was half-way
// when it looked (`decodeFlowGraph` refuses a torn generation; the cached one
// stays). `refine` then swaps one holon's split for what it says right now.
// All the meaning — what a snapshot is, how it is indexed and drawn — is
// `@holons/core/flows`; this is only the store around it.

import { shortId } from "@holons/core/identity";
import { derived, get, writable, type Readable } from "svelte/store";
import {
  indexFlowGraph,
  loadAllocationInputs,
  loadCascadeChildren,
  loadFlowGraph,
  refineFlowGraph,
  resourcesOf,
  scoreAllocationMembers,
  standingOf,
  type FlowGraph,
  type FlowGraphDrift,
  type FlowGraphIndex,
} from "@holons/core/flows";
import { resolveAppName, resolveDevGraphUrl, resolvePot } from "./config";
import { getHolosphere } from "./holosphere";

export type SnapshotStatus =
  | "loading"
  | "ready"
  /** No Pot is configured for this deployment. */
  | "unconfigured"
  /** Nothing has been published for the Pot yet. */
  | "missing"
  /** A publish is half-way, or a part did not arrive. */
  | "incomplete"
  /** Published by a newer app than this one. */
  | "version"
  | "corrupt"
  /** The relays could not be reached. */
  | "offline";

export interface SnapshotState {
  status: SnapshotStatus;
  /** The graph on screen: the snapshot, with any holon refined since. */
  graph: FlowGraph | null;
  /** The graph came from this device's cache, not from the relays this visit. */
  cached: boolean;
}

const CACHE_KEY = "flows_graph_cache";
/** Past this the cache is skipped rather than risk the storage quota. */
const CACHE_MAX_CHARS = 1_500_000;

export const potId = resolvePot();

export const snapshot = writable<SnapshotState>({
  status: potId ? "loading" : "unconfigured",
  graph: null,
  cached: false,
});

/**
 * The map as shown: a party the map knows only by its id — a person seated
 * under a bare key — is named by the id made short, once, here, so every
 * list and every diagram reads the same.
 */
function named(graph: FlowGraph): FlowGraph {
  if (!graph.nodes.some((n) => n.label === n.id && shortId(n.id) !== n.id))
    return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.label === n.id ? { ...n, label: shortId(n.id) || n.id } : n,
    ),
  };
}

export const index: Readable<FlowGraphIndex | null> = derived(snapshot, (s) =>
  s.graph ? indexFlowGraph(named(s.graph)) : null,
);

/** Holon → how far the snapshot was from its split when last refined. */
export const refined = writable<
  Record<string, { at: number; drift: FlowGraphDrift[] }>
>({});

function readCache(): FlowGraph | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const doc = JSON.parse(raw);
    if (doc?.pot !== potId || doc?.app !== resolveAppName()) return null;
    return doc.graph?.v === 1 ? (doc.graph as FlowGraph) : null;
  } catch {
    return null;
  }
}

function writeCache(graph: FlowGraph): void {
  try {
    const raw = JSON.stringify({ pot: potId, app: resolveAppName(), graph });
    if (raw.length <= CACHE_MAX_CHARS) localStorage.setItem(CACHE_KEY, raw);
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    /* private mode or a full quota — the cache is a convenience */
  }
}

let loading: Promise<void> | null = null;

/** Load (or reload) the Pot's snapshot. Safe to call from every screen. */
export function loadSnapshot(force = false): Promise<void> {
  if (!potId) return Promise.resolve();
  if (loading && !force) return loading;
  loading = (async () => {
    const before = get(snapshot);
    if (!before.graph) {
      const cached = readCache();
      if (cached)
        snapshot.set({ status: "loading", graph: cached, cached: true });
    }

    const devUrl = resolveDevGraphUrl();
    if (devUrl) {
      try {
        const graph = (await (await fetch(devUrl)).json()) as FlowGraph;
        snapshot.set({ status: "ready", graph, cached: false });
      } catch {
        snapshot.update((s) => ({ ...s, status: "offline" }));
      }
      return;
    }

    try {
      const hs = await getHolosphere();
      const loaded = await loadFlowGraph(hs, potId);
      if (loaded.ok) {
        writeCache(loaded.graph);
        refined.set({});
        snapshot.set({ status: "ready", graph: loaded.graph, cached: false });
      } else {
        // Whatever was on screen stays; the status says why it is not fresher.
        snapshot.update((s) => ({ ...s, status: loaded.reason }));
      }
    } catch {
      snapshot.update((s) => ({ ...s, status: "offline" }));
    }
  })();
  return loading;
}

/** Party → display name, from the graph on screen. */
export function labelOf(id: string): string {
  return nameFor(id, get(index)?.byId.get(id)?.label);
}

/** A party's name as shown: its label, or — when all the map has is the id — the id made short. */
export function nameFor(id: string, label?: string | null): string {
  return label && label !== id ? label : shortId(id) || id;
}

const refining = new Set<string>();

/**
 * Read one holon's split afresh and fold it into the graph on screen. Quiet:
 * a holon that cannot be read just keeps what the snapshot said. Once per
 * visit, unless `force` — after the split was just changed from here.
 */
export async function refine(holonId: string, force = false): Promise<void> {
  const holon = String(holonId ?? "");
  if (
    !holon ||
    refining.has(holon) ||
    (!force && get(refined)[holon]) ||
    resolveDevGraphUrl()
  )
    return;
  if (!get(index)?.byId.has(holon)) return;
  refining.add(holon);
  try {
    const hs = await getHolosphere();
    const read = {
      scoreOf: (id: string) => scoreAllocationMembers(hs, id),
      standingOf: standingOf(hs),
      resourcesOf: resourcesOf(hs),
    };
    const inputs = await loadAllocationInputs(hs, holon, read);
    if (!inputs.configured) return;
    const rootPartyIds = [
      ...new Set([
        ...inputs.members.map((m) => m.id),
        ...inputs.zoned.filter((p) => p.zone >= 1).map((p) => p.id),
      ]),
    ];
    const loaded = await loadCascadeChildren(hs, rootPartyIds, {
      ...read,
      rootId: holon,
      maxDepth: 1,
      maxHolons: 50,
    });
    const current = get(snapshot).graph;
    if (!current) return;
    const out = refineFlowGraph(current, {
      holonId: holon,
      root: {
        config: inputs.config,
        members: inputs.members,
        zoned: inputs.zoned,
        ...(inputs.name ? { name: inputs.name } : {}),
      },
      children: loaded.children,
    });
    snapshot.update((s) => ({ ...s, graph: out.graph }));
    refined.update((r) => ({
      ...r,
      [holon]: { at: Date.now(), drift: out.drift },
    }));
  } catch {
    /* the snapshot stands */
  } finally {
    refining.delete(holon);
  }
}
