// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Auto-arranged layered layout for the Tasks dependency graph — a small
// Sugiyama-style pipeline (layer by longest path to a goal, then reduce edge
// crossings with barycenter sweeps). Pure geometry over ids: which edges exist
// and what they *mean* is decided upstream (core's dependency helpers); this
// module only decides where each node sits. Sized for a kiosk backlog (tens of
// nodes), not for thousands.

export interface DagEdge {
  /** Predecessor (the dependency — must happen first; drawn above). */
  from: string;
  /** Successor (the task that waits on it; drawn below). */
  to: string;
}

export interface DagLayout {
  /**
   * Linked nodes, top→bottom: the LAST layer holds the goals (nothing waits on
   * them), each earlier layer the work that feeds the one below it.
   */
  layers: string[][];
  /** Per linked node: its layer and its column within that layer. */
  pos: Map<string, { layer: number; col: number }>;
  /** Nodes with no edges at all, in input order — rendered apart. */
  free: string[];
  /** The edges actually laid out (normalized; cycle-closing edges dropped). */
  edges: DagEdge[];
}

/** How many alternating down/up barycenter passes to run. */
const ORDER_PASSES = 4;

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
  // its successor), but the alignment is what makes a breakdown read as one
  // move: all the steps feeding a task sit together on the row directly above
  // it, at every level. Aligning from the roots instead would drop whichever
  // steps happen to be simple onto the top row and strand their siblings.
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
  const layers: string[][] = Array.from({ length: layerCount }, () => []);
  for (const id of linked) layers[layerOf.get(id)!].push(id);

  // Barycenter ordering: sweep down then up, sorting each layer by the mean
  // column of its neighbours in the already-ordered adjacent layer. Nodes
  // with no neighbour there keep their current column.
  const colOf = new Map<string, number>();
  const reindex = (layer: string[]) =>
    layer.forEach((id, i) => colOf.set(id, i));
  layers.forEach(reindex);
  const sortLayer = (layer: string[], over: (id: string) => string[]) => {
    const bary = new Map<string, number>();
    for (const id of layer) {
      const ns = over(id);
      bary.set(
        id,
        ns.length
          ? ns.reduce((s, n) => s + colOf.get(n)!, 0) / ns.length
          : colOf.get(id)!,
      );
    }
    layer.sort(
      (a, b) => bary.get(a)! - bary.get(b)! || colOf.get(a)! - colOf.get(b)!,
    );
    reindex(layer);
  };
  for (let pass = 0; pass < ORDER_PASSES; pass++) {
    for (let i = 1; i < layers.length; i++)
      sortLayer(layers[i], (id) => preds.get(id) ?? []);
    for (let i = layers.length - 2; i >= 0; i--)
      sortLayer(layers[i], (id) => nexts.get(id) ?? []);
  }

  const pos = new Map<string, { layer: number; col: number }>();
  layers.forEach((layer, l) =>
    layer.forEach((id, c) => pos.set(id, { layer: l, col: c })),
  );
  return { layers, pos, free, edges: kept };
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
  /** Horizontal gap between siblings in a layer. */
  colGap: number;
  /** Vertical gap between layers — the room the edges are drawn through. */
  rowGap: number;
}

/**
 * Turn a layered layout into pixel boxes: layers stack top→bottom, each
 * centred on the canvas. Unlinked nodes are deliberately NOT placed — they
 * live in the view's drawer, off the canvas, so they neither stretch the
 * extent nor shrink the fit. Pure geometry: the caller supplies the node size
 * and gaps and applies its own fit/zoom transform to the result.
 */
export function placeDag(
  layout: DagLayout,
  { nodeW, nodeH, colGap, rowGap }: PlaceOptions,
): DagPlacement {
  const rowWidth = (n: number) => (n > 0 ? n * nodeW + (n - 1) * colGap : 0);
  const { layers } = layout;

  const width = layers.reduce((w, l) => Math.max(w, rowWidth(l.length)), 0);
  const height = layers.length
    ? layers.length * nodeH + (layers.length - 1) * rowGap
    : 0;

  const nodes = new Map<string, NodeBox>();
  layers.forEach((layer, l) => {
    const left = (width - rowWidth(layer.length)) / 2;
    layer.forEach((id, c) =>
      nodes.set(id, {
        id,
        x: left + c * (nodeW + colGap),
        y: l * (nodeH + rowGap),
      }),
    );
  });
  return { nodes, width, height };
}
