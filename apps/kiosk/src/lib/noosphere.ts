// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The noosphere: federation drawn as the flower of life, read through
// Metatron's cube. Every holon is a frame — a circle with its own seed at
// the centre — and its federation partners are the circles of the flower
// round it, on the hexagonal rings of the lattice (6, then 12, then 18…:
// the same rings the Geosphere's H3 cells make). Straight lines join every
// circle centre, the cube's lattice; the lines between the seed and each
// partner are the channels its flows travel along, two strands each: what
// reaches the frame on one side, what it sends on the other.
//
// A partner's circle holds a small flower of ITS partners, laid out by
// exactly the call that lays it out once entered (the same kids, the same
// rotation), so a flight into it lands without a jump. Each frame's lattice
// is turned so the frame it was entered from — the way back — sits in its
// first slot, facing where the person came from; turns snap to the
// lattice's own 60° so its rows always run level and names sit side by side.
//
// Federation is a graph, not a tree — A partners B partners A — so a frame's
// circles are its partners PLUS the frame it was entered from (its
// container). Pure: no DOM, no relays. NoosphereView draws it; tests drive it.

import { pairFlows, type LensDirections } from "./dock";

export type Pt = { x: number; y: number };
/** A circle in its frame's unit circle (centre 0,0, radius 1). */
export type Slot = { x: number; y: number; r: number };

const TAU = Math.PI * 2;
const SIXTH = Math.PI / 3;
export const SQ3 = Math.sqrt(3);

/** Circles a frame draws at most: four hexagonal rings (6 + 12 + 18 + 24). */
export const MAX_CHILDREN = 60;
/** The top level's turn: its first hub upper left, the rest clockwise. */
export const ROOT_ROT = -2 * SIXTH;

/** How a frame is proportioned, in units of the lattice spacing. */
export type Shape = {
  /** A partner's circle. */
  bloom: number;
  /** The seed at the centre. */
  hub: number;
};
/** A holon's frame: room between the seed and each circle for its channel. */
export const FRAME: Shape = { bloom: 0.32, hub: 0.34 };
/** The top level: no channels (no one holon at the centre), big circles. */
export const ROOT: Shape = { bloom: 0.46, hub: 0.46 };
/** The outer circles keep this far inside the rim. */
const RIM = 0.985;

/** Hexagonal rings needed for `n` circles (6 · 18 · 36 · 60 in all). */
export function ringsFor(n: number): number {
  if (n <= 0) return 0;
  let k = 1;
  while (3 * k * (k + 1) < n && k < 4) k += 1;
  return k;
}

/** Lattice spacing (centre to neighbour) for `k` rings of `shape`. */
export function spacing(k: number, shape: Shape): number {
  return RIM / (Math.max(1, k) + shape.bloom);
}

/** An angle snapped to the lattice's own 60°, folded into (−π, π]. */
export function snapRot(a: number): number {
  const s = Math.round(a / SIXTH) * SIXTH;
  let n = ((s % TAU) + TAU) % TAU;
  if (n > Math.PI + 1e-9) n -= TAU;
  return Math.abs(n) < 1e-12 ? 0 : n;
}

/**
 * Ring `m` of the triangular lattice, in units of the spacing, turned so its
 * corner at angle `rot` comes first and the rest follow clockwise (on screen,
 * y down). Ring 0 is the centre; ring m holds 6m nodes.
 */
export function hexRing(m: number, rot: number): Pt[] {
  if (m <= 0) return [{ x: 0, y: 0 }];
  const dirs: Pt[] = Array.from({ length: 6 }, (_, i) => ({
    x: Math.cos(i * SIXTH),
    y: Math.sin(i * SIXTH),
  }));
  // Corner m·dir[0] then walk the six sides, m steps each.
  const pts: Pt[] = [];
  let p = { x: m * dirs[0].x, y: m * dirs[0].y };
  for (let s = 0; s < 6; s++) {
    const step = dirs[(s + 2) % 6];
    for (let i = 0; i < m; i++) {
      pts.push(p);
      p = { x: p.x + step.x, y: p.y + step.y };
    }
  }
  const c = Math.cos(rot);
  const sn = Math.sin(rot);
  return pts
    .map((q) => {
      const x = q.x * c - q.y * sn;
      const y = q.x * sn + q.y * c;
      let a = (((Math.atan2(y, x) - rot) % TAU) + TAU) % TAU;
      if (a > TAU - 1e-9) a = 0;
      return { x: clean(x), y: clean(y), a };
    })
    .sort((u, v) => u.a - v.a)
    .map(({ x, y }) => ({ x, y }));
}
const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);

