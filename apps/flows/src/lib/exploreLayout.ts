// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Where Explore puts one level of the fractal: the party in focus at the
// middle, what is under it on a golden-angle disc falling below, and a few
// of THEIR children in a smaller disc under each — so every level looks like
// the one above it. Only geometry: what a party is and how wide its pipe is
// are core's (`buildFractal`).

export interface ExploreItem {
  id: string;
  bandwidth: number;
  coverage: number;
  /** The share of money it gets, when it differs from the bandwidth: what its pipe is drawn by. */
  share?: number;
}

export interface ExploreSpot {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Sphere radius. */
  r: number;
  /** 0…1, the bandwidth against the widest on this level, eased (sizes). */
  weight: number;
  /**
   * 0…1, its money share against the largest here, in proportion: how thick
   * its pipe is drawn, so a 10% share reads twice as thick as a 5% one.
   */
  flow: number;
}

/** The most shown on one level; the card lists the rest. */
export const EXPLORE_MAX = 72;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** How far under the focus a level hangs. */
export const LEVEL_DROP = 2.4;

/** One level: who goes where, the widest pipe first and closest in. */
export function layoutLevel(
  items: readonly ExploreItem[],
  opts: {
    max?: number;
    spread?: number;
    drop?: number;
    r0?: number;
    r1?: number;
    /**
     * The bandwidth drawn full size. By default the widest here; fixed, a
     * level can be redrawn (a split being edited) and still be compared
     * with how it was.
     */
    widest?: number;
  } = {},
): ExploreSpot[] {
  const max = opts.max ?? EXPLORE_MAX;
  const shown = items.slice(0, max);
  const n = shown.length;
  // A crowded level spreads wider and its spheres get smaller.
  const crowd = Math.max(1, Math.sqrt(n / 16));
  const spread = opts.spread ?? 4.6 * Math.min(2.2, crowd);
  const drop = opts.drop ?? LEVEL_DROP;
  const r0 = opts.r0 ?? 0.14;
  const r1 = opts.r1 ?? 0.6 / Math.min(1.8, crowd);
  const shareOf = (c: ExploreItem) => Math.max(0, c.share ?? c.bandwidth);
  const largest = opts.widest ?? Math.max(0, ...shown.map(shareOf));
  const widest = opts.widest ?? Math.max(0, ...shown.map((c) => c.bandwidth));
  return shown.map((c, i) => {
    // Nothing paid on this level (a quest's people): size by what is committed.
    const weight =
      widest > 0
        ? Math.sqrt(Math.max(0, c.bandwidth) / widest)
        : 0.35 + 0.4 * c.coverage;
    const flow =
      largest > 0 ? Math.min(1, shareOf(c) / largest) : 0.2 + 0.3 * c.coverage;
    const rho = n === 1 ? 0 : spread * (0.28 + 0.72 * Math.sqrt((i + 0.5) / n));
    const a = i * GOLDEN;
    return {
      id: c.id,
      x: rho * Math.cos(a),
      // The outer ring hangs a little lower: the level reads as a bowl.
      y: -drop - 0.08 * rho * rho * 0.25,
      z: rho * Math.sin(a),
      r: r0 + (r1 - r0) * Math.min(1, weight),
      weight: Math.min(1, weight),
      flow,
    };
  });
}
