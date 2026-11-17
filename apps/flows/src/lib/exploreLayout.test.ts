// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { EXPLORE_MAX, LEVEL_DROP, layoutLevel } from "./exploreLayout";

describe("layoutLevel", () => {
  it("hangs a level under the focus, the widest pipe biggest and closest in", () => {
    const spots = layoutLevel([
      { id: "a", bandwidth: 40, coverage: 0 },
      { id: "b", bandwidth: 10, coverage: 0 },
      { id: "c", bandwidth: 0, coverage: 1 },
    ]);
    expect(spots.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(spots.every((s) => s.y <= -LEVEL_DROP)).toBe(true);
    expect(spots[0].r).toBeGreaterThan(spots[1].r);
    expect(spots[1].r).toBeGreaterThan(spots[2].r);
    const rho = (s: (typeof spots)[number]) => Math.hypot(s.x, s.z);
    expect(rho(spots[0])).toBeLessThan(rho(spots[2]));
    expect(spots[0].weight).toBe(1);
  });

  it("draws pipes in proportion to the share: twice the share, twice as thick", () => {
    const [a, b, c] = layoutLevel([
      { id: "a", bandwidth: 40, coverage: 0 },
      { id: "b", bandwidth: 20, coverage: 0 },
      { id: "c", bandwidth: 4, coverage: 0 },
    ]);
    expect(a.flow).toBe(1);
    expect(b.flow).toBeCloseTo(0.5);
    expect(c.flow).toBeCloseTo(0.1);
    // Sizes are eased (sqrt) so small parties stay visible; pipes are not.
    expect(c.weight).toBeGreaterThan(c.flow);
  });

  it("draws a pipe by the money share, not by resources committed", () => {
    const [a, b] = layoutLevel([
      { id: "a", bandwidth: 20, share: 10, coverage: 1 },
      { id: "b", bandwidth: 16, share: 16, coverage: 0 },
    ]);
    expect(a.weight).toBeGreaterThan(b.weight);
    expect(b.flow).toBe(1);
    expect(a.flow).toBeCloseTo(10 / 16);
  });

  it("sizes by what is committed when nothing on the level is paid", () => {
    const [low, high] = layoutLevel([
      { id: "a", bandwidth: 0, coverage: 0 },
      { id: "b", bandwidth: 0, coverage: 1 },
    ]);
    expect(high.r).toBeGreaterThan(low.r);
  });

  it("keeps a fixed full size, so a redrawn level compares with how it was", () => {
    const items = [
      { id: "a", bandwidth: 20, coverage: 0 },
      { id: "b", bandwidth: 5, coverage: 0 },
    ];
    const [a] = layoutLevel(items, { widest: 40 });
    expect(a.weight).toBeCloseTo(Math.sqrt(0.5));
    expect(a.r).toBeLessThan(layoutLevel(items)[0].r);
    // Grown past the old widest, it is drawn full size, no more.
    expect(layoutLevel(items, { widest: 10 })[0].weight).toBe(1);
    // Pipes too: a draft that passes on less draws every pipe thinner.
    expect(layoutLevel(items, { widest: 40 })[0].flow).toBeCloseTo(0.5);
  });

  it("puts a lone child straight under, and shows at most the cap", () => {
    expect(
      layoutLevel([{ id: "a", bandwidth: 1, coverage: 0 }])[0],
    ).toMatchObject({ x: 0, z: 0 });
    const many = Array.from({ length: 200 }, (_, i) => ({
      id: `n${i}`,
      bandwidth: 1,
      coverage: 0,
    }));
    expect(layoutLevel(many)).toHaveLength(EXPLORE_MAX);
  });
});
