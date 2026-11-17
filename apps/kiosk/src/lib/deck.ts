// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pure logic for the Tasks "Choose" deck (ChooseDeck.svelte): the gesture —
// where a drag points, how far along it is, whether letting go commits it —
// the 3D poses of the stack and of each answered card's flight, how cards are
// dealt in small circles, and each person's frozen deck per hub. No Svelte, no
// Holosphere — ChooseDeck renders these, membership.ts writes the outcome.

import type { BacklogTask } from "./data";

/** Where a committed swipe went: left = skip, right = join, up = like. */
export type SwipeDirection = "left" | "right" | "up";

// ── The gesture ─────────────────────────────────────────────────────────────

/** Fraction of the card's width a drag has to travel to commit. */
export const THRESHOLD = 0.3;
/** A flick this fast (px/ms) commits even when short… */
export const FLICK = 0.6;
/** …once it has moved at least this far (px). */
export const FLICK_MIN = 24;
/** Less movement than this (px) is a tap. */
export const TAP_SLOP = 8;

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/**
 * Which answer a drag points at, or null (down, or nowhere yet). Up wins a
 * diagonal only while the lift clearly dominates, so a flick to a corner
 * still reads as left/right; a downward drag never answers.
 */
export function intentOf(dx: number, dy: number): SwipeDirection | null {
  const ax = Math.abs(dx);
  const lift = -dy;
  if (lift > 0 && lift > ax * 1.1) return lift >= TAP_SLOP ? "up" : null;
  if (ax < TAP_SLOP || ax < Math.abs(dy) * 0.6) return null;
  return dx > 0 ? "right" : "left";
}

export interface Drag {
  /** Displacement from the press, px. */
  dx: number;
  dy: number;
  /** Release velocity, px/ms (0 for a held release). */
  vx: number;
  vy: number;
  /** The card's width, px. */
  width: number;
}

/** 0..1: how close the drag is to committing (1 = past the threshold). */
export function progress(d: Pick<Drag, "dx" | "dy" | "width">): number {
  const intent = intentOf(d.dx, d.dy);
  if (!intent) return 0;
  const along = intent === "up" ? -d.dy : Math.abs(d.dx);
  return clamp(along / (THRESHOLD * Math.max(1, d.width)), 0, 1);
}

/** The answer a release commits — by distance or by a flick — or null to spring back. */
export function decide(d: Drag): SwipeDirection | null {
  const intent = intentOf(d.dx, d.dy);
  if (!intent) return null;
  if (progress(d) >= 1) return intent;
  if (intent === "up")
    return -d.vy >= FLICK && -d.dy >= FLICK_MIN ? intent : null;
  const v = intent === "right" ? d.vx : -d.vx;
  return v >= FLICK && Math.abs(d.dx) >= FLICK_MIN ? intent : null;
}

/** A press that barely moved. */
export function isTap(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) < TAP_SLOP;
}

// ── 3D: the stack, the tilt, the throws ─────────────────────────────────────
// Units: px and degrees. The stage has a CSS perspective, so z < 0 is further
// away.

export interface Pose {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  s: number;
  o: number;
}

export function poseCss(p: Pose): string {
  return (
    `translate3d(${r1(p.x)}px, ${r1(p.y)}px, ${r1(p.z)}px) ` +
    `rotateX(${r1(p.rx)}deg) rotateY(${r1(p.ry)}deg) rotateZ(${r1(p.rz)}deg) scale(${r3(p.s)})`
  );
}
// `+ 0` folds -0 into 0, so a pose at rest prints cleanly.
const r1 = (n: number) => Math.round(n * 10) / 10 + 0;
const r3 = (n: number) => Math.round(n * 1000) / 1000 + 0;

/** Depth between two cards of the stack, px. */
export const STACK_GAP = 44;

/**
 * Card `i` of the stack (0 = top) while the top is dragged `p` (0..1) of the
 * way to committing: the cards behind fan up and back into depth, and rise a
 * step forward as the top one leaves.
 */
export function stackPose(i: number, p = 0): Pose {
  const d = Math.max(0, i - clamp(p, 0, 1));
  return {
    x: 0,
    y: d ? -d * 26 : 0,
    z: d ? -d * STACK_GAP : 0,
    rx: d * 4,
    ry: 0,
    rz: 0,
    s: 1 - d * 0.035,
    o: 1,
  };
}

