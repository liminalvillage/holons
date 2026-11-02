// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The flow calendar's space: a fractal of dials. Every level of time is the
// same shape one scale down — the year is a dial of moons, the moon a dial
// of its four quadrants and days, the quadrant a dial of its days, the day
// a dial of hours (a clock). At any depth the outer ring is the period
// we're in and the inner ring the next period down, the one the focus
// instant falls in. Zooming is a dolly: the inner ring grows into the outer
// one while the outer slides off past the edge, and the next ring down
// surfaces at the centre — so the four keyframe views (year dial, moon
// dial, phase dial, day clock) are what the zoom interpolates across, and
// nothing switches.
//
// Twelve o'clock is the start of every period, time runs clockwise, and
// each ring is scaled from the one outside it by one constant ratio, which
// is what makes the nest self-similar. The zoom is `z = log2(days on
// screen)`; the focus `t0` picks which moon, quadrant and day are nested.
// Pure: no DOM, no stores; the view is a flat render of the scene.

import { lunationAt, type Lunation } from "@holons/core/flows";
import type { CalendarEvent } from "./data";
import {
  DAY_MS,
  moonQuarters,
  solarEventsIn,
  type SolarKey,
} from "./yearscale";

// ── Drawing ───────────────────────────────────────────────────────────────
/** The drawing is a 0..1000 square; every ring is centred on it. */
export const SIZE = 1000;
export const C = SIZE / 2;
/**
 * The self-similar ratio between one level and the next: each ring is the
 * one outside it scaled by this, which is what makes the nest a fractal.
 */
export const RATIO = 1.85;
/** The outer ring's largest radius (a big box); smaller boxes plan less. */
export const R_OUTER_MAX = 440;
/** Band each ring draws its sectors in, drawing units at 1 unit/px. */
const BAND = 26;
/** Card geometry, drawing units at 1 unit/px. */
export const CHIP = 11;
const STEP = 13; // a column of chips, away from the band
const LANE = 8; // span lanes, inward
const GAP = 6; // from the band to the first chip / lane
const MAX_STACK = 5;
const MAX_LANES = 4;
const EDGE = 6; // kept clear at the drawing's edge
const HOUR_MS = 3600_000;

// ── Zoom levels ───────────────────────────────────────────────────────────
/** Zoom anchors: `z = log2(days across the screen)`. */
export const Z = {
  YEAR: Math.log2(365),
  LUN: Math.log2(29.53),
  PHASE: Math.log2(7.4),
  DAY: 0,
} as const;
export const Z_MIN = Math.log2(0.75);
export const Z_MAX = Math.log2(420);
export const LEVELS = ["year", "lunation", "phase", "day"] as const;
export type FlowLevel = (typeof LEVELS)[number];
const Z_OF: Record<FlowLevel, number> = {
  year: Z.YEAR,
  lunation: Z.LUN,
  phase: Z.PHASE,
  day: Z.DAY,
};
export const zOfLevel = (l: FlowLevel | number): number =>
  Z_OF[typeof l === "number" ? LEVELS[l] : l];

export interface FlowCamera {
  /** log2 of the days across the screen. */
  z: number;
  /** The focus instant, ms. */
  t0: number;
}

export interface Weights {
  year: number;
  lunation: number;
  phase: number;
  day: number;
}

/** Flat near both ends: each anchor is a plateau, each blend a soft hand-over. */
const smoother = (u: number): number => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * x * (x * (x * 6 - 15) + 10);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** How far each blend has gone: year→lunation, lunation→phase, phase→day (0..1). */
export function stages(z: number): { yl: number; lp: number; pd: number } {
  const f = (outer: number, inner: number) =>
    smoother((outer - z) / (outer - inner));
  return {
    yl: f(Z.YEAR, Z.LUN),
    lp: f(Z.LUN, Z.PHASE),
    pd: f(Z.PHASE, Z.DAY),
  };
}

