// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { WAD } from "@holons/core/flows";
import { encodeChainSync } from "./chain";

describe("encodeChainSync", () => {
  const scored = [
    { id: "a", name: "Ada", percentage: 60 },
    { id: "b", name: "Bob", percentage: 40 },
  ];

  it("sends the equation roster and placed rings", () => {
    expect(
      encodeChainSync({
        bundleAddress: "0x0000000000000000000000000000000000000001",
        config: {
          interiorPercent: 70,
          steepness: 50,
          nzones: 4,
          interiorMode: "equation",
        },
        scored,
        shares: { z: 100 },
        placed: [
          { id: "p1", zone: 2 },
          { id: "u9", zone: 1 },
          { id: "p2", zone: 0 },
        ],
      }),
    ).toEqual([
      7000n,
      3000n,
      WAD / 2n,
      4n,
      ["a", "b"],
      [6000n, 4000n],
      ["p1", "u9"],
      [2n, 1n],
    ]);
  });

  it("seats the holon itself when an interior share has nobody in it", () => {
    const args = encodeChainSync({
      bundleAddress: "0x0000000000000000000000000000000000000001",
      holonId: "235114395",
      config: {
        interiorPercent: 60,
        steepness: 50,
        nzones: 2,
        interiorMode: "equation",
      },
      scored: [],
      shares: {},
      placed: [{ id: "u3", zone: 1 }],
    });
    expect(args[4]).toEqual(["235114395"]);
    expect(args[5]).toEqual([10000n]);
  });

  it("sends the custom shares under a custom split", () => {
    const args = encodeChainSync({
      bundleAddress: "0x0000000000000000000000000000000000000001",
      config: {
        interiorPercent: 50,
        steepness: 50,
        nzones: 2,
        interiorMode: "custom",
      },
      scored,
      shares: { b: 25, c: 75 },
      placed: [],
    });
    expect(args[4]).toEqual(["b", "c"]);
    expect(args[5]).toEqual([2500n, 7500n]);
  });
});
