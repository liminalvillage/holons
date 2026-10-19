// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The flow graph in space — every party once, placed where an eye can turn it.
 *
 * The Sankey answers "where does it go" for a few named bars. This answers
 * "what does the whole of it look like": the Pot in the middle, whoever it
 * pays around it, whoever THEY pay beyond them, two thousand parties deep. A
 * surface projects it, turns it and zooms it; where each party stands and how
 * much each line carries is said here, once, so every surface draws the same
 * ecosystem.
 *
 * What the drawing means:
 *
 *   a link's `width`  — its bandwidth: LINEAR in the share of the root pot
 *                       that travels it, on the scale where the whole pot is
 *                       as wide as the root itself. Twice the funds, twice
 *                       the line. A link that carries nothing has none.
 *   a node's `r`      — its disc holds its share: the radius goes with the
 *                       square root, floored so a small party is still there.
 *   a node's place    — beside whoever pays it most. A party paid along
 *                       several ways stands with the largest; the other ways
 *                       in are still drawn, across the space.
 *
 * A holon the root does not reach (`share` 0) has no way in: it and what it
 * pays stand on a shell outside everything the pot does reach.
 *
 * No simulation and no randomness: the same graph is the same shape, on every
 * device, every time. Pure.
 */

import type { FlowGraphLink, FlowPartyKind } from './flow-graph.js';
import type { FlowGraphIndex } from './flow-graph-index.js';

export interface FlowSpaceNode {
  id: string;
  label: string;
  kind: FlowPartyKind;
  /** Share of the root pot that reaches this party, 0..100. */
  share: number;
  x: number;
  y: number;
  z: number;
  /** Radius, in the units of the coordinates. */
  r: number;
  /** Hops from the root along the placement tree. */
  depth: number;
  /** Whoever it stands beside: its largest payer. Null for the root and for a holon nobody reaches. */
  parent: string | null;
  /** False when the root pot does not reach it. */
  reached: boolean;
}

export interface FlowSpaceLink {
  id: string;
  source: string;
  target: string;
  /** Share of the root pot travelling it, 0..100. */
  share: number;
  /** Percent of the source's own split. */
  local: number;
  via: 'interior' | 'exterior';
  /** Its bandwidth, in the units of the coordinates: linear in `share`. */
  width: number;
}

export interface FlowSpace {
  /** The root first, then by depth. */
  nodes: FlowSpaceNode[];
  /** Widest first. */
  links: FlowSpaceLink[];
  /** A sphere about the origin (the root) that holds every node. */
  radius: number;
}

/** The root's radius: the unit everything else is measured in. */
export const FLOW_SPACE_ROOT_RADIUS = 1;
/** No party is drawn smaller than this, however little reaches it. */
export const FLOW_SPACE_MIN_RADIUS = 0.07;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Half-angle of the cone a party's own payees fan out in, away from its payer. */
const CONE = (100 * Math.PI) / 180;
/** How much of the fan's surface the payees may cover before it grows. */
const PACKING = 0.5;
/** Room a party keeps round itself, as a multiple of its radius. */
const PAD = 1.6;

export function flowSpaceLinkId(source: string, target: string): string {
  return `${source}\u0000${target}`;
}

const radiusOf = (share: number, isRoot: boolean): number =>
  isRoot
    ? FLOW_SPACE_ROOT_RADIUS
    : Math.max(FLOW_SPACE_MIN_RADIUS, FLOW_SPACE_ROOT_RADIUS * Math.sqrt(Math.max(0, share) / 100) * 0.8);

/** The width of a link carrying `share` percent of the root pot. */
export function flowSpaceWidth(share: number): number {
  return (2 * FLOW_SPACE_ROOT_RADIUS * Math.max(0, share)) / 100;
}

type Vec = [number, number, number];

