// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The People view's territories as cells: a hub's ground is the outline of
// its members melted together, worked out as numbers and drawn as plain
// paths on one canvas (components/PeopleView). It used to be painted by SVG
// filters — blur, morphology, turbulence — re-run over the whole pane every
// frame for every hub, which is what brought the machine to a halt.
//
// The method: every member (and every neck between neighbours) adds a soft
// bump to a coarse grid — a kernel with a hard edge, so a bump touches only
// the cells around it — and the ground is where the sum crosses a level,
// traced with marching squares and stitched into closed loops. Bumps close
// enough run together the way drops do; a second, higher level traced on
// the same grid is a line just inside the first, the membrane's inner leaf.

import type { Vec } from "./dock";

/** The level the membrane is traced at. */
export const MEMBRANE = 0.3;
/** The inner leaf: a little higher, so a little inside. */
export const INNER_LEAF = 0.42;
/** A neck's bump against a member's: thinner, so it reads as a bridge. */
const NECK = 0.55;

/** A sampled field: `v[row * cols + col]` at `(x0 + col·step, y0 + row·step)`. */
export type BlobField = {
  x0: number;
  y0: number;
  step: number;
  cols: number;
  rows: number;
  v: Float32Array;
};

/** The kernel's own radius for an outline `reach` from a lone member. */
function spreadFor(reach: number): number {
  // (1 − d²/R²)² = MEMBRANE at d = reach.
  return reach / Math.sqrt(1 - Math.sqrt(MEMBRANE));
}

/**
 * The field of one hub's ground: a bump per member that crosses the
 * membrane level `reach` from them, and a thinner one along each neck.
 * The grid covers them all with a border of empty cells, so every outline
 * traced on it is closed.
 */
export function blobField(
  pts: readonly Vec[],
  necks: readonly (readonly [Vec, Vec])[],
  reach: number,
  step: number,
): BlobField {
  const R = spreadFor(reach);
  const Rn = R * NECK;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  if (!pts.length)
    return { x0: 0, y0: 0, step, cols: 0, rows: 0, v: new Float32Array(0) };
  const pad = R + 2 * step;
  x0 -= pad;
  y0 -= pad;
  const cols = Math.ceil((x1 + pad - x0) / step) + 1;
  const rows = Math.ceil((y1 + pad - y0) / step) + 1;
  const v = new Float32Array(cols * rows);
  const R2 = R * R;
  for (const p of pts) {
    const c0 = Math.max(0, Math.floor((p.x - R - x0) / step));
    const c1 = Math.min(cols - 1, Math.ceil((p.x + R - x0) / step));
    const r0 = Math.max(0, Math.floor((p.y - R - y0) / step));
    const r1 = Math.min(rows - 1, Math.ceil((p.y + R - y0) / step));
    for (let r = r0; r <= r1; r++) {
      const dy = y0 + r * step - p.y;
      for (let c = c0; c <= c1; c++) {
        const dx = x0 + c * step - p.x;
        const q = 1 - (dx * dx + dy * dy) / R2;
        if (q > 0) v[r * cols + c] += q * q;
      }
    }
  }
  const Rn2 = Rn * Rn;
  for (const [a, b] of necks) {
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len2 = ex * ex + ey * ey || 1;
    const c0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - Rn - x0) / step));
    const c1 = Math.min(
      cols - 1,
      Math.ceil((Math.max(a.x, b.x) + Rn - x0) / step),
    );
    const r0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - Rn - y0) / step));
    const r1 = Math.min(
      rows - 1,
      Math.ceil((Math.max(a.y, b.y) + Rn - y0) / step),
    );
    for (let r = r0; r <= r1; r++) {
      const py = y0 + r * step;
      for (let c = c0; c <= c1; c++) {
        const px = x0 + c * step;
        const t = Math.max(
          0,
          Math.min(1, ((px - a.x) * ex + (py - a.y) * ey) / len2),
        );
        const dx = px - (a.x + t * ex);
        const dy = py - (a.y + t * ey);
        const q = 1 - (dx * dx + dy * dy) / Rn2;
        if (q > 0) v[r * cols + c] += q * q;
      }
    }
  }
  return { x0, y0, step, cols, rows, v };
}

