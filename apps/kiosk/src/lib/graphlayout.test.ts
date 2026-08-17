// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { layoutDag, placeDag, type DagEdge } from "./graphlayout";

const e = (from: string, to: string): DagEdge => ({ from, to });

describe("layoutDag", () => {
  it("puts a chain on consecutive layers, roots first", () => {
    const { layers, pos } = layoutDag(
      ["a", "b", "c"],
      [e("a", "b"), e("b", "c")],
    );
    expect(layers).toEqual([["a"], ["b"], ["c"]]);
    expect(pos.get("c")).toEqual({ layer: 2, col: 0 });
  });

  it("layers by LONGEST path, so every edge points strictly down", () => {
    // d depends on both a (short path) and c (long path a→b→c): d must sit
    // below c, not beside b.
    const { pos } = layoutDag(
      ["a", "b", "c", "d"],
      [e("a", "b"), e("b", "c"), e("a", "d"), e("c", "d")],
    );
    expect(pos.get("d")!.layer).toBe(3);
  });

  it("separates independent components and isolated nodes", () => {
    const { layers, free } = layoutDag(
      ["a", "b", "x", "y", "lone"],
      [e("a", "b"), e("x", "y")],
    );
    expect(layers[0]).toHaveLength(2); // both roots share layer 0
    expect(layers[1]).toHaveLength(2);
    expect(free).toEqual(["lone"]);
  });

  it("drops self-loops, dangling endpoints and duplicate edges", () => {
    const { edges, free } = layoutDag(
      ["a", "b"],
      [e("a", "a"), e("a", "ghost"), e("a", "b"), e("a", "b")],
    );
    expect(edges).toEqual([e("a", "b")]);
    expect(free).toEqual([]);
  });

  it("breaks a cycle instead of hanging, keeping the rest of the graph", () => {
    const { layers, edges } = layoutDag(
      ["a", "b", "c"],
      [e("a", "b"), e("b", "c"), e("c", "a")],
    );
    expect(edges).toHaveLength(2); // one cycle-closing edge dropped
    expect(layers.flat().sort()).toEqual(["a", "b", "c"]);
    // Every kept edge still points strictly downward.
    const { pos } = layoutDag(["a", "b", "c"], edges);
    for (const kept of edges)
      expect(pos.get(kept.to)!.layer).toBeGreaterThan(
        pos.get(kept.from)!.layer,
      );
  });

  it("orders children under their parents to avoid crossings", () => {
    // Two parents each with their own child, listed interleaved: the
    // barycenter pass should uncross them (p1's child under p1, p2's under p2).
    const { pos } = layoutDag(
      ["p1", "p2", "c2", "c1"],
      [e("p1", "c1"), e("p2", "c2")],
    );
    const side = (id: string) => pos.get(id)!.col;
    expect(Math.sign(side("c1") - side("c2"))).toBe(
      Math.sign(side("p1") - side("p2")),
    );
  });

  it("keeps every breakdown's steps together on their own row", () => {
    // goal ← {s1, s2}; s1 broken down again into {t1, t2}. Aligning from the
    // roots would put the un-broken-down s2 on the top row with t1/t2 and
    // strand it from its sibling s1; rows counted up from the goal keep each
    // breakdown level intact.
    const { pos, layers } = layoutDag(
      ["goal", "s1", "s2", "t1", "t2"],
      [e("s1", "goal"), e("s2", "goal"), e("t1", "s1"), e("t2", "s1")],
    );
    expect(pos.get("s1")!.layer).toBe(pos.get("s2")!.layer);
    expect(pos.get("t1")!.layer).toBe(pos.get("t2")!.layer);
    expect(layers).toHaveLength(3);
    expect(layers[2]).toEqual(["goal"]); // the goal anchors the bottom row
    expect(pos.get("s1")!.layer).toBe(1); // its steps sit directly above it
  });

  it("handles an empty graph", () => {
    const { layers, free, edges } = layoutDag([], []);
    expect(layers).toEqual([]);
    expect(free).toEqual([]);
    expect(edges).toEqual([]);
  });
});

describe("placeDag", () => {
  const G = { nodeW: 100, nodeH: 50, colGap: 10, rowGap: 40 };

  it("stacks layers top→bottom and centres narrower ones", () => {
    // a and b share layer 0; c (their join) sits centred beneath them.
    const layout = layoutDag(["a", "b", "c"], [e("a", "c"), e("b", "c")]);
    const { nodes, width, height } = placeDag(layout, G);
    expect(width).toBe(210); // two 100px nodes + one 10px gap
    expect(height).toBe(140); // two 50px rows + one 40px row gap
    expect(nodes.get("a")).toEqual({ id: "a", x: 0, y: 0 });
    expect(nodes.get("b")).toEqual({ id: "b", x: 110, y: 0 });
    expect(nodes.get("c")).toEqual({ id: "c", x: 55, y: 90 });
  });

  it("leaves unlinked nodes off the canvas — they belong to the drawer", () => {
    const layout = layoutDag(["a", "b", "f1", "f2"], [e("a", "b")]);
    const { nodes, width, height } = placeDag(layout, G);
    expect([...nodes.keys()].sort()).toEqual(["a", "b"]);
    // The extent is the graph's alone, so the fit isn't shrunk by the drawer.
    expect([width, height]).toEqual([100, 140]);
  });

  it("opens the cluster gap between cards that feed different tasks", () => {
    // Two breakdowns side by side: {a1, a2} → ga and {b1, b2} → gb share the
    // top row. Within a breakdown the tight colGap holds; where the clusters
    // meet — and between the unrelated goals below — the wider gap opens.
    const layout = layoutDag(
      ["ga", "gb", "a1", "a2", "b1", "b2"],
      [e("a1", "ga"), e("a2", "ga"), e("b1", "gb"), e("b2", "gb")],
    );
    const { nodes, width } = placeDag(layout, { ...G, clusterGap: 40 });
    const x = (id: string) => nodes.get(id)!.x;
    expect(x("a2") - x("a1")).toBe(110); // siblings: nodeW + colGap
    expect(x("b2") - x("b1")).toBe(110);
    expect(x("b1") - x("a2")).toBe(140); // cluster boundary: nodeW + clusterGap
    expect(x("gb") - x("ga")).toBe(140); // unrelated goals part the same way
    expect(width).toBe(460); // 4 nodes + two colGaps + one clusterGap
    // The goal row (240 wide) still centres under the full row.
    expect(x("ga")).toBe(110);
  });

  it("keeps every gap uniform when clusterGap is not given", () => {
    const layout = layoutDag(
      ["ga", "gb", "a1", "b1"],
      [e("a1", "ga"), e("b1", "gb")],
    );
    const { nodes, width } = placeDag(layout, G);
    const x = (id: string) => nodes.get(id)!.x;
    expect(x("b1") - x("a1")).toBe(110);
    expect(width).toBe(210);
  });

  it("gives an empty board no extent", () => {
    const { nodes, width, height } = placeDag(layoutDag([], []), G);
    expect(nodes.size).toBe(0);
    expect([width, height]).toEqual([0, 0]);
  });
});
