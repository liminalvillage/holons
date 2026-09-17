// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Auto-arranged layout for the Tasks dependency graph: rows by longest path
// down to a goal, columns by a tidy-tree placement over each goal's branch.
// Pure geometry over ids: which edges exist and what they *mean* is decided
// upstream (core's dependency helpers); this module only decides where each
// node sits. Sized for a kiosk backlog (tens of nodes), not for thousands.
//
// The arrangement is deliberately STABLE — nothing here depends on anything
// but the ids' order and the edges' order, so the same data draws the same
// board on every kiosk, and editing one branch leaves every other branch
// where it was (its neighbours slide over to make room, they don't reshuffle).

export interface DagEdge {
  /** Predecessor (the dependency — must happen first; drawn above). */
  from: string;
  /** Successor (the task that waits on it; drawn below). */
  to: string;
}

export interface DagLayout {
  /**
   * Linked nodes, top→bottom: the LAST layer holds the goals (nothing waits on
   * them), each earlier layer the work that feeds the one below it. Within a
   * row the order is the drawing order, left→right.
   */
  layers: string[][];
  /** Per linked node: its layer and its column within that layer. */
  pos: Map<string, { layer: number; col: number }>;
  /** Nodes with no edges at all, in input order — rendered apart. */
  free: string[];
  /** The edges actually laid out (normalized; cycle-closing edges dropped). */
  edges: DagEdge[];
  /** The goals (bottom row), in input order — each is the root of a branch. */
  roots: string[];
  /**
   * Each node's PRIMARY dependent — the branch it is drawn in. A card several
   * tasks wait on lives under the one listed first in the input (its other
   * edges are still drawn); goals have none.
   */
  parent: Map<string, string | null>;
  /**
   * Each node's primary predecessors, in edge order — for a task that is the
   * order of its `dependencies`, so a newly wired card lands to the right of
   * the ones already there.
   */
  children: Map<string, string[]>;
}

/**
 * Arrange a dependency DAG for top→bottom rendering. Tolerates dirty input —
 * self-loops, dangling endpoints and duplicate edges are dropped, and any
 * cycle (possible in stored data even though the UIs refuse to create one) is
 * broken by ignoring the edge that would close it, so the layout never hangs.
 */