/**
 * Which of ring `m`'s nodes `take` circles use, in clockwise order. A full
 * ring uses all. A part ring spreads them evenly; past the first ring the
 * corners (hidden behind a nearer circle, seen from the seed) fill last, so
 * every channel runs clear.
 */
export function ringPick(m: number, take: number): number[] {
  const len = 6 * m;
  const t = Math.max(0, Math.min(len, take));
  if (t >= len) return Array.from({ length: len }, (_, i) => i);
  const spread = (pool: number[], n: number) =>
    Array.from(
      { length: n },
      (_, i) => pool[Math.round((i * pool.length) / n) % pool.length],
    );
  if (m === 1) return spread([0, 1, 2, 3, 4, 5], t).sort((a, b) => a - b);
  const all = Array.from({ length: len }, (_, i) => i);
  const clear = all.filter((i) => i % m !== 0);
  const corners = all.filter((i) => i % m === 0);
  const picked =
    t <= clear.length
      ? spread(clear, t)
      : [...clear, ...spread(corners, t - clear.length)];
  return [...new Set(picked)].sort((a, b) => a - b);
}

/** One partner's circle in a frame. */
export type Bloom = Slot & { id: string; ring: number };

/** A frame laid out: its rings, spacing, seed radius, turn and circles. */
export type Flower = {
  k: number;
  d: number;
  hub: number;
  rot: number;
  blooms: Bloom[];
};

/**
 * The flower of a frame whose circles are `kids`, already in order (see
 * {@link orderKids}): ring by ring from the first slot at `rot`, clockwise.
 * Deterministic: the same circles and turn are the same flower.
 */
export function flowerOf(
  kids: readonly string[],
  rot: number,
  shape: Shape = FRAME,
): Flower {
  const list = kids.slice(0, MAX_CHILDREN);
  const k = ringsFor(list.length);
  const d = spacing(k, shape);
  const blooms: Bloom[] = [];
  let left = list.length;
  for (let m = 1; m <= k && left > 0; m++) {
    const ring = hexRing(m, rot);
    const take = Math.min(ring.length, left);
    left -= take;
    for (const i of ringPick(m, take)) {
      const q = ring[i];
      const id = list[blooms.length];
      blooms.push({ id, x: q.x * d, y: q.y * d, r: shape.bloom * d, ring: m });
    }
  }
  return { k, d, hub: shape.hub * d, rot, blooms };
}

/** The turn of a circle's own flower: its first slot faces back at the seed. */
export function childRot(b: Pt): number {
  return snapRot(Math.atan2(-b.y, -b.x));
}

/**
 * A frame's circles in the order they take their slots: the container (the
 * way back) first, then the rest heaviest first (by `weight`), ties by id.
 */
export function orderKids(
  kids: readonly string[],
  container: string | null,
  weight: (id: string) => number,
): string[] {
  const rest = kids
    .filter((k) => k !== container)
    .map((id) => ({ id, w: weight(id) }))
    .sort((a, b) => b.w - a.w || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((k) => k.id);
  return container && kids.includes(container) ? [container, ...rest] : rest;
}

// ── The cube's lattice ────────────────────────────────────────────────────

/**
 * Metatron's cube: every pair of the fruit of life's 13 centres (the seed,
 * the first ring, the second ring's corners) joined by a straight line — 78
 * lines, in units of the spacing.
 */
export function cubeLines(rot: number): [Pt, Pt][] {
  const pts = [
    ...hexRing(0, rot),
    ...hexRing(1, rot),
    ...hexRing(2, rot).filter((_, i) => i % 2 === 0),
  ];
  const out: [Pt, Pt][] = [];
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) out.push([pts[i], pts[j]]);
  return out;
}