/** Two unit vectors that, with `axis`, make a right-handed frame. */
function frameOf(axis: Vec): [Vec, Vec] {
  const [x, y, z] = axis;
  const ref: Vec = Math.abs(y) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let u: Vec = [ref[1] * z - ref[2] * y, ref[2] * x - ref[0] * z, ref[0] * y - ref[1] * x];
  const len = Math.hypot(u[0], u[1], u[2]) || 1;
  u = [u[0] / len, u[1] / len, u[2] / len];
  const v: Vec = [y * u[2] - z * u[1], z * u[0] - x * u[2], x * u[1] - y * u[0]];
  return [u, v];
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/**
 * Which of `n` places on the fan the `i`-th largest takes. Taken in order the
 * largest would crowd one pole; a stride near the golden cut, coprime to `n`,
 * deals them round it instead. The largest keeps the axis.
 */
function seatOf(i: number, n: number): number {
  if (n < 4) return i;
  let stride = Math.max(1, Math.round(n * 0.6180339887));
  while (gcd(stride, n) !== 1) stride++;
  return (i * stride) % n;
}

/** The `i`-th of `n` directions spread evenly over the cap of half-angle `cone` about `axis`. */
function fan(axis: Vec, cone: number, i: number, n: number): Vec {
  // The first sits on the axis: an only payee carries straight on.
  const t = n > 0 ? (i + 0.5 - 0.5 / n) / n : 0;
  const cos = 1 - t * (1 - Math.cos(cone));
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  const phi = i * GOLDEN_ANGLE;
  const [u, v] = frameOf(axis);
  const a = Math.cos(phi) * sin;
  const b = Math.sin(phi) * sin;
  return [a * u[0] + b * v[0] + cos * axis[0], a * u[1] + b * v[1] + cos * axis[1], a * u[2] + b * v[2] + cos * axis[2]];
}

interface Placing {
  id: string;
  r: number;
  children: Placing[];
  /** Radius of a ball about this party that holds everything placed under it. */
  ball: number;
  /** How far each child stands from it, in `children` order. */
  reach: number[];
}

export function layoutFlowSpace(index: FlowGraphIndex): FlowSpace {
  const { graph, byId, out, into } = index;
  const rootId = graph.root;
  if (!byId.has(rootId)) return { nodes: [], links: [], radius: FLOW_SPACE_ROOT_RADIUS };

  // ── Who stands beside whom ──────────────────────────────────────────────
  const depth = new Map<string, number>();
  const walk = (start: string, from: number) => {
    depth.set(start, from);
    let level = [start];
    while (level.length) {
      const next: string[] = [];
      for (const id of level) {
        const d = depth.get(id)!;
        for (const link of out.get(id) ?? []) {
          if (depth.has(link.target) || !byId.has(link.target)) continue;
          depth.set(link.target, d + 1);
          next.push(link.target);
        }
      }
      level = next;
    }
  };
  walk(rootId, 0);
  const reached = new Set(depth.keys());

  // What the pot does not reach: each holon nobody pays opens its own cluster.
  const strays: string[] = [];
  const unreached = graph.nodes
    .filter((n) => !reached.has(n.id))
    .sort(
      (a, b) =>
        (into.get(a.id)?.length ?? 0) - (into.get(b.id)?.length ?? 0) ||
        (out.get(b.id)?.length ?? 0) - (out.get(a.id)?.length ?? 0) ||
        (a.id < b.id ? -1 : 1),
    );
  for (const node of unreached) {
    if (depth.has(node.id)) continue;
    strays.push(node.id);
    walk(node.id, 1);
  }

  const heavier = (a: FlowGraphLink, b: FlowGraphLink) =>
    b.share - a.share || b.local - a.local || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0);
  const parent = new Map<string, string | null>();
  for (const node of graph.nodes) {
    const d = depth.get(node.id)!;
    const ways = (into.get(node.id) ?? []).filter((l) => depth.get(l.source) === d - 1).sort(heavier);
    parent.set(node.id, node.id === rootId ? null : (ways[0]?.source ?? null));
  }

  const placing = new Map<string, Placing>();
  for (const node of graph.nodes) {
    placing.set(node.id, { id: node.id, r: radiusOf(node.share, node.id === rootId), children: [], ball: 0, reach: [] });
  }
  for (const node of graph.nodes) {
    const p = parent.get(node.id);
    if (p != null) placing.get(p)!.children.push(placing.get(node.id)!);
  }

  // ── How much room each needs, leaves first ──────────────────────────────
  const deepestFirst = [...graph.nodes].sort((a, b) => depth.get(b.id)! - depth.get(a.id)!);
  for (const node of deepestFirst) {
    const p = placing.get(node.id)!;
    if (!p.children.length) {
      p.ball = p.r * PAD;
      continue;
    }
    const shareOf = (c: Placing) => byId.get(c.id)!.share;
    p.children.sort((a, b) => shareOf(b) - shareOf(a) || b.ball - a.ball || (a.id < b.id ? -1 : 1));
    const covered = node.id === rootId ? 1 : (1 - Math.cos(CONE)) / 2;
    const area = p.children.reduce((sum, c) => sum + c.ball * c.ball, 0);
    const shell = Math.sqrt(area / (4 * covered * PACKING));
    // A payee with much under it stands further off, so what is under it has room.
    p.reach = p.children.map((c) => Math.max(shell, p.r + c.r) + c.ball * 0.6);
    p.ball = p.children.reduce((max, c, i) => Math.max(max, p.reach[i] + c.ball), p.r * PAD);
  }

  // ── Where each stands, root first ───────────────────────────────────────
  const at = new Map<string, Vec>();
  const place = (p: Placing, here: Vec, axis: Vec, whole: boolean) => {
    at.set(p.id, here);
    const n = p.children.length;
    p.children.forEach((child, i) => {
      const dir = fan(axis, whole ? Math.PI : CONE, seatOf(i, n), n);
      const L = p.reach[i];
      place(child, [here[0] + dir[0] * L, here[1] + dir[1] * L, here[2] + dir[2] * L], dir, false);
    });
  };
  const root = placing.get(rootId)!;
  place(root, [0, 0, 0], [0, 1, 0], true);

  if (strays.length) {
    const clusters = strays.map((id) => placing.get(id)!);
    const widest = clusters.reduce((max, c) => Math.max(max, c.ball), 0);
    const area = clusters.reduce((sum, c) => sum + c.ball * c.ball, 0);
    const shell = Math.max(root.ball + widest, Math.sqrt(area / (4 * PACKING)));
    clusters.forEach((cluster, i) => {
      const dir = fan([0, 1, 0], Math.PI, i, clusters.length);
      place(cluster, [dir[0] * shell, dir[1] * shell, dir[2] * shell], dir, false);
    });
  }

  let radius = FLOW_SPACE_ROOT_RADIUS;
  const nodes: FlowSpaceNode[] = graph.nodes
    .map((node) => {
      const [x, y, z] = at.get(node.id)!;
      const r = placing.get(node.id)!.r;
      radius = Math.max(radius, Math.hypot(x, y, z) + r);
      return {
        id: node.id,
        label: node.label,
        kind: node.kind,
        share: node.share,
        x,
        y,
        z,
        r,
        depth: depth.get(node.id)!,
        parent: parent.get(node.id) ?? null,
        reached: reached.has(node.id),
      };
    })
    .sort((a, b) => Number(b.id === rootId) - Number(a.id === rootId) || a.depth - b.depth);

  const links: FlowSpaceLink[] = graph.links
    .filter((l) => at.has(l.source) && at.has(l.target) && l.source !== l.target)
    .map((l) => ({
      id: flowSpaceLinkId(l.source, l.target),
      source: l.source,
      target: l.target,
      share: l.share,
      local: l.local,
      via: l.via,
      width: flowSpaceWidth(l.share),
    }))
    .sort((a, b) => b.width - a.width);

  return { nodes, links, radius };
}
