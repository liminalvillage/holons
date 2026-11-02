// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { cellSpots, placeLabels, type LabelBox } from "./labelplace";

const pane = { w: 1000, h: 800 };
const box = (id: string, spots: { x: number; y: number }[]): LabelBox => ({
  id,
  w: 100,
  h: 24,
  spots,
});
const clash = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < 100 && Math.abs(a.y - b.y) < 24;

describe("placeLabels", () => {
  it("gives the first its best spot, and moves the next off it", () => {
    const spots = [
      { x: 500, y: 300 },
      { x: 500, y: 400 },
    ];
    const out = placeLabels([box("a", spots), box("b", spots)], {
      bounds: pane,
    });
    expect(out.get("a")).toMatchObject({ x: 500, y: 300, spot: 0 });
    expect(out.get("b")).toMatchObject({ x: 500, y: 400, spot: 1 });
  });

  it("never lets two names cover each other while a free spot is left", () => {
    const names = Array.from({ length: 6 }, (_, i) =>
      box(String(i), cellSpots([{ x: 500, y: 400 }], 40, 100, 24)),
    );
    const out = [...placeLabels(names, { bounds: pane }).values()];
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++)
        expect(clash(out[i], out[j])).toBe(false);
  });

  it("keeps a name on the spot it had while that spot is free", () => {
    const spots = [
      { x: 500, y: 300 },
      { x: 500, y: 400 },
    ];
    const prev = new Map([["a", 1]]);
    expect(
      placeLabels([box("a", spots)], { bounds: pane, prev }).get("a")?.spot,
    ).toBe(1);
  });

  it("keeps names inside the pane", () => {
    const out = placeLabels([box("a", [{ x: -50, y: -50 }])], { bounds: pane });
    expect(out.get("a")).toMatchObject({ x: 54, y: 16 });
  });

  it("takes the spot that covers least when every spot clashes", () => {
    const a = box("a", [{ x: 500, y: 300 }]);
    const b = box("b", [
      { x: 500, y: 300 },
      { x: 560, y: 300 },
    ]);
    expect(placeLabels([a, b], { bounds: pane }).get("b")?.spot).toBe(1);
  });
});

describe("placeLabels around people", () => {
  it("steps off a spot that would cover someone", () => {
    const spots = [
      { x: 500, y: 300 },
      { x: 500, y: 400 },
    ];
    const face = { x0: 480, y0: 290, x1: 520, y1: 330 };
    const out = placeLabels([box("a", spots)], {
      bounds: pane,
      obstacles: [face],
    });
    expect(out.get("a")?.spot).toBe(1);
  });
});

describe("cellSpots", () => {
  it("puts the best spot centred over the top of the cell", () => {
    const [best] = cellSpots(
      [
        { x: 100, y: 200 },
        { x: 300, y: 260 },
      ],
      30,
      80,
      20,
    );
    expect(best).toEqual({ x: 200, y: 170 });
  });

  it("has nothing for an empty cell", () => {
    expect(cellSpots([], 30, 80, 20)).toEqual([]);
  });
});
