// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Who gave what to whom: resource flows between parties, as a directed chord.
 *
 * The movement Sankey fans everything through the holon, which is the right
 * picture for "what came in and went out" and the wrong one for "who carries
 * whom". This module keeps both ends of every record: a matrix where
 * `matrix[i][j]` is what party `i` gave party `j`, one per unit, and the
 * geometry of the directed chord diagram drawn from it (the d3
 * `chordDirected` + `ribbonArrow` layout, ported as arithmetic — core carries
 * no chart dependency and the kiosk must not gain d3).
 *
 * The parties are the people AND the holon itself (and any partner holon a
 * record names): most of what a member gives, they give to the holon — a
 * shared expense, an hour of work, a finished quest — so a picture of people
 * alone would leave most of the holon out. The treasury is the holon's own
 * purse and is drawn as the holon. External payees (a shop an expense was
 * paid to) are not parties.
 *
 * What counts as a flow:
 *
 *   money   an expense's payer to each member of its split, their share (the
 *           canonical expenses lens — settlements are the same shape, debtor
 *           to creditor); `transfer:direct`; `credit:transfer`; library fees
 *           and deposits
 *   time    hours logged, from the time-tracking expenses and from
 *           `quest:time_logged`, the same hour counted once
 *   kudos   `appreciation:sent` (never its `received` mirror), quest
 *           initiatives and completions — the units the ledger reads them in
 *   items   stock produced, consumed and transferred, each in its own unit;
 *           `item:borrowed` as lends
 *
 * Units never mix, as everywhere in flows — each unit is its own matrix and
 * nothing sums across them.
 */

import type { REAEvent } from '../rea/index.js';
import { coerceSplitWith, normalizeCurrency } from '../expenses/index.js';
import { TREASURY_ID } from '../governance/index.js';
import type { BuildFlowsInput } from './build.js';
import { DEFAULT_LEDGER_WINDOW_DAYS } from './ledger.js';
import type { BreakdownRow } from './layout.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const EPSILON = 1e-6;

/** The rollup party that stands in for everyone past the top N. */
export const CHORD_OTHERS_ID = '__others';

/** Which kind of resource a people-flow track carries. */
export type PeopleFlowTrackId =
  | 'money'
  | 'time'
  | 'appreciation'
  | 'items'
  /** Every unit at once, on the share basis — see `combinePeopleTracks`. */
  | 'combined';

/** A person, or a holon — this one or a partner a record names. */
export type PeopleFlowPartyKind = 'person' | 'holon';

/** One party in a track, with what they gave and received in it. */
export interface PeopleFlowParty {
  id: string;
  label: string;
  kind: PeopleFlowPartyKind;
  given: number;
  received: number;
}

/** One unit-coherent matrix of flows between parties. */
export interface PeopleFlowTrack {
  id: PeopleFlowTrackId;
  /** Currency code, 'credit', 'hours', 'kudos', 'lends' or a stock unit. */
  unit: string;
  /** This holon first, then by label — a party keeps its place as the window moves. */
  parties: PeopleFlowParty[];
  /** `matrix[i][j]` is what `parties[i]` gave `parties[j]`. Diagonal is 0. */
  matrix: number[][];
  /** Everything that moved between two parties in this track. */
  total: number;
  /** How many flows fed it. */
  count: number;
}

export interface BuildPeopleFlowsInput extends BuildFlowsInput {
  /** Keep only flows this person gave or received — a personal view. */
  involving?: string | null;
}

interface Party {
  id: string;
  kind: PeopleFlowPartyKind;
}

type Agent = { id?: unknown; type?: unknown } | null | undefined;

class MatrixBuilder {
  private flows = new Map<string, Map<string, number>>();
  private parties = new Map<string, { label: string; kind: PeopleFlowPartyKind }>();
  count = 0;

  constructor(
    readonly id: PeopleFlowTrackId,
    readonly unit: string,
    private readonly first: string,
  ) {}

  add(from: Party, to: Party, value: number, label: (id: string) => string): void {
    const row = this.flows.get(from.id) ?? new Map<string, number>();
    row.set(to.id, (row.get(to.id) ?? 0) + value);
    this.flows.set(from.id, row);
    for (const p of [from, to]) {
      if (!this.parties.has(p.id)) this.parties.set(p.id, { label: label(p.id), kind: p.kind });
    }
    this.count += 1;
  }

