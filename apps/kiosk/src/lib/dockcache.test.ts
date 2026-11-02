// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { packSky, unpackSky } from "./dockcache";
import { seedOrbs } from "./dock";

describe("dockcache sky", () => {
  it("keeps places as fractions and puts them back at rest", () => {
    const sim = seedOrbs(["a", "b"], 800, 600);
    sim.px[0] = 200;
    sim.py[0] = 150;
    sim.vx[0] = 5;
    const kept = packSky(sim, 800, 600);
    expect(kept.a).toEqual([0.25, 0.25]);

    // A reload, in a window twice as wide, with a newcomer.
    const next = seedOrbs(["c", "a"], 1600, 600);
    const seedC = [next.px[0], next.py[0]];
    next.vx[1] = 3;
    expect(unpackSky(next, kept, 1600, 600)).toBe(1);
    expect([next.px[1], next.py[1]]).toEqual([400, 150]);
    expect(next.vx[1]).toBe(0);
    expect([next.px[0], next.py[0]]).toEqual(seedC);
  });

  it("ignores junk and keeps places inside the field", () => {
    const sim = seedOrbs(["a", "b"], 100, 100);
    const placed = unpackSky(
      sim,
      { a: [2, -1], b: ["x", 1] as unknown as [number, number] },
      100,
      100,
    );
    expect(placed).toBe(1);
    expect([sim.px[0], sim.py[0]]).toEqual([100, 0]);
  });

  it("packs nothing for a field with no size", () => {
    expect(packSky(seedOrbs(["a"], 0, 0), 0, 0)).toEqual({});
  });
});