// Marching squares. Corners of a cell: 1 top-left, 2 top-right,
// 4 bottom-right, 8 bottom-left. Edges: 0 top, 1 right, 2 bottom, 3 left.
// Each case lists the edge pairs its segments join; the two saddles (5, 10)
// are settled by the cell's middle.
const SEGMENTS: number[][] = [
  [],
  [3, 0],
  [0, 1],
  [3, 1],
  [1, 2],
  [3, 0, 1, 2], // saddle, split
  [0, 2],
  [3, 2],
  [2, 3],
  [2, 0],
  [0, 1, 2, 3], // saddle, split
  [2, 1],
  [1, 3],
  [1, 0],
  [0, 3],
  [],
];

/**
 * The closed outlines where `f` crosses `iso`, as loops of points. A ring
 * of members round an empty middle gives two loops, the inner one a hole:
 * fill them even-odd.
 */
export function contours(f: BlobField, iso = MEMBRANE): Vec[][] {
  const { cols, rows, v, x0, y0, step } = f;
  if (cols < 2 || rows < 2) return [];
  // An edge's id: horizontal edges (c, r)→(c+1, r) are even, vertical
  // edges (c, r)→(c, r+1) odd.
  const hEdge = (c: number, r: number) => (r * cols + c) * 2;
  const vEdge = (c: number, r: number) => (r * cols + c) * 2 + 1;
  const at = new Map<number, Vec>();
  const cross = (a: number, b: number) => (iso - a) / (b - a || 1e-9);
  const point = (edge: number): Vec => {
    const hit = at.get(edge);
    if (hit) return hit;
    const cell = edge >> 1;
    const c = cell % cols;
    const r = (cell - c) / cols;
    const a = v[cell];
    let p: Vec;
    if (edge & 1) {
      const t = cross(a, v[cell + cols]);
      p = { x: x0 + c * step, y: y0 + (r + t) * step };
    } else {
      const t = cross(a, v[cell + 1]);
      p = { x: x0 + (c + t) * step, y: y0 + r * step };
    }
    at.set(edge, p);
    return p;
  };
  // Every edge an outline passes through, and the (at most two) others it
  // is joined to across the cells either side.
  const links = new Map<number, number[]>();
  const join = (a: number, b: number) => {
    const la = links.get(a);
    if (la) la.push(b);
    else links.set(a, [b]);
    const lb = links.get(b);
    if (lb) lb.push(a);
    else links.set(b, [a]);
  };
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const i = r * cols + c;
      const tl = v[i];
      const tr = v[i + 1];
      const br = v[i + cols + 1];
      const bl = v[i + cols];
      let k =
        (tl >= iso ? 1 : 0) |
        (tr >= iso ? 2 : 0) |
        (br >= iso ? 4 : 0) |
        (bl >= iso ? 8 : 0);
      if (k === 0 || k === 15) continue;
      const mid = (tl + tr + br + bl) / 4;
      // A saddle whose middle is in joins its corners the other way.
      if (k === 5 && mid >= iso) k = 10;
      else if (k === 10 && mid >= iso) k = 5;
      const edges = [
        hEdge(c, r),
        vEdge(c + 1, r),
        hEdge(c, r + 1),
        vEdge(c, r),
      ];
      const seg = SEGMENTS[k];
      for (let s = 0; s < seg.length; s += 2)
        join(edges[seg[s]], edges[seg[s + 1]]);
    }
  }
  const loops: Vec[][] = [];
  const done = new Set<number>();
  for (const start of links.keys()) {
    if (done.has(start)) continue;
    const loop: Vec[] = [];
    let prev = -1;
    let cur = start;
    while (!done.has(cur)) {
      done.add(cur);
      loop.push(point(cur));
      const next = links.get(cur)!.find((e) => e !== prev && !done.has(e));
      if (next == null) break;
      prev = cur;
      cur = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/**
 * Trace `loops` onto a canvas path, rounded: each corner is cut by a curve
 * through the midpoints of its sides, so the grid's facets never show.
 */
export function traceLoops(
  ctx: Pick<
    CanvasRenderingContext2D,
    "moveTo" | "quadraticCurveTo" | "closePath"
  >,
  loops: readonly Vec[][],
): void {
  for (const loop of loops) {
    const n = loop.length;
    const last = loop[n - 1];
    ctx.moveTo((last.x + loop[0].x) / 2, (last.y + loop[0].y) / 2);
    for (let i = 0; i < n; i++) {
      const p = loop[i];
      const q = loop[(i + 1) % n];
      ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
    }
    ctx.closePath();
  }
}