/** The depth into the nest: 0 = year dial, 1 = moon dial, 2 = phase, 3 = day. */
export function depth(z: number): number {
  const { yl, lp, pd } = stages(z);
  return yl + lp + pd;
}

/** The share each level has at `z`; sums to one, a pure plateau at each anchor. */
export function levelWeights(z: number): Weights {
  const { yl, lp, pd } = stages(z);
  return {
    year: 1 - yl,
    lunation: yl * (1 - lp),
    phase: lp * (1 - pd),
    day: pd,
  };
}

export function levelOf(z: number): FlowLevel {
  const w = levelWeights(z);
  let best: FlowLevel = "year";
  for (const k of ["lunation", "phase", "day"] as const)
    if (w[k] > w[best]) best = k;
  return best;
}

export const spanDays = (z: number): number => Math.pow(2, z);

// ── Context: the moons and suns around the focus ──────────────────────────
export interface FlowContext {
  /** The lunation the focus is in. */
  focus: Lunation;
  /** Lunations around the focus, oldest first (covers the year). */
  lunations: Lunation[];
  quarters: Map<number, { first: number; full: number; last: number }>;
  solar: Array<{ key: SolarKey; date: Date }>;
  lunationOf: (t: number) => Lunation;
}

const ctxCache = new Map<number, FlowContext>();

/** Memoised per lunation: a pan inside one cycle costs nothing. */
export function flowContext(t0: number): FlowContext {
  const focus = lunationAt(t0);
  const hit = ctxCache.get(focus.index);
  if (hit) return hit;
  const lunations: Lunation[] = [];
  let c = focus;
  for (let i = 0; i < 14; i++) c = lunationAt(c.from - 1);
  for (let i = 0; i < 29; i++) {
    lunations.push(c);
    c = lunationAt(c.to + 1);
  }
  const quarters = new Map<
    number,
    { first: number; full: number; last: number }
  >();
  for (const l of lunations) {
    const q = moonQuarters(l.from, l.to + 1);
    quarters.set(l.index, {
      first: q.first.getTime(),
      full: q.full.getTime(),
      last: q.last.getTime(),
    });
  }
  const lunationOf = (t: number): Lunation => {
    let lo = 0;
    let hi = lunations.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const l = lunations[mid];
      if (t < l.from) hi = mid - 1;
      else if (t > l.to) lo = mid + 1;
      else return l;
    }
    return lunationAt(t);
  };
  const ctx: FlowContext = {
    focus,
    lunations,
    quarters,
    solar: solarEventsIn(lunations[0].from, lunations[lunations.length - 1].to),
    lunationOf,
  };
  if (ctxCache.size > 24) ctxCache.clear();
  ctxCache.set(focus.index, ctx);
  return ctx;
}

// ── Periods: what each ring holds, for this focus ─────────────────────────
export interface Period {
  level: number;
  from: number;
  /** Exclusive. */
  to: number;
}

const startOfDay = (t: number): number => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const nextDay = (dayStart: number): number =>
  startOfDay(dayStart + DAY_MS + HOUR_MS);
const midday = (t: number): number => startOfDay(t) + 12 * HOUR_MS;

/** The four quadrant bounds of a lunation (new, first, full, last, new). */
export function quadrantBounds(l: Lunation, ctx: FlowContext): number[] {
  const q = ctx.quarters.get(l.index);
  const len = l.to + 1 - l.from;
  return q
    ? [l.from, q.first, q.full, q.last, l.to + 1]
    : [0, 1, 2, 3, 4].map((k) => l.from + (k * len) / 4);
}

