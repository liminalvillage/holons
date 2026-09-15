// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Every unit in one diagram, without inventing an exchange rate.
 *
 * The board shows one track at a time because a track is unit-coherent: euro
 * ribbons and kilogram ribbons cannot share a width axis, and this repo has no
 * rates to convert between them. But "one at a time" also means you can never
 * see the whole picture — who is central across everything the holon moves,
 * not just across its euro.
 *
 * So the combined view scales each track to ITS OWN total before merging. A
 * ribbon's width is then its share of its own unit's flow, which is a number
 * every track produces on the same 0-100 scale and which can honestly be added
 * up. Nothing is ever converted, and no amount is ever summed across units.
 *
 * The real amounts are not lost: every link, segment and node carries a
 * `display` string, formatted by the caller in the track's own unit, and that
 * is the only thing the labels print. A node that saw value in three units
 * shows all three.
 */

import type { PeopleFlowParty, PeopleFlowTrack } from './chord.js';
import type {
  ValueFlowLink,
  ValueFlowNode,
  ValueFlowSegment,
  ValueFlowTrack,
} from './types.js';

/** The scale every track is mapped onto: its own total is this much. */
const SHARE_BASIS = 100;

/** Names and formats one track — everything the caller's locale owns. */
export interface CombineOptions {
  /** The track's short name, e.g. "EUR", "Hours", "kg". */
  labelOf: (track: { id: string; unit: string }) => string;
  /** Formats an amount in that track's unit, e.g. `(v) => "€1,108"`. */
  formatOf: (track: { id: string; unit: string }) => (value: number) => string;
  /** What to call the merged track. Defaults to nothing. */
  unit?: string;
}

/** `value / total * 100`, or 0 when the track moved nothing. */
function shareOf(value: number, total: number): number {
  return total > 0 ? (value / total) * SHARE_BASIS : 0;
}

/**
 * Name the unit, unless the formatted amount already does.
 *
 * Money comes back as "€106" and needs its code; a stock or an appreciation
 * comes back as "4 kg" or "27 kudos" and would otherwise read "4 kg KG".
 */
function withUnit(amount: string, label: string): string {
  const a = amount.trim().toLowerCase();
  const l = label.trim().toLowerCase();
  if (!l || a === l || a.endsWith(` ${l}`) || a.endsWith(l)) return amount.trim();
  return `${amount.trim()} ${label}`;
}

/** Join per-unit strings the way a label reads them: "€120 · 4 kg". */
function joinDisplay(parts: string[]): string {
  return parts.join(' · ');
}

/**
 * Merge unit-coherent movement tracks into one diagram.
 *
 * Returns null for an empty list, and the track itself when there is only one
 * — combining a single unit would only replace real amounts with shares.
 */
