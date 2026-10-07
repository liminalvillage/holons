// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The board as a window. Closing it shrinks the whole tab interface into a
// circle — the dock: one circle per holon this device has opened, each
// reopenable, removable, plus a "+" that adds a board by id/label/pasted
// link. The list is per-device (localStorage), like the caretaker's pinned
// holon. This module owns the state and the pure list operations; the morph
// animation between window and dock lives in the layout, which watches
// `dockState` for the two transitional frames.

import { shortId } from "@holons/core/identity";
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
  /**
   * The hub whose federation brought this one onto the dock, when it was
   * not added or opened by the person themselves. Docking a hub also docks
   * its partners (dockfed.ts), each tagged with the hub it came in with, so
   * removing that hub can offer to take its retinue along. Cleared the
   * moment the person adds or opens the board: from then on it is theirs.
   */
  via?: string;
};

/**
 * Window ↔ dock lifecycle. "closing" and "opening" are the morph frames where
 * BOTH the window and the dock are mounted so the layout can animate one into
 * the other; the layout settles them to "dock" / "window" when the morph ends.
 */
export type DockState = "window" | "closing" | "dock" | "opening";

const DOCK_KEY = "kiosk_dock";
const FORGOTTEN_KEY = "kiosk_dock_forgotten";

// ── Pure list operations (exported for tests) ────────────────────────────--

function isEntry(e: unknown): e is DockEntry {
  const c = e as DockEntry;
  return (
    !!c &&
    typeof c === "object" &&
    typeof c.id === "string" &&
    c.id.trim() !== "" &&
    typeof c.name === "string" &&
    typeof c.at === "number" &&
    (c.via === undefined || (typeof c.via === "string" && c.via !== ""))
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

/** How a board came to be docked — see {@link DockEntry.via}. */
export type DockOrigin = {
  /** The hub whose federation brought it in; omit for the person's own add. */
  via?: string;
};

/**
 * Add or refresh a board in the list. Positions are STABLE — a circle never
 * jumps around the dock — so an existing entry is updated in place and a new
 * one appended. An empty `name` never clobbers a name already learned.
 *
 * `origin.via` tags a board a federation brought in. Without it the call is
 * the person's own (an add, an open): a new entry has no `via`, and an
 * existing one LOSES its tag — the board is theirs now. With it, an entry
 * already docked keeps whatever tag it has (a partner cannot demote a board
 * the person added).
 */
export function upsertEntry(
  list: DockEntry[],
  id: string,
  name: string,
  at = Date.now(),
  origin: DockOrigin = {},
): DockEntry[] {
  const clean = name.trim();
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) {
    const fresh: DockEntry = { id, name: clean || labelFor(id), at };
    if (origin.via && origin.via !== id) fresh.via = origin.via;
    return [...list, fresh];
  }
  const cur = list[i];
  const next: DockEntry = { ...cur, name: clean || cur.name, at };
  if (!origin.via) delete next.via;
  if (next.name === cur.name && next.at === cur.at && next.via === cur.via)
    return list;
  return [...list.slice(0, i), next, ...list.slice(i + 1)];
}

/**
 * The boards a hub's federation brought onto the dock and the person never
 * made their own — what removing that hub can offer to take along.
 */
export function broughtInBy(list: DockEntry[], id: string): DockEntry[] {
  return list.filter((e) => e.via === id);
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

/**
 * Remove a board from the list (a no-op when it isn't there). With
 * `withDependents`, the boards its federation brought in ({@link broughtInBy})
 * go too; the ones the person made their own stay.
 */
export function removeEntry(
  list: DockEntry[],
  id: string,
  opts: { withDependents?: boolean } = {},
): DockEntry[] {
  const gone = new Set(forgottenBy(list, id, opts));
  return list.some((e) => gone.has(e.id))
    ? list.filter((e) => !gone.has(e.id))
    : list;
}

/**
 * The ids a removal forgets: the board itself and, with `withDependents`,
 * the boards its federation brought in. These are what the implicit docking
 * paths — a shown hub's partners (dockfed.ts), a key login's own hubs
 * (myhubs.ts) — must leave alone from then on, or every reload would put the
 * removed circle straight back.
 */
export function forgottenBy(
  list: DockEntry[],
  id: string,
  opts: { withDependents?: boolean } = {},
): string[] {
  const ids = [id];
  if (opts.withDependents)
    for (const e of broughtInBy(list, id)) ids.push(e.id);
  return ids;
}

/** Parse the persisted forgotten list, dropping anything malformed. */
export function parseForgotten(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list)
      ? [...new Set(list.filter((v) => typeof v === "string" && v.trim()))]
      : [];
  } catch {
    return [];
  }
}

