// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Ventures — projects and quests as one thing, on one fractal.
 *
 * A project (a holon a fund seats) and a quest (an entry on a fund's
 * `quest_board`) are the same shape here: a VENTURE with inputs it needs and
 * outputs it yields, people standing in it by role, and a financial
 * bandwidth. They differ only in where they are stored, which `origin` says.
 *
 * Every level reads the same way, so a reader can go down as far as the
 * links go:
 *
 *   pot → funds → ventures → people → the people they forward to → …
 *
 * A venture's children are the ventures under it (a project's own quests,
 * whatever it pays that is a venture) and its people. A person's children
 * are whoever their own split forwards to. One party is one node, whatever
 * the number of places it stands: `parents` lists them all and a person's
 * `roles` say what they are in each.
 *
 * Roles: in a project a person is a `member` (its interior split) or `paid`
 * (its rings). On a quest they are the `proposer`, `in`, `curious`, or
 * `covers` a need by pledging to it. A need counted in people is a role to
 * fill, so standing in it covers it.
 *
 * Coverage is how much of what a venture needs has been committed, 0…1: a
 * quest's own (`foldQuestBoard`), a project's over the needs of its live
 * quests. A fund, the Pot, read the mean of what is under them, weighted by
 * the share each carries.
 *
 * Bandwidth is the financial pipe drawn for a party: the share of the Pot
 * reaching it, widened by what is committed — `share × (1 + coverage)`.
 * It is SHOWN, not paid: the cut still pays `share` (`cascade.ts`). It says
 * to a fund where resources have already gathered, so money can follow.
 *
 * Pure: a graph and quests in, a fractal out.
 */

import type { BoardQuest, QuestState } from '../tasks/board.js';
import type { FlowGraphIndex } from './flow-graph-index.js';
import type { FlowGraphNode } from './flow-graph.js';

export type FractalKind = 'pot' | 'fund' | 'venture' | 'person';
/** Where a venture is kept: a holon in the flow graph, or a quest on a board. */
export type VentureOrigin = 'project' | 'quest';
export type FractalRole = 'member' | 'paid' | 'proposer' | 'in' | 'curious' | 'covers';

/** An input a venture needs. */
export interface VentureNeed {
  id: string;
  label: string;
  quantity: number;
  unit?: string;
  covered: number;
  by: string[];
  /** The quest it is asked on. */
  quest: string;
}

/** An output a venture yields. */
export interface VentureYield {
  label: string;
  quantity?: number;
  unit?: string;
  /** The quest that promises it. */
  quest: string;
}

/** What a person is in one place. */
export interface FractalStanding {
  at: string;
  role: FractalRole;
  /** For `covers`: the need's label. */
  need?: string;
}

export interface FractalNode {
  id: string;
  kind: FractalKind;
  label: string;
  description?: string;
  /** Ventures only. */
  origin?: VentureOrigin;
  /** A seat nobody has claimed yet. */
  unclaimed?: boolean;
  /** Quests: where it stands. */
  state?: QuestState;
  /** Quests: the fund whose board it is on. */
  board?: string;
  /** Share of the Pot reaching it, 0…100 — what the cut pays. */
  share: number;
  /** How much of what it needs is committed, 0…1. */
  coverage: number;
  /** `share × (1 + coverage)`: shown, not paid. */
  bandwidth: number;
  needs: VentureNeed[];
  yields: VentureYield[];
  /** Needs still open, here and in the ventures right under it. */
  openNeeds: number;
  /** People: what they are, where. */
  roles: FractalStanding[];
  /** One level down, widest bandwidth first. */
  children: string[];
  /** Everywhere it stands one level up. */
  parents: string[];
}

export interface Fractal {
  root: string;
  byId: Map<string, FractalNode>;
}

/** The financial pipe drawn for a share once `coverage` of its needs are committed. */
export const ventureBandwidth = (share: number, coverage: number): number =>
  Math.max(0, share) * (1 + Math.min(1, Math.max(0, coverage)));

const LIVE: ReadonlySet<QuestState> = new Set(['open', 'assembled']);

const shortId = (id: string) => (id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id);

function kindOf(n: FlowGraphNode): FractalKind {
  if (n.kind === 'pot') return 'pot';
  if (n.kind === 'fund') return 'fund';
  if (n.kind === 'person') return 'person';
  return 'venture';
}

