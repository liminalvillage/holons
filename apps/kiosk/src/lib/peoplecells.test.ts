// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { INNER_LEAF, blobField, contours, traceLoops } from "./peoplecells";

const centre = (loop: { x: number; y: number }[]) => ({
  x: loop.reduce((s, p) => s + p.x, 0) / loop.length,
  y: loop.reduce((s, p) => s + p.y, 0) / loop.length,
});

describe("peoplecells", () => {
  it("draws nothing for nobody", () => {
    expect(contours(blobField([], [], 20, 4))).toEqual([]);
  });

  it("rings a lone member at the reach asked for", () => {
    const loops = contours(blobField([{ x: 100, y: 50 }], [], 20, 2));
    expect(loops).toHaveLength(1);
    for (const p of loops[0])
      expect(Math.hypot(p.x - 100, p.y - 50)).toBeCloseTo(20, -0.5);
    const c = centre(loops[0]);
    expect(c.x).toBeCloseTo(100, 0);
    expect(c.y).toBeCloseTo(50, 0);
  });

  it("traces the inner leaf just inside the membrane", () => {
    const f = blobField([{ x: 0, y: 0 }], [], 20, 2);
    const [inner] = contours(f, INNER_LEAF);
    const d = Math.hypot(inner[0].x, inner[0].y);
    expect(d).toBeLessThan(20);
    expect(d).toBeGreaterThan(14);
  });

  it("keeps two far members apart, and a neck makes them one", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 200, y: 0 };
    expect(contours(blobField([a, b], [], 20, 4))).toHaveLength(2);
    expect(contours(blobField([a, b], [[a, b]], 20, 4))).toHaveLength(1);
  });

  it("melts two close members into one", () => {
    const loops = contours(
      blobField(
        [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
        ],
        [],
        20,
        3,
      ),
    );
    expect(loops).toHaveLength(1);
  });

  it("leaves a hole in a ring of members round an empty middle", () => {
    const ring = Array.from({ length: 24 }, (_, i) => ({
      x: Math.cos((i / 24) * 2 * Math.PI) * 150,
      y: Math.sin((i / 24) * 2 * Math.PI) * 150,
    }));
    expect(contours(blobField(ring, [], 25, 4))).toHaveLength(2);
  });

  it("traces each loop as one closed rounded path", () => {
    const calls: string[] = [];
    const ctx = {
      moveTo: () => calls.push("move"),
      quadraticCurveTo: () => calls.push("curve"),
      closePath: () => calls.push("close"),
    };
    const loops = contours(blobField([{ x: 0, y: 0 }], [], 20, 4));
    traceLoops(ctx, loops);
    expect(calls[0]).toBe("move");
    expect(calls.at(-1)).toBe("close");
    expect(calls.filter((c) => c === "curve")).toHaveLength(loops[0].length);
  });
});
