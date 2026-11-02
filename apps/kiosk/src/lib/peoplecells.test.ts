// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { convexHull, membrane, traceLoop } from "./peoplecells";

type V = { x: number; y: number };
const area = (loop: V[]) =>
  loop.reduce((s, p, i) => {
    const q = loop[(i + 1) % loop.length];
    return s + (p.x * q.y - q.x * p.y);
  }, 0) / 2;
/** Is `p` inside the closed loop (ray casting)? */
const inside = (loop: V[], p: V) => {
  let hit = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i];
    const b = loop[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      hit = !hit;
  }
  return hit;
};

describe("convexHull", () => {
  it("keeps the corners, drops what is inside, runs counter-clockwise", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 },
      { x: 5, y: 0 }, // on a side
    ]);
    expect(hull).toHaveLength(4);
    expect(area(hull)).toBeGreaterThan(0);
  });
});

describe("membrane", () => {
  it("is nothing round nobody, and a disc round one", () => {
    expect(membrane([], 10)).toEqual([]);
    const disc = membrane([{ x: 50, y: 50 }], 10);
    for (const p of disc)
      expect(Math.hypot(p.x - 50, p.y - 50)).toBeCloseTo(10);
  });

  it("is one loop round everyone, a reach clear of each", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 200, y: 20 },
      { x: 90, y: 150 },
      { x: 60, y: 40 }, // inside
      { x: 400, y: 0 }, // far off: still the same one cell
    ];
    const loop = membrane(pts, 30);
    expect(area(loop)).toBeGreaterThan(0);
    for (const p of pts) expect(inside(loop, p)).toBe(true);
    // Every point of the membrane is a reach from the nearest member or
    // more — no member pokes through it.
    for (const q of loop) {
      const d = Math.min(...pts.map((p) => Math.hypot(p.x - q.x, p.y - q.y)));
      expect(d).toBeGreaterThan(30 - 1e-6);
    }
  });

  it("is a capsule round two", () => {
    const loop = membrane(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      10,
    );
    const ys = loop.map((p) => p.y);
    expect(Math.max(...ys)).toBeCloseTo(10);
    expect(Math.min(...ys)).toBeCloseTo(-10);
    expect(Math.min(...loop.map((p) => p.x))).toBeCloseTo(-10, 0); // sampled arc
    expect(Math.max(...loop.map((p) => p.x))).toBeCloseTo(110, 0);
  });
});

describe("traceLoop", () => {
  it("draws one closed path", () => {
    const calls: string[] = [];
    traceLoop(
      {
        moveTo: () => calls.push("move"),
        lineTo: () => calls.push("line"),
        closePath: () => calls.push("close"),
      },
      membrane([{ x: 0, y: 0 }], 10),
    );
    expect(calls[0]).toBe("move");
    expect(calls.at(-1)).toBe("close");
    expect(calls.filter((c) => c === "move")).toHaveLength(1);
  });
});