/**
 * The fractal over a flow graph and the quests read off its funds' boards.
 *
 * A quest sits under the holon it names when that is a venture or a fund in
 * the graph, else under its board.
 */
export function buildFractal(index: FlowGraphIndex, quests: readonly BoardQuest[] = []): Fractal {
  const root = index.graph.root;
  const byId = new Map<string, FractalNode>();
  const edges = new Map<string, Map<string, number>>();

  const node = (id: string, init: () => Omit<FractalNode, 'children' | 'parents' | 'roles' | 'needs' | 'yields' | 'openNeeds' | 'coverage' | 'bandwidth'>) => {
    let n = byId.get(id);
    if (!n) {
      n = { ...init(), coverage: 0, bandwidth: 0, needs: [], yields: [], openNeeds: 0, roles: [], children: [], parents: [] };
      byId.set(id, n);
    }
    return n;
  };
  const link = (from: string, to: string, weight: number) => {
    if (from === to) return;
    let m = edges.get(from);
    if (!m) edges.set(from, (m = new Map()));
    m.set(to, (m.get(to) ?? 0) + weight);
  };
  const stand = (person: FractalNode, s: FractalStanding) => {
    if (!person.roles.some((r) => r.at === s.at && r.role === s.role && r.need === s.need)) person.roles.push(s);
  };

  for (const g of index.graph.nodes) {
    const kind = kindOf(g);
    node(g.id, () => ({
      id: g.id,
      kind,
      label: g.label || shortId(g.id),
      ...(g.description ? { description: g.description } : {}),
      ...(kind === 'venture' ? { origin: 'project' as const } : {}),
      ...(g.kind === 'placeholder' ? { unclaimed: true } : {}),
      share: g.share,
    }));
  }
  for (const l of index.graph.links) {
    const from = byId.get(l.source);
    const to = byId.get(l.target);
    if (!from || !to) continue;
    link(l.source, l.target, l.share);
    if (to.kind === 'person' && from.kind !== 'person') stand(to, { at: from.id, role: l.via === 'interior' ? 'member' : 'paid' });
  }

  // Quests: a venture each, its people by role.
  const person = (id: string, q: BoardQuest) => {
    const n = node(id, () => ({ id, kind: 'person', label: q.names?.[id] || shortId(id), share: 0 }));
    if (n.label === shortId(id) && q.names?.[id]) n.label = q.names[id];
    return n;
  };
  for (const q of quests) {
    if (byId.has(q.id)) continue;
    const v = node(q.id, () => ({
      id: q.id,
      kind: 'venture',
      origin: 'quest',
      label: q.title,
      ...(q.description ? { description: q.description } : {}),
      state: q.state,
      ...(q.board ? { board: q.board } : {}),
      share: 0,
    }));
    v.needs = q.needs.map((n) => ({
      id: n.id,
      label: n.label,
      quantity: n.quantity,
      ...(n.unit ? { unit: n.unit } : {}),
      covered: n.covered,
      by: [...n.by],
      quest: q.id,
    }));
    v.yields = (q.yields ?? []).map((y) => ({ ...y, quest: q.id }));
    v.coverage = q.coverage;
    const at = (q.holon && byId.get(q.holon)?.kind !== 'person' && byId.has(q.holon) ? q.holon : null) ?? (q.board && byId.has(q.board) ? q.board : null);
    if (at) link(at, q.id, 0);
    const people: [string, FractalStanding][] = [
      [q.proposer, { at: q.id, role: 'proposer' }],
      ...q.participants.map((p): [string, FractalStanding] => [String(p.id), { at: q.id, role: 'in' }]),
      ...q.curious.map((p): [string, FractalStanding] => [p, { at: q.id, role: 'curious' }]),
      ...q.pledges
        .filter((p) => !p.released)
        .map((p): [string, FractalStanding] => [p.party, { at: q.id, role: 'covers', need: q.needs.find((n) => n.id === p.need)?.label }]),
    ];
    for (const [id, s] of people) {
      if (!id) continue;
      stand(person(id, q), s.need ? s : { at: s.at, role: s.role });
      link(q.id, id, 0);
    }
  }

  // Children and parents, widest first.
  for (const [from, m] of edges) {
    const n = byId.get(from)!;
    for (const to of m.keys()) byId.get(to)!.parents.push(from);
    n.children = [...m.keys()];
  }

  // A project's needs and yields are its live quests'; coverage and
  // bandwidth roll up from the bottom, a cycle read once.
  const done = new Set<string>();
  const visiting = new Set<string>();
  const roll = (id: string): void => {
    if (done.has(id) || visiting.has(id)) return;
    visiting.add(id);
    const n = byId.get(id)!;
    for (const c of n.children) roll(c);
    const kids = n.children.map((c) => byId.get(c)!);
    if (n.kind === 'venture' && n.origin === 'project') {
      for (const q of kids) {
        if (q.origin !== 'quest') continue;
        n.yields.push(...q.yields);
        if (q.state && LIVE.has(q.state)) n.needs.push(...q.needs);
      }
      n.coverage = n.needs.length ? n.needs.reduce((s, x) => s + Math.min(1, x.covered / x.quantity), 0) / n.needs.length : 0;
    } else if (n.kind === 'fund' || n.kind === 'pot') {
      const under = kids.filter((k) => k.kind === 'venture' || k.kind === 'fund');
      const w = under.map((k) => edges.get(id)?.get(k.id) ?? 0);
      const total = w.reduce((s, x) => s + x, 0);
      n.coverage = under.length
        ? total > 0
          ? under.reduce((s, k, i) => s + k.coverage * w[i], 0) / total
          : under.reduce((s, k) => s + k.coverage, 0) / under.length
        : 0;
    }
    const own = n.needs.filter((x) => x.covered < x.quantity).length;
    n.openNeeds = n.kind === 'person' ? 0 : own + kids.filter((k) => k.kind !== 'person').reduce((s, k) => s + (k.kind === 'venture' && k.origin === 'quest' && n.origin === 'project' ? 0 : k.openNeeds), 0);
    n.bandwidth = ventureBandwidth(n.share, n.coverage);
    visiting.delete(id);
    done.add(id);
  };
  if (byId.has(root)) roll(root);
  for (const id of byId.keys()) roll(id);

  const rank = (a: FractalNode, z: FractalNode) =>
    z.bandwidth - a.bandwidth || z.coverage - a.coverage || (a.label < z.label ? -1 : a.label > z.label ? 1 : 0);
  for (const n of byId.values()) {
    n.children.sort((a, z) => rank(byId.get(a)!, byId.get(z)!));
    n.parents.sort((a, z) => rank(byId.get(a)!, byId.get(z)!));
  }
  return { root, byId };
}

