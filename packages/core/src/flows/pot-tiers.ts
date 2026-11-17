// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A track drawn top-down, as pots pouring into pots.
 *
 * The first column of a `ValueFlowTrack` (`ecosystemTrack`, `centredTrack`
 * with `up: 0`) is a vessel across the top; each later column is a row of
 * smaller vessels under it, and a band falls from a slice of a vessel's
 * bottom edge to a slice of the next one's top. Every width is on one scale —
 * the top vessel's value is the full width — so a band is as wide as the
 * share it carries, and what a vessel keeps (its fee) is the part of its
 * bottom edge no band leaves from.
 *
 * A row holds `topN` vessels; the rest roll into one "more" vessel. A vessel
 * too thin to tap is widened to `minWidth`, and the row shrunk back to fit.
 * Vessels are ordered under their sources, so bands cross as little as they can.
 *
 * Geometry is normalized: x in 0..1 across, y in 0..1 down. Pure.
 */

import type { ValueFlowTrack } from './types.js';

export interface PotTiersOptions {
  /** Vessels named per row before the rest roll into one. Default 6. */
  topN?: number;
  /** Label of the rolled-up vessel. */
  moreLabel?: string;
  /** Gap between vessels of a row, as a fraction of the width. Default 0.025. */
  gap?: number;
  /** Narrowest a vessel is drawn. Default 0.06. */
  minWidth?: number;
  /** A vessel's height as a fraction of the pitch between rows. Default 0.36. */
  vesselHeight?: number;
}