/**
 * The lattice behind a frame of `k` rings: the cube, and past its reach the
 * straight lines joining every neighbouring centre — so every circle of
 * the flower sits on a line. In units of the spacing; each line once.
 */
export function latticeLines(k: number, rot: number): [Pt, Pt][] {
  const lines = cubeLines(rot);
  if (k < 2) return lines;
  const key = (p: Pt) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
  const seen = new Set(
    lines.map(([a, b]) => [key(a), key(b)].sort().join("|")),
  );
  const nodes: Pt[] = [];
  for (let m = 0; m <= k; m++) nodes.push(...hexRing(m, rot));
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 1) > 1e-6) continue;
      const id = [key(a), key(b)].sort().join("|");
      if (seen.has(id)) continue;
      seen.add(id);
      lines.push([a, b]);
    }
  return lines;
}

/**
 * The part of the segment a–b inside the disc of radius `R` round the
 * centre, or null when it misses — the lattice drawn inside its rim.
 */
export function clipSeg(a: Pt, b: Pt, R = 1): [Pt, Pt] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const A = dx * dx + dy * dy;
  if (!A) return null;
  const B = 2 * (a.x * dx + a.y * dy);
  const C = a.x * a.x + a.y * a.y - R * R;
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return null;
  const sq = Math.sqrt(disc);
  const t0 = Math.max(0, (-B - sq) / (2 * A));
  const t1 = Math.min(1, (-B + sq) / (2 * A));
  if (t1 - t0 <= 1e-9) return null;
  return [
    { x: a.x + dx * t0, y: a.y + dy * t0 },
    { x: a.x + dx * t1, y: a.y + dy * t1 },
  ];
}

/**
 * A lattice as one SVG path: each line (in units of the spacing) scaled by
 * `d` and kept inside the rim.
 */
export function linesPath(
  lines: readonly [Pt, Pt][],
  d: number,
  R = 1,
): string {
  const f = (v: number) => +v.toFixed(4);
  let out = "";
  for (const [a, b] of lines) {
    const c = clipSeg(
      { x: a.x * d, y: a.y * d },
      { x: b.x * d, y: b.y * d },
      R,
    );
    if (c) out += `M${f(c[0].x)} ${f(c[0].y)}L${f(c[1].x)} ${f(c[1].y)}`;
  }
  return out;
}

/** The centres of the flower of life behind `k` rings (one ring past them). */
export function flowerCentres(k: number, rot: number): Pt[] {
  const out: Pt[] = [];
  for (let m = 0; m <= k + 1; m++) out.push(...hexRing(m, rot));
  return out;
}

/**
 * The vesica piscis between two circles: the lens where circles of radius
 * `k`·|ab| round `a` and `b` overlap. An SVG path.
 */
export function vesicaPath(a: Pt, b: Pt, k = 0.6): string {
  const D = Math.hypot(b.x - a.x, b.y - a.y);
  if (!D) return "";
  const R = D * k;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const nx = -(b.y - a.y) / D;
  const ny = (b.x - a.x) / D;
  const h = Math.sqrt(Math.max(0, R * R - (D * D) / 4));
  const f = (v: number) => +v.toFixed(5);
  const p = { x: mx + nx * h, y: my + ny * h };
  const q = { x: mx - nx * h, y: my - ny * h };
  return `M${f(p.x)} ${f(p.y)}A${f(R)} ${f(R)} 0 0 1 ${f(q.x)} ${f(q.y)}A${f(R)} ${f(R)} 0 0 1 ${f(p.x)} ${f(p.y)}Z`;
}

// ── Channels ──────────────────────────────────────────────────────────────

/** A straight strand from (x0,y0) to (x1,y1). */
export type Seg = { x0: number; y0: number; x1: number; y1: number };

/** The point `t` (0…1) along a strand. */
export function segAt(s: Seg, t: number): Pt {
  return { x: s.x0 + (s.x1 - s.x0) * t, y: s.y0 + (s.y1 - s.y0) * t };
}

/**
 * The channel between the seed `a` and a circle `b`: two parallel strands
 * `gap` either side of the line joining them, each from rim to rim. Looking
 * out from the seed, what the frame SENDS runs on the right, outward; what
 * REACHES it runs on the left, inward. `mid` is the bare line, rim to rim.
 */