  build(): PeopleFlowTrack {
    const ids = [...this.parties.keys()].sort((a, b) => {
      if (a === this.first || b === this.first) return a === this.first ? -1 : 1;
      const byLabel = this.parties.get(a)!.label.localeCompare(this.parties.get(b)!.label);
      return byLabel !== 0 ? byLabel : a < b ? -1 : a > b ? 1 : 0;
    });
    const index = new Map(ids.map((id, i) => [id, i]));
    const matrix = ids.map(() => ids.map(() => 0));
    let total = 0;
    for (const [from, row] of this.flows) {
      for (const [to, value] of row) {
        matrix[index.get(from)!][index.get(to)!] += value;
        total += value;
      }
    }
    const parties = ids.map((id, i) => ({
      id,
      label: this.parties.get(id)!.label,
      kind: this.parties.get(id)!.kind,
      given: matrix[i].reduce((s, v) => s + v, 0),
      received: matrix.reduce((s, row) => s + row[i], 0),
    }));
    return { id: this.id, unit: this.unit, parties, matrix, total, count: this.count };
  }
}

/** When a record happened: `created`, else the legacy `timestamp` / `date`. */
function recordTime(record: Record<string, unknown>): number {
  for (const field of ['created', 'timestamp', 'date']) {
    const raw = record[field];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && raw) {
      const parsed = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return NaN;
}

/**
 * Every flow matrix for a holon over one window.
 *
 * Same window and name rules as the movement ledger, so the chord and the
 * Sankey beside it describe the same records. Returns only non-empty tracks:
 * money, then time, kudos and items.
 */
export function buildPeopleFlows(input: BuildPeopleFlowsInput): PeopleFlowTrack[] {
  const now = input.now ?? Date.now();
  const windowDays =
    input.windowDays === undefined ? DEFAULT_LEDGER_WINDOW_DAYS : input.windowDays;
  const from = windowDays == null ? 0 : now - windowDays * DAY_MS;
  const inWindow = (ts: number) => Number.isFinite(ts) && ts >= from && ts <= now;
  const holon = String(input.holonId ?? '');
  const hubLabel = input.hubLabel ?? 'Holon';
  const nameOf = input.nameOf ?? (() => undefined);
  const label = (id: string) => (id === holon ? hubLabel : nameOf(id) || id);
  const involving = input.involving ? String(input.involving) : '';

  /** Who a record's agent is on the ring, or null for someone who is not a party. */
  const partyOf = (rawId: unknown, agent?: Agent): Party | null => {
    const id = String(rawId ?? '');
    if (!id || agent?.type === 'external') return null;
    if (id === holon || id === TREASURY_ID) return { id: holon, kind: 'holon' };
    return { id, kind: agent?.type === 'holon' ? 'holon' : 'person' };
  };

  const builders = new Map<string, MatrixBuilder>();
  const flow = (
    track: PeopleFlowTrackId,
    unit: string,
    giver: Party | null,
    taker: Party | null,
    value: number,
  ) => {
    if (!giver || !taker || !(value > 0) || !unit || giver.id === taker.id) return;
    if (involving && giver.id !== involving && taker.id !== involving) return;
    const key = `${track}:${unit}`;
    let builder = builders.get(key);
    if (!builder) {
      builder = new MatrixBuilder(track, unit, holon);
      builders.set(key, builder);
    }
    builder.add(giver, taker, value, label);
  };

  // The same logged hour can arrive as a time-tracking expense and as a
  // `quest:time_logged` event; the event is skipped when an expense already
  // said it. Two expenses are two records, however close together.
  const expenseHours = new Set<string>();
  const hours = (
    giver: Party | null,
    taker: Party | null,
    value: number,
    quest: unknown,
    ts: number,
    fromEvent = false,
  ) => {
    const key = `${giver?.id}>${taker?.id}|${quest ?? ''}|${Math.round(ts / 60_000)}|${value}`;
    if (fromEvent && expenseHours.has(key)) return;
    if (!fromEvent) expenseHours.add(key);
    flow('time', 'hours', giver, taker, value);
  };

  for (const expense of input.expenses ?? []) {
    if (!expense) continue;
    const record = expense as unknown as Record<string, unknown>;
    const ts = recordTime(record);
    if (!inWindow(ts)) continue;
    const amount = Number(expense.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const payer = partyOf(expense.paidBy);
    const splitWith = coerceSplitWith(expense.splitWith);
    if (!payer || !splitWith.length) continue;
    const unit = normalizeCurrency(expense.currency || expense.unit);
    const isTime = record.fromTimeTracking === true || unit === 'hour';
    const share = amount / splitWith.length;
    for (const member of splitWith) {
      const taker = partyOf(member);
      if (isTime) hours(payer, taker, share, record.questId, ts);
      else flow('money', unit, payer, taker, share);
    }
  }

  for (const event of (input.events ?? []) as REAEvent[]) {
    if (!event) continue;
    const ts = Number(event.timestamp);
    if (!inWindow(ts)) continue;
    const quantity = Number(event.resource?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const provider = event.provider as Agent;
    const receiver = event.receiver as Agent;
    const giver = partyOf(provider?.id, provider);
    const taker = partyOf(receiver?.id, receiver);
    // Records about work or stock "in the holon" may not name it as an agent.
    const giverOrHolon = giver ?? (provider?.id ? null : partyOf(holon));
    const takerOrHolon = taker ?? (receiver?.id ? null : partyOf(holon));
    const rawUnit = String(event.resource?.unit ?? '');

    switch (String(event.eventType ?? '')) {
      case 'transfer:direct':
        flow('money', normalizeCurrency(rawUnit), giver, taker, quantity);
        break;
      case 'credit:transfer':
      case 'item:fee_paid':
      case 'item:deposit_held':
      case 'item:deposit_returned':
        flow('money', normalizeCurrency(rawUnit || 'credits'), giverOrHolon, takerOrHolon, quantity);
        break;
      case 'quest:time_logged':
        hours(giver, takerOrHolon, quantity, (event.context as { questId?: unknown } | undefined)?.questId, ts, true);
        break;
      case 'appreciation:sent':
      case 'quest:initiated':
      case 'quest:completed':
        flow('appreciation', 'kudos', giver, takerOrHolon, quantity);
        break;
      case 'item:borrowed':
        flow('items', 'lends', giver, taker, 1);
        break;
      case 'stock:produced':
      case 'stock:consumed':
      case 'stock:transferred':
        flow('items', rawUnit || 'units', giverOrHolon, takerOrHolon, quantity);
        break;
      default:
        break;
    }
  }

  const order: PeopleFlowTrackId[] = ['money', 'time', 'appreciation', 'items'];
  return [...builders.values()]
    .map((b) => b.build())
    .filter((t) => t.total > 0)
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface ChordOptions {
  /** Radius the ribbons end at, in the caller's units (px). */
  innerRadius: number;
  /** Thickness of each party's arc outside the ribbons. Default 8. */
  arcWidth?: number;
  /** Gap between two parties' arcs, as arc length. Default 10. */
  padLength?: number;
  /** Length of a ribbon's arrowhead. Default 10. */
  headLength?: number;
  /** Keep at most this many parties; the rest roll into one. Default 16. */
  topN?: number;
  /** Label for that rollup. Default 'Others'. */
  othersLabel?: string;
  /** Distance of a label from the arc's outer edge. Default 6. */
  labelOffset?: number;
}

/** One party's arc on the ring. Angles are radians clockwise from 12 o'clock. */
export interface ChordGroup {
  id: string;
  label: string;
  index: number;
  given: number;
  received: number;
  /** given + received: the arc's length. */
  value: number;
  startAngle: number;
  endAngle: number;
  /** SVG path `d` of the arc, centred on (0, 0). */
  path: string;
  /** SVG `transform` placing the label outside the arc, reading outward. */
  labelTransform: string;
  labelAnchor: 'start' | 'end';
  /** A holon, or the rollup of everyone past the top N; absent for a person. */
  kind?: 'holon' | 'other';
}

/** One arrow from a giver's arc to a receiver's. */
export interface ChordRibbon {
  id: string;
  source: string;
  target: string;
  value: number;
  /** SVG path `d`, centred on (0, 0). */
  path: string;
}

export interface ChordLayout {
  groups: ChordGroup[];
  /** Largest first, so the small arrows are painted on top. */
  ribbons: ChordRibbon[];
  /** Outer edge of the arcs — the caller adds room for labels past it. */
  outerRadius: number;
  empty: boolean;
}

const r = (n: number) => Math.round(n * 100) / 100;
const at = (radius: number, angle: number) => `${r(radius * Math.cos(angle))},${r(radius * Math.sin(angle))}`;

/** An SVG arc from the current point at `a0` to `a1` (SVG angles). */
function arcTo(radius: number, a0: number, a1: number, sweep: 0 | 1 = 1): string {
  const span = Math.abs(a1 - a0);
  if (span < EPSILON) return '';
  return `A${r(radius)},${r(radius)},0,${span >= Math.PI ? 1 : 0},${sweep},${at(radius, a1)}`;
}

/**
 * Fold everyone past the top N (by given + received) into one party. Holons
 * are always kept. Flows between two rolled-up parties have nowhere to go
 * and are dropped.
 */
function capParties(track: PeopleFlowTrack, topN: number, othersLabel: string) {
  const n = track.parties.length;
  if (n <= topN) return { parties: track.parties.map((p) => ({ ...p })), matrix: track.matrix };

  const byValue = track.parties
    .map((p, i) => ({ i, holon: p.kind === 'holon', value: p.given + p.received }))
    .sort((a, b) => Number(b.holon) - Number(a.holon) || b.value - a.value || a.i - b.i);
  const keep = new Set(byValue.slice(0, topN - 1).map((x) => x.i));
  const kept = track.parties.map((_, i) => i).filter((i) => keep.has(i));
  const slot = new Map(kept.map((i, k) => [i, k]));
  const others = kept.length;
  const size = others + 1;
  const matrix = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = slot.get(i) ?? others;
      const b = slot.get(j) ?? others;
      if (a !== b) matrix[a][b] += track.matrix[i][j];
    }
  }
  const parties: (PeopleFlowParty & { rollup?: true })[] = [
    ...kept.map((i) => ({ ...track.parties[i] })),
    {
      id: CHORD_OTHERS_ID,
      label: `${othersLabel} (${n - kept.length})`,
      kind: 'person' as const,
      given: 0,
      received: 0,
      rollup: true as const,
    },
  ];
  parties.forEach((p, k) => {
    p.given = matrix[k].reduce((s, v) => s + v, 0);
    p.received = matrix.reduce((s, row) => s + row[k], 0);
  });
  return { parties, matrix };
}

/**
 * Lay a track out as a directed chord diagram.
 *
 * Each party's arc is as long as everything they gave plus everything they
 * received; along it, flows are laid largest first, incoming before outgoing
 * on a tie. A ribbon leaves the giver's arc at full width and narrows to an
 * arrowhead on the receiver's — so the direction is in the shape, not just
 * the colour.
 */
export function layoutChord(track: PeopleFlowTrack | null, opts: ChordOptions): ChordLayout {
  const inner = Math.max(1, opts.innerRadius);
  const outer = inner + (opts.arcWidth ?? 8);
  const empty: ChordLayout = { groups: [], ribbons: [], outerRadius: outer, empty: true };
  if (!track || !(track.total > 0)) return empty;

  const { parties, matrix } = capParties(track, Math.max(2, opts.topN ?? 16), opts.othersLabel ?? 'Others');
  const n = parties.length;
  const sums = parties.map((p) => p.given + p.received);
  const grand = sums.reduce((s, v) => s + v, 0);
  if (!(grand > 0)) return empty;

  const active = sums.filter((s) => s > 0).length;
  const pad = Math.min((opts.padLength ?? 10) / inner, TAU / (active * 2));
  const k = Math.max(0, TAU - pad * active) / grand;

  type End = { index: number; startAngle: number; endAngle: number };
  const sourceEnd = new Map<string, End>();
  const targetEnd = new Map<string, End>();
  const groups: ChordGroup[] = [];
  const labelOffset = opts.labelOffset ?? 6;

  let x = 0;
  for (let i = 0; i < n; i++) {
    if (!(sums[i] > 0)) continue;
    const x0 = x;
    const subgroups: { j: number; incoming: boolean; value: number }[] = [];
    for (let j = 0; j < n; j++) {
      if (matrix[j][i] > 0) subgroups.push({ j, incoming: true, value: matrix[j][i] });
    }
    for (let j = 0; j < n; j++) {
      if (matrix[i][j] > 0) subgroups.push({ j, incoming: false, value: matrix[i][j] });
    }
    subgroups.sort((a, b) => b.value - a.value || Number(b.incoming) - Number(a.incoming) || a.j - b.j);
    for (const sub of subgroups) {
      const start = x;
      x += sub.value * k;
      const end = { index: i, startAngle: start, endAngle: x };
      if (sub.incoming) targetEnd.set(`${sub.j}>${i}`, end);
      else sourceEnd.set(`${i}>${sub.j}`, end);
    }

    const a0 = x0 - HALF_PI;
    const a1 = x - HALF_PI;
    const mid = (x0 + x) / 2;
    const flip = mid > Math.PI;
    const party = parties[i] as PeopleFlowParty & { rollup?: true };
    const kind = party.rollup ? 'other' : party.kind === 'holon' ? 'holon' : undefined;
    groups.push({
      id: party.id,
      label: party.label,
      index: i,
      given: party.given,
      received: party.received,
      value: sums[i],
      startAngle: x0,
      endAngle: x,
      path: `M${at(outer, a0)}${arcTo(outer, a0, a1)}L${at(inner, a1)}${arcTo(inner, a1, a0, 0)}Z`,
      labelTransform: `rotate(${r((mid * 180) / Math.PI - 90)}) translate(${r(outer + labelOffset)},0)${flip ? ' rotate(180)' : ''}`,
      labelAnchor: flip ? 'end' : 'start',
      ...(kind ? { kind } : {}),
    });
    x += pad;
  }

  const radius = inner - 1;
  const head = Math.min(opts.headLength ?? 10, radius * 0.5);
  const halfPad = 1 / inner / 2;
  const ribbons: ChordRibbon[] = [];
  for (const [key, s] of sourceEnd) {
    const t = targetEnd.get(key);
    if (!t) continue;
    const value = matrix[s.index][t.index];
    let sa0 = s.startAngle - HALF_PI;
    let sa1 = s.endAngle - HALF_PI;
    let ta0 = t.startAngle - HALF_PI;
    let ta1 = t.endAngle - HALF_PI;
    // A hairline of space between neighbouring ribbons, as `ribbonArrow`
    // does; a sliver too thin for it collapses to its centre line.
    if (sa1 - sa0 > halfPad * 2 + EPSILON) (sa0 += halfPad), (sa1 -= halfPad);
    else sa0 = sa1 = (sa0 + sa1) / 2;
    if (ta1 - ta0 > halfPad * 2 + EPSILON) (ta0 += halfPad), (ta1 -= halfPad);
    else ta0 = ta1 = (ta0 + ta1) / 2;
    const neck = radius - head;
    const tip = (ta0 + ta1) / 2;
    ribbons.push({
      id: `${parties[s.index].id}>${parties[t.index].id}`,
      source: parties[s.index].id,
      target: parties[t.index].id,
      value,
      path:
        `M${at(radius, sa0)}${arcTo(radius, sa0, sa1)}` +
        `Q0,0,${at(neck, ta0)}L${at(radius, tip)}L${at(neck, ta1)}` +
        `Q0,0,${at(radius, sa0)}Z`,
    });
  }
  ribbons.sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : 1));

  return { groups, ribbons, outerRadius: outer, empty: groups.length === 0 };
}

/**
 * Who a party gave to and received from, largest first — the rows a tap on
 * their arc lists. Reads the laid-out picture, so a rollup lists what it holds
 * as the diagram draws it.
 */
export function chordBreakdown(
  layout: ChordLayout,
  id: string,
): { given: BreakdownRow[]; received: BreakdownRow[] } {
  const labelOf = new Map(layout.groups.map((g) => [g.id, g.label]));
  const rows = (pick: (ribbon: ChordRibbon) => string | null) =>
    layout.ribbons
      .map((ribbon) => ({ ribbon, other: pick(ribbon) }))
      .filter((x): x is { ribbon: ChordRibbon; other: string } => x.other != null)
      .map(({ ribbon, other }) => ({ id: other, label: labelOf.get(other) ?? other, value: ribbon.value }))
      .sort((a, b) => b.value - a.value);
  return {
    given: rows((rb) => (rb.source === id ? rb.target : null)),
    received: rows((rb) => (rb.target === id ? rb.source : null)),
  };
}
