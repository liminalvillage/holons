// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The flow graph as a network — who funds whom, pulled together by the links.
 *
 * `layoutFlowSpace` places each party beside its largest payer: a tree, so a
 * project five funds back stands by one of them. Here every link pulls: a
 * project funded by two funds settles between them, funds that back the same
 * projects drift close, and a fund nobody shares with stands apart. It is the
 * same `FlowSpace` — the same discs, the same line widths — so every surface
 * that draws the one draws the other.
 *
 * By default only the funds and the projects take part (`FLOW_FORCE_KINDS`):
 * the Pot pays every fund and would pull all of them to itself, and the
 * people under each project would bury the links between funds and projects.
 * A party with no link inside the chosen kinds is left out.
 *
 * A force simulation, but no randomness: the start is laid out from the
 * graph and the run is a fixed number of steps, so the same graph is the same
 * shape on every device, every time. Repulsion is approximated with an
 * octree (Barnes–Hut), so two thousand parties settle in a few hundred milliseconds. Pure.
 */

import type { FlowPartyKind } from './flow-graph.js';
import type { FlowGraphIndex } from './flow-graph-index.js';
import {
  FLOW_SPACE_ROOT_RADIUS,
  flowSpaceLinkId,
  flowSpaceRadius,
  flowSpaceWidth,
  type FlowSpace,
  type FlowSpaceLink,
  type FlowSpaceNode,
} from './flow-graph-space.js';

export const FLOW_FORCE_KINDS: readonly FlowPartyKind[] = ['fund', 'project'];

