// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  layoutDag,
  placeDag,
  type DagEdge,
  type PlaceOptions,
} from "./graphlayout";

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
    const { layers, free, roots } = layoutDag(
      ["a", "b", "x", "y", "lone"],
      [e("a", "b"), e("x", "y")],
    );
    expect(layers[0]).toHaveLength(2); // both roots share layer 0
    expect(layers[1]).toHaveLength(2);
    expect(free).toEqual(["lone"]);
    expect(roots).toEqual(["b", "y"]);
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

  it("orders goals by input and children by edge order, whatever the ids' order", () => {
    // Ids arrive shuffled (the wall's sort); the edges carry each task's own
    // `dependencies` order. Goals follow the ids, children follow the edges.
    const { roots, children, layers } = layoutDag(
      ["gb", "c2", "ga", "c1", "c3"],
      [e("c2", "ga"), e("c1", "ga"), e("c3", "gb")],
    );
    expect(roots).toEqual(["gb", "ga"]);
    expect(children.get("ga")).toEqual(["c2", "c1"]);
    expect(layers[0]).toEqual(["c3", "c2", "c1"]); // pre-order = drawing order
    expect(layers[1]).toEqual(["gb", "ga"]);
  });

  it("hangs a shared card under its first-listed dependent, keeping every edge", () => {
    const { parent, children, edges } = layoutDag(
      ["ga", "gb", "x"],
      [e("x", "gb"), e("x", "ga")],
    );
    expect(parent.get("x")).toBe("ga"); // ga precedes gb in the input
    expect(children.get("ga")).toEqual(["x"]);
    expect(children.get("gb")).toEqual([]);
    expect(edges).toHaveLength(2); // the other edge is still drawn
  });

  it("handles an empty graph", () => {
    const { layers, free, edges, roots } = layoutDag([], []);
    expect(layers).toEqual([]);
    expect(free).toEqual([]);
    expect(edges).toEqual([]);
    expect(roots).toEqual([]);
  });
});

