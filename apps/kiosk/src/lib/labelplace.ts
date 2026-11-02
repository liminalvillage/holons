// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Where the People view's hub names go, so no two cover each other. Each
// name comes with the spots it could take round its cell, best first (over
// the top of the cell, then beside, below, further up); the names are laid
// down one at a time, most important first, each on the first spot that
// clashes with none laid before it and stays in the pane. A name keeps the
// spot it had while that spot is still free, so the names do not hop about
// as the field moves under them. The people are in the way too: a name
// would rather not sit on anyone's face. When every spot clashes, the one
// that covers least is taken.

import type { Vec } from "./dock";

/** A name to place: its size and its spots (centres), best first. */
export type LabelBox = { id: string; w: number; h: number; spots: Vec[] };

/** Where a name went: its centre, and which of its spots that was. */
export type Placed = { x: number; y: number; spot: number };

/** A box on screen, edges inclusive of nothing. */
export type Rect = { x0: number; y0: number; x1: number; y1: number };

export type PlaceOptions = {
  /** The pane the names must stay in. */
  bounds: { w: number; h: number };
  /** Where each name was last time (its spot index). */
  prev?: ReadonlyMap<string, number>;
  /** Air kept between two names, and from the pane's edge. */
  gap?: number;
  /** What else a name should not cover (the people). */
  obstacles?: readonly Rect[];
};

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Lay the names down in the order given (see `PlaceOptions`). */
export function placeLabels(
  labels: readonly LabelBox[],
  opts: PlaceOptions,
): Map<string, Placed> {
  const { bounds, prev = new Map(), gap = 4, obstacles = [] } = opts;
  const out = new Map<string, Placed>();
  const taken: Rect[] = [];
  for (const label of labels) {
    if (!label.spots.length) continue;
    const order = label.spots.map((_, i) => i);
    const was = prev.get(label.id);
    if (was != null && was < order.length) {
      order.splice(was, 1);
      order.unshift(was);
    }
    let best: { at: Placed; rect: Rect; cover: number } | null = null;
    for (const i of order) {
      const at = clampInto(label, label.spots[i], bounds, gap);
      const rect = rectOf(label, at, gap / 2);
      let cover = 0;
      for (const t of taken) cover += overlap(rect, t);
      for (const o of obstacles) cover += overlap(rect, o);
      if (!best || cover < best.cover)
        best = { at: { ...at, spot: i }, rect, cover };
      if (cover === 0) break;
    }
    if (!best) continue;
    taken.push(best.rect);
    out.set(label.id, best.at);
  }
  return out;
}

function clampInto(
  label: LabelBox,
  p: Vec,
  bounds: { w: number; h: number },
  gap: number,
): Vec {
  const hw = label.w / 2 + gap;
  const hh = label.h / 2 + gap;
  return {
    x: bounds.w > 2 * hw ? Math.min(bounds.w - hw, Math.max(hw, p.x)) : p.x,
    y: bounds.h > 2 * hh ? Math.min(bounds.h - hh, Math.max(hh, p.y)) : p.y,
  };
}

function rectOf(label: LabelBox, p: Vec, pad: number): Rect {
  return {
    x0: p.x - label.w / 2 - pad,
    y0: p.y - label.h / 2 - pad,
    x1: p.x + label.w / 2 + pad,
    y1: p.y + label.h / 2 + pad,
  };
}

/**
 * The spots round a cell for its name, best first: centred over the top,
 * over the top to either side, below (clear of the first names hung under
 * the orbs), to the left and right, and stacked further up.
 */
export function cellSpots(
  pts: readonly Vec[],
  reach: number,
  w: number,
  h: number,
  below = 0,
): Vec[] {
  if (!pts.length) return [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
    cx += p.x;
    cy += p.y;
  }
  cx /= pts.length;
  cy /= pts.length;
  const top = y0 - reach;
  const step = h + 6;
  return [
    { x: cx, y: top },
    { x: cx - w * 0.6, y: top },
    { x: cx + w * 0.6, y: top },
    { x: cx, y: y1 + reach + below + h / 2 },
    { x: x0 - reach - w / 2, y: cy },
    { x: x1 + reach + w / 2, y: cy },
    { x: cx, y: top - step },
    { x: cx - w * 0.6, y: top - step },
    { x: cx + w * 0.6, y: top - step },
    { x: cx, y: top - 2 * step },
  ];
}