export interface FlowForceOptions {
  /** Which parties take part. Default: funds and projects. */
  kinds?: readonly FlowPartyKind[];
  /** Simulation steps. More settles further; the default is plenty. */
  steps?: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Rest length of a link, beyond the two discs it joins. */
const SPRING = 0.9;
/** How hard every party pushes every other away (per unit of share-free weight). */
const CHARGE = 0.06;
/** Nothing pushes from further than this. */
const REACH = 12;
/** A cell this far off, for its size, counts as one body. */
const THETA = 1.2;
/** The pull back to the middle, so a lone cluster does not drift off. */
const GRAVITY = 0.02;
/** What a step keeps of the velocity. */
const KEEP = 0.6;
const ALPHA_MIN = 0.001;

type Vec = [number, number, number];

/** The `i`-th of `n` points spread evenly over a sphere of radius `r`. */
function onSphere(i: number, n: number, r: number): Vec {
  const y = n > 1 ? 1 - (2 * (i + 0.5)) / n : 0;
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = i * GOLDEN_ANGLE;
  return [Math.cos(phi) * ring * r, y * r, Math.sin(phi) * ring * r];
}

/** A small fixed offset for a party, from its id, so two that start on one spot part. */
function nudge(id: string, size: number): Vec {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const a = ((h >>> 0) % 1000) / 1000;
  const b = ((Math.imul(h, 2654435761) >>> 0) % 1000) / 1000;
  const c = ((Math.imul(h, 40503) >>> 0) % 1000) / 1000;
  return [(a - 0.5) * size, (b - 0.5) * size, (c - 0.5) * size];
}

interface Cell {
  /** Centre of charge and the charge it holds. */
  x: number;
  y: number;
  z: number;
  q: number;
  /** A leaf holds one body (or several on one spot). */
  body: number;
  more: number[] | null;
  kids: (Cell | null)[] | null;
  cx: number;
  cy: number;
  cz: number;
  half: number;
}

export function layoutFlowForce(index: FlowGraphIndex, opts: FlowForceOptions = {}): FlowSpace {
  const kinds = new Set(opts.kinds ?? FLOW_FORCE_KINDS);
  const steps = Math.max(1, Math.floor(opts.steps ?? 200));
  const rootId = index.graph.root;

  const inKind = (id: string) => {
    const n = index.byId.get(id);
    return !!n && kinds.has(n.kind);
  };
  const edges = index.graph.links.filter((l) => l.source !== l.target && inKind(l.source) && inKind(l.target));
  const linked = new Set<string>();
  for (const l of edges) {
    linked.add(l.source);
    linked.add(l.target);
  }
  // The largest first: a stable order, and the start places them first.
  const members = index.graph.nodes
    .filter((n) => linked.has(n.id))
    .sort((a, b) => b.share - a.share || (a.id < b.id ? -1 : 1));
  if (!members.length) return { nodes: [], links: [], radius: FLOW_SPACE_ROOT_RADIUS };

  const N = members.length;
  const at = new Map(members.map((n, i) => [n.id, i]));
  const r = Float64Array.from(members, (n) => flowSpaceRadius(n.share, n.id === rootId));
  const A = Int32Array.from(edges, (l) => at.get(l.source)!);
  const B = Int32Array.from(edges, (l) => at.get(l.target)!);
  const degree = new Int32Array(N);
  for (let e = 0; e < edges.length; e++) {
    degree[A[e]]++;
    degree[B[e]]++;
  }

  // ── The start: whoever pays nobody here on a sphere, the rest among their payers ──
  const px = new Float64Array(N);
  const py = new Float64Array(N);
  const pz = new Float64Array(N);
  const placed = new Uint8Array(N);
  const payers: number[][] = members.map(() => []);
  for (let e = 0; e < edges.length; e++) payers[B[e]].push(A[e]);
  const shell = Math.cbrt(N) * 1.6;
  const tops = members.map((_n, i) => i).filter((i) => payers[i].length === 0);
  tops.forEach((i, k) => {
    [px[i], py[i], pz[i]] = onSphere(k, tops.length, shell);
    placed[i] = 1;
  });
  // In waves: a party goes where its placed payers are, a little off.
  let pending = members.map((_n, i) => i).filter((i) => !placed[i]);
  while (pending.length) {
    const next: number[] = [];
    const wave: number[] = [];
    for (const i of pending) {
      const from = payers[i].filter((j) => placed[j]);
      if (!from.length) {
        next.push(i);
        continue;
      }
      const d = nudge(members[i].id, 1.2);
      px[i] = from.reduce((s, j) => s + px[j], 0) / from.length + d[0];
      py[i] = from.reduce((s, j) => s + py[j], 0) / from.length + d[1];
      pz[i] = from.reduce((s, j) => s + pz[j], 0) / from.length + d[2];
      wave.push(i);
    }
    for (const i of wave) placed[i] = 1;
    if (!wave.length) {
      // A ring of parties paying only each other: the first of it opens a spot on the sphere.
      const i = next.shift()!;
      [px[i], py[i], pz[i]] = onSphere(i, N, shell * 1.2);
      placed[i] = 1;
    }
    pending = next;
  }

  // ── The run ────────────────────────────────────────────────────────────
  const vx = new Float64Array(N);
  const vy = new Float64Array(N);
  const vz = new Float64Array(N);
  const charge = Float64Array.from(r, (ri) => -CHARGE * (1 + 4 * ri));
  const strength = Float64Array.from(edges, (_l, e) => 1 / Math.min(degree[A[e]], degree[B[e]]));
  const bias = Float64Array.from(edges, (_l, e) => degree[A[e]] / (degree[A[e]] + degree[B[e]]));
  const rest = Float64Array.from(edges, (_l, e) => SPRING + r[A[e]] + r[B[e]]);
  const decay = 1 - Math.pow(ALPHA_MIN, 1 / steps);
  let alpha = 1;

  const build = (): Cell => {
    const lo: Vec = [Infinity, Infinity, Infinity];
    const hi: Vec = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < N; i++) {
      if (px[i] < lo[0]) lo[0] = px[i];
      if (py[i] < lo[1]) lo[1] = py[i];
      if (pz[i] < lo[2]) lo[2] = pz[i];
      if (px[i] > hi[0]) hi[0] = px[i];
      if (py[i] > hi[1]) hi[1] = py[i];
      if (pz[i] > hi[2]) hi[2] = pz[i];
    }
    const half = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-6) / 2 + 1e-6;
    const root = cell((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2, half);
    for (let i = 0; i < N; i++) insert(root, i, 0);
    total(root);
    return root;
  };
  const cell = (cx: number, cy: number, cz: number, half: number): Cell => ({
    x: 0, y: 0, z: 0, q: 0, body: -1, more: null, kids: null, cx, cy, cz, half,
  });
  const octant = (c: Cell, i: number) => (px[i] >= c.cx ? 1 : 0) | (py[i] >= c.cy ? 2 : 0) | (pz[i] >= c.cz ? 4 : 0);
  const insert = (c: Cell, i: number, depth: number): void => {
    if (c.kids) {
      const o = octant(c, i);
      const h = c.half / 2;
      c.kids[o] ??= cell(c.cx + (o & 1 ? h : -h), c.cy + (o & 2 ? h : -h), c.cz + (o & 4 ? h : -h), h);
      insert(c.kids[o]!, i, depth + 1);
      return;
    }
    if (c.body < 0) {
      c.body = i;
      return;
    }
    // Two on one spot (or as deep as it is worth going): they share the leaf.
    const j = c.body;
    if (depth > 24 || (px[i] === px[j] && py[i] === py[j] && pz[i] === pz[j])) {
      (c.more ??= []).push(i);
      return;
    }
    c.kids = [null, null, null, null, null, null, null, null];
    const stay = [j, ...(c.more ?? [])];
    c.body = -1;
    c.more = null;
    for (const k of stay) insert(c, k, depth);
    insert(c, i, depth);
  };
  const total = (c: Cell): void => {
    let q = 0, x = 0, y = 0, z = 0;
    const add = (i: number) => {
      q += charge[i];
      x += charge[i] * px[i];
      y += charge[i] * py[i];
      z += charge[i] * pz[i];
    };
    if (c.kids) {
      for (const k of c.kids) {
        if (!k) continue;
        total(k);
        q += k.q;
        x += k.q * k.x;
        y += k.q * k.y;
        z += k.q * k.z;
      }
    } else {
      if (c.body >= 0) add(c.body);
      for (const i of c.more ?? []) add(i);
    }
    c.q = q;
    [c.x, c.y, c.z] = q ? [x / q, y / q, z / q] : [c.cx, c.cy, c.cz];
  };
  const push = (c: Cell, i: number): void => {
    const dx = c.x - px[i];
    const dy = c.y - py[i];
    const dz = c.z - pz[i];
    const l = dx * dx + dy * dy + dz * dz;
    const size = c.half * 2;
    if (c.kids && size * size < THETA * THETA * l) {
      if (l < REACH * REACH) {
        const k = (c.q * alpha) / l;
        vx[i] += dx * k;
        vy[i] += dy * k;
        vz[i] += dz * k;
      }
      return;
    }
    if (c.kids) {
      for (const k of c.kids) if (k) push(k, i);
      return;
    }
    if (c.body >= 0) near(c.body, i);
    if (c.more) for (const j of c.more) near(j, i);
  };
  /** One body on another, close enough to count one by one. */
  const near = (j: number, i: number): void => {
    if (j === i) return;
    let dx = px[j] - px[i];
    let dy = py[j] - py[i];
    let dz = pz[j] - pz[i];
    let l = dx * dx + dy * dy + dz * dz;
    if (l >= REACH * REACH) return;
    if (l < 1e-9) {
      // On one spot: part them along a fixed way, by who is who.
      [dx, dy, dz] = nudge(`${i}:${j}`, 1e-3);
      l = dx * dx + dy * dy + dz * dz + 1e-12;
    }
    l = Math.max(l, (r[i] + r[j]) * (r[i] + r[j]) * 0.25);
    const k = (charge[j] * alpha) / l;
    vx[i] += dx * k;
    vy[i] += dy * k;
    vz[i] += dz * k;
  };