export interface PotTierVessel {
  id: string;
  label: string;
  kind?: string;
  /** What reaches it, in the track's unit. */
  value: number;
  /** What it keeps: what reaches it less what it passes on, never below 0. */
  kept: number;
  /** What it passes on to the row below. */
  passed: number;
  row: number;
  /** For the rolled-up vessel: the ids it stands for. */
  rolled?: string[];
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PotTierBand {
  id: string;
  source: string;
  target: string;
  value: number;
  /** Where the band leaves the source's bottom edge and meets the target's top. */
  x0: number;
  x1: number;
  x2: number;
  x3: number;
  y0: number;
  y1: number;
  /** A closed path, normalized like the rest. */
  path: string;
}

export interface PotTiers {
  vessels: PotTierVessel[];
  bands: PotTierBand[];
  rows: number;
  empty: boolean;
}

export const POT_TIERS_MORE_PREFIX = '__more_';
const EPSILON = 1e-9;

/** A band as a closed shape: down the left edge, across, back up the right. */
export function potTierBandPath(b: Pick<PotTierBand, 'x0' | 'x1' | 'x2' | 'x3' | 'y0' | 'y1'>): string {
  const m = (b.y0 + b.y1) / 2;
  const f = (v: number) => Number(v.toFixed(5));
  return (
    `M${f(b.x0)},${f(b.y0)} C${f(b.x0)},${f(m)} ${f(b.x2)},${f(m)} ${f(b.x2)},${f(b.y1)} ` +
    `L${f(b.x3)},${f(b.y1)} C${f(b.x3)},${f(m)} ${f(b.x1)},${f(m)} ${f(b.x1)},${f(b.y0)} Z`
  );
}

export function layoutPotTiers(track: ValueFlowTrack, opts: PotTiersOptions = {}): PotTiers {
  const topN = Math.max(1, Math.floor(opts.topN ?? 6));
  const gap = Math.max(0, opts.gap ?? 0.025);
  const minWidth = Math.max(0, opts.minWidth ?? 0.06);
  const vesselHeight = Math.min(1, Math.max(0.05, opts.vesselHeight ?? 0.36));
  const moreLabel = opts.moreLabel ?? 'More';

  // What a vessel keeps is drawn as its own bottom edge, not as a vessel.
  const kept = new Set(track.nodes.filter((n) => n.kind === 'retained').map((n) => n.id));
  const nodes = track.nodes.filter((n) => !kept.has(n.id) && n.value > EPSILON);
  const present = new Set(nodes.map((n) => n.id));
  const links = track.links.filter((l) => present.has(l.source) && present.has(l.target) && l.value > EPSILON);

  const depths = [...new Set(nodes.map((n) => n.depth))].sort((a, b) => a - b);
  if (!depths.length) return { vessels: [], bands: [], rows: 0, empty: true };
  const rowOf = new Map(depths.map((d, i) => [d, i] as const));

  // Roll each row past `topN` into one vessel.
  const alias = new Map<string, string>();
  const vessels = new Map<string, PotTierVessel>();
  for (const d of depths) {
    const row = rowOf.get(d)!;
    const here = nodes.filter((n) => n.depth === d).sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : 1));
    // Rolling a single vessel up only renames it.
    const keep = here.length > topN + 1 ? here.slice(0, topN) : here;
    for (const n of keep) {
      alias.set(n.id, n.id);
      vessels.set(n.id, { id: n.id, label: n.label, kind: n.kind, value: n.value, kept: 0, passed: 0, row, x: 0, y: 0, w: 0, h: 0 });
    }
    const rest = here.slice(keep.length);
    if (rest.length) {
      const id = `${POT_TIERS_MORE_PREFIX}${row}`;
      for (const n of rest) alias.set(n.id, id);
      vessels.set(id, {
        id,
        label: moreLabel,
        kind: 'other',
        value: rest.reduce((s, n) => s + n.value, 0),
        kept: 0,
        passed: 0,
        row,
        rolled: rest.map((n) => n.id),
        x: 0,
        y: 0,
        w: 0,
        h: 0,
      });
    }
  }

  // Only bands that fall one row; merged where both ends rolled into one.
  const merged = new Map<string, { source: string; target: string; value: number }>();
  for (const l of links) {
    const source = alias.get(l.source)!;
    const target = alias.get(l.target)!;
    if (vessels.get(target)!.row !== vessels.get(source)!.row + 1) continue;
    const id = `${source}>${target}`;
    const seen = merged.get(id);
    if (seen) seen.value += l.value;
    else merged.set(id, { source, target, value: l.value });
  }
  for (const b of merged.values()) vessels.get(b.source)!.passed += b.value;
  for (const v of vessels.values()) {
    v.passed = Math.min(v.passed, v.value);
    v.kept = Math.max(0, v.value - v.passed);
  }

  const rows = depths.length;
  const scale = Math.max(...[...vessels.values()].filter((v) => v.row === 0).map((v) => v.value));
  const pitch = 1 / Math.max(1, rows - 1 + vesselHeight);
  const h = pitch * vesselHeight;

  // Lay rows out top to bottom, each ordered under where its sources are.
  const centre = new Map<string, number>();
  for (let row = 0; row < rows; row++) {
    const here = [...vessels.values()].filter((v) => v.row === row);
    const pull = (v: PotTierVessel) => {
      let sum = 0;
      let weight = 0;
      for (const b of merged.values()) {
        if (b.target !== v.id) continue;
        sum += (centre.get(b.source) ?? 0.5) * b.value;
        weight += b.value;
      }
      // The rolled-up vessel stands last; a vessel with no source, by size.
      return v.rolled ? 2 : weight > 0 ? sum / weight : 1.5 - v.value / scale;
    };
    here.sort((a, b) => pull(a) - pull(b) || b.value - a.value || (a.id < b.id ? -1 : 1));
    const room = 1 - gap * (here.length - 1);
    let widths = here.map((v) => Math.max(minWidth, v.value / scale));
    const total = widths.reduce((s, w) => s + w, 0);
    if (total > room) widths = widths.map((w) => (w * room) / total);
    const used = widths.reduce((s, w) => s + w, 0) + gap * (here.length - 1);
    let x = (1 - used) / 2;
    here.forEach((v, i) => {
      v.x = x;
      v.w = widths[i];
      v.y = row * pitch;
      v.h = h;
      centre.set(v.id, x + widths[i] / 2);
      x += widths[i] + gap;
    });
  }

  // Slice each edge: a source's bands in the order of their targets, left to
  // right, then what it keeps; a target's in the order of their sources.
  const bands: PotTierBand[] = [];
  const outCursor = new Map<string, number>();
  const inCursor = new Map<string, number>();
  const list = [...merged.entries()].map(([id, b]) => ({ id, ...b }));
  const byTarget = [...list].sort((a, b) => vessels.get(a.target)!.x - vessels.get(b.target)!.x);
  const bySource = [...list].sort((a, b) => vessels.get(a.source)!.x - vessels.get(b.source)!.x);
  const top = new Map<string, [number, number]>();
  for (const b of byTarget) {
    const s = vessels.get(b.source)!;
    const at = outCursor.get(s.id) ?? s.x;
    const w = (b.value / s.value) * s.w;
    top.set(b.id, [at, at + w]);
    outCursor.set(s.id, at + w);
  }
  for (const b of bySource) {
    const s = vessels.get(b.source)!;
    const t = vessels.get(b.target)!;
    const at = inCursor.get(t.id) ?? t.x;
    const w = (b.value / t.value) * t.w;
    inCursor.set(t.id, at + w);
    const [x0, x1] = top.get(b.id)!;
    const geometry = { x0, x1, x2: at, x3: at + w, y0: s.y + s.h, y1: t.y };
    bands.push({ id: b.id, source: b.source, target: b.target, value: b.value, ...geometry, path: potTierBandPath(geometry) });
  }

  return { vessels: [...vessels.values()].sort((a, b) => a.row - b.row || a.x - b.x), bands, rows, empty: false };
}