/** The period level `L` holds around the focus. */
export function periodOf(level: number, t0: number, ctx: FlowContext): Period {
  if (level <= 0) {
    const y = new Date(t0).getFullYear();
    return {
      level: 0,
      from: new Date(y, 0, 1).getTime(),
      to: new Date(y + 1, 0, 1).getTime(),
    };
  }
  const l = ctx.lunationOf(t0);
  if (level === 1) return { level: 1, from: l.from, to: l.to + 1 };
  if (level === 2) {
    const b = quadrantBounds(l, ctx);
    let k = 3;
    for (let i = 0; i < 4; i++) if (t0 >= b[i] && t0 < b[i + 1]) k = i;
    return { level: 2, from: b[k], to: b[k + 1] };
  }
  const d = startOfDay(t0);
  return { level: 3, from: d, to: nextDay(d) };
}

const TAU = 2 * Math.PI;
/** Fraction of a period (12 o'clock = 0, clockwise); may run past 0..1. */
export const fracIn = (t: number, p: Period): number =>
  (t - p.from) / (p.to - p.from);
/** Point at fraction `f` of a lap, radius `r`. */
export function pt(f: number, r: number): [number, number] {
  const a = f * TAU;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
}
/** An arc from `f0` to `f1` at radius `r`, as a path. */
export function arc(f0: number, f1: number, r: number): string {
  const sweep = Math.max(f1 - f0, 0.0004);
  if (sweep >= 0.9999) {
    const [x0, y0] = pt(0, r);
    const [x1, y1] = pt(0.5, r);
    return `M${x0} ${y0}A${r} ${r} 0 1 1 ${x1} ${y1}A${r} ${r} 0 1 1 ${x0} ${y0}`;
  }
  const [x0, y0] = pt(f0, r);
  const [x1, y1] = pt(f0 + sweep, r);
  return `M${x0} ${y0}A${r} ${r} 0 ${sweep > 0.5 ? 1 : 0} 1 ${x1} ${y1}`;
}
/** A ring sector from `f0` to `f1` between radii `rIn` and `rOut`. */
export function sector(
  f0: number,
  f1: number,
  rIn: number,
  rOut: number,
): string {
  const large = f1 - f0 > 0.5 ? 1 : 0;
  const [a, b] = pt(f0, rOut);
  const [c, d] = pt(f1, rOut);
  const [e, g] = pt(f1, rIn);
  const [h, i] = pt(f0, rIn);
  return `M${a} ${b}A${rOut} ${rOut} 0 ${large} 1 ${c} ${d}L${e} ${g}A${rIn} ${rIn} 0 ${large} 0 ${h} ${i}Z`;
}

/**
 * The radial plan for a box: chips, bands and gaps keep their size on
 * screen (`S` drawing units per px). A ring's cards stack outward from its
 * band, where they have room to grow, so the outer ring is set where its
 * fullest stack still clears the drawing's edge — and the stack is as deep
 * as leaves the ring at least a third of the drawing across.
 */
export function radialPlan(S = 1): { rO: number; maxStack: number } {
  const edge = (EDGE + BAND / 2) * S;
  const budget = SIZE / 2 - edge - 300;
  const maxStack = Math.min(
    MAX_STACK,
    Math.max(1, Math.floor((budget - (GAP + CHIP) * S) / (STEP * S)) + 1),
  );
  const eOut = (GAP + CHIP + (maxStack - 1) * STEP) * S;
  return { rO: Math.min(R_OUTER_MAX, SIZE / 2 - edge - eOut), maxStack };
}

/** The radius of level `L`'s ring at depth `d`: outer at d = L, inner one out. */
export function ringRadius(level: number, d: number, rO = R_OUTER_MAX): number {
  return rO * Math.pow(RATIO, d - level);
}

/** Visibility of a ring by its radius: fades off the edge, surfaces at the centre. */
export function ringOpacity(r: number, rO = R_OUTER_MAX): number {
  const out = clamp01((rO * 1.55 - r) / (rO * 0.55));
  const inn = clamp01((r - 24) / 70);
  return out * inn;
}