/** The top card under the finger: it leans toward where it is pulled. */
export function dragPose(dx: number, dy: number, width: number): Pose {
  const w = Math.max(1, width);
  return {
    x: dx,
    y: dy,
    z: Math.min(40, Math.hypot(dx, dy) * 0.12),
    rx: clamp((-dy / w) * 22, -14, 14),
    ry: clamp((dx / w) * 26, -16, 16),
    rz: clamp(dx * 0.05, -14, 14),
    s: 1,
    o: 1,
  };
}

export interface Keyframe extends Pose {
  /** 0..1 */
  offset: number;
}

export interface ThrowOpts {
  /** Where the drag let go (0,0 for a button press). */
  dx: number;
  dy: number;
  /** Release velocity, px/ms. */
  vx: number;
  vy: number;
  /** The card's box, px. */
  width: number;
  height: number;
  /** For a join: its star in the progress sky, relative to the card's centre. */
  target?: { x: number; y: number };
}

/**
 * The flight of an answered card, as keyframes from where the finger left
 * it. Join — it carries its momentum, then swings up into its star and
 * shrinks to a point of light. Like — it lifts straight up, glowing, and
 * fades. Skip — it turns edge-on and passes sideways, out of the circle.
 */
export function throwPath(dir: SwipeDirection, o: ThrowOpts): Keyframe[] {
  const start = { ...dragPose(o.dx, o.dy, o.width), offset: 0 };
  const vx = clamp(o.vx, -3, 3);
  const vy = clamp(o.vy, -3, 3);
  // Where the release velocity carries it in ~90 ms.
  const carry = { x: o.dx + vx * 90, y: o.dy + vy * 90 };
  if (dir === "right") {
    const t = o.target ?? { x: 0, y: -o.height * 1.4 };
    return [
      start,
      {
        ...start,
        x: carry.x + o.width * 0.18,
        y: Math.min(carry.y, o.dy) - o.height * 0.08,
        z: 80,
        rz: start.rz + 6,
        ry: 18,
        rx: 10,
        s: 1.04,
        offset: 0.22,
      },
      {
        x: (carry.x + t.x) * 0.5 + o.width * 0.12,
        y: t.y * 0.55,
        z: -120,
        rx: 40,
        ry: 10,
        rz: 14,
        s: 0.45,
        o: 1,
        offset: 0.62,
      },
      {
        x: t.x,
        y: t.y,
        z: -260,
        rx: 60,
        ry: 0,
        rz: 30,
        s: 0.04,
        o: 0,
        offset: 1,
      },
    ];
  }
  if (dir === "up") {
    return [
      start,
      {
        ...start,
        x: carry.x * 0.5,
        y: Math.min(carry.y, o.dy) - o.height * 0.12,
        z: 60,
        rx: -8,
        s: 1.05,
        offset: 0.25,
      },
      {
        x: carry.x * 0.2,
        y: -o.height * 0.9,
        z: -60,
        rx: -16,
        ry: 0,
        rz: 0,
        s: 0.8,
        o: 0.7,
        offset: 0.65,
      },
      {
        x: 0,
        y: -o.height * 1.5,
        z: -200,
        rx: -20,
        ry: 0,
        rz: 0,
        s: 0.6,
        o: 0,
        offset: 1,
      },
    ];
  }
  // left: skip
  return [
    start,
    {
      ...start,
      x: Math.min(carry.x, o.dx) - o.width * 0.12,
      y: carry.y,
      z: 40,
      ry: -24,
      offset: 0.2,
    },
    {
      x: -o.width * 0.9,
      y: carry.y * 0.5 + o.height * 0.04,
      z: -160,
      rx: 4,
      ry: -62,
      rz: -6,
      s: 0.8,
      o: 0.9,
      offset: 0.58,
    },
    {
      x: -o.width * 1.9,
      y: o.height * 0.1,
      z: -380,
      rx: 6,
      ry: -82,
      rz: -8,
      s: 0.55,
      o: 0,
      offset: 1,
    },
  ];
}

/** How long a throw lasts, ms (faster when flung harder). */
export function throwMs(dir: SwipeDirection, vx = 0, vy = 0): number {
  const base = dir === "right" ? 820 : dir === "up" ? 700 : 640;
  const v = Math.hypot(vx, vy);
  return Math.round(clamp(base - v * 120, base * 0.7, base));
}

// ── Circles ─────────────────────────────────────────────────────────────────

