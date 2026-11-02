// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The People view's territories as cells: a hub's ground is ONE membrane
// round all its members, the way a cell's membrane holds what is in it —
// the smallest convex outline that keeps every member a `reach` inside it
// (their convex hull, rounded out by that reach). Never in pieces, never
// pinched between members; a lone member's cell is a disc round them, two
// members' a capsule. Worked out as points and painted as a plain path on
// one canvas (components/PeopleView).

import type { Vec } from "./dock";

/** The convex hull of `pts`, counter-clockwise (positive signed area). */
export function convexHull(pts: readonly Vec[]): Vec[] {
  const sorted = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const uniq = sorted.filter(
    (p, i) => i === 0 || p.x !== sorted[i - 1].x || p.y !== sorted[i - 1].y,
  );
  if (uniq.length < 3) return uniq;
  const cross = (o: Vec, a: Vec, b: Vec) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec[] = [];
  for (const p of uniq) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    )
      lower.pop();
    lower.push(p);
  }
  const upper: Vec[] = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    )
      upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * The membrane round `pts`: their hull grown by `reach` — straight along
 * each side, a round arc at each corner — as a closed loop of points, an
 * arc sampled every `step` radians or finer.
 */
export function membrane(
  pts: readonly Vec[],
  reach: number,
  step = 0.25,
): Vec[] {
  const hull = convexHull(pts);
  const n = hull.length;
  if (n === 0) return [];
  const arc = (c: Vec, a0: number, a1: number, out: Vec[]) => {
    const k = Math.max(1, Math.ceil((a1 - a0) / step));
    for (let i = 0; i <= k; i++) {
      const a = a0 + ((a1 - a0) * i) / k;
      out.push({ x: c.x + Math.cos(a) * reach, y: c.y + Math.sin(a) * reach });
    }
  };
  const out: Vec[] = [];
  if (n === 1) {
    arc(hull[0], 0, 2 * Math.PI, out);
    out.pop(); // the loop closes itself
    return out;
  }
  // Each side's outward normal, as an angle. The hull runs with positive
  // area, so outward is the side's direction turned by −90°.
  const normal = (a: Vec, b: Vec) => Math.atan2(-(b.x - a.x), b.y - a.y);
  for (let i = 0; i < n; i++) {
    const prev = hull[(i - 1 + n) % n];
    const here = hull[i];
    const next = hull[(i + 1) % n];
    const a0 = normal(prev, here);
    let a1 = normal(here, next);
    while (a1 < a0) a1 += 2 * Math.PI;
    arc(here, a0, a1, out);
  }
  return out;
}

/** Trace a closed loop of points onto a canvas path. */
export function traceLoop(
  ctx: Pick<CanvasRenderingContext2D, "moveTo" | "lineTo" | "closePath">,
  loop: readonly Vec[],
): void {
  if (!loop.length) return;
  ctx.moveTo(loop[0].x, loop[0].y);
  for (let i = 1; i < loop.length; i++) ctx.lineTo(loop[i].x, loop[i].y);
  ctx.closePath();
}