/** The rings on screen at depth `d`: their levels and radii, outermost first. */
export function ringsAt(
  d: number,
  rO = R_OUTER_MAX,
): Array<{ level: number; r: number }> {
  const out: Array<{ level: number; r: number }> = [];
  for (let level = 0; level < LEVELS.length; level++) {
    const r = ringRadius(level, d, rO);
    if (r < 24 || r > rO * 1.55) continue;
    out.push({ level, r });
  }
  return out;
}

/** Where `t` sits on level `L`'s ring at this camera. */
export function placeOn(
  level: number,
  t: number,
  cam: FlowCamera,
  ctx: FlowContext,
  rO = R_OUTER_MAX,
): { x: number; y: number; f: number; r: number } {
  const p = periodOf(level, cam.t0, ctx);
  const f = fracIn(t, p);
  const r = ringRadius(level, depth(cam.z), rO);
  const [x, y] = pt(f, r);
  return { x, y, f, r };
}

export interface RingHit {
  level: number;
  t: number;
  r: number;
  /** Signed distance from the ring's radius, drawing units. */
  off: number;
}

/**
 * The ring and the instant under a drawing point: the nearest visible ring
 * by radius, when the point is within `reach` of it — the space between
 * rings is nobody's.
 */
export function ringAt(
  x: number,
  y: number,
  cam: FlowCamera,
  ctx: FlowContext,
  rO = R_OUTER_MAX,
  reach = 70,
): RingHit | null {
  const dx = x - C;
  const dy = y - C;
  const r = Math.hypot(dx, dy);
  const f = (((Math.atan2(dx, -dy) / TAU) % 1) + 1) % 1;
  let best: RingHit | null = null;
  for (const ring of ringsAt(depth(cam.z), rO)) {
    const off = r - ring.r;
    // A small ring only answers for its own neighbourhood, never the centre.
    if (Math.abs(off) > Math.min(reach, ring.r * 0.45)) continue;
    if (best && Math.abs(best.off) <= Math.abs(off)) continue;
    const p = periodOf(ring.level, cam.t0, ctx);
    best = {
      level: ring.level,
      t: p.from + f * (p.to - p.from),
      r: ring.r,
      off,
    };
  }
  return best;
}

/** The instant under a point, or null off every ring. */
export function instantAt(
  x: number,
  y: number,
  cam: FlowCamera,
  ctx: FlowContext,
  rO = R_OUTER_MAX,
): number | null {
  return ringAt(x, y, cam, ctx, rO)?.t ?? null;
}

/** The nearest keyframe level's ring (the one the camera is "on"). */
export function outerLevel(d: number): number {
  return Math.min(LEVELS.length - 1, Math.max(0, Math.round(d)));
}

/**
 * A drag as a time shift: dragging round the ring under the finger turns
 * its hand — clockwise is forward. Off every ring, the outer ring's period.
 */
export function dragDt(
  from: { x: number; y: number },
  to: { x: number; y: number },
  cam: FlowCamera,
  ctx: FlowContext,
  rO = R_OUTER_MAX,
): number {
  const ang = (p: { x: number; y: number }) => Math.atan2(p.x - C, -(p.y - C));
  let da = ang(to) - ang(from);
  if (da > Math.PI) da -= TAU;
  if (da < -Math.PI) da += TAU;
  const hit = ringAt(from.x, from.y, cam, ctx, rO);
  const p = periodOf(hit?.level ?? outerLevel(depth(cam.z)), cam.t0, ctx);
  return (da / TAU) * (p.to - p.from);
}