/**
 * Cards per circle. The deck never deals the whole backlog at once — a
 * handful to answer, then an end that offers the next circle.
 */
export const CIRCLE = 7;

/**
 * The next circle: up to CIRCLE cards of the deck (already in dealing order)
 * that this session has not dealt yet.
 */
export function nextCircle<T extends { id: string }>(
  deck: readonly T[],
  seen: ReadonlySet<string>,
): T[] {
  return deck.filter((t) => !seen.has(t.id)).slice(0, CIRCLE);
}

/**
 * A circle's frozen cards with today's data: each one replaced by its live
 * version while the backlog still has it (nothing reshuffles under the
 * finger, but a card shows what changed — a new joiner, a heart).
 */
export function hydrate<T extends { id: string }>(
  snapshot: readonly T[],
  live: readonly T[],
): T[] {
  const byId = new Map(live.map((x) => [x.id, x]));
  return snapshot.map((x) => byId.get(x.id) ?? x);
}

/**
 * One person's progress through one hub's deck. A deck is personal: what
 * someone skipped, and the order their cards were dealt in, must never leak
 * to the next person at a shared screen, to another hub (quest ids are
 * Telegram message ids and collide across chats), or follow other people's
 * likes (the wall's "most loved" sort re-ranks live; a deck does not).
 */
export interface DeckState {
  /** Card ids this person has dealt with — skipped, joined, or liked. */
  dismissed: ReadonlySet<string>;
  /**
   * Every card id in the order it was first dealt. Frozen: later re-ranks of
   * the backlog don't move a card, new cards join at the back, and an id that
   * is momentarily absent (search filter, a live update in flight) keeps its
   * place for when it returns.
   */
  order: readonly string[];
}

export const EMPTY_DECK: DeckState = { dismissed: new Set(), order: [] };

/** Deck owner when nobody is logged in (skipping needs no login). */
const ANON = "anon";

/** Joins hub and person in a deck key; a space never occurs in either id. */
const SEP = " ";

/** The key a deck is kept under: one per hub, per person (or the anonymous visitor). */
export function deckKey(
  holon: string | null | undefined,
  uid: string | number | null | undefined,
): string {
  return `${holon ?? ""}${SEP}${uid ?? ANON}`;
}

/** Whether `key` belongs to `uid` (null = the anonymous visitor). */
function ownedBy(
  key: string,
  uid: string | number | null | undefined,
): boolean {
  return key.slice(key.indexOf(SEP) + 1) === String(uid ?? ANON);
}

/**
 * The decks that survive a change of who is at the screen: only the new
 * person's own. Logging out ends the previous person's session, so their
 * skipped cards return next time — and nobody inherits anybody's deck.
 */
export function decksFor<T>(
  all: ReadonlyMap<string, T>,
  uid: string | number | null | undefined,
): Map<string, T> {
  return new Map([...all].filter(([key]) => ownedBy(key, uid)));
}

/**
 * The frozen dealing order extended with any card not dealt yet. Returns
 * `prev` itself when nothing is new, so callers can skip a store write.
 */
export function dealOrder(
  prev: readonly string[],
  tasks: readonly BacklogTask[],
): readonly string[] {
  const seen = new Set(prev);
  const added = tasks.map((t) => t.id).filter((id) => !seen.has(id));
  return added.length ? [...prev, ...added] : prev;
}

/**
 * The deck in dealing order: the (already search-filtered) backlog in this
 * person's frozen `order`, minus the cards they have dealt with, and minus
 * tasks still blocked by open dependencies — the deck is "where should focus
 * go now", so it deals only the graph's current leaves. Tasks the user
 * already joined stay in — they show a JOINED ribbon and a right-swipe is a
 * no-op. A card not in `order` yet is dealt last, in backlog order.
 */
export function deckTasks(
  tasks: BacklogTask[],
  dismissed: ReadonlySet<string>,
  order: readonly string[] = [],
): BacklogTask[] {
  const open = tasks.filter((t) => t.unmetDeps === 0 && !dismissed.has(t.id));
  if (!order.length) return open;
  const rank = new Map(order.map((id, i) => [id, i] as const));
  const at = (t: BacklogTask) => rank.get(t.id) ?? Number.MAX_SAFE_INTEGER;
  // Array.prototype.sort is stable, so undealt cards keep their backlog order.
  return [...open].sort((a, b) => at(a) - at(b));
}
