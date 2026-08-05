// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Hexagon geometry from the WeQuest design doc: pointy-top hex polygons laid
// out on an offset grid, with a deterministic noise value per cell that
// drives the demand-heat fill.

export const HEX_R = 30;

/** Pointy-top hexagon vertices around the origin, as an SVG points string. */
export function hexPts(r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 90);
    return (r * Math.cos(a)).toFixed(1) + "," + (r * Math.sin(a)).toFixed(1);
  }).join(" ");
}

/** Translate an SVG points string by (dx, dy). */
export function shiftPts(pts: string, dx: number, dy: number): string {
  return pts
    .split(" ")
    .map((p) => {
      const [x, y] = p.split(",").map(Number);
      return (x + dx).toFixed(1) + "," + (y + dy).toFixed(1);
    })
    .join(" ");
}

export interface GridHex {
  x: number;
  y: number;
  /** Deterministic pseudo-noise in [0, 1) — drives the heat level. */
  n: number;
  pts: string;
  col: number;
  row: number;
}

/**
 * Fill a w×h viewport with an offset hex grid of radius r. `seedShift`
 * varies the noise field between screens without RNG, so a given grid is
 * stable across renders.
 */
export function buildGrid(
  w: number,
  h: number,
  r: number,
  seedShift: number,
): GridHex[] {
  const pts = hexPts(r);
  const dx = Math.sqrt(3) * r;
  const dy = 1.5 * r;
  const out: GridHex[] = [];
  for (let row = -1; row * dy < h + r; row++) {
    for (let col = -1; col * dx < w + dx; col++) {
      const x = col * dx + (row % 2 ? dx / 2 : 0);
      const y = row * dy + r;
      const n =
        Math.abs(
          Math.sin((col + seedShift) * 12.9898 + row * 78.233) * 43758.5453,
        ) % 1;
      out.push({ x, y, n, pts: shiftPts(pts, x, y), col, row });
    }
  }
  return out;
}

/** Demand-heat fills, quiet → loud. */
export const HEAT = [
  "rgba(245,234,216,0.06)",
  "rgba(174,191,146,0.28)",
  "rgba(246,160,107,0.35)",
  "rgba(214,127,72,0.62)",
  "rgba(178,98,45,0.9)",
] as const;