// ── The scene ─────────────────────────────────────────────────────────────
export interface FlowSector {
  key: string;
  d: string;
  alt: boolean;
  /** Label at the sector's middle, when it has room. */
  label?: string;
  lx: number;
  ly: number;
  /** Mid fraction, for the label's rotation. */
  f: number;
}
export interface FlowTick {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  lx: number;
  ly: number;
  f: number;
}
export type SkyKind = "new" | "full" | "quarter" | "solar";
export interface FlowSky {
  key: string;
  kind: SkyKind;
  x: number;
  y: number;
  f: number;
  date: Date;
  labelKey?: SolarKey;
}
export interface FlowCard {
  key: string;
  ev: CalendarEvent;
  /** A small square chip, turned to the ring, like the year dial's. */
  x: number;
  y: number;
  rot: number;
  size: number;
  f: number;
  /** The chip's column away from the band (0 = nearest). */
  col: number;
  opacity: number;
}
export interface FlowSpan {
  key: string;
  ev: CalendarEvent;
  d: string;
}
/** A small mark on the band: a day's cards when chips have no room, or "+n". */
export interface FlowMark {
  key: string;
  x: number;
  y: number;
  r: number;
  label?: string;
  opacity: number;
  day: Date;
}
export interface FlowRing {
  level: number;
  name: FlowLevel;
  r: number;
  /** Half the band's width. */
  half: number;
  opacity: number;
  /** 1 when this ring is at its keyframe radius (the outer ring). */
  focus: number;
  period: Period;
  sectors: FlowSector[];
  ticks: FlowTick[];
  sky: FlowSky[];
  cards: FlowCard[];
  marks: FlowMark[];
  spans: FlowSpan[];
  /** The now hand's fraction, when now falls in the period. */
  now: number | null;
  /** Innermost and outermost radius this ring's content reaches. */
  rIn: number;
  rOut: number;
}
export interface FlowScene {
  cam: FlowCamera;
  weights: Weights;
  level: FlowLevel;
  depth: number;
  rings: FlowRing[];
  /** The radial plan the scene was laid out with. */
  rO: number;
  /** Clear radius at the centre, for the dial's name. */
  centreRoom: number;
  readout: {
    year: number;
    lunation: Lunation;
    /** 0 new→first quarter, 1 →full, 2 →last quarter, 3 →new. */
    quadrant: number;
    date: Date;
  };
  unitsPerPx: number;
}

export interface LayoutInput {
  events: CalendarEvent[];
  now: Date;
  cam: FlowCamera;
  ctx: FlowContext;
  /** Drawing units per screen pixel (1000 / the box's smaller side). */
  unitsPerPx?: number;
  /** Short weekday names, Sunday first (the view passes its locale's). */
  weekdays?: string[];
}

/** A card's duration in ms (an hour when it has none worth drawing). */
function durationMs(ev: CalendarEvent): number {
  if (ev.allDay || ev.multiDay) return 0;
  if (ev.end) {
    const d = ev.end.getTime() - ev.date.getTime();
    if (d >= 15 * 60_000) return d;
  }
  return HOUR_MS;
}

/**
 * Lay the nest out: every ring on screen with its sectors, sky and cards,
 * each given only the room between it and its neighbours — so at every
 * depth nothing sits on anything else. Rings are planned outermost first:
 * a ring's span lanes take the room down to the next ring in, and that
 * ring's cards take what the lanes left. A ring without room for a chip
 * marks its days on the band instead, and chips fade in as room grows.
 */