export function layoutDag(ids: string[], edges: DagEdge[]): DagLayout {
  const idSet = new Set(ids);
  // Normalize: both ends known, no self-loops, one copy of each edge.
  const seen = new Set<string>();
  const clean: DagEdge[] = [];
  for (const e of edges) {
    if (!idSet.has(e.from) || !idSet.has(e.to) || e.from === e.to) continue;
    const key = `${e.from}\0${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push(e);
  }

  const linked = ids.filter((id) =>
    clean.some((e) => e.from === id || e.to === id),
  );
  const free = ids.filter((id) => !linked.includes(id));

  // Break cycles: DFS along successor edges; an edge into a node still on the
  // current path (gray) would close a loop — keep the graph without it.
  const succs = new Map<string, string[]>(linked.map((id) => [id, []]));
  for (const e of clean) succs.get(e.from)!.push(e.to);
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map(linked.map((id) => [id, WHITE]));
  const dropped = new Set<string>();
  const visit = (id: string) => {
    color.set(id, GRAY);
    for (const s of succs.get(id) ?? []) {
      if (color.get(s) === GRAY) dropped.add(`${id}\0${s}`);
      else if (color.get(s) === WHITE) visit(s);
    }
    color.set(id, BLACK);
  };
  for (const id of linked) if (color.get(id) === WHITE) visit(id);
  const kept = clean.filter((e) => !dropped.has(`${e.from}\0${e.to}`));

  const preds = new Map<string, string[]>(linked.map((id) => [id, []]));
  const nexts = new Map<string, string[]>(linked.map((id) => [id, []]));
  for (const e of kept) {
    preds.get(e.to)!.push(e.from);
    nexts.get(e.from)!.push(e.to);
  }

  // Rows are counted UP FROM THE GOALS: a node's height is the longest path
  // from it down to a sink, and it renders that many rows above the bottom.
  // Every edge still points strictly down (a predecessor is always taller than
  // its successor), and for a plain tree it puts every dependency on the row
  // directly above the task it feeds, at every level. Aligning from the roots
  // instead would drop whichever steps happen to be simple onto the top row
  // and strand their siblings.
  const heightOf = new Map<string, number>();
  const height = (id: string): number => {
    const known = heightOf.get(id);
    if (known != null) return known;
    const ns = nexts.get(id) ?? [];
    const h = ns.length ? 1 + Math.max(...ns.map(height)) : 0;
    heightOf.set(id, h);
    return h;
  };
  for (const id of linked) height(id);

  const layerCount = linked.length
    ? 1 + Math.max(...linked.map((id) => heightOf.get(id)!))
    : 0;
  const layerOf = new Map(
    linked.map((id) => [id, layerCount - 1 - heightOf.get(id)!] as const),
  );

  // The branches: every node hangs under ONE dependent — the first listed in
  // the input among those waiting on it — so a shared card only changes
  // branch when its own dependents change, never because some other branch
  // was edited. Children keep edge order (= the task's `dependencies` order).
  const index = new Map(ids.map((id, i) => [id, i] as const));
  const parent = new Map<string, string | null>();
  const children = new Map<string, string[]>(linked.map((id) => [id, []]));
  const roots: string[] = [];
  for (const id of linked) {
    const ns = nexts.get(id)!;
    if (!ns.length) {
      parent.set(id, null);
      roots.push(id);
      continue;
    }
    let best = ns[0];
    for (const n of ns) if (index.get(n)! < index.get(best)!) best = n;
    parent.set(id, best);
  }
  for (const id of linked)
    for (const p of preds.get(id)!)
      if (parent.get(p) === id) children.get(id)!.push(p);

  // Rows filled in pre-order over the branches, which is the drawing order:
  // a branch's subtrees are placed strictly left→right, so a row's DOM order
  // matches what the eye follows (and so does tab order).
  const layers: string[][] = Array.from({ length: layerCount }, () => []);
  const place = (id: string) => {
    layers[layerOf.get(id)!].push(id);
    for (const c of children.get(id)!) place(c);
  };
  for (const r of roots) place(r);

  const pos = new Map<string, { layer: number; col: number }>();
  layers.forEach((layer, l) =>
    layer.forEach((id, c) => pos.set(id, { layer: l, col: c })),
  );
  return { layers, pos, free, edges: kept, roots, parent, children };
}

/** Where one node's box sits on the canvas (top-left corner, px). */
export interface NodeBox {
  id: string;
  x: number;
  y: number;
}

export interface DagPlacement {
  /** The LINKED nodes, by id — `layout.free` isn't on the canvas at all. */
  nodes: Map<string, NodeBox>;
  /** Canvas extent, so the view can fit the whole graph to the screen. */
  width: number;
  height: number;
}

export interface PlaceOptions {
  nodeW: number;
  nodeH: number;
  /** Horizontal gap between siblings — cards that feed the same task. */
  colGap: number;
  /** Vertical gap between layers — the room the edges are drawn through. */
  rowGap: number;
  /**
   * Horizontal gap between cards on one row that feed DIFFERENT tasks, and
   * between the goals themselves. Defaults to `colGap`, which keeps every gap
   * uniform.
   */
  clusterGap?: number;
}

/**
 * A subtree's horizontal footprint, per absolute row: the left edge of its
 * leftmost box and the right edge of its rightmost one, plus which node sits
 * there (so a gap can tell siblings from cousins). Rows the subtree doesn't
 * touch are `undefined`.
 */
interface Contour {
  left: (number | undefined)[];
  right: (number | undefined)[];
  leftId: (string | undefined)[];
  rightId: (string | undefined)[];
}

/**
 * Turn a layered layout into pixel boxes with a tidy-tree placement: every
 * task is centred over its dependencies, which sit side by side on the row
 * above it, and each branch keeps its own horizontal span — branches are
 * merged left→right by their outlines, never interleaved. Cards that feed the
 * same task sit a `colGap` apart; anything else sharing a row opens the wider
 * `clusterGap`. A long edge (a card pulled higher by a second dependent)
 * reserves the rows it crosses so nothing is drawn under it.
 *
 * Unlinked nodes are deliberately NOT placed — they live in the view's
 * drawer, off the canvas, so they neither stretch the extent nor shrink the
 * fit. Pure geometry: the caller supplies the node size and gaps and applies
 * its own fit/zoom transform to the result.
 */
export function placeDag(
  layout: DagLayout,
  { nodeW, nodeH, colGap, rowGap, clusterGap = colGap }: PlaceOptions,
): DagPlacement {
  const { layers, pos, roots, parent, children } = layout;
  const rows = layers.length;
  const xs = new Map<string, number>();
  const rowOf = (id: string) => pos.get(id)!.layer;

  const empty = (): Contour => ({
    left: new Array(rows),
    right: new Array(rows),
    leftId: new Array(rows),
    rightId: new Array(rows),
  });
  /** Widen `c` at `row` to include [l, r], attributed to `id`. */
  const cover = (c: Contour, row: number, l: number, r: number, id: string) => {
    if (c.left[row] == null || l < c.left[row]!) {
      c.left[row] = l;
      c.leftId[row] = id;
    }
    if (c.right[row] == null || r > c.right[row]!) {
      c.right[row] = r;
      c.rightId[row] = id;
    }
  };
  /** Siblings (same task waits on both) sit close; anything else, apart. */
  const gapBetween = (a: string | undefined, b: string | undefined) => {
    const pa = a ? parent.get(a) : null;
    const pb = b ? parent.get(b) : null;
    return pa != null && pa === pb ? colGap : clusterGap;
  };
  const shift = (c: Contour, dx: number) => {
    for (let r = 0; r < rows; r++) {
      if (c.left[r] != null) c.left[r]! += dx;
      if (c.right[r] != null) c.right[r]! += dx;
    }
  };
  /** Slide `sub` right until it clears `acc` on every row they share. */
  const merge = (acc: Contour, sub: Contour, ids: string[]) => {
    let dx = -Infinity;
    let shared = false;
    for (let r = 0; r < rows; r++) {
      if (acc.right[r] == null || sub.left[r] == null) continue;
      shared = true;
      const need =
        acc.right[r]! +
        gapBetween(acc.rightId[r], sub.leftId[r]) -
        sub.left[r]!;
      if (need > dx) dx = need;
    }
    if (!shared) {
      // No row in common: still keep it to the right of everything so far.
      const accRight = Math.max(...acc.right.filter((v) => v != null));
      const subLeft = Math.min(...sub.left.filter((v) => v != null));
      dx = accRight + clusterGap - subLeft;
    }
    if (!Number.isFinite(dx)) dx = 0;
    for (const id of ids) xs.set(id, xs.get(id)! + dx);
    shift(sub, dx);
    for (let r = 0; r < rows; r++) {
      if (sub.left[r] == null) continue;
      cover(acc, r, sub.left[r]!, sub.right[r]!, sub.leftId[r]!);
      // `cover` picks the outer edge; the right edge's owner is sub's own.
      if (acc.right[r] === sub.right[r]) acc.rightId[r] = sub.rightId[r];
    }
  };

  /** Lay out the branch rooted at `id`; returns its outline and members. */
  const build = (id: string): { contour: Contour; ids: string[] } => {
    const row = rowOf(id);
    const kids = children.get(id) ?? [];
    if (!kids.length) {
      xs.set(id, 0);
      const contour = empty();
      cover(contour, row, 0, nodeW, id);
      return { contour, ids: [id] };
    }
    const acc = empty();
    const members: string[] = [];
    let first = true;
    for (const kid of kids) {
      const sub = build(kid);
      // A dependency more than one row up trails an edge through the rows
      // between: reserve its column there so no sibling sits under the line.
      for (let r = rowOf(kid) + 1; r < row; r++)
        cover(sub.contour, r, xs.get(kid)!, xs.get(kid)! + nodeW, kid);
      if (first) {
        for (let r = 0; r < rows; r++) {
          acc.left[r] = sub.contour.left[r];
          acc.right[r] = sub.contour.right[r];
          acc.leftId[r] = sub.contour.leftId[r];
          acc.rightId[r] = sub.contour.rightId[r];
        }
        first = false;
      } else merge(acc, sub.contour, sub.ids);
      members.push(...sub.ids);
    }
    // The task sits centred over its dependencies' span.
    const x = (xs.get(kids[0])! + xs.get(kids[kids.length - 1])!) / 2;
    xs.set(id, x);
    cover(acc, row, x, x + nodeW, id);
    // ...and the span of any long edge into it is kept clear of cousins too.
    for (const kid of kids) {
      const kx = xs.get(kid)!;
      for (let r = rowOf(kid) + 1; r < row; r++)
        cover(acc, r, Math.min(kx, x), Math.max(kx, x) + nodeW, kid);
    }
    members.push(id);
    return { contour: acc, ids: members };
  };

  const all = empty();
  let first = true;
  for (const root of roots) {
    const sub = build(root);
    if (first) {
      for (let r = 0; r < rows; r++) {
        all.left[r] = sub.contour.left[r];
        all.right[r] = sub.contour.right[r];
        all.leftId[r] = sub.contour.leftId[r];
        all.rightId[r] = sub.contour.rightId[r];
      }
      first = false;
    } else merge(all, sub.contour, sub.ids);
  }

  const lefts = all.left.filter((v): v is number => v != null);
  const rights = all.right.filter((v): v is number => v != null);
  const minX = lefts.length ? Math.min(...lefts) : 0;
  const width = rights.length ? Math.max(...rights) - minX : 0;
  const height = rows ? rows * nodeH + (rows - 1) * rowGap : 0;

  const nodes = new Map<string, NodeBox>();
  for (const [id, x] of xs)
    nodes.set(id, { id, x: x - minX, y: rowOf(id) * (nodeH + rowGap) });
  return { nodes, width, height };
}
