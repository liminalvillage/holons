// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { buildGrid, hexPts, shiftPts, HEAT } from "./hex";

describe("hex geometry", () => {
  it("hexPts produces six pointy-top vertices, first at the top", () => {
    const pts = hexPts(30).split(" ");
    expect(pts).toHaveLength(6);
    expect(pts[0]).toBe("0.0,-30.0");
  });

  it("shiftPts translates every vertex", () => {
    expect(shiftPts("0.0,-30.0 10.0,5.0", 100, 50)).toBe(
      "100.0,20.0 110.0,55.0",
    );
  });

  it("buildGrid covers the viewport, offsets odd rows, and is deterministic", () => {
    const a = buildGrid(358, 330, 30, 1);
    const b = buildGrid(358, 330, 30, 1);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
    for (const h of a) {
      expect(h.n).toBeGreaterThanOrEqual(0);
      expect(h.n).toBeLessThan(1);
    }
    const odd = a.find((h) => h.row === 1 && h.col === 0);
    const even = a.find((h) => h.row === 0 && h.col === 0);
    expect(odd && even && odd.x - even.x).toBeCloseTo(
      (Math.sqrt(3) * 30) / 2,
      5,
    );
  });

  it("a different seed changes the noise field", () => {
    const a = buildGrid(100, 100, 30, 1).map((h) => h.n);
    const b = buildGrid(100, 100, 30, 3).map((h) => h.n);
    expect(a).not.toEqual(b);
  });

  it("HEAT has five levels", () => {
    expect(HEAT).toHaveLength(5);
  });
});