export function channel(
  a: Slot,
  b: Slot,
  gap: number,
): { inn: Seg; out: Seg; mid: Seg } {
  const D = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / D;
  const uy = (b.y - a.y) / D;
  // Screen right of the direction a → b (y down): (−uy, ux).
  const rx = -uy;
  const ry = ux;
  const g = Math.min(gap, a.r * 0.8, b.r * 0.8);
  const at = (c: Slot, side: number, dir: number): Pt => {
    const along = Math.sqrt(Math.max(0, c.r * c.r - g * g));
    return {
      x: c.x + ux * along * dir + rx * g * side,
      y: c.y + uy * along * dir + ry * g * side,
    };
  };
  const o0 = at(a, 1, 1);
  const o1 = at(b, 1, -1);
  const i0 = at(b, -1, -1);
  const i1 = at(a, -1, 1);
  return {
    out: { x0: o0.x, y0: o0.y, x1: o1.x, y1: o1.y },
    inn: { x0: i0.x, y0: i0.y, x1: i1.x, y1: i1.y },
    mid: {
      x0: a.x + ux * a.r,
      y0: a.y + uy * a.r,
      x1: b.x - ux * b.r,
      y1: b.y - uy * b.r,
    },
  };
}

// ── Names ──────────────────────────────────────────────────────────────────

/**
 * A name in at most `max` characters: whole if it fits, else cut at a word
 * with an ellipsis — keeping a closing number ("Lunation 83") so siblings
 * that differ only there stay apart.
 */
export function shortName(name: string, max: number): string {
  const s = name.trim();
  if (s.length <= max) return s;
  // A name already cut (a short id: "npub1abc…xyz") is cut again from its
  // head, never given a second ellipsis.
  if (s.includes("…")) {
    const head = s.slice(0, s.indexOf("…")).trimEnd();
    return head.slice(0, Math.max(1, max - 1)).trimEnd() + "…";
  }
  const m = /\s(\S{1,4})$/.exec(s);
  if (m && /\d/.test(m[1])) {
    const tail = " " + m[1];
    const room = max - tail.length - 1;
    if (room >= 2) return s.slice(0, room).trimEnd() + "…" + tail;
  }
  const room = Math.max(1, max - 1);
  const cut = s.slice(0, room);
  const sp = cut.lastIndexOf(" ");
  return (sp >= room * 0.5 ? cut.slice(0, sp) : cut).trimEnd() + "…";
}

/** The short id tail that tells two holons of one name apart: "#2239". */
export const idTail = (id: string): string =>
  "#" + id.replace(/^-/, "").slice(-4);

/** The ids among `ids` whose name another of them shares. */
export function twins(
  ids: readonly string[],
  name: (id: string) => string,
): Set<string> {
  const by = new Map<string, string[]>();
  for (const id of ids) {
    const k = name(id).trim().toLowerCase();
    by.set(k, [...(by.get(k) ?? []), id]);
  }
  const out = new Set<string>();
  for (const list of by.values())
    if (list.length > 1) for (const id of list) out.add(id);
  return out;
}

