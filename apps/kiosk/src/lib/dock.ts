// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The board as a window. Closing it shrinks the whole tab interface into a
// circle — the dock: one circle per holon this device has opened, each
// reopenable, removable, plus a "+" that adds a board by id/label/pasted
// link. The list is per-device (localStorage), like the caretaker's pinned
// holon. This module owns the state and the pure list operations; the morph
// animation between window and dock lives in the layout, which watches
// `dockState` for the two transitional frames.

import { get, writable } from "svelte/store";
import { colorHash } from "@holons/core/settings";
import { SUBDOMAIN_HOLONS } from "./holons";

export type DockEntry = {
  /** Holon id — a "-100…" group id or a personal numeric id. */
  id: string;
  /** Display name: the holon's own name once seen, else its label or id. */
  name: string;
  /** When this board was last opened (ms epoch). Order stays stable anyway. */
  at: number;
};

/**
 * Window ↔ dock lifecycle. "closing" and "opening" are the morph frames where
 * BOTH the window and the dock are mounted so the layout can animate one into
 * the other; the layout settles them to "dock" / "window" when the morph ends.
 */
export type DockState = "window" | "closing" | "dock" | "opening";

const DOCK_KEY = "kiosk_dock";

// ── Pure list operations (exported for tests) ────────────────────────────--

function isEntry(e: unknown): e is DockEntry {
  const c = e as DockEntry;
  return (
    !!c &&
    typeof c === "object" &&
    typeof c.id === "string" &&
    c.id.trim() !== "" &&
    typeof c.name === "string" &&
    typeof c.at === "number"
  );
}

/** Parse a persisted dock list, dropping anything malformed. */
export function parseDock(raw: string | null): DockEntry[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter(isEntry) : [];
  } catch {
    return [];
  }
}

/**
 * Add or refresh a board in the list. Positions are STABLE — a circle never
 * jumps around the dock — so an existing entry is updated in place and a new
 * one appended. An empty `name` never clobbers a name already learned.
 */
export function upsertEntry(
  list: DockEntry[],
  id: string,
  name: string,
  at = Date.now(),
): DockEntry[] {
  const clean = name.trim();
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) return [...list, { id, name: clean || labelFor(id), at }];
  const cur = list[i];
  const next = { ...cur, name: clean || cur.name, at };
  if (next.name === cur.name && next.at === cur.at) return list;
  return [...list.slice(0, i), next, ...list.slice(i + 1)];
}

/** Remove a board from the list (a no-op when it isn't there). */
export function removeEntry(list: DockEntry[], id: string): DockEntry[] {
  return list.some((e) => e.id === id) ? list.filter((e) => e.id !== id) : list;
}

/**
 * A human label for a holon id before its real name is known: the registered
 * subdomain label, capitalised ("liminal" → "Liminal"), else the raw id.
 */
