// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { lunationAt } from "@holons/core/flows";
import { moonQuarters, DAY_MS } from "./yearscale";

describe("moonQuarters", () => {
  // A year of cycles from 2026, one per lunation.
  const cycles: Array<{ from: number; to: number }> = [];
  let c = lunationAt(Date.UTC(2026, 0, 3));
  for (let i = 0; i < 13; i++) {
    cycles.push({ from: c.from, to: c.to + 1 });
    c = lunationAt(c.to + 1);
  }

  it("falls inside the cycle, in order", () => {
    for (const { from, to } of cycles) {
      const q = moonQuarters(from, to);
      expect(q.first.getTime()).toBeGreaterThan(from);
      expect(q.full.getTime()).toBeGreaterThan(q.first.getTime());
      expect(q.last.getTime()).toBeGreaterThan(q.full.getTime());
      expect(q.last.getTime()).toBeLessThan(to);
    }
  });

  it("spaces the quarters about a week apart", () => {
    for (const { from, to } of cycles) {
      const q = moonQuarters(from, to);
      const gaps = [
        (q.first.getTime() - from) / DAY_MS,
        (q.full.getTime() - q.first.getTime()) / DAY_MS,
        (q.last.getTime() - q.full.getTime()) / DAY_MS,
        (to - q.last.getTime()) / DAY_MS,
      ];
      for (const g of gaps) {
        expect(g).toBeGreaterThan(6.2);
        expect(g).toBeLessThan(8.6);
      }
    }
  });
});
