// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Build the movement graphs: what came in, what went out.
 *
 * Pure and storage-free, like `expenses/balance.ts` — callers do the reading and
 * hand in plain arrays. That matters for more than testability: `REAEventStore`
 * re-reads the whole lens on every query, so a UI reads once and passes the
 * in-memory array here rather than letting an aggregation fan out into dozens of
 * round trips.
 *
 * The reading of those arrays lives in `ledger.ts`, which emits one row per
 * thing that happened; this file only groups those rows into nodes and links.
 * One walker, two views: the diagram and the ledger under it cannot disagree.
 *
 * Double-counting is the trap the walker has to avoid. Shared expenses exist
 * BOTH as records on the `expenses` lens and as `expense:paid` / `expense:share`
 * REA events mirroring them, so money flows are derived from the expenses lens
 * (the canonical store) and REA is used only for what has no expense record:
 * library fees and deposits, logged time, and appreciation.
 *
 * Tracks never share a unit and are never summed. Two currencies mean two money
 * tracks; hours and kudos each get their own.
 */

import type { REAEvent } from '../rea/index.js';
import { normalizeCurrency, type Expense } from '../expenses/index.js';
import { buildLedger, ledgerTrackKey, type LedgerEntry } from './ledger.js';
import type { OpenCollectiveSnapshot } from './opencollective.js';
import type { TrackId, ValueFlowGraph, ValueFlowLink, ValueFlowNode, ValueFlowTrack } from './types.js';

/** The centre node every movement track fans through. */
export const HUB_ID = '__holon';

export const DEFAULT_WINDOW_DAYS = 90;

export interface BuildFlowsInput {
  holonId: string;
  events: REAEvent[];
  expenses: Expense[];
  collective?: OpenCollectiveSnapshot | null;
  /** The holon settings doc, read for the treasury rate. */
  settings?: unknown;
  /** Resolve an agent id to a display name. */
  nameOf?: (id: string) => string | undefined;
  now?: number;
  /** `null` means all time. */
  windowDays?: number | null;
  hubLabel?: string;
}

/** Accumulates one track's nodes and links before they are frozen into shape. */
class TrackBuilder {
  private nodes = new Map<string, ValueFlowNode>();
  private links = new Map<string, ValueFlowLink>();

  constructor(
    private readonly id: TrackId,
    private readonly unit: string,
    private readonly hubLabel: string,
  ) {}

  /** Money into the hub, from `id`. */
  inflow(id: string, label: string, value: number, kind: string): void {
    this.add(id, label, 0, value, kind);
    this.link(`in-${id}`, id, HUB_ID, value, kind);
  }

  /** Money out of the hub, to `id`. */
  outflow(id: string, label: string, value: number, kind: string): void {
    this.add(id, label, 2, value, kind);
    this.link(`out-${id}`, HUB_ID, id, value, kind);
  }

  private add(id: string, label: string, depth: number, value: number, kind: string): void {
    if (!(value > 0)) return;
    const seen = this.nodes.get(id);
    if (seen) seen.value += value;
    else this.nodes.set(id, { id, label, depth, value, kind });
  }

  private link(id: string, source: string, target: string, value: number, kind: string): void {
    if (!(value > 0)) return;
    const seen = this.links.get(id);
    if (seen) seen.value += value;
    else this.links.set(id, { id, source, target, value, kind });
  }

  /** Whether anything at all landed in this track. */
  get empty(): boolean {
    return this.nodes.size === 0;
  }

  build(balance: number | null): ValueFlowTrack {
    const nodes = [...this.nodes.values()];
    const totalIn = nodes.filter((n) => n.depth === 0).reduce((s, n) => s + n.value, 0);
    const totalOut = nodes.filter((n) => n.depth === 2).reduce((s, n) => s + n.value, 0);

    const hubValue = Math.max(totalIn, totalOut);
    if (hubValue > 0) {
      nodes.push({
        id: HUB_ID,
        label: this.hubLabel,
        depth: 1,
        value: hubValue,
        kind: 'hub',
      });
    }

    return {
      id: this.id,
      unit: this.unit,
      nodes,
      links: [...this.links.values()],
      totalIn,
      totalOut,
      balance,
    };
  }
}

/**
 * Build every movement track for a holon over one window.
 *
 * Returns only non-empty tracks, so a holon that has never logged an hour does
 * not get an empty "time" tab.
 */
export function buildValueFlows(input: BuildFlowsInput): ValueFlowGraph {
  const hubLabel = input.hubLabel ?? 'Holon';
  const { from, to, entries } = buildLedger(input);

  // Insertion order is the emission order of the ledger — expenses, REA money,
  // OpenCollective, time, appreciation — so money tracks come out first, in the
  // order their currencies were first seen.
  const builders = new Map<string, TrackBuilder>();
  const trackOf = (entry: LedgerEntry): TrackBuilder => {
    const key = ledgerTrackKey(entry);
    let builder = builders.get(key);
    if (!builder) {
      builder = new TrackBuilder(entry.track, entry.unit, hubLabel);
      builders.set(key, builder);
    }
    return builder;
  };

  for (const entry of entries) {
    const builder = trackOf(entry);
    if (entry.direction === 'in') {
      builder.inflow(entry.nodeId, entry.nodeLabel, entry.amount, entry.kind);
    } else {
      builder.outflow(entry.nodeId, entry.nodeLabel, entry.amount, entry.kind);
    }
  }

  const collective = input.collective ?? null;
  const collectiveCurrency = collective ? normalizeCurrency(collective.currency) : '';

  const tracks: ValueFlowTrack[] = [];
  for (const [key, builder] of builders) {
    if (builder.empty) continue;
    // A balance is only meaningful where real funds are actually held.
    const balance =
      collective && key === `money:${collectiveCurrency}` ? collective.balance : null;
    tracks.push(builder.build(balance));
  }

  return { holonId: String(input.holonId), from, to, tracks };
}