export function labelFor(id: string): string {
  const label = segmentFor(id);
  if (label === id) return id;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * The URL path segment that names this holon — a registered label when one
 * exists (`/liminal`), else the id itself (`/-100…`), matching holonForPath.
 */
export function segmentFor(id: string): string {
  for (const [label, holon] of Object.entries(SUBDOMAIN_HOLONS))
    if (holon === id) return label;
  return id;
}

/**
 * A stable angle (0–359) for a holon from the card hash every surface shares.
 * The orbs are PAINTED with `holonColor` (lib/palette), which also honours a
 * caretaker override; this bare number only seeds each orb's drift phase.
 */
export function hueFor(id: string): number {
  return colorHash(id) % 360;
}

// ── Gravity system (pure, exported for tests) ────────────────────────────--
//
// The dock's circles float in a little gravity field: every orb repels every
// other, a federation link pulls its two orbs together like a spring, and a
// weak central gravity keeps the whole constellation on screen. Federated
// clusters therefore gather visibly, and DockView draws a soft hull — the
// holographic bound — around each one.

export type Vec = { x: number; y: number };
/** An undirected federation link between two dock circles. */
export type OrbLink = readonly [string, string];

/**
 * The links among the docked boards: a pair is linked when either side lists
 * the other as a federation partner. Pairs come out sorted and deduped so the
 * layout and the bounds are stable.
 */
export function linksAmong(
  ids: readonly string[],
  partners: ReadonlyMap<string, readonly string[]>,
): OrbLink[] {
  const here = new Set(ids);
  const seen = new Set<string>();
  const out: OrbLink[] = [];
  for (const a of ids) {
    for (const b of partners.get(a) ?? []) {
      if (a === b || !here.has(b)) continue;
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const key = `${lo}\n${hi}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([lo, hi]);
    }
  }
  return out;
}

/** Connected components of the link graph (singletons included). */
export function orbClusters(
  ids: readonly string[],
  links: readonly OrbLink[],
): string[][] {
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [a, b] of links) {
    adj.get(a)?.push(b);
    adj.get(b)?.push(a);
  }
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const group: string[] = [];
    const queue = [id];
    seen.add(id);
    while (queue.length) {
      const cur = queue.pop()!;
      group.push(cur);
      for (const next of adj.get(cur) ?? [])
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
    }
    out.push(group);
  }
  return out;
}

/** A running gravity simulation — positions, momentum, and wander phases. */
export type OrbSim = {
  ids: string[];
  px: Float64Array;
  py: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  /** Per-orb wander phase (from the id hash) so no two orbs drift in step. */
  phase: Float64Array;
};

const GOLDEN_ANGLE = 2.399963229728653; // spreads any orb count evenly

/** A fresh sim with `ids` seeded on a golden-angle ring around the centre. */
export function seedOrbs(
  ids: readonly string[],
  width: number,
  height: number,
): OrbSim {
  const n = ids.length;
  const sim: OrbSim = {
    ids: [...ids],
    px: new Float64Array(n),
    py: new Float64Array(n),
    vx: new Float64Array(n),
    vy: new Float64Array(n),
    phase: new Float64Array(n),
  };
  const ring = n > 1 ? Math.min(width, height) / 3.2 : 0;
  for (let i = 0; i < n; i++) {
    const a = i * GOLDEN_ANGLE;
    sim.px[i] = width / 2 + Math.cos(a) * ring;
    sim.py[i] = height / 2 + Math.sin(a) * ring * 0.8;
    sim.phase[i] = (hueFor(ids[i]) / 360) * Math.PI * 2;
  }
  return sim;
}

/**
 * Carry a running sim over to a new id list (or field size): retained orbs
 * keep their position and momentum, newcomers enter on the seed ring and
 * glide in, removed ones vanish. Returns a new sim; the old one is untouched.
 */
export function syncOrbs(
  sim: OrbSim | null,
  ids: readonly string[],
  width: number,
  height: number,
): OrbSim {
  const fresh = seedOrbs(ids, width, height);
  if (!sim) return fresh;
  const old = new Map(sim.ids.map((id, i) => [id, i]));
  ids.forEach((id, i) => {
    const j = old.get(id);
    if (j == null) return;
    fresh.px[i] = sim.px[j];
    fresh.py[i] = sim.py[j];
    fresh.vx[i] = sim.vx[j];
    fresh.vy[i] = sim.vy[j];
  });
  return fresh;
}

/**
 * One physics tick: central gravity, pairwise repulsion, link springs, then
 * damped integration clamped to the field. `wobbleT` (ms, e.g. a rAF
 * timestamp) adds the gentle perpetual wander that keeps the sky alive; omit
 * it for a deterministic settle (that's what the tests and orbLayout do).
 *
 * `liftedId` names an orb carried by a finger: it is lifted OUT of the
 * physics — it exerts and feels no forces and is not integrated (the caller
 * pins it to the pointer). Without this, its repulsion would shove the drop
 * target away and dropping would become a chase.
 */
export function stepOrbs(
  sim: OrbSim,
  links: readonly OrbLink[],
  width: number,
  height: number,
  radius: number,
  wobbleT?: number,
  liftedId?: string,
): void {
  const n = sim.ids.length;
  if (!n || width <= 0 || height <= 0) return;
  const { px, py, vx, vy, phase } = sim;
  const cx = width / 2;
  const cy = height / 2;
  const idx = new Map(sim.ids.map((id, i) => [id, i]));
  const lifted = liftedId != null ? (idx.get(liftedId) ?? -1) : -1;
  // Linked circles OVERLAP by ~25% of their diameter — the intersection is
  // the tappable lens that configures the pair. The spring alone sets their
  // distance (mutual repulsion is off for linked pairs below); rest sits a
  // touch above the 75%-of-diameter target because central gravity squeezes
  // a settled pair together by about that much.
  const rest = radius * 1.55;
  const repel = radius * radius * 20; // unlinked orbs drift much farther out
  const padX = Math.min(radius * 1.3, width / 2);
  const padY = Math.min(radius * 1.3, height / 2);
  const linked = new Set<number>();
  for (const [a, b] of links) {
    const i = idx.get(a);
    const j = idx.get(b);
    if (i != null && j != null && i !== j)
      linked.add(Math.min(i, j) * n + Math.max(i, j));
  }
  for (let i = 0; i < n; i++) {
    if (i !== lifted) {
      vx[i] += (cx - px[i]) * 0.004;
      vy[i] += (cy - py[i]) * 0.004;
    }
    for (let j = i + 1; j < n; j++) {
      if (i === lifted || j === lifted) continue;
      if (linked.has(i * n + j)) continue; // the spring owns this pair
      let dx = px[i] - px[j];
      let dy = py[i] - py[j];
      const d2 = dx * dx + dy * dy || 1;
      const d = Math.sqrt(d2);
      const f = repel / d2;
      dx /= d;
      dy /= d;
      vx[i] += dx * f;
      vy[i] += dy * f;
      vx[j] -= dx * f;
      vy[j] -= dy * f;
    }
  }
  for (const [a, b] of links) {
    const i = idx.get(a);
    const j = idx.get(b);
    if (i == null || j == null || i === j || i === lifted || j === lifted)
      continue;
    let dx = px[j] - px[i];
    let dy = py[j] - py[i];
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = (d - rest) * 0.06;
    dx /= d;
    dy /= d;
    vx[i] += dx * f;
    vy[i] += dy * f;
    vx[j] -= dx * f;
    vy[j] -= dy * f;
  }
  if (wobbleT !== undefined) {
    // A slow orbital breeze, phased per orb: strong enough to see the sky
    // breathe, far too weak to break a constellation apart.
    const t = wobbleT * 0.001;
    for (let i = 0; i < n; i++) {
      if (i === lifted) continue;
      vx[i] += Math.cos(t * 0.6 + phase[i]) * 0.05;
      vy[i] += Math.sin(t * 0.45 + phase[i] * 1.7) * 0.05;
    }
  }
  for (let i = 0; i < n; i++) {
    if (i === lifted) continue;
    vx[i] *= 0.8;
    vy[i] *= 0.8;
    px[i] = Math.min(width - padX, Math.max(padX, px[i] + vx[i]));
    py[i] = Math.min(height - padY, Math.max(padY, py[i] + vy[i]));
  }
}

/** The sim's positions as a map, for the template and the bounds. */
export function orbPositions(sim: OrbSim): Map<string, Vec> {
  const out = new Map<string, Vec>();
  sim.ids.forEach((id, i) => out.set(id, { x: sim.px[i], y: sim.py[i] }));
  return out;
}

/**
 * Settle the orbs in one go (300 ticks, no wander). Deterministic — the same
 * dock always settles into the same sky. The reduced-motion path and the
 * tests use this; the live dock steps the same physics frame by frame.
 */
export function orbLayout(
  ids: readonly string[],
  links: readonly OrbLink[],
  width: number,
  height: number,
  radius: number,
): Map<string, Vec> {
  if (!ids.length || width <= 0 || height <= 0) return new Map();
  const sim = seedOrbs(ids, width, height);
  for (let it = 0; it < 300; it++) stepOrbs(sim, links, width, height, radius);
  return orbPositions(sim);
}

/**
 * The vesica between two overlapping circles of radius `r` — the intersection
 * lens the dock highlights and makes tappable to configure a federated pair.
 * Empty when the circles don't overlap (or are concentric).
 */
export function lensPath(a: Vec, b: Vec, r: number): string {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d >= 2 * r || d < 1e-6) return "";
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const h = Math.sqrt(r * r - (d * d) / 4);
  const ux = -(b.y - a.y) / d; // unit perpendicular to the centre line
  const uy = (b.x - a.x) / d;
  const rnd = (v: number) => Math.round(v * 10) / 10;
  const p1x = rnd(mx + ux * h);
  const p1y = rnd(my + uy * h);
  const p2x = rnd(mx - ux * h);
  const p2y = rnd(my - uy * h);
  return (
    `M ${p1x} ${p1y} A ${r} ${r} 0 0 1 ${p2x} ${p2y}` +
    ` A ${r} ${r} 0 0 1 ${p1x} ${p1y} Z`
  );
}

/** Convex hull (monotone chain), counter-clockwise, no repeated endpoint. */
export function convexHull(pts: readonly Vec[]): Vec[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length <= 2) return p;
  const cross = (o: Vec, a: Vec, b: Vec) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const build = (list: Vec[]) => {
    const h: Vec[] = [];
    for (const pt of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], pt) <= 0)
        h.pop();
      h.push(pt);
    }
    h.pop();
    return h;
  };
  return [...build(p), ...build([...p].reverse())];
}

/**
 * The holographic bound around a cluster: a smooth closed SVG path hugging
 * the member orbs at distance `r`. Built from sample points on a circle of
 * radius `r` around each centre, hulled, then rounded through midpoints.
 */
export function boundsPath(centers: readonly Vec[], r: number): string {
  if (!centers.length) return "";
  const samples: Vec[] = [];
  for (const c of centers)
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      samples.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
    }
  const hull = convexHull(samples);
  if (hull.length < 3) return "";
  const rnd = (v: number) => Math.round(v * 10) / 10;
  const mid = (a: Vec, b: Vec) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const m0 = mid(hull[hull.length - 1], hull[0]);
  let d = `M ${rnd(m0.x)} ${rnd(m0.y)}`;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i];
    const m = mid(p, hull[(i + 1) % hull.length]);
    d += ` Q ${rnd(p.x)} ${rnd(p.y)} ${rnd(m.x)} ${rnd(m.y)}`;
  }
  return d + " Z";
}

// ── Stores + persistence ─────────────────────────────────────────────────--

function load(): DockEntry[] {
  try {
    return parseDock(localStorage.getItem(DOCK_KEY));
  } catch {
    return []; // no storage (SSR, tests) → start empty
  }
}

function save(list: DockEntry[]): void {
  try {
    localStorage.setItem(DOCK_KEY, JSON.stringify(list));
  } catch {
    /* private mode / quota — the dock just won't survive a reload */
  }
}

/** Every board this device has opened, in first-opened order. */
export const dockEntries = writable<DockEntry[]>(load());

// ── Deck ⇄ map ───────────────────────────────────────────────────────────--

/** How the closed boards are shown: the gravity deck, or the real map. */
export type DockViewMode = "deck" | "map";

const VIEW_KEY = "kiosk_dock_view";

function loadView(): DockViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === "map" ? "map" : "deck";
  } catch {
    return "deck";
  }
}

export const dockView = writable<DockViewMode>(loadView());

export function setDockView(mode: DockViewMode): void {
  dockView.set(mode);
  try {
    localStorage.setItem(VIEW_KEY, mode);
  } catch {
    /* private mode — the choice just won't survive a reload */
  }
}

/** Where the interface is between full window and dock of circles. */
export const dockState = writable<DockState>("window");

/** The circle whose board is being opened — the morph animates from it. */
export const dockOpenTarget = writable<string | null>(null);

/** Record that this device is showing `id` (name is best-effort, may be ""). */
export function rememberBoard(id: string, name: string): void {
  const cur = get(dockEntries);
  const next = upsertEntry(cur, id, name, cur.find((e) => e.id === id)?.at);
  if (next !== cur) {
    dockEntries.set(next);
    save(next);
  }
}

/** Bump a board's last-opened time (called when a circle is opened). */
export function touchBoard(id: string): void {
  const next = upsertEntry(get(dockEntries), id, "");
  dockEntries.set(next);
  save(next);
}

/** Delete a circle. Forgetting is local — the holon itself is untouched. */
export function forgetBoard(id: string): void {
  const cur = get(dockEntries);
  const next = removeEntry(cur, id);
  if (next !== cur) {
    dockEntries.set(next);
    save(next);
  }
}

/** Close the window into its circle (no-op unless the window is up). */
export function requestClose(): void {
  if (get(dockState) === "window") dockState.set("closing");
}

/** Expand a circle back into the window (no-op unless the dock is up). */
export function requestOpen(id: string): void {
  if (get(dockState) !== "dock") return;
  dockOpenTarget.set(id);
  dockState.set("opening");
}