/** Everywhere a person stands, besides `here`: the ventures and funds of their roles. */
export function alsoIn(fractal: Fractal, personId: string, here?: string): FractalNode[] {
  const n = fractal.byId.get(personId);
  if (!n) return [];
  const seen = new Set<string>();
  const out: FractalNode[] = [];
  for (const r of n.roles) {
    if (r.at === here || seen.has(r.at)) continue;
    seen.add(r.at);
    const at = fractal.byId.get(r.at);
    if (at) out.push(at);
  }
  return out;
}

/**
 * The shortest way down from `from` to `to` through children (both included),
 * the widest branches first; null when `to` is not under `from`.
 */
export function fractalWay(fractal: Fractal, from: string, to: string, maxDepth = 8): string[] | null {
  if (!fractal.byId.has(from) || !fractal.byId.has(to)) return null;
  if (from === to) return [from];
  const via = new Map<string, string>([[from, '']]);
  let ring = [from];
  for (let depth = 0; depth < maxDepth && ring.length; depth++) {
    const next: string[] = [];
    for (const id of ring) {
      for (const c of fractal.byId.get(id)!.children) {
        if (via.has(c)) continue;
        via.set(c, id);
        if (c === to) {
          const way = [to];
          for (let at = id; at; at = via.get(at)!) way.unshift(at);
          return way;
        }
        next.push(c);
      }
    }
    ring = next;
  }
  return null;
}

/** A way down from the root to `id`, through the widest parents; the root alone when there is none. */
export function fractalPath(fractal: Fractal, id: string): string[] {
  if (!fractal.byId.has(id)) return [fractal.root];
  const path = [id];
  const seen = new Set(path);
  let at = id;
  while (at !== fractal.root) {
    const up = fractal.byId.get(at)!.parents.find((p) => !seen.has(p));
    if (!up) break;
    path.unshift(up);
    seen.add(up);
    at = up;
  }
  if (path[0] !== fractal.root) path.unshift(fractal.root);
  return path;
}
