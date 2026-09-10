// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { scaleLadder } from "@holons/core/offers";
import {
  cellAcrossKm,
  formatAcross,
  scaleRingMapUrl,
  scaleRingPicture,
} from "./scalering";
import { cellToBoundary, cellToLatLng } from "h3-js";

const HOME = "891f1d48b4bffff"; // res 9, ~350 m across

describe("scaleRingPicture", () => {
  it("nests the chain around the home centre, innermost first, fitted to the chosen level", () => {
    const chain = scaleLadder(HOME);
    const pic = scaleRingPicture(chain, 2, 100)!;
    expect(pic).not.toBeNull();
    expect(pic.rings.map((r) => r.id)).toEqual([
      "cell:0",
      "cell:1",
      "cell:2",
      "cell:3",
      "cell:4",
    ]);
    const extent = (points: string) =>
      Math.max(
        ...points.split(" ").map((p) => {
          const [x, y] = p.split(",").map(Number);
          return Math.hypot(x - 50, y - 50);
        }),
      );
    const e = pic.rings.map((r) => extent(r.points));
    // Each parent reaches further than its child; the fitted ring sits inside the square.
    expect(e[0]).toBeLessThan(e[1]);
    expect(e[1]).toBeLessThan(e[2]);
    expect(e[2]).toBeLessThan(e[3]);
    expect(e[2]).toBeLessThanOrEqual(45.01);
    expect(e[2]).toBeGreaterThan(40);
    // The home cell's outline surrounds the centre.
    expect(e[0]).toBeGreaterThan(0);
  });

  it("covers the fitted ring's ground in its bbox, centred on the home cell", () => {
    const chain = scaleLadder(HOME);
    const pic = scaleRingPicture(chain, 2, 100)!;
    const [w, s, e, n] = pic.bbox;
    const [lat, lng] = cellToLatLng(HOME);
    expect((w + e) / 2).toBeCloseTo(lng, 6);
    expect((s + n) / 2).toBeCloseTo(lat, 6);
    // Every corner of the fitted ring lies inside; the outermost runs off.
    for (const [cLat, cLng] of cellToBoundary(chain[2])) {
      expect(cLng).toBeGreaterThan(w);
      expect(cLng).toBeLessThan(e);
      expect(cLat).toBeGreaterThan(s);
      expect(cLat).toBeLessThan(n);
    }
    const outside = cellToBoundary(chain[3]).some(
      ([cLat, cLng]) => cLng < w || cLng > e || cLat < s || cLat > n,
    );
    expect(outside).toBe(true);
  });

  it("builds a square static-map url for the bbox, none without a token", () => {
    const pic = scaleRingPicture(scaleLadder(HOME), 1, 100)!;
    expect(scaleRingMapUrl(pic, "")).toBe("");
    const url = scaleRingMapUrl(pic, "pk.test", 80);
    expect(url).toContain("/static/[");
    expect(url).toContain("/80x80@2x?");
    expect(url).toContain("access_token=pk.test");
    expect(url).toContain(pic.bbox[0].toFixed(5));
  });

  it("returns null without a valid home cell", () => {
    expect(scaleRingPicture([], 0)).toBeNull();
    expect(scaleRingPicture(["nope"], 0)).toBeNull();
  });

  it("labels the width in metres below a kilometre and rounds above", () => {
    expect(cellAcrossKm(HOME)).toBeGreaterThan(0.3);
    expect(cellAcrossKm(HOME)).toBeLessThan(0.5);
    expect(formatAcross(0.35)).toBe("≈ 350 m");
    expect(formatAcross(1.23)).toBe("≈ 1.2 km");
    expect(formatAcross(45.4)).toBe("≈ 45 km");
    expect(formatAcross(0)).toBe("");
  });
});
