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
  adoptFlowParty,
  indexFlowGraph,
  loadAllocationInputs,
  loadCascadeChildren,
  loadPotGraph,
  refineFlowGraph,
  refineFlowGraphResources,
  resourcesOf,
  scoreAllocationMembers,
  standingOf,
  type FlowGraph,
  type FlowGraphDrift,
  type Capital,
  type FlowGraphIndex,
} from "@holons/core/flows";
import {
  rememberPot,
  resolveArtizenView,
  resolveAppName,
  resolveDevGraphUrl,
  resolvePot,
} from "./config";
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
  /** Nobody has published a snapshot for the Pot: this is the walk, read live. */
  live?: boolean;
}

const CACHE_KEY = "flows_graph_cache";
/** Past this the cache is skipped rather than risk the storage quota. */
const CACHE_MAX_CHARS = 1_500_000;

/** The Pot on screen. A live binding: `choosePot` moves the whole app to another. */
export let potId = resolvePot();

export const snapshot = writable<SnapshotState>({
  status: potId || resolveDevGraphUrl() ? "loading" : "unconfigured",
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

/** The Artizen map is on screen instead of this device's own pot (`toggleArtizen`). */
export const showingArtizen = writable(false);
/** The pot to come back to from the Artizen map. */
let ownPot = potId;

/** The map file to draw instead of reading the relays, if any. */
function graphUrl(): string {
  const view = get(showingArtizen) ? resolveArtizenView() : null;
  return view?.kind === "fixture" ? view.url : resolveDevGraphUrl();
}

/**
 * Show the whole Artizen map, or go back to this device's own pot. Nothing
 * is remembered: a reload opens on one's own pot again.
 */
export function toggleArtizen(): Promise<void> {
  const view = resolveArtizenView();
  if (!view) return Promise.resolve();
  const on = !get(showingArtizen);
  if (on) ownPot = potId;
  showingArtizen.set(on);
  if (view.kind === "pot") potId = on ? view.id : ownPot;
  refined.set({});
  snapshot.set({
    status: potId || graphUrl() ? "loading" : "unconfigured",
    graph: null,
    cached: false,
  });
  loading = null;
  return loadSnapshot(true);
}

/** Load (or reload) the Pot's snapshot. Safe to call from every screen. */
export function loadSnapshot(force = false): Promise<void> {
  if (!potId && !graphUrl()) return Promise.resolve();
  if (loading && !force) return loading;
  loading = (async () => {
    const pot = potId;
    const before = get(snapshot);
    if (!before.graph && !get(showingArtizen)) {
      const cached = readCache();
      if (cached)
        snapshot.set({
          status: "loading",
          graph: withLiveResources(cached),
          cached: true,
        });
    }

    const devUrl = graphUrl();
    if (devUrl) {
      try {
        const graph = (await (await fetch(devUrl)).json()) as FlowGraph;
        snapshot.set({
          status: "ready",
          graph: withAdopted(graph),
          cached: false,
        });
      } catch {
        snapshot.update((s) => ({ ...s, status: "offline" }));
      }
      return;
    }

    try {
      const hs = await getHolosphere();
      const loaded = await loadPotGraph(hs, potId, {
        scoreOf: (id: string) => scoreAllocationMembers(hs, id),
        standingOf: standingOf(hs),
        resourcesOf: resourcesOf(hs),
      });
      // Moved to another Pot while this one was read: that read decides.
      if (pot !== potId) return;
      if (loaded.ok) {
        writeCache(loaded.graph);
        refined.set({});
        snapshot.set({
          status: "ready",
          graph: withLiveResources(withAdopted(loaded.graph)),
          cached: false,
          live: loaded.live === true,
        });
      } else {
        // Whatever was on screen stays; the status says why it is not fresher.
        snapshot.update((s) => ({ ...s, status: loaded.reason }));
      }
    } catch {
      if (pot === potId) snapshot.update((s) => ({ ...s, status: "offline" }));
    }
  })();
  return loading;
}

/**
 * Open the app on another Pot — one this device just started, or one a link
 * pointed at — and remember it. The session and everything signed stay; only
 * the map is read again.
 */
export function choosePot(holon: string): Promise<void> {
  const id = String(holon ?? "").trim();
  if (!id || id === potId) return loadSnapshot(true);
  rememberPot(id);
  showingArtizen.set(false);
  potId = id;
  refined.set({});
  snapshot.set({ status: "loading", graph: null, cached: false });
  loading = null;
  return loadSnapshot(true);
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
 * Holons drawn this visit that the snapshot does not reach — one just
 * started here, or opened by its link before anyone seated it — so a
 * snapshot that lands later keeps them.
 */
const adopted = new Map<string, { label?: string; description?: string }>();

function withAdopted(graph: FlowGraph): FlowGraph {
  let out = graph;
  for (const [id, meta] of adopted) out = adoptFlowParty(out, { id, ...meta });
  return out;
}

/**
 * Make sure the map knows `holonId`: a holon the snapshot does not reach is
 * read off its own settings and drawn on its own, then its split folded in.
 * Resolves false when there is no such holon to read.
 */
export async function adopt(holonId: string): Promise<boolean> {
  const id = String(holonId ?? "").trim();
  if (!id) return false;
  if (get(index)?.byId.has(id)) return true;
  try {
    const hs = await getHolosphere();
    const read = await loadAllocationInputs(hs, id);
    const settings = read.settings as Record<string, unknown> | null;
    if (!settings || (!read.configured && !settings.holonPubkey)) return false;
    adopted.set(id, {
      ...(read.name ? { label: read.name } : {}),
      ...(read.description ? { description: read.description } : {}),
    });
    snapshot.update((s) =>
      s.graph ? { ...s, graph: withAdopted(s.graph) } : s,
    );
    await refine(id, true);
    return !!get(index)?.byId.has(id);
  } catch {
    return false;
  }
}

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
    // The dev fixture is the whole truth, except for holons drawn on top of it.
    (graphUrl() && !adopted.has(holon))
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

/** Party → its resource base as last read off its own log this visit. */
const liveResources = new Map<string, Partial<Record<Capital, number>>>();

/** A snapshot with every resource base read this visit folded in. */
function withLiveResources(graph: FlowGraph): FlowGraph {
  let out = graph;
  for (const [id, byCapital] of liveResources)
    out = refineFlowGraphResources(out, id, byCapital);
  return out;
}

/**
 * Fold one party's resource base, as just read from its log, into the graph
 * on screen — the snapshot counts gifts as they were when it was published —
 * and keep it, so a snapshot that lands later does not undo it. Not over the
 * dev fixture, which is the whole truth in that mode.
 */
export function refineResources(
  partyId: string,
  byCapital: Partial<Record<Capital, number>>,
): void {
  if (graphUrl()) return;
  liveResources.set(partyId, byCapital);
  snapshot.update((s) =>
    s.graph
      ? { ...s, graph: refineFlowGraphResources(s.graph, partyId, byCapital) }
      : s,
  );
}

/**
 * A map read live is only as fresh as its last walk: read it again when the
 * person comes back to the tab — someone may have been seated meanwhile.
 */
const LIVE_AGAIN_MS = 15_000;
let walkedAt = 0;
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!get(snapshot).live || Date.now() - walkedAt < LIVE_AGAIN_MS) return;
    walkedAt = Date.now();
    void loadSnapshot(true);
  });
}