  for (let step = 0; step < steps; step++) {
    alpha += (0 - alpha) * decay;
    // Links: each pulls its two ends toward its rest length, the busier end moving less.
    for (let e = 0; e < edges.length; e++) {
      const s = A[e];
      const t = B[e];
      let dx = px[t] + vx[t] - px[s] - vx[s];
      let dy = py[t] + vy[t] - py[s] - vy[s];
      let dz = pz[t] + vz[t] - pz[s] - vz[s];
      let l = Math.hypot(dx, dy, dz);
      if (l < 1e-9) {
        [dx, dy, dz] = nudge(`${e}`, 1e-3);
        l = Math.hypot(dx, dy, dz);
      }
      const k = ((l - rest[e]) / l) * alpha * strength[e];
      dx *= k;
      dy *= k;
      dz *= k;
      vx[t] -= dx * bias[e];
      vy[t] -= dy * bias[e];
      vz[t] -= dz * bias[e];
      vx[s] += dx * (1 - bias[e]);
      vy[s] += dy * (1 - bias[e]);
      vz[s] += dz * (1 - bias[e]);
    }
    // Every party pushes every other away.
    const tree = build();
    for (let i = 0; i < N; i++) push(tree, i);
    // And all are held toward the middle.
    for (let i = 0; i < N; i++) {
      vx[i] -= px[i] * GRAVITY * alpha;
      vy[i] -= py[i] * GRAVITY * alpha;
      vz[i] -= pz[i] * GRAVITY * alpha;
      px[i] += vx[i] *= KEEP;
      py[i] += vy[i] *= KEEP;
      pz[i] += vz[i] *= KEEP;
    }
  }

  // ── Centred on the largest, as the tree is on the root ──────────────────
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < N; i++) {
    mx += px[i] / N;
    my += py[i] / N;
    mz += pz[i] / N;
  }
  let radius = FLOW_SPACE_ROOT_RADIUS;
  const nodes: FlowSpaceNode[] = members.map((n, i) => {
    const x = px[i] - mx;
    const y = py[i] - my;
    const z = pz[i] - mz;
    radius = Math.max(radius, Math.hypot(x, y, z) + r[i]);
    const from = (index.into.get(n.id) ?? [])
      .filter((l) => l.source !== n.id && at.has(l.source) && inKind(l.source))
      .sort((a, b) => b.share - a.share || b.local - a.local || (a.source < b.source ? -1 : 1));
    return {
      id: n.id,
      label: n.label,
      kind: n.kind,
      share: n.share,
      x,
      y,
      z,
      r: r[i],
      // No hops in a network, and no root: who pays nobody here is 1, who is paid 2.
      depth: payers[i].length ? 2 : 1,
      parent: from[0]?.source ?? null,
      reached: n.share > 0,
    };
  });

  const links: FlowSpaceLink[] = edges
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