export function combineTracks(
  tracks: ValueFlowTrack[],
  options: CombineOptions,
): ValueFlowTrack | null {
  const usable = (tracks ?? []).filter((t) => t && t.links.length > 0);
  if (usable.length === 0) return null;
  if (usable.length === 1) return usable[0];

  const nodes = new Map<
    string,
    ValueFlowNode & { segments: ValueFlowSegment[]; parts: string[] }
  >();
  // Keyed by unit as well as by ends: a pair of parties who trade in two
  // currencies gets one ribbon each, so the diagram shows WHICH unit moved
  // between them and not merely that something did.
  const links = new Map<string, ValueFlowLink & { raw: number }>();
  let totalIn = 0;
  let totalOut = 0;

  for (const track of usable) {
    // A track's own total: what flowed through it, by its own reckoning.
    const total = Math.max(
      track.totalIn,
      track.totalOut,
      track.links.reduce((s, l) => s + l.value, 0),
    );
    const label = options.labelOf(track);
    const format = options.formatOf(track);

    for (const link of track.links) {
      const share = shareOf(link.value, total);
      if (share <= 0) continue;
      const key = `${link.source}->${link.target}->${label}`;
      const existing = links.get(key);
      if (existing) {
        // The same pair can appear twice within one track (two expenses, say).
        existing.value += share;
        existing.raw += link.value;
        existing.display = withUnit(format(existing.raw), label);
      } else {
        links.set(key, {
          id: key,
          source: link.source,
          target: link.target,
          value: share,
          kind: link.kind,
          unit: label,
          display: withUnit(format(link.value), label),
          raw: link.value,
        });
      }
    }

    for (const node of track.nodes) {
      const share = shareOf(node.value, total);
      if (share <= 0) continue;
      const shown = withUnit(format(node.value), label);
      const existing = nodes.get(node.id);
      const slice: ValueFlowSegment = {
        kind: label,
        label,
        unit: label,
        value: share,
        display: shown,
      };
      if (existing) {
        existing.value += share;
        // One slice per unit, so a bar shows what it is made of.
        existing.segments.push(slice);
        existing.parts.push(shown);
      } else {
        nodes.set(node.id, {
          id: node.id,
          label: node.label,
          depth: node.depth,
          kind: node.kind,
          value: share,
          segments: [slice],
          parts: [shown],
        });
      }
    }

    totalIn += shareOf(track.totalIn, total);
    totalOut += shareOf(track.totalOut, total);
  }

  return {
    id: 'combined',
    unit: options.unit ?? '',
    nodes: [...nodes.values()].map(({ parts, segments, ...node }) => ({
      ...node,
      // A bar made of one unit needs no slices; several do.
      segments: segments.length > 1 ? segments : undefined,
      display: joinDisplay(parts),
    })),
    // `raw` was only ever scratch for accumulating the real amount.
    links: [...links.values()].map(({ raw: _raw, ...link }) => link),
    totalIn,
    totalOut,
    balance: null,
  };
}

/**
 * Merge people-flow matrices into one chord, on the same share basis.
 *
 * Parties are unioned by id; a party present in several tracks keeps one arc
 * whose size is the sum of its shares.
 */
export function combinePeopleTracks(
  tracks: PeopleFlowTrack[],
  options: CombineOptions,
): PeopleFlowTrack | null {
  const usable = (tracks ?? []).filter((t) => t && t.total > 0);
  if (usable.length === 0) return null;
  if (usable.length === 1) return usable[0];

  // One row per party, in first-seen order, so the holon stays first.
  const index = new Map<string, number>();
  const parties: PeopleFlowParty[] = [];
  for (const track of usable) {
    for (const party of track.parties) {
      if (index.has(party.id)) continue;
      index.set(party.id, parties.length);
      parties.push({ ...party, given: 0, received: 0 });
    }
  }

  const n = parties.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  let count = 0;
  let total = 0;

  for (const track of usable) {
    for (let i = 0; i < track.parties.length; i++) {
      const from = index.get(track.parties[i].id);
      if (from == null) continue;
      for (let j = 0; j < track.parties.length; j++) {
        const to = index.get(track.parties[j].id);
        if (to == null || from === to) continue;
        const share = shareOf(track.matrix[i][j] ?? 0, track.total);
        if (share <= 0) continue;
        matrix[from][to] += share;
        parties[from].given += share;
        parties[to].received += share;
        total += share;
      }
    }
    count += track.count;
  }

  // Rescale the whole matrix to itself, so the combined chord's numbers are
  // shares of everything that moved between people, counting each unit
  // equally. Without this last pass they would be sums of per-unit shares,
  // which can run past 100 and read as a percentage of nothing.
  const scale = total > 0 ? SHARE_BASIS / total : 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) matrix[i][j] *= scale;
    parties[i].given *= scale;
    parties[i].received *= scale;
  }

  return {
    id: 'combined' as PeopleFlowTrack['id'],
    unit: options.unit ?? '',
    parties,
    matrix,
    total: total > 0 ? SHARE_BASIS : 0,
    count,
  };
}
