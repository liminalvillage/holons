// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// What a finger meant. A bar a few pixels tall cannot be the size of a
// fingertip, and widening every shape's own hit area makes them overlap and
// lets the last one drawn win. So a tap is resolved here instead, against the
// layout's own numbers: a bar wins when the tap lands in its box grown to a
// fingertip, the nearest one when two such boxes meet; failing that the
// nearest ribbon within reach of its band. Pure.

import type {
  SankeyLayout,
  SankeyLayoutLink,
  SankeyLayoutNode,
} from "@holons/core/flows";

export type SankeyHit =
  | { type: "node"; node: SankeyLayoutNode }
  | { type: "link"; link: SankeyLayoutLink };

export interface HitOptions {
  /** The drawing's size in px: the layout is normalized to 0..1. */
  w: number;
  h: number;
  /** The least a target measures, in px. Default 44. */
  min?: number;
}

/** The eight corner and control coordinates of a ribbon path, as core writes it. */
function ribbonOf(path: string): number[] | null {
  const n = path.match(/-?\d*\.?\d+(?:e-?\d+)?/gi)?.map(Number);
  return n && n.length >= 16 && n.every(Number.isFinite) ? n : null;
}

const cubic = (a: number, b: number, c: number, d: number, t: number) => {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
};

/** The top and bottom of a ribbon at horizontal position `x` (normalized), or null outside it. */
export function ribbonBandAt(
  path: string,
  x: number,
): { top: number; bottom: number } | null {
  const n = ribbonOf(path);
  if (!n) return null;
  // M x0,y0t C xm,y0t xm,y1t x1,y1t L x1,y1b C xm,y1b xm,y0b x0,y0b Z
  const [x0, y0t, xm, , , y1t, x1, , , y1b, , , , y0b] = n;
  if (!(x1 > x0) || x < x0 || x > x1) return null;
  // x(t) is monotone between the two bars: find t by bisection.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (cubic(x0, xm, xm, x1, mid) < x) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  return {
    top: cubic(y0t, y0t, y1t, y1t, t),
    bottom: cubic(y0b, y0b, y1b, y1b, t),
  };
}

/** The bar or ribbon a tap at (`x`, `y`) px means, or null for bare paper. */
export function sankeyHit(
  layout: SankeyLayout | null | undefined,
  x: number,
  y: number,
  opts: HitOptions,
): SankeyHit | null {
  if (!layout || layout.empty || !(opts.w > 0) || !(opts.h > 0)) return null;
  const min = opts.min ?? 44;

  let best: SankeyLayoutNode | null = null;
  let bestDistance = Infinity;
  for (const node of layout.nodes) {
    const cx = (node.x + node.w / 2) * opts.w;
    const cy = (node.y + node.h / 2) * opts.h;
    const halfW = Math.max(node.w * opts.w, min) / 2;
    const halfH = Math.max(node.h * opts.h, min) / 2;
    if (Math.abs(x - cx) > halfW || Math.abs(y - cy) > halfH) continue;
    // Two grown boxes over one point: the bar whose own edge is nearer.
    const distance = Math.max(0, Math.abs(y - cy) - (node.h * opts.h) / 2);
    if (
      distance < bestDistance ||
      (distance === bestDistance && best != null && node.id < best.id)
    ) {
      best = node;
      bestDistance = distance;
    }
  }
  if (best) return { type: "node", node: best };

  let link: SankeyLayoutLink | null = null;
  let reach = min / 2;
  let thickest = -1;
  for (const candidate of layout.links) {
    const band = ribbonBandAt(candidate.path, x / opts.w);
    if (!band) continue;
    const top = band.top * opts.h;
    const bottom = band.bottom * opts.h;
    const distance = y < top ? top - y : y > bottom ? y - bottom : 0;
    const thickness = bottom - top;
    // Inside two ribbons at once is not possible; near two, the nearer one,
    // then the one that carries more.
    if (
      distance < reach ||
      (distance === reach && link != null && thickness > thickest)
    ) {
      link = candidate;
      reach = distance;
      thickest = thickness;
    }
  }
  return link ? { type: "link", link } : null;
}