describe("placeDag", () => {
  const G = { nodeW: 100, nodeH: 50, colGap: 10, rowGap: 40 };
  const lay = (ids: string[], edges: DagEdge[], opts: PlaceOptions = G) =>
    placeDag(layoutDag(ids, edges), opts);
  const xOf = (p: ReturnType<typeof placeDag>) => (id: string) =>
    p.nodes.get(id)!.x;

  it("stacks layers top→bottom and centres a task over its dependencies", () => {
    // a and b share layer 0; c (their join) sits centred beneath them.
    const { nodes, width, height } = lay(
      ["a", "b", "c"],
      [e("a", "c"), e("b", "c")],
    );
    expect(width).toBe(210); // two 100px nodes + one 10px gap
    expect(height).toBe(140); // two 50px rows + one 40px row gap
    expect(nodes.get("a")).toEqual({ id: "a", x: 0, y: 0 });
    expect(nodes.get("b")).toEqual({ id: "b", x: 110, y: 0 });
    expect(nodes.get("c")).toEqual({ id: "c", x: 55, y: 90 });
  });

  it("leaves unlinked nodes off the canvas — they belong to the drawer", () => {
    const { nodes, width, height } = lay(["a", "b", "f1", "f2"], [e("a", "b")]);
    expect([...nodes.keys()].sort()).toEqual(["a", "b"]);
    // The extent is the graph's alone, so the fit isn't shrunk by the drawer.
    expect([width, height]).toEqual([100, 140]);
  });

  it("opens the cluster gap between cards that feed different tasks", () => {
    // Two breakdowns side by side: {a1, a2} → ga and {b1, b2} → gb. Within a
    // breakdown the tight colGap holds; where the branches meet — and between
    // the unrelated goals below — the wider gap opens, and each goal is
    // centred over its own steps.
    const p = lay(
      ["ga", "gb", "a1", "a2", "b1", "b2"],
      [e("a1", "ga"), e("a2", "ga"), e("b1", "gb"), e("b2", "gb")],
      { ...G, clusterGap: 40 },
    );
    const x = xOf(p);
    expect(x("a2") - x("a1")).toBe(110); // siblings: nodeW + colGap
    expect(x("b2") - x("b1")).toBe(110);
    expect(x("b1") - x("a2")).toBe(140); // branch boundary: nodeW + clusterGap
    expect(x("ga")).toBe(55); // centred over a1/a2
    expect(x("gb")).toBe(305); // centred over b1/b2
    expect(p.width).toBe(460); // 4 nodes + two colGaps + one clusterGap
  });

  it("keeps every gap uniform when clusterGap is not given", () => {
    const p = lay(["ga", "gb", "a1", "b1"], [e("a1", "ga"), e("b1", "gb")]);
    const x = xOf(p);
    expect(x("b1") - x("a1")).toBe(110);
    expect(p.width).toBe(210);
  });

  it("parts the goals themselves by the cluster gap", () => {
    const p = lay(["ga", "gb", "a1", "b1"], [e("a1", "ga"), e("b1", "gb")], {
      ...G,
      clusterGap: 40,
    });
    const x = xOf(p);
    expect(x("gb") - x("ga")).toBe(140);
  });

  it("adds a new dependency to the right and leaves the others in place", () => {
    // g ← {a, b}; then c is wired in last. a and b keep their spacing, c lands
    // beside them, g re-centres over the wider span.
    const before = lay(["g", "a", "b", "c"], [e("a", "g"), e("b", "g")]);
    const after = lay(
      ["g", "a", "b", "c"],
      [e("a", "g"), e("b", "g"), e("c", "g")],
    );
    const xb = xOf(before);
    const xa = xOf(after);
    expect(xa("b") - xa("a")).toBe(xb("b") - xb("a"));
    expect(xa("c")).toBeGreaterThan(xa("b"));
    expect(xa("g")).toBe((xa("a") + xa("c")) / 2);
  });

  it("moves a whole branch with its card and keeps every other card's order", () => {
    // Two goals: P ← {a, s}, a ← {a1, a2}; B ← {b1}. Move a (with a1, a2)
    // from P to B: s keeps its place under P, b1 keeps its place under B, the
    // branch lands to the right of b1, and no untouched pair swaps sides.
    const ids = ["P", "B", "a", "s", "b1", "a1", "a2"];
    const before = lay(ids, [
      e("a", "P"),
      e("s", "P"),
      e("a1", "a"),
      e("a2", "a"),
      e("b1", "B"),
    ]);
    const after = lay(ids, [
      e("s", "P"),
      e("a1", "a"),
      e("a2", "a"),
      e("b1", "B"),
      e("a", "B"),
    ]);
    const xb = xOf(before);
    const xa = xOf(after);
    // Order is kept per ROW (a task re-centres over its own dependencies, so
    // parent-vs-child offsets legitimately change).
    for (const [m, n] of [
      ["P", "B"],
      ["s", "b1"],
    ])
      expect(Math.sign(xa(m) - xa(n))).toBe(Math.sign(xb(m) - xb(n)));
    // The branch is intact and sits inside B's span, right of b1.
    expect(xa("a")).toBeGreaterThan(xa("b1"));
    expect(xa("a")).toBe((xa("a1") + xa("a2")) / 2);
    expect(xa("B")).toBe((xa("b1") + xa("a")) / 2);
    // s alone now: P centred on it.
    expect(xa("P")).toBe(xa("s"));
  });

  it("leaves a branch's internal offsets alone when another branch changes", () => {
    const ids = ["T1", "T2", "u", "v", "w", "z"];
    const base = [e("u", "T1"), e("v", "T1"), e("w", "T2")];
    const before = lay(ids, base);
    const after = lay(ids, [...base, e("z", "T2")]);
    const xb = xOf(before);
    const xa = xOf(after);
    for (const m of ["T1", "u", "v"])
      for (const n of ["T1", "u", "v"])
        expect(xa(m) - xa(n)).toBe(xb(m) - xb(n));
    // T1 is the first goal, so it doesn't even shift.
    expect(xa("T1")).toBe(xb("T1"));
  });

  it("keeps a shared card put when an unrelated branch is edited", () => {
    const ids = ["ga", "gb", "gc", "x", "c1", "c2"];
    const base = [e("x", "ga"), e("x", "gb"), e("c1", "gc")];
    const before = lay(ids, base);
    const after = lay(ids, [...base, e("c2", "gc")]);
    expect(xOf(after)("x")).toBe(xOf(before)("x"));
    expect(xOf(after)("ga")).toBe(xOf(before)("ga"));
  });

  it("copes with a card pulled higher than the row above its dependent", () => {
    // a→b→c→d and e→d: e is a direct dependency of d but d's row is set by
    // the long chain, so e's edge crosses two rows. It must still be placed,
    // centred with c under d, and nothing may sit under the long edge.
    const p = lay(
      ["a", "b", "c", "d", "e", "f"],
      [e("a", "b"), e("b", "c"), e("c", "d"), e("e", "d"), e("f", "b")],
    );
    for (const box of p.nodes.values()) {
      expect(Number.isFinite(box.x)).toBe(true);
      expect(Number.isFinite(box.y)).toBe(true);
    }
    const x = xOf(p);
    expect(p.nodes.get("e")!.y).toBe(p.nodes.get("c")!.y);
    expect(x("d")).toBe((x("c") + x("e")) / 2);
    expect(x("e")).toBeGreaterThan(x("c"));
  });

  it("emits each row in left→right order, so DOM order follows the eye", () => {
    const layout = layoutDag(
      ["P", "B", "a", "s", "b1", "a1", "a2", "b2"],
      [
        e("a", "P"),
        e("s", "P"),
        e("a1", "a"),
        e("a2", "a"),
        e("b1", "B"),
        e("b2", "B"),
      ],
    );
    const { nodes } = placeDag(layout, G);
    for (const row of layout.layers)
      for (let i = 1; i < row.length; i++)
        expect(nodes.get(row[i])!.x).toBeGreaterThan(nodes.get(row[i - 1])!.x);
  });

  it("is deterministic", () => {
    const ids = ["g", "a", "b", "c"];
    const edges = [e("a", "g"), e("b", "g"), e("c", "a")];
    expect(lay(ids, edges)).toEqual(lay(ids, edges));
  });

  it("gives an empty board no extent", () => {
    const { nodes, width, height } = placeDag(layoutDag([], []), G);
    expect(nodes.size).toBe(0);
    expect([width, height]).toEqual([0, 0]);
  });
});
