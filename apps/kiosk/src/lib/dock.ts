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

/**
 * Set a docked board's DISPLAY NAME. Unlike {@link upsertEntry}, an empty
 * `name` is not "keep whatever is there" — it means the holon resolves no
 * name of its own, so the circle falls back to `labelFor(id)`: the registered
 * label, else the bare id. Keeping a stale name here is what let a name
 * learned for one holon sit under another holon's circle.
 *
 * Renaming a board that isn't docked is a no-op — the caller docks it first.
 */
export function renameEntry(
  list: DockEntry[],
  id: string,
  name: string,
): DockEntry[] {
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) return list;
  const display = name.trim() || labelFor(id);
  if (list[i].name === display) return list;
  return [
    ...list.slice(0, i),
    { ...list[i], name: display },
    ...list.slice(i + 1),
  ];
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
//
// With the earth showing beneath the sky, an orb whose holon has claimed a
// place is ANCHORED: instead of the centre it is drawn toward a point above
// its hexagon on the map (the `anchors` argument, in field px), so it hovers
// over its place and follows the map as it pans — and DockView ties the two
// with a beacon cone (`beaconPath`). Orbs with no place keep the centre.

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
// The pull toward an anchor: five times the central gravity, so a placed orb
// holds its spot against its neighbours' repulsion yet still glides there
// (damping 0.8 settles it in about a second, without overshoot).
const ANCHOR_PULL = 0.02;
/**
 * The widest a federated pair is ever drawn, in radii: 1.9 leaves 5% of a
 * diameter overlapping, so the vesica — the tappable lens that configures the
 * pair — is never empty. The spring settles a free pair far closer than this
 * (~1.5 radii, a 25% overlap); this is the hard floor for the cases a spring
 * cannot reach, above all two orbs held apart by their places on the earth.
 */
export const LINK_MAX_GAP = 1.9;

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
 *
 * `anchors` (field px, by id) names the orbs with a place on the map: an
 * anchored orb is pulled to its anchor instead of the centre — firmly enough
 * that the place wins over its neighbours' repulsion — and a federation
 * spring only ever moves its free ends: a placed orb stays on its place and a
 * free partner is pulled alongside it.
 *
 * The last word belongs to `linkOverlap`: whatever the forces worked out,
 * federated orbs are ALWAYS left overlapping, so their vesica is always there
 * to tap. Places bend to that (a placed orb yields a quarter as much as a
 * free one) and keep their beacon pointing home.
 */
