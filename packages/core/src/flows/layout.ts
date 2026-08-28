// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure layered-Sankey geometry.
 *
 * Emits normalized 0..1 coordinates and ready-to-use SVG path strings, so the
 * kiosk and the dashboard scale identical numbers into different viewports and
 * cannot drift apart. Nothing here touches the DOM or a charting library — core
 * carries no chart dependency, and the kiosk must not gain d3.
 *
 * Not a general DAG solver: `depth` comes from the builder, which knows the
 * shape it made. That keeps this to arithmetic.
 */

import type { ValueFlowLink, ValueFlowTrack } from './types.js';

export interface SankeyOptions {
  /** Node column width, as a fraction of total width. */
  nodeWidth?: number;
  /** Vertical gap between stacked nodes, as a fraction of total height. */
  nodeGap?: number;
  /** Keep at most this many nodes per column; the rest roll into one "other". */
  topN?: number;
}

export interface SankeyLayoutNode {
  id: string;
  label: string;
  value: number;
  depth: number;
  kind?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SankeyLayoutLink {
  id: string;
  source: string;
  target: string;
  value: number;
  kind?: string;
  /** SVG path `d` for a closed ribbon, ready for `<path d={...} />`. */
  path: string;
}

export interface SankeyLayout {
  nodes: SankeyLayoutNode[];
  links: SankeyLayoutLink[];
  columns: number;
  /** No positive flow to draw — the caller should show an empty state. */
  empty: boolean;
}

const DEFAULT_NODE_WIDTH = 0.06;
const DEFAULT_NODE_GAP = 0.02;
const DEFAULT_TOP_N = 8;

/** Trim to a sane precision so path strings stay short and stable across runs. */
const r = (n: number) => Math.round(n * 10000) / 10000;

interface Placed {
  node: SankeyLayoutNode;
  inCursor: number;
  outCursor: number;
}

/**
 * Lay a track out as a layered Sankey.
 *
 * The vertical scale is set by the LARGEST column, not by the source total:
 * flow through a holon is not conserved (it can spend more in a window than it
 * took in), so scaling to the inputs alone would push a heavier column off
 * canvas.
 */
export function layoutSankey(
  track: ValueFlowTrack,
  opts: SankeyOptions = {},
): SankeyLayout {
  const w = opts.nodeWidth ?? DEFAULT_NODE_WIDTH;
  const gap = opts.nodeGap ?? DEFAULT_NODE_GAP;
  const topN = opts.topN ?? DEFAULT_TOP_N;

  const positive = (track.nodes ?? []).filter(
    (n) => Number.isFinite(n.value) && n.value > 0,
  );
  if (positive.length === 0) {
    return { nodes: [], links: [], columns: 0, empty: true };
  }

  // Group by column, then cap each column.
  const byDepth = new Map<number, typeof positive>();
  for (const node of positive) {
    const d = Math.max(0, Math.floor(node.depth));
    const bucket = byDepth.get(d);
    if (bucket) bucket.push(node);
    else byDepth.set(d, [node]);
  }

  // Nodes dropped by the top-N cap. Their links get retargeted onto the rollup
  // node so the ribbons still add up instead of silently vanishing.
  const rollupOf = new Map<string, string>();
  const kept = new Map<string, SankeyLayoutNode>();

  for (const [depth, group] of byDepth) {
    const sorted = [...group].sort((a, b) => b.value - a.value);
    const head = sorted.slice(0, topN);
    const tail = sorted.slice(topN);

    for (const n of head) {
      kept.set(n.id, {
        id: n.id,
        label: n.label,
        value: n.value,
        depth,
        kind: n.kind,
        x: 0,
        y: 0,
        w,
        h: 0,
      });
    }
    if (tail.length > 0) {
      const id = `__other_${depth}`;
      const total = tail.reduce((s, n) => s + n.value, 0);
      for (const n of tail) rollupOf.set(n.id, id);
      kept.set(id, {
        id,
        label: `+${tail.length} more`,
        value: total,
        depth,
        kind: 'other',
        x: 0,
        y: 0,
        w,
        h: 0,
      });
    }
  }

  const resolve = (id: string) => rollupOf.get(id) ?? id;

  // Merge links, following any rollup retargeting.
  const merged = new Map<string, ValueFlowLink>();
  for (const link of track.links ?? []) {
    if (!Number.isFinite(link.value) || link.value <= 0) continue;
    const source = resolve(link.source);
    const target = resolve(link.target);
    if (source === target) continue; // one rollup swallowed both ends
    if (!kept.has(source) || !kept.has(target)) continue;
    const key = `${source} ${target}`;
    const seen = merged.get(key);
    if (seen) seen.value += link.value;
    else
      merged.set(key, {
        id: link.id,
        source,
        target,
        value: link.value,
        kind: link.kind,
      });
  }
  const links = [...merged.values()];

  const columnNodes = new Map<number, SankeyLayoutNode[]>();
  for (const node of kept.values()) {
    const bucket = columnNodes.get(node.depth);
    if (bucket) bucket.push(node);
    else columnNodes.set(node.depth, [node]);
  }

  const depths = [...columnNodes.keys()].sort((a, b) => a - b);
  const columns = depths[depths.length - 1] + 1;

  // Vertical scale: the heaviest column.
  let total = 0;
  for (const group of columnNodes.values()) {
    total = Math.max(
      total,
      group.reduce((s, n) => s + n.value, 0),
    );
  }
  if (total <= 0) return { nodes: [], links: [], columns: 0, empty: true };

  // Order each column, then stack it. Column 0 goes by value; every later
  // column by the mean y of its incoming sources (the barycentre heuristic),
  // which is what keeps ribbons from crossing needlessly. One pass is plenty at
  // this size, and the allocation tree comes out crossing-free.
  const placed = new Map<string, Placed>();
  const incoming = new Map<string, ValueFlowLink[]>();
  for (const link of links) {
    const bucket = incoming.get(link.target);
    if (bucket) bucket.push(link);
    else incoming.set(link.target, [link]);
  }

  const usableFor = (depth: number) => {
    const count = columnNodes.get(depth)?.length ?? 1;
    return Math.max(0, 1 - gap * Math.max(0, count - 1));
  };

  for (const depth of depths) {
    const group = columnNodes.get(depth)!;
    if (depth === depths[0]) {
      group.sort((a, b) => b.value - a.value);
    } else {
      const barycentre = (node: SankeyLayoutNode) => {
        const ins = incoming.get(node.id) ?? [];
        let weight = 0;
        let acc = 0;
        for (const link of ins) {
          const src = placed.get(link.source);
          if (!src) continue;
          acc += (src.node.y + src.node.h / 2) * link.value;
          weight += link.value;
        }
        // No placed parent (an orphan, or a column-skipping link whose source
        // lands later): sink it to the bottom rather than letting NaN scramble
        // the comparator.
        return weight > 0 ? acc / weight : Number.POSITIVE_INFINITY;
      };
      const keys = new Map(group.map((n) => [n.id, barycentre(n)] as const));
      group.sort(
        (a, b) => keys.get(a.id)! - keys.get(b.id)! || b.value - a.value,
      );
    }

    const usable = usableFor(depth);
    const x = columns === 1 ? (1 - w) / 2 : (depth * (1 - w)) / (columns - 1);
    let y = 0;
    for (const node of group) {
      node.x = r(x);
      node.y = r(y);
      node.h = r((node.value / total) * usable);
      placed.set(node.id, { node, inCursor: node.y, outCursor: node.y });
      y += node.h + gap;
    }
  }

  // Ribbons. Each node keeps separate in/out cursors so incoming and outgoing
  // ribbons stack independently and never overlap on the same edge. Drawing in
  // visual order makes that stacking follow the node order chosen above.
  links.sort((a, b) => {
    const sa = placed.get(a.source)!.node;
    const sb = placed.get(b.source)!.node;
    return (
      sa.y - sb.y || placed.get(a.target)!.node.y - placed.get(b.target)!.node.y
    );
  });

  const laidOut: SankeyLayoutLink[] = [];
  for (const link of links) {
    const from = placed.get(link.source)!;
    const to = placed.get(link.target)!;

    // Thickness is measured against each end's own column scale, so a ribbon
    // meets a node edge exactly even when the two columns hold different counts.
    const sh = (link.value / total) * usableFor(from.node.depth);
    const th = (link.value / total) * usableFor(to.node.depth);

    const y0t = from.outCursor;
    const y0b = y0t + sh;
    const y1t = to.inCursor;
    const y1b = y1t + th;
    from.outCursor = y0b;
    to.inCursor = y1b;

    const x0 = from.node.x + w;
    const x1 = to.node.x;
    const xm = (x0 + x1) / 2;

    laidOut.push({
      id: link.id,
      source: link.source,
      target: link.target,
      value: link.value,
      kind: link.kind,
      path:
        `M${r(x0)},${r(y0t)}` +
        `C${r(xm)},${r(y0t)} ${r(xm)},${r(y1t)} ${r(x1)},${r(y1t)}` +
        `L${r(x1)},${r(y1b)}` +
        `C${r(xm)},${r(y1b)} ${r(xm)},${r(y0b)} ${r(x0)},${r(y0b)}Z`,
    });
  }

  return { nodes: [...kept.values()], links: laidOut, columns, empty: false };
}
