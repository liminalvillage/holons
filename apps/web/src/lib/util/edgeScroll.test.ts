// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { EDGE_PX, MAX_PX_PER_SEC, edgeSpeed } from "./edgeScroll";

describe("edgeSpeed", () => {
  it("is still in the middle and outside the container", () => {
    expect(edgeSpeed(300, 0, 600)).toBe(0);
    expect(edgeSpeed(-5, 0, 600)).toBe(0);
    expect(edgeSpeed(605, 0, 600)).toBe(0);
  });

  it("scrolls up near the top and down near the bottom", () => {
    expect(edgeSpeed(10, 0, 600)).toBeLessThan(0);
    expect(edgeSpeed(590, 0, 600)).toBeGreaterThan(0);
  });

  it("is fastest right at the edge", () => {
    expect(edgeSpeed(0, 0, 600)).toBe(-MAX_PX_PER_SEC);
    expect(edgeSpeed(600, 0, 600)).toBe(MAX_PX_PER_SEC);
    expect(Math.abs(edgeSpeed(EDGE_PX - 5, 0, 600))).toBeLessThan(
      Math.abs(edgeSpeed(5, 0, 600)),
    );
  });

  it("keeps a middle dead zone in a short container", () => {
    expect(edgeSpeed(45, 0, 90)).toBe(0);
    expect(edgeSpeed(2, 0, 90)).toBeLessThan(0);
  });
});