export function stepOrbs(
  sim: OrbSim,
  links: readonly OrbLink[],
  width: number,
  height: number,
  radius: number,
  wobbleT?: number,
  liftedId?: string,
  anchors?: ReadonlyMap<string, Vec>,
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
  // A third, not a half: at a half a field narrower than 2.6 radii collapses
  // to a single line every orb is clamped onto, stacked one on the other.
  const padX = Math.min(radius * 1.3, width / 3);
  const padY = Math.min(radius * 1.3, height / 3);
  const clampX = (v: number) => Math.min(width - padX, Math.max(padX, v));
  const clampY = (v: number) => Math.min(height - padY, Math.max(padY, v));
  // A place OUTSIDE the view is parked at the edge nearest it. Pulling toward
  // the raw off-screen point drove the orb into the wall with a force that
  // grew with the distance — hundreds of pixels per frame, dwarfing every
  // repulsion — so each orb sat pinned on the exact same boundary pixel and
  // several distant places stacked their orbs into one, of which only the top
  // could be tapped. Clamping the anchor into the field makes that pull local
  // and weak, so ordinary repulsion spreads the parked orbs along the edge
  // and each is still on the side its own place lies.
  const anchor = sim.ids.map((id) => {
    const a = anchors?.get(id);
    return a ? { x: clampX(a.x), y: clampY(a.y) } : undefined;
  });
  const linked = new Set<number>();
  for (const [a, b] of links) {
    const i = idx.get(a);
    const j = idx.get(b);
    if (i != null && j != null && i !== j)
      linked.add(Math.min(i, j) * n + Math.max(i, j));
  }
  for (let i = 0; i < n; i++) {
    if (i !== lifted) {
      const a = anchor[i];
      if (a) {
        vx[i] += (a.x - px[i]) * ANCHOR_PULL;
        vy[i] += (a.y - py[i]) * ANCHOR_PULL;
      } else {
        vx[i] += (cx - px[i]) * 0.004;
        vy[i] += (cy - py[i]) * 0.004;
      }
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
    // A spring only ever moves its FREE ends: a placed orb stays on its
    // place, and between two placed orbs it does nothing at all.
    if (!anchor[i]) {
      vx[i] += dx * f;
      vy[i] += dy * f;
    }
    if (!anchor[j]) {
      vx[j] -= dx * f;
      vy[j] -= dy * f;
    }
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
    px[i] = clampX(px[i] + vx[i]);
    py[i] = clampY(py[i] + vy[i]);
  }
  linkOverlap(sim, links, radius, lifted, anchor, width, height, padX, padY);
}

/**
 * The hard constraint behind the soft spring: pull any federated pair drawn
 * wider than `LINK_MAX_GAP` radii back until it overlaps again, and drop the
 * velocity that was separating them.
 *
 * Ends yield by weight — a lifted orb (under a finger) not at all, a placed
 * orb a quarter as much as a free one — so a drag stays exact, a place is
 * mostly kept, and a free partner does most of the travelling. Chains and
 * hubs need a few passes to settle, hence the sweep.
 */
function linkOverlap(
  sim: OrbSim,
  links: readonly OrbLink[],
  radius: number,
  lifted: number,
  anchor: readonly (Vec | undefined)[],
  width: number,
  height: number,
  padX: number,
  padY: number,
): void {
  if (!links.length || !(radius > 0)) return;
  const { px, py, vx, vy } = sim;
  const idx = new Map(sim.ids.map((id, i) => [id, i]));
  const max = radius * LINK_MAX_GAP;
  const clampX = (v: number) => Math.min(width - padX, Math.max(padX, v));
  const clampY = (v: number) => Math.min(height - padY, Math.max(padY, v));
  const weight = (i: number) => (i === lifted ? 0 : anchor[i] ? 0.25 : 1);
  for (let pass = 0; pass < 4; pass++) {
    let corrected = false;
    for (const [a, b] of links) {
      const i = idx.get(a);
      const j = idx.get(b);
      if (i == null || j == null || i === j) continue;
      const dx = px[j] - px[i];
      const dy = py[j] - py[i];
      const d = Math.hypot(dx, dy);
      if (d <= max) continue;
      const wi = weight(i);
      const wj = weight(j);
      const sum = wi + wj;
      if (sum <= 0) continue; // both ends pinned — nothing may move
      const ux = dx / d;
      const uy = dy / d;
      const excess = d - max;
      px[i] = clampX(px[i] + ux * excess * (wi / sum));
      py[i] = clampY(py[i] + uy * excess * (wi / sum));
      px[j] = clampX(px[j] - ux * excess * (wj / sum));
      py[j] = clampY(py[j] - uy * excess * (wj / sum));
      // Whatever was driving them apart along this axis is spent.
      const sep = (vx[j] - vx[i]) * ux + (vy[j] - vy[i]) * uy;
      if (sep > 0) {
        vx[i] += ux * sep * (wi / sum);
        vy[i] += uy * sep * (wi / sum);
        vx[j] -= ux * sep * (wj / sum);
        vy[j] -= uy * sep * (wj / sum);
      }
      corrected = true;
    }
    if (!corrected) return;
  }
}

/** The sim's positions as a map, for the template and the bounds. */
export function orbPositions(sim: OrbSim): Map<string, Vec> {
  const out = new Map<string, Vec>();
  sim.ids.forEach((id, i) => out.set(id, { x: sim.px[i], y: sim.py[i] }));
  return out;
}

/**
 * The orb a dragged finger is OVER — the only thing a drop can federate with.
 *
 * The pointer must be inside the target's own circle (`radius`), not merely
 * near it. A federated partner is towed along behind the finger by
 * `linkOverlap`, which holds it within `LINK_MAX_GAP` radii of the carried
 * orb for as long as the drag lasts. A capture radius as wide as that leash
 * therefore matched the partner on every single frame, so dragging a
 * federated orb onto the earth could never reach the ground: the hexagon lit
 * up between frames and the drop always came out a federation.
 *
 * `self` (the carried orb) is never its own target.
 */
export function orbUnder(
  positions: ReadonlyMap<string, Vec>,
  p: Vec,
  self: string,
  radius: number,
): string | null {
  let best: string | null = null;
  let bestD = radius;
  for (const [id, q] of positions) {
    if (id === self) continue;
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
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
  anchors?: ReadonlyMap<string, Vec>,
): Map<string, Vec> {
  if (!ids.length || width <= 0 || height <= 0) return new Map();
  const sim = seedOrbs(ids, width, height);
  for (let it = 0; it < 300; it++)
    stepOrbs(sim, links, width, height, radius, undefined, undefined, anchors);
  return orbPositions(sim);
}

/**
 * Where the lines of sight from `ground` touch an orb of radius `r` centred
 * at `orb` — the two shoulders the beacon cone hangs from. Null when the
 * ground point is inside the circle (the orb is sitting on its place).
 */
export function beaconTangents(
  orb: Vec,
  ground: Vec,
  r: number,
): [Vec, Vec] | null {
  const dx = ground.x - orb.x;
  const dy = ground.y - orb.y;
  const d = Math.hypot(dx, dy);
  if (!(r > 0) || d <= r) return null;
  const a = Math.atan2(dy, dx);
  const th = Math.acos(r / d);
  const rnd = (v: number) => Math.round(v * 10) / 10;
  return [
    {
      x: rnd(orb.x + Math.cos(a + th) * r),
      y: rnd(orb.y + Math.sin(a + th) * r),
    },
    {
      x: rnd(orb.x + Math.cos(a - th) * r),
      y: rnd(orb.y + Math.sin(a - th) * r),
    },
  ];
}

/**
 * The beacon cone tying an orb (centre `orb`, radius `r`) to its place on
 * the ground: the two tangent points (`beaconTangents`) joined through the
 * ground point — orb-wide at the orb, converging on the spot. Empty when the
 * ground point is inside the circle (nothing to draw).
 */
export function beaconPath(orb: Vec, ground: Vec, r: number): string {
  const t = beaconTangents(orb, ground, r);
  if (!t) return "";
  const rnd = (v: number) => Math.round(v * 10) / 10;
  return (
    `M ${t[0].x} ${t[0].y} L ${rnd(ground.x)} ${rnd(ground.y)}` +
    ` L ${t[1].x} ${t[1].y} Z`
  );
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

// ── Sky ⇄ earth ──────────────────────────────────────────────────────────--

/**
 * What lies beneath the orbs: "deck" is the sky alone, "map" shows the earth
 * under it — each placed orb then hovers over its hexagon, tied to it by a
 * beacon. The orbs themselves are always there.
 */
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

/**
 * Name a docked board from the one authority on it — a name resolved FOR that
 * holon. An unresolved name (`""`) resets the circle to its id/label rather
 * than leaving the previous holon's name under it.
 */
export function nameBoard(id: string, name: string): void {
  const cur = get(dockEntries);
  const next = renameEntry(cur, id, name);
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