/** Pairs of `ids` federated with each other, each pair once, in `ids` order. */
export function ties(
  ids: readonly string[],
  partnersOf: (id: string) => readonly string[] | undefined,
): [string, string][] {
  const at = new Map(ids.map((id, i) => [id, i]));
  const seen = new Set<string>();
  const out: [string, string][] = [];
  ids.forEach((a, i) => {
    for (const b of partnersOf(a) ?? []) {
      const j = at.get(b);
      if (j === undefined || j === i) continue;
      const [x, y] = i < j ? [a, b] : [b, a];
      const key = `${x}\u0000${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([x, y]);
    }
  });
  return out.sort(
    (p, q) => at.get(p[0])! - at.get(q[0])! || at.get(p[1])! - at.get(q[1])!,
  );
}

// ── Fitting a name into its circle ─────────────────────────────────────────

/** Width of a text set at 1px (the view measures it in the label face). */
export type Measure = (text: string) => number;

/**
 * Words into lines no wider than `room` (in 1px units), greedily. A word
 * wider than the room alone: null (the size does not fit), or — when asked
 * — broken with a hyphen (three letters a side at least) or bare.
 */
export function wrapWords(
  text: string,
  room: number,
  measure: Measure,
  breakWords: false | "hyphen" | "chars" = false,
): string[] | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (measure(next) <= room) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    if (measure(w) <= room) {
      cur = w;
      continue;
    }
    // An id ("npub1…xyz", "-1004332702038") is never hyphenated: it is cut.
    if (
      !breakWords ||
      (breakWords === "hyphen" && (w.includes("…") || /^[-\d#]+$/.test(w)))
    )
      return null;
    let rest = w;
    const dash = breakWords === "hyphen" ? "-" : "";
    while (measure(rest) > room) {
      let k = rest.length - 1;
      while (k > 0 && measure(rest.slice(0, k) + dash) > room) k -= 1;
      // A stub of three letters or so on the next line reads badly
      // ("Celebrat-ion"): break nearer the middle when the rest fits.
      if (dash && rest.length - k <= 3 && measure(rest.slice(k)) <= room) {
        const mid = Math.ceil(rest.length / 2);
        if (mid < k && measure(rest.slice(mid)) <= room) k = mid;
      }
      if (dash && (k < 3 || rest.length - k < 3)) return null;
      if (k < 1) return null;
      lines.push(rest.slice(0, k) + dash);
      rest = rest.slice(k);
    }
    cur = rest;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** A name set into a box: its lines, its size, whether it had to be cut. */
export type Fit = { lines: string[]; px: number; cut: boolean };

/**
 * The largest size (from `max` down to `min`, half a pixel at a time) at
 * which `text` fits a box `w` × `h` px in at most `lines` lines, whole
 * words only. Smaller text with the whole name wins over a cut; only at
 * `min` is the name cut (keeping a closing number). Null when not even a
 * stub fits — the name is then left to the card and the panel.
 */
export function fitLabel(
  text: string,
  box: { w: number; h: number },
  o: {
    max: number;
    min: number;
    lines?: number;
    lead?: number;
    measure: Measure;
    /** A last line kept whole under the name (an id tail). */
    tail?: string;
    /**
     * How small a whole word may go before it is broken with a hyphen
     * (default `min`): a smaller single word reads better than a split one.
     */
    wordMin?: number;
  },
): Fit | null {
  const lead = o.lead ?? 1.15;
  const name = text.trim();
  if (!name || box.w <= 0 || box.h <= 0) return null;
  if (o.tail) {
    // The tail takes the last line, at the name's size; the name fits in
    // what is left.
    const tail = o.tail;
    for (let px = o.max; px >= o.min - 1e-9; px -= 0.5) {
      const head = fitLabel(
        name,
        { w: box.w, h: box.h - px * lead },
        {
          ...o,
          max: px,
          tail: undefined,
          lines: Math.max(1, (o.lines ?? 2) - 1),
        },
      );
      if (
        head &&
        o.measure(tail) * head.px <= box.w &&
        (head.lines.length + 1) * head.px * lead <= box.h
      )
        return { ...head, lines: [...head.lines, tail] };
    }
    return null;
  }
  const most = o.lines ?? 2;
  // The largest whole-word size for at most n lines, for each n.
  const best: (Fit | null)[] = [];
  for (let n = 1; n <= most; n++) {
    let found: Fit | null = null;
    for (let px = o.max; px >= o.min - 1e-9; px -= 0.5) {
      const lines = wrapWords(name, box.w / px, o.measure);
      if (lines && lines.length <= n && lines.length * px * lead <= box.h) {
        found = { lines, px, cut: false };
        break;
      }
    }
    best.push(found);
  }
  const top = Math.max(0, ...best.map((f) => f?.px ?? 0));
  // Fewer lines win unless they cost more than a sixth of the size.
  const pick = best.find((f) => f && f.px >= top * 0.84 - 1e-9);
  if (pick) return pick;
  // Whole words a little smaller still, before any word is broken.
  const wordMin = Math.min(o.wordMin ?? o.min, o.min);
  for (let px = o.min - 0.5; px >= wordMin - 1e-9; px -= 0.5) {
    const lines = wrapWords(name, box.w / px, o.measure);
    if (lines && lines.length <= most && lines.length * px * lead <= box.h)
      return { lines, px, cut: false };
  }
  // A word too long for the box at any size: break it with a hyphen, the
  // whole name kept, at the largest size that holds.
  for (let px = o.max; px >= wordMin - 1e-9; px -= 0.5) {
    const lines = wrapWords(name, box.w / px, o.measure, "hyphen");
    if (lines && lines.length <= most && lines.length * px * lead <= box.h)
      return { lines, px, cut: false };
  }
  const px = o.min;
  const n = Math.min(most, Math.floor(box.h / (px * lead) + 1e-9));
  if (n < 1) return null;
  // Whole words still; a word too long for the box is cut short itself.
  for (let chars = name.length - 1; chars >= 4; chars--) {
    const cut = shortName(name, chars);
    const lines = wrapWords(cut, box.w / px, o.measure);
    if (lines && lines.length <= n) return { lines, px, cut: true };
  }
  return null;
}

// ── Cards ─────────────────────────────────────────────────────────────────

/** A box on screen, in px. */
export type Rect = { x0: number; y0: number; x1: number; y1: number };

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
  Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/**
 * Where a hover card of `size` goes beside `target`: off to the side
 * `away` points (out from the seed), never over the target nor any of
 * `avoid` (the seed) when there is room, always inside the stage.
 */
export function placeCard(
  size: { w: number; h: number },
  target: Rect,
  avoid: readonly Rect[],
  stage: { w: number; h: number },
  away: Pt,
  gap = 12,
  margin = 8,
  /** Boxes better left clear (the other circles), weighed a quarter as much. */
  soft: readonly Rect[] = [],
): Pt {
  const { w, h } = size;
  const cx = (target.x0 + target.x1) / 2;
  const cy = (target.y0 + target.y1) / 2;
  const cands: Pt[] = [
    { x: target.x1 + gap, y: cy - h / 2 },
    { x: target.x0 - gap - w, y: cy - h / 2 },
    { x: cx - w / 2, y: target.y1 + gap },
    { x: cx - w / 2, y: target.y0 - gap - h },
    { x: target.x1 + gap, y: target.y1 + gap },
    { x: target.x0 - gap - w, y: target.y1 + gap },
    { x: target.x1 + gap, y: target.y0 - gap - h },
    { x: target.x0 - gap - w, y: target.y0 - gap - h },
  ];
  const len = Math.hypot(away.x, away.y) || 1;
  const ax = away.x / len;
  const ay = away.y / len;
  let best: Pt = cands[0];
  let bestScore = Infinity;
  for (const c of cands) {
    const x = Math.max(margin, Math.min(c.x, stage.w - w - margin));
    const y = Math.max(margin, Math.min(c.y, stage.h - h - margin));
    const r = { x0: x, y0: y, x1: x + w, y1: y + h };
    const hit =
      [target, ...avoid].reduce((s, a) => s + overlap(r, a), 0) +
      0.25 * soft.reduce((s, a) => s + overlap(r, a), 0);
    const dx = x + w / 2 - cx;
    const dy = y + h / 2 - cy;
    const dl = Math.hypot(dx, dy) || 1;
    // Overlap dominates; then the side facing away from the seed.
    const score = hit * 1000 - ((dx * ax + dy * ay) / dl) * 10;
    if (score < bestScore - 1e-9) {
      bestScore = score;
      best = { x, y };
    }
  }
  return best;
}

// ── The circles of a frame and what flows ─────────────────────────────────

/**
 * The circles inside `id` when entered from `container` (null at the top):
 * its partners and the container, once each, never itself, in id order —
 * stable while names and flows arrive. Capped at {@link MAX_CHILDREN},
 * never cutting the container.
 */
export function childrenOf(
  id: string,
  partners: readonly string[] | undefined,
  container: string | null,
): string[] {
  const set = new Set<string>(partners ?? []);
  set.delete(id);
  set.delete("");
  if (container) set.delete(container);
  const rest = [...set].sort();
  const head = container && container !== id ? [container] : [];
  return [...head, ...rest]
    .slice(0, MAX_CHILDREN)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** What travels between a frame and one of its circles, from the frame's side. */
export type Stream = {
  partner: string;
  /** Lenses that reach the frame FROM the partner. */
  inbound: string[];
  /** Lenses the frame sends TO the partner. */
  outbound: string[];
};

/** The flows between `focus` and `partner`, folded from both sides' records. */
export function streamOf(
  focus: string,
  partner: string,
  configs: ReadonlyMap<string, Readonly<Record<string, LensDirections>>>,
): Stream {
  const { ab, ba } = pairFlows(focus, partner, configs);
  return { partner, inbound: ba, outbound: ab };
}

/**
 * Every circle's streams, those with something reaching the frame first
 * (most lenses first), then those it only sends to, then the quiet links.
 */
export function reaching(
  focus: string,
  partners: readonly string[],
  configs: ReadonlyMap<string, Readonly<Record<string, LensDirections>>>,
): Stream[] {
  const rank = (s: Stream) =>
    s.inbound.length ? 0 : s.outbound.length ? 1 : 2;
  return partners
    .map((p) => streamOf(focus, p, configs))
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.inbound.length - a.inbound.length ||
        b.outbound.length - a.outbound.length ||
        (a.partner < b.partner ? -1 : a.partner > b.partner ? 1 : 0),
    );
}

/** Every lens reaching the frame, each with the partners it comes from. */
export function lensesReaching(
  streams: readonly Stream[],
): { lens: string; from: string[] }[] {
  const by = new Map<string, string[]>();
  for (const s of streams)
    for (const l of s.inbound) by.set(l, [...(by.get(l) ?? []), s.partner]);
  return [...by.entries()]
    .map(([lens, from]) => ({ lens, from }))
    .sort(
      (a, b) => b.from.length - a.from.length || a.lens.localeCompare(b.lens),
    );
}

// ── The camera ─────────────────────────────────────────────────────────────

/** What the view frames, in the current frame's units: a centre and a radius. */
export type Cam = { x: number; y: number; r: number };

/** The whole frame, the camera at rest. */
export const HOME: Cam = { x: 0, y: 0, r: 1 };

/**
 * The camera `t` (0…1) of the way from `a` to `b`: the radius moves on a log
 * scale (so a 10× zoom feels as steady as a 2× one) and the centre moves in
 * step with it — the zoom reads as falling into the circle, not sliding past.
 */
export function lerpCam(a: Cam, b: Cam, t: number): Cam {
  const r = Math.exp(Math.log(a.r) + (Math.log(b.r) - Math.log(a.r)) * t);
  const k = Math.abs(b.r - a.r) < 1e-9 ? t : (r - a.r) / (b.r - a.r);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, r };
}

/** Ease in and out (cubic). */
export const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/** A slot nested in a slot: `inner` is in `outer`'s unit frame. */
export function nest(outer: Slot, inner: Slot): Slot {
  return {
    x: outer.x + inner.x * outer.r,
    y: outer.y + inner.y * outer.r,
    r: inner.r * outer.r,
  };
}

/** One frame on the trail: the holon, and the turn its flower was entered at. */
export type Step = { id: string; rot: number };

/**
 * The trail after travelling to `id` (entered at turn `rot`): a frame
 * already on the trail cuts it back to there (going back up), anything
 * else goes one deeper.
 */
export function travel(
  trail: readonly Step[],
  id: string,
  rot: number,
): Step[] {
  const at = trail.findIndex((s) => s.id === id);
  return at >= 0 ? trail.slice(0, at + 1) : [...trail, { id, rot }];
}

/** A stored trail read back: steps, or bare ids from before turns were kept. */
export function parseTrail(v: unknown): Step[] {
  if (!Array.isArray(v)) return [];
  const out: Step[] = [];
  for (const s of v) {
    if (typeof s === "string" && s) out.push({ id: s, rot: ROOT_ROT });
    else if (
      s &&
      typeof s === "object" &&
      typeof (s as Step).id === "string" &&
      (s as Step).id
    ) {
      const r = Number((s as Step).rot);
      out.push({
        id: (s as Step).id,
        rot: Number.isFinite(r) ? snapRot(r) : ROOT_ROT,
      });
    } else return [];
  }
  return out;
}

// ── Taps: one flies in, two (or a hold) open the board ──────────────────────

/** Two taps on one circle closer than this are a double tap. */
export const DOUBLE_MS = 450;
/** A press held this long opens the board. */
export const HOLD_MS = 500;

/**
 * What a tap on `id` at `now` means, given the tap before it: the second of
 * two quick taps — on the same circle, or anywhere while flying toward the
 * first one's circle — opens; anything else travels.
 */
export function tapMeaning(
  last: { id: string; at: number } | null,
  id: string | null,
  now: number,
  flyingTo: string | null = null,
): { act: "open" | "travel"; id: string | null } {
  if (last && now - last.at <= DOUBLE_MS) {
    if (flyingTo && last.id === flyingTo) return { act: "open", id: flyingTo };
    if (id && id === last.id) return { act: "open", id };
  }
  return { act: "travel", id };
}

// ── The wheel ─────────────────────────────────────────────────────────────

export type WheelState = { acc: number; last: number; lock: boolean };

/** Wheel push needed to travel a level, and the pause that ends a swipe. */
const WHEEL_STEP = 120;
const WHEEL_GAP = 250;

/**
 * One wheel event: a push past the step travels a level ("out" scrolling
 * down, "in" up), then the gate stays shut until the wheel rests — one
 * inertial trackpad swipe travels one level, not five.
 */
export function wheelGate(
  s: WheelState,
  deltaY: number,
  now: number,
): { state: WheelState; fire: "in" | "out" | null } {
  const rested = now - s.last > WHEEL_GAP;
  const acc = rested ? 0 : s.acc;
  const lock = rested ? false : s.lock;
  if (lock) return { state: { acc: 0, last: now, lock }, fire: null };
  const next = acc + deltaY;
  if (next > WHEEL_STEP)
    return { state: { acc: 0, last: now, lock: true }, fire: "out" };
  if (next < -WHEEL_STEP)
    return { state: { acc: 0, last: now, lock: true }, fire: "in" };
  return { state: { acc: next, last: now, lock: false }, fire: null };
}

// ── Lens names ─────────────────────────────────────────────────────────────

/** The kiosk tab a federated lens is read in, where it has one. */
export const LENS_TABS: Record<string, string> = {
  quests: "tabs.tasks",
  events: "tabs.calendar",
  shifts: "tabs.shifts",
  library: "tabs.library",
  checklists: "tabs.checklists",
  roles: "tabs.roles",
  stock: "tabs.stock",
  offers: "tabs.offers",
  needs: "tabs.offers",
};

// ── The top level's marks ──────────────────────────────────────────────────
//
// At the top every circle is one of the dock's hubs, so it carries the mark
// its orb wears in the Holosphere (lib/identicon) above its name. In units of
// the circle's radius: the mark is a square of half-side MARK centred
// MARK_RISE above the centre; the name's box (MARK_BOX_W × MARK_BOX_H) is
// centred MARK_DROP below it.

/** Half the mark's side, in radii. */
export const MARK = 0.3;
/** How far above the centre the mark's centre sits, in radii. */
export const MARK_RISE = 0.34;
/** How far below the centre the name's box is centred, in radii. */
export const MARK_DROP = 0.36;
/** The name's box under a mark, in radii. */
export const MARK_BOX_W = 1.4;
export const MARK_BOX_H = 0.6;
/**
 * Below this radius (screen px) a name under the mark could only ever read
 * "Limin…": the circle wears its mark alone, larger and centred — as an orb
 * does in the Holosphere — and its name lives in the card and the panel.
 */
export const MARK_NAME_MIN = 34;
/** Half the side of a mark worn alone, in radii. */
export const MARK_ALONE = 0.42;

/** Where a top-level circle of screen radius `rPx` draws its mark (radii). */
export function markPlace(rPx: number): {
  half: number;
  rise: number;
  named: boolean;
} {
  return rPx >= MARK_NAME_MIN
    ? { half: MARK, rise: MARK_RISE, named: true }
    : { half: MARK_ALONE, rise: 0, named: false };
}