export function layoutFlow({
  events,
  now,
  cam,
  ctx,
  unitsPerPx = 1,
  weekdays,
}: LayoutInput): FlowScene {
  const S = unitsPerPx;
  const { rO, maxStack } = radialPlan(S);
  const chip = CHIP * S;
  const step = STEP * S;
  const lane = LANE * S;
  const gap = GAP * S;
  const half = (BAND * S) / 2;
  const edge = EDGE * S;
  const w = levelWeights(cam.z);
  const d = depth(cam.z);
  const nowMs = now.getTime();
  const rings: FlowRing[] = [];

  const visible = ringsAt(d, rO).filter(({ r }) => ringOpacity(r, rO) > 0.002);
  // What the ring outside leaves this one: its inward content's edge (the
  // drawing's edge for the outermost).
  let outwardLimit = SIZE / 2 - edge;
  for (let idx = 0; idx < visible.length; idx++) {
    const { level, r } = visible[idx];
    const next = visible[idx + 1];
    const name = LEVELS[level];
    const period = periodOf(level, cam.t0, ctx);
    const opacity = ringOpacity(r, rO);
    const focus = clamp01(1 - Math.abs(d - level));
    const frac = (t: number) => fracIn(t, period);
    const rBandIn = r - half;
    const rBandOut = r + half;
    // A ring whose band would sit on the ring outside's content is left
    // out (the smaller ones in, too): a hint of the nest is not worth a
    // clash. The outermost ring is the exception — on its way off past the
    // edge it keeps drawing, fading, clipped by the box.
    const leaving = idx === 0 && rBandOut > outwardLimit + 1e-6;
    if (!leaving && rBandOut > outwardLimit + 1e-6) break;
    // Room outward, up to the ring outside's content: the chips' spokes
    // (a leaving ring keeps the room it had at the edge). Room inward,
    // down to the next ring's band: the span lanes.
    const outwardRoom = leaving
      ? (GAP + CHIP + (maxStack - 1) * STEP) * S
      : Math.max(0, outwardLimit - rBandOut);
    const innerLimit = next ? next.r + half + edge : 0;
    const inwardRoom = Math.max(0, rBandIn - innerLimit);
    // A chip needs a chip's room, and fades in over the next chip's.
    const chipsOn = clamp01((outwardRoom - gap - chip / 2) / chip);
    const stacks = Math.min(
      maxStack,
      Math.max(0, Math.floor((outwardRoom - gap - chip) / step) + 1),
    );
    const stackDepth = stacks ? gap + chip + (stacks - 1) * step : 0;
    const lanes = Math.min(
      MAX_LANES,
      Math.max(0, Math.floor((inwardRoom - gap) / lane)),
    );
    const detail = r >= (rO / RATIO) * 0.8;
    const rCard = (column: number) => rBandOut + gap + chip / 2 + column * step;
    const rLane0 = rBandIn - gap - lane / 2;
    const ring: FlowRing = {
      level,
      name,
      r,
      half,
      opacity,
      focus,
      period,
      sectors: [],
      ticks: [],
      sky: [],
      cards: [],
      marks: [],
      spans: [],
      now: nowMs >= period.from && nowMs < period.to ? frac(nowMs) : null,
      rIn: rBandIn - (lanes ? gap + lanes * lane : 0),
      rOut: rBandOut + stackDepth,
    };
    outwardLimit = ring.rIn - edge;

    const labelAt = (f: number, rr: number) => {
      const [lx, ly] = pt(f, rr);
      return { lx, ly };
    };
    const skyAt = (kind: SkyKind, t: number, extra: Partial<FlowSky> = {}) => {
      if (t < period.from || t >= period.to) return;
      const f = frac(t);
      // Against the band's inner edge, clear of the labels in its middle.
      const [x, y] = pt(f, rBandIn + 4.5 * S);
      ring.sky.push({
        key: `${kind}${t}`,
        kind,
        x,
        y,
        f,
        date: new Date(t),
        ...extra,
      });
    };

    // ── Sectors and ticks per level
    if (level === 0) {
      for (const l of ctx.lunations) {
        const a = Math.max(l.from, period.from);
        const b = Math.min(l.to + 1, period.to);
        if (b <= a) continue;
        const f0 = frac(a);
        const f1 = frac(b);
        ring.sectors.push({
          key: `L${l.index}`,
          d: sector(f0, f1, rBandIn, rBandOut),
          alt: l.index % 2 === 1,
          label: (f1 - f0) * TAU * r > 30 * S ? String(l.index) : undefined,
          f: (f0 + f1) / 2,
          ...labelAt((f0 + f1) / 2, r),
        });
      }
      for (const sun of ctx.solar)
        skyAt("solar", sun.date.getTime(), { labelKey: sun.key });
      for (const l of ctx.lunations) {
        skyAt("new", l.from);
        const q = ctx.quarters.get(l.index);
        if (q) skyAt("full", q.full);
      }
    } else if (level === 1) {
      const l = ctx.lunationOf(cam.t0);
      const b = quadrantBounds(l, ctx);
      for (let k = 0; k < 4; k++)
        ring.sectors.push({
          key: `Q${k}`,
          d: sector(frac(b[k]), frac(b[k + 1]), rBandIn, rBandOut),
          alt: k % 2 === 1,
          f: (frac(b[k]) + frac(b[k + 1])) / 2,
          ...labelAt((frac(b[k]) + frac(b[k + 1])) / 2, r),
        });
      const dayArc = (DAY_MS / (period.to - period.from)) * TAU * r;
      for (
        let day = nextDay(startOfDay(period.from));
        day < period.to;
        day = nextDay(day)
      ) {
        const f = frac(day);
        const [x1, y1] = pt(f, rBandIn);
        const [x2, y2] = pt(f, rBandOut);
        const mid = frac(Math.min(day + 12 * HOUR_MS, period.to));
        ring.ticks.push({
          key: `D${day}`,
          x1,
          y1,
          x2,
          y2,
          label: dayArc > 16 * S ? String(new Date(day).getDate()) : undefined,
          f: mid,
          ...labelAt(mid, r),
        });
      }
      skyAt("new", l.from);
      const q = ctx.quarters.get(l.index);
      if (q) {
        skyAt("quarter", q.first);
        skyAt("full", q.full);
        skyAt("quarter", q.last);
      }
    } else if (level === 2) {
      let i = 0;
      for (
        let day = startOfDay(period.from);
        day < period.to;
        day = nextDay(day), i++
      ) {
        const a = Math.max(day, period.from);
        const b = Math.min(nextDay(day), period.to);
        const f0 = frac(a);
        const f1 = frac(b);
        const date = new Date(day);
        const wd = weekdays?.[date.getDay()] ?? "";
        const room = (f1 - f0) * TAU * r;
        ring.sectors.push({
          key: `W${day}`,
          d: sector(f0, f1, rBandIn, rBandOut),
          alt: i % 2 === 1,
          label:
            room > 48 * S
              ? `${wd} ${date.getDate()}`.trim()
              : room > 18 * S
                ? String(date.getDate())
                : undefined,
          f: (f0 + f1) / 2,
          ...labelAt((f0 + f1) / 2, r),
        });
      }
    } else {
      for (let k = 0; k < 4; k++) {
        const f0 = k / 4;
        const f1 = (k + 1) / 4;
        ring.sectors.push({
          key: `H${k}`,
          d: sector(f0, f1, rBandIn, rBandOut),
          alt: k % 2 === 1,
          f: (f0 + f1) / 2,
          ...labelAt((f0 + f1) / 2, r),
        });
      }
      const hourArc = (TAU * r) / 24;
      const every = hourArc > 16 * S ? 1 : hourArc > 8 * S ? 2 : 6;
      for (let h = 0; h < 24; h++) {
        const t = period.from + h * HOUR_MS;
        if (t >= period.to) break;
        const f = frac(t);
        const [x1, y1] = pt(f, rBandIn);
        const [x2, y2] = pt(f, rBandOut);
        const date = new Date(t);
        ring.ticks.push({
          key: `h${h}`,
          x1,
          y1,
          x2,
          y2,
          label:
            h % every === 0
              ? String(date.getHours()).padStart(2, "0")
              : undefined,
          f,
          ...labelAt(f, r),
        });
      }
    }
    if (!detail) {
      for (const sc of ring.sectors) sc.label = undefined;
      for (const tk of ring.ticks) tk.label = undefined;
      ring.sky = [];
      rings.push(ring);
      continue;
    }

    // ── Cards: the dial's small chips. A day's cards stack along its
    // radius at the day's noon (an hour's, on the clock), a straight spoke
    // of squares outward from the band, where they have room to grow.
    const inPeriod = events.filter((ev) => {
      const a = ev.date.getTime();
      if (isNaN(a)) return false;
      if (ev.multiDay)
        return a < period.to && (ev.end ?? ev.date).getTime() >= period.from;
      return a >= period.from && a < period.to;
    });
    const singles = inPeriod
      .filter((ev) => !ev.multiDay)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    const unit = level === 3 ? HOUR_MS : DAY_MS;
    const groupStart = (t: number) =>
      level === 3 ? Math.floor(t / HOUR_MS) * HOUR_MS : startOfDay(t);
    const groups = new Map<number, CalendarEvent[]>();
    for (const ev of singles) {
      const g = groupStart(ev.date.getTime());
      (groups.get(g) ?? groups.set(g, []).get(g)!).push(ev);
    }
    const midOf = (g: number) => Math.min(g + unit / 2, period.to - 1);
    const dropped = new Map<number, number>();
    for (const [g, items] of groups) {
      const f = frac(midOf(g));
      items.forEach((ev, i) => {
        if (i >= stacks || chipsOn <= 0.001) {
          dropped.set(g, (dropped.get(g) ?? 0) + 1);
          return;
        }
        const [x, y] = pt(f, rCard(i));
        ring.cards.push({
          key: `${ev.id}@${ev.date.getTime()}`,
          ev,
          x,
          y,
          rot: f * 360,
          size: chip,
          f,
          col: i,
          opacity: chipsOn,
        });
      });
    }
    // What had no room: a mark per day, sized by its count, hugging the
    // band's inner edge — clear of the labels that sit in its middle.
    for (const [g, n] of dropped) {
      const f = frac(midOf(g));
      const mr = Math.min(3 * S, (2 + 1.1 * Math.sqrt(n)) * S);
      const [x, y] = pt(f, rBandIn + 1.5 * S + mr);
      ring.marks.push({
        key: `m${g}`,
        x,
        y,
        r: mr,
        label: chipsOn > 0.5 ? `+${n}` : undefined,
        opacity: 1,
        day: new Date(g),
      });
    }
    // Spans: what lasts days, on lanes inside the stacks.
    const multi = inPeriod
      .filter((ev) => ev.multiDay)
      .sort(
        (a, b) =>
          a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id),
      );
    const laneEnds: number[] = [];
    for (const ev of multi) {
      const start = ev.date.getTime();
      const endEx = nextDay(startOfDay((ev.end ?? ev.date).getTime()));
      let laneNo = laneEnds.findIndex((e) => e <= start);
      if (laneNo === -1) {
        laneNo = laneEnds.length;
        laneEnds.push(endEx);
      } else laneEnds[laneNo] = endEx;
      if (laneNo >= lanes) continue;
      ring.spans.push({
        key: `${ev.id}@${start}`,
        ev,
        d: arc(
          frac(Math.max(start, period.from)),
          frac(Math.min(endEx, period.to)),
          rLane0 - laneNo * lane,
        ),
      });
    }
    rings.push(ring);
  }

  const l = ctx.lunationOf(cam.t0);
  const b = quadrantBounds(l, ctx);
  let quadrant = 3;
  for (let k = 0; k < 4; k++)
    if (cam.t0 >= b[k] && cam.t0 < b[k + 1]) quadrant = k;
  const innermost = rings[rings.length - 1];
  return {
    cam,
    weights: w,
    level: levelOf(cam.z),
    depth: d,
    rings,
    rO,
    centreRoom: innermost ? innermost.rIn - edge : SIZE / 2,
    readout: {
      year: new Date(cam.t0).getFullYear(),
      lunation: l,
      quadrant,
      date: new Date(cam.t0),
    },
    unitsPerPx: S,
  };
}
