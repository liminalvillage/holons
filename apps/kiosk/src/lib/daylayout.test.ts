// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { packColumns } from "./daylayout";

const p = (id: string, start: number, end: number) => ({ id, start, end });

describe("packColumns", () => {
  it("keeps disjoint events in one column each", () => {
    const out = packColumns([p("a", 0, 60), p("b", 60, 120), p("c", 200, 230)]);
    for (const id of ["a", "b", "c"])
      expect(out.get(id)).toEqual({ col: 0, cols: 1 });
  });

  it("puts a nested event beside its container", () => {
    const out = packColumns([p("a", 0, 120), p("b", 30, 60)]);
    expect(out.get("a")).toEqual({ col: 0, cols: 2 });
    expect(out.get("b")).toEqual({ col: 1, cols: 2 });
  });

  it("reuses a freed column along a chain and sizes the cluster by its peak", () => {
    // a overlaps b, b overlaps c, c overlaps d — one cluster, never more than
    // two at once, so two columns and the third event takes the first again.
    const out = packColumns([
      p("a", 0, 60),
      p("b", 30, 90),
      p("c", 60, 120),
      p("d", 90, 150),
    ]);
    expect(out.get("a")).toEqual({ col: 0, cols: 2 });
    expect(out.get("b")).toEqual({ col: 1, cols: 2 });
    expect(out.get("c")).toEqual({ col: 0, cols: 2 });
    expect(out.get("d")).toEqual({ col: 1, cols: 2 });
  });

  it("starts a new cluster once the overlap breaks", () => {
    const out = packColumns([p("a", 0, 60), p("b", 30, 90), p("c", 90, 120)]);
    expect(out.get("c")).toEqual({ col: 0, cols: 1 });
  });
});
