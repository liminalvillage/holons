// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A holon's mark: a small mirrored bitmap drawn from its id, the way every
// surface draws its colour from the same hash (`colorHash`). Two hubs whose
// names start alike — Liminal Village, Liminal grove, Lunation 83 — all wore
// the same letter; the mark tells them apart at a glance and never changes
// when a board is renamed, because it is the ID that seeds it.

import { colorHash } from "@holons/core/settings";

/** Grid side: 5 cells, mirrored left–right (3 free columns, 15 bits). */
export const IDENTICON_SIZE = 5;

/**
 * The lit cells of a seed's mark, row-major, each `[column, row]` in a
 * `IDENTICON_SIZE` grid. Deterministic, symmetric about the vertical axis,
 * and never empty or full (a blank or solid disc says nothing).
 */
export function identiconCells(seed: string): Array<[number, number]> {
  const n = IDENTICON_SIZE;
  const half = Math.ceil(n / 2);
  // mulberry32 over the shared hash: one 32-bit hash spread into as many
  // well-mixed bits as the grid needs, so near-identical ids diverge.
  let a = (colorHash(seed) ^ 0x9e3779b9) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const lit: boolean[][] = [];
  for (let row = 0; row < n; row++) {
    const r: boolean[] = new Array(n).fill(false);
    for (let col = 0; col < half; col++) {
      const on = next() < 0.5;
      r[col] = on;
      r[n - 1 - col] = on;
    }
    lit.push(r);
  }
  const cells: Array<[number, number]> = [];
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++) if (lit[row][col]) cells.push([col, row]);
  // A mark must be readable: fewer than 5 lit cells, light the centre column;
  // all 25, clear the four corners.
  if (cells.length < 5) {
    const mid = Math.floor(n / 2);
    for (let row = 0; row < n; row++)
      if (!lit[row][mid]) cells.push([mid, row]);
    cells.sort((p, q) => p[1] - q[1] || p[0] - q[0]);
  } else if (cells.length === n * n) {
    return cells.filter(
      ([c, r]) => !((c === 0 || c === n - 1) && (r === 0 || r === n - 1)),
    );
  }
  return cells;
}