/**
 * A human label for a holon id before its real name is known: the registered
 * subdomain label, capitalised ("liminal" → "Liminal"), else the raw id.
 */
export function labelFor(id: string): string {
  const label = segmentFor(id);
  if (label === id) return shortId(id);
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

/** Lower-case, accents stripped, whitespace squeezed — for loose matching. */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Does a docked board answer this search? Every word of the query must occur
 * in the board's name, its registered label, or its id — case and accents
 * aside — so "casa grove" finds "Casa Selva grove" and "-5560" the Oilonics
 * group by id. A blank query answers yes: nothing is being filtered.
 */
export function matchesDock(
  entry: Pick<DockEntry, "id" | "name">,
  query: string,
): boolean {
  const words = fold(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const hay = fold(`${entry.name} ${labelFor(entry.id)} ${entry.id}`);
  return words.every((w) => hay.includes(w));
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
// holds its spot against its placed neighbours' repulsion yet still glides
// there (damping 0.8 settles it in about a second, without overshoot).
const ANCHOR_PULL = 0.02;
/**
 * The farthest an orb may travel in one frame, in radii. Every force here is
 * soft, but a crowded sky can still add up to a shove; capping the speed turns
 * it into a glide. A quarter radius a frame is ~0.8 s across the field.
 */
const MAX_SPEED = 0.25;

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
 * One physics tick: central gravity, pairwise repulsion, link springs, soft
 * walls, then damped integration. `wobbleT` (ms, e.g. a rAF timestamp) adds
 * the gentle perpetual wander that keeps the sky alive; omit it for a
 * deterministic settle (that's what the tests and orbLayout do).
 *
 * Every force is SOFT and bounded — there is no positional snap anywhere.
 * The dock used to finish each frame by yanking every federated pair back
 * into overlap and clamping the orbs to the field edge; where a place, a wall
 * and a spring disagreed, the snap and the forces undid each other every
 * frame and the orbs shivered on the spot. Now a placed pair the earth holds
 * apart simply stays apart — DockView draws their link's control on the tie
 * between them instead of in a vesica — and the edge is a cushion, not a
 * wall.
 *
 * `liftedId` names an orb carried by a finger: it is lifted OUT of the
 * physics — it exerts and feels no forces and is not integrated (the caller
 * pins it to the pointer). Without this, its repulsion would shove the drop
 * target away and dropping would become a chase.
 *
 * `anchors` (field px, by id) names the orbs with a place on the map: an
 * anchored orb is pulled to its anchor instead of the centre, and a
 * federation spring only ever moves its free ends: a placed orb stays on its
 * place and a free partner is pulled alongside it.
 *
 * The earth is ONE-WAY: a placed orb is moved by its place and by other
 * placed orbs, never by a free one. Every force a free orb feels is then
 * either returned by its partner or comes from a point that does not answer
 * — a potential, which damping settles. A placed orb that answered a free
 * orb's repulsion but not its spring broke that: the free partner chased the
 * placed orb, the placed orb was shoved round by the partner's own neighbour,
 * and — damping only sets the SPEED of a driven motion, it never ends it —
 * a chain hung off a placed orb spun rigidly round it for as long as the
 * dock stayed open, at a rate that depended on the zoom.
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
  // Inside a diameter the push stops growing: an inverse-square shove between
  // two orbs a spring has packed against the same hub was the stiffest force
  // in the sky, and the one most prone to overshoot and shiver.
  const core2 = 4 * radius * radius;
  const maxSpeed = radius * MAX_SPEED;
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
      const f = repel / Math.max(d2, core2);
      dx /= d;
      dy /= d;
      // A placed orb is never shoved by a FREE one (see the note on the
      // one-way earth above): the free orb stands off, the placed one stays.
      // Placed orbs still spread one another along a shared edge.
      if (!anchor[i] || anchor[j]) {
        vx[i] += dx * f;
        vy[i] += dy * f;
      }
      if (!anchor[j] || anchor[i]) {
        vx[j] -= dx * f;
        vy[j] -= dy * f;
      }
    }
  }
  for (const [a, b] of links) {
    const i = idx.get(a);
    const j = idx.get(b);
    if (i == null || j == null || i === j) continue;
    let dx = px[j] - px[i];
    let dy = py[j] - py[i];
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = (d - rest) * 0.06;
    dx /= d;
    dy /= d;
    // A spring only ever moves its FREE ends: a placed orb stays on its
    // place, a lifted one under its finger, and between two held ends it
    // does nothing at all. This is what tows a free partner behind a drag.
    if (!anchor[i] && i !== lifted) {
      vx[i] += dx * f;
      vy[i] += dy * f;
    }
    if (!anchor[j] && j !== lifted) {
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
    const speed = Math.hypot(vx[i], vy[i]);
    if (speed > maxSpeed) {
      vx[i] *= maxSpeed / speed;
      vy[i] *= maxSpeed / speed;
    }
    const nx = px[i] + vx[i];
    const ny = py[i] + vy[i];
    px[i] = clampX(nx);
    py[i] = clampY(ny);
    // Meeting the edge spends the momentum that was carrying the orb into
    // it — otherwise it keeps pressing, and the next nudge off the wall is a
    // jump rather than a drift.
    if (px[i] !== nx) vx[i] = 0;
    if (py[i] !== ny) vy[i] = 0;
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
 * near it. A free federated partner is towed along behind the finger by its
 * spring, which keeps it about a diameter from the carried orb for as long
 * as the drag lasts. A capture radius as wide as that leash therefore matched
 * the partner on every single frame, so dragging a federated orb onto the
 * earth could never reach the ground: the hexagon lit up between frames and
 * the drop always came out a federation.
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
 * The liquid bridge between two federated orbs: a glassy neck of fluid that
 * clings to both rims and pinches in the middle — wide enough to fill the
 * vesica when they overlap, a thin thread when the earth holds them apart.
 * The shape is what joins a pair on the dock; its gradient (DockView) runs
 * from one orb's colour to the other's, and hovering or tapping it tells the
 * pair's flows. Empty when the orbs are concentric (nothing to span).
 *
 * Two cubic halves per edge meet at the neck with a flat tangent; each leaves
 * its rim tangentially at `theta` from the centre line — just past the
 * vesica's corners when the orbs overlap, a fixed shoulder when apart — and
 * the near side of each rim closes the shape with a short arc.
 */
export function liquidPath(a: Vec, b: Vec, r: number): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (!(r > 0) || d < 1e-6) return "";
  const ux = dx / d;
  const uy = dy / d;
  const nx = -uy;
  const ny = ux;
  // Where the rims cross (half the vesica's height), or nothing when apart.
  const h = d < 2 * r ? Math.sqrt(r * r - (d * d) / 4) : 0;
  const phi = d < 2 * r ? Math.acos(d / (2 * r)) : 0;
  const theta = Math.min(1.3, phi + 0.5);
  // The neck's half-width: the vesica's plus a lip, or the thread's.
  const w = h + r * 0.16;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // How far each attachment sits from the midpoint, along the centre line.
  const span = d / 2 - r * cos;
  // Handle lengths: at the neck, along the centre line; at the rim, along
  // the rim's tangent — but never so long that the inward dive crosses the
  // neck line, or a long thread would sway from edge to edge.
  const Ln = span * 0.55;
  const Lr = Math.min(Ln, (0.9 * (r * sin - w)) / Math.max(cos, 0.2));
  const rnd = (v: number) => Math.round(v * 10) / 10;
  const P = (x: number, y: number) => `${rnd(x)} ${rnd(y)}`;
  // One edge, from A's rim to B's rim, offset `s` (±1) along the normal.
  const edge = (s: number) => {
    const p1x = a.x + r * (cos * ux + s * sin * nx);
    const p1y = a.y + r * (cos * uy + s * sin * ny);
    const p2x = b.x + r * (-cos * ux + s * sin * nx);
    const p2y = b.y + r * (-cos * uy + s * sin * ny);
    const qx = mx + s * w * nx;
    const qy = my + s * w * ny;
    // Tangent leaving A's rim toward the neck: along the rim, inward.
    const t1x = sin * ux - s * cos * nx;
    const t1y = sin * uy - s * cos * ny;
    const t2x = -sin * ux - s * cos * nx;
    const t2y = -sin * uy - s * cos * ny;
    return {
      p1: P(p1x, p1y),
      p2: P(p2x, p2y),
      d:
        `C ${P(p1x + t1x * Lr, p1y + t1y * Lr)} ${P(qx - ux * Ln, qy - uy * Ln)} ${P(qx, qy)} ` +
        `C ${P(qx + ux * Ln, qy + uy * Ln)} ${P(p2x + t2x * Lr, p2y + t2y * Lr)} ${P(p2x, p2y)}`,
    };
  };
  const top = edge(1);
  const bottom = edge(-1);
  // Top edge A→B, down B's near rim to the bottom edge's end, back B→A
  // (the bottom edge reversed), and up A's near rim home.
  return (
    `M ${top.p1} ${top.d} A ${r} ${r} 0 0 1 ${bottom.p2} ` +
    reverseCubics(bottom.d, bottom.p2, bottom.p1) +
    ` A ${r} ${r} 0 0 1 ${top.p1} Z`
  );
}

/** Two cubic segments "C c1 c2 q C c3 c4 end", walked from `end` to `start`. */
function reverseCubics(d: string, _end: string, start: string): string {
  const nums = d.replace(/C/g, " ").trim().split(/\s+/);
  // c1 c2 q c3 c4 end → C c4 c3 q C c2 c1 start
  const pt = (i: number) => `${nums[2 * i]} ${nums[2 * i + 1]}`;
  return `C ${pt(4)} ${pt(3)} ${pt(2)} C ${pt(1)} ${pt(0)} ${start}`;
}

/** One side's federation config toward a partner. */
export type LensDirections = {
  inbound: readonly string[];
  outbound: readonly string[];
};
/** What flows between a pair, from either side's record. */
export type PairFlows = {
  /** Lenses travelling from `a` to `b`, sorted, deduped. */
  ab: string[];
  /** Lenses travelling from `b` to `a`. */
  ba: string[];
};

/**
 * The relation between two federated holons, folded from both sides: `a`
 * sends what it marks outbound to `b` and what `b` marks inbound from `a`;
 * likewise the other way. Either side's record may be missing (a partner
 * the relay hasn't answered for yet) — the other still tells the story.
 */
export function pairFlows(
  a: string,
  b: string,
  configs: ReadonlyMap<string, Readonly<Record<string, LensDirections>>>,
): PairFlows {
  const fromA = configs.get(a)?.[b];
  const fromB = configs.get(b)?.[a];
  const ab = new Set<string>([
    ...(fromA?.outbound ?? []),
    ...(fromB?.inbound ?? []),
  ]);
  const ba = new Set<string>([
    ...(fromA?.inbound ?? []),
    ...(fromB?.outbound ?? []),
  ]);
  return { ab: [...ab].sort(), ba: [...ba].sort() };
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

// The boards this device removed. A removal is final until the person adds
// or opens the board again themselves: the folds that dock boards on their
// own — a shown hub's partners, a key login's hubs — ask `isForgotten` first.
function loadForgotten(): Set<string> {
  try {
    return new Set(parseForgotten(localStorage.getItem(FORGOTTEN_KEY)));
  } catch {
    return new Set();
  }
}

function saveForgotten(set: Set<string>): void {
  try {
    localStorage.setItem(FORGOTTEN_KEY, JSON.stringify([...set]));
  } catch {
    /* private mode / quota — a removal just won't survive a reload */
  }
}

const forgotten: Set<string> = loadForgotten();

/** Was this board removed from the dock, and never re-added since? */
export function isForgotten(id: string): boolean {
  return forgotten.has(id);
}

// ── Sky ⇄ earth ──────────────────────────────────────────────────────────--

/**
 * What lies beneath the orbs: "deck" is the sky alone, "map" shows the earth
 * under it — each placed orb then hovers over its hexagon, tied to it by a
 * beacon — and "list" turns the earth's pane over into a list of the same
 * things, by name. The orbs themselves are always there. The earth is the
 * default: the map is the kiosk's front door, the first thing a bare visit
 * shows.
 */
export type DockViewMode = "deck" | "map" | "list";

const VIEW_KEY = "kiosk_dock_view";

function loadView(): DockViewMode {
  try {
    const kept = localStorage.getItem(VIEW_KEY);
    return kept === "deck" || kept === "list" ? kept : "map";
  } catch {
    return "map";
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

/**
 * Record that this device is showing `id` (name is best-effort, may be "").
 * Plain, the board becomes the person's own; with `origin.via` it is docked
 * as a hub's federation partner (see {@link upsertEntry}).
 */
export function rememberBoard(
  id: string,
  name: string,
  origin: DockOrigin = {},
): void {
  // Docking is wanted again, whoever asks: the implicit folds that must
  // honour a removal check `isForgotten` before they ever get here.
  if (forgotten.delete(id)) saveForgotten(forgotten);
  const cur = get(dockEntries);
  const next = upsertEntry(
    cur,
    id,
    name,
    cur.find((e) => e.id === id)?.at,
    origin,
  );
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

/**
 * Bump a board's last-opened time (called when a circle is opened). Opening
 * is the person's own act, so a partner-docked board becomes theirs here.
 */
export function touchBoard(id: string): void {
  if (forgotten.delete(id)) saveForgotten(forgotten);
  const next = upsertEntry(get(dockEntries), id, "");
  dockEntries.set(next);
  save(next);
}

/**
 * Delete a circle, and with `withDependents` the circles its federation
 * brought in. Forgetting is local — the holon and its links are untouched —
 * and it sticks: the removed ids stay forgotten (see `isForgotten`) until
 * the person docks them again themselves.
 */
export function forgetBoard(
  id: string,
  opts: { withDependents?: boolean } = {},
): void {
  const cur = get(dockEntries);
  for (const gone of forgottenBy(cur, id, opts)) forgotten.add(gone);
  saveForgotten(forgotten);
  const next = removeEntry(cur, id, opts);
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

/**
 * The board a switch is heading for: set by {@link requestSwitch}, consumed
 * by the layout once the close morph has landed on the dock, which then opens
 * this circle. `null` when no switch is pending.
 */
export const dockSwitchTarget = writable<string | null>(null);

export type SwitchRequest = {
  /** The holon to open. */
  id: string;
  /** Its name as the badge showed it, when known. */
  name?: string;
  /** The board being left, when one is up. */
  from?: string | null;
};

/**
 * A switch waiting for the person's yes — leaving a board is a change of
 * place, so a badge tap asks first (SwitchConfirm). `null` when nothing is
 * pending. {@link confirmSwitch} performs it, {@link cancelSwitch} drops it.
 */
export const switchRequest = writable<SwitchRequest | null>(null);

/** Would a switch to `id` do anything right now? (Shared no-op rules.) */
function switchable(id: string, from?: string | null): boolean {
  if (!id) return false;
  const state = get(dockState);
  if (state === "window" && from === id) return false;
  return state === "window" || state === "dock";
}

/**
 * Ask to jump from the shown board to another holon's — the way a tap on a
 * card's provenance badge travels to the holon the card came from. Nothing
 * moves yet: the request is parked for the confirmation sheet, and
 * {@link confirmSwitch} does the travelling.
 *
 * A no-op for an empty id, for the board already shown, and mid-morph.
 */
export function requestSwitch(
  id: string,
  opts: { name?: string; from?: string | null } = {},
): void {
  if (!switchable(id, opts.from)) return;
  switchRequest.set({ id, name: opts.name, from: opts.from });
}

/** Drop the pending switch, if any. */
export function cancelSwitch(): void {
  switchRequest.set(null);
}

/**
 * Perform the pending switch. The window first closes into its circle (the
 * map and holosphere show through), then the target's circle opens. The
 * target is docked first so there is a circle to land on: tagged as brought
 * in by `from` (the board being left), so the dock never promotes a partner
 * the person didn't add themselves — opening it is what makes it theirs
 * (see {@link touchBoard}). From the dock it opens straight away.
 */
export function confirmSwitch(): void {
  const req = get(switchRequest);
  switchRequest.set(null);
  if (!req || !switchable(req.id, req.from)) return;
  const { id, name, from } = req;
  rememberBoard(id, name ?? "", from ? { via: from } : {});
  if (get(dockState) === "dock") {
    requestOpen(id);
    return;
  }
  dockSwitchTarget.set(id);
  dockState.set("closing");
}
