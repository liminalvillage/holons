// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Buckets — a contributors' share divided by several rules at once.
 *
 * `allocate` divides the interior ONE way: by the value equation, or by a
 * hand-set weight per member. The Artisan fork needs a node to say "40 % by
 * legacy credit, 30 % as a needs floor, 30 % by validated impact" — three
 * rules over the same pot, each with its own roster. A BUCKET is one such
 * rule with the slice of the interior it governs:
 *
 *   custom   — hand-set weights (`shares`): the legacy credit, what each
 *              party was owed, read against their own sum
 *   equation — the scored roster the holon's value equation ranks
 *   needs    — equal among the parties who signed a `needs` flag
 *   equal    — equal among the roster, flag or no flag
 *
 * `composeInterior` folds every bucket into ONE roster — the
 * `AllocationMember[]` that `allocate` already takes, one row per party with
 * its percentages across buckets added up — so the cascade, the ceilings,
 * the rights table and the diagrams change nothing. A `byBucket` breakdown
 * rides beside it for an editor that wants to show the parts.
 *
 * Two facts of standing shape every bucket (`standing.ts`):
 *   - an EXIT retires a party from every bucket of the node: they collect
 *     what the table already owes them and take no part in later income;
 *   - an ALIAS maps a placeholder the importer seated (`artisan:<id>`) onto
 *     the party who claimed it. One hop, never chained: a real id is final.
 *
 * A bucket nobody is in (no one flagged, no one scored yet) pays nobody and
 * its slice goes to the other buckets — the same renormalization `allocate`
 * applies to a partial roster — and is reported in `empty` so a surface can
 * say so.
 *
 * `splitHash` is what a genesis lock pins: the rule, not the people. Buckets,
 * their weights and the contributors' percent go in; aliases, exits and
 * claim codes do not — claiming a seat or leaving it is the rule at work.
 *
 * A CLAIM WINDOW (`lapsedSeats`) closes the fork: a hand-set seat nobody
 * claimed by then is read as an exit.
 *
 * Pure: shapes in, roster out.
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { normalizeInteriorShares, type AllocationMember, type InteriorShares } from './allocation.js';

export type BucketMode = 'custom' | 'equation' | 'needs' | 'equal';

const MODES: readonly BucketMode[] = ['custom', 'equation', 'needs', 'equal'];

export interface AllocationBucket {
  /** `legacy`, `needs`, `impact` — or anything a holon names. */
  id: string;
  label?: string;
  /** The slice of the interior this bucket governs. Read against the sum of all buckets. */
  percent: number;
  mode: BucketMode;
  /** `custom` only: party → weight. */
  shares?: InteriorShares;
}

/** Placeholder → the party who claimed it. */
export type Aliases = Record<string, string>;

/** A stored bucket list made whole: bad entries dropped, ids unique. */
export function normalizeBuckets(raw: unknown): AllocationBucket[] {
  if (!Array.isArray(raw)) return [];
  const out: AllocationBucket[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const b = (entry ?? {}) as Record<string, unknown>;
    const id = String(b.id ?? '').trim();
    const percent = Number(b.percent);
    const mode = b.mode as BucketMode;
    if (!id || seen.has(id) || !MODES.includes(mode) || !Number.isFinite(percent) || percent < 0) continue;
    seen.add(id);
    const label = typeof b.label === 'string' && b.label.trim() ? b.label.trim() : undefined;
    const shares = mode === 'custom' ? normalizeInteriorShares(b.shares) : undefined;
    out.push({ id, percent, mode, ...(label ? { label } : {}), ...(shares ? { shares } : {}) });
  }
  return out;
}

/** A stored alias map made whole: placeholder → party, both non-empty, never a self-map. */
export function normalizeAliases(raw: unknown): Aliases {
  const out: Aliases = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [from, to] of Object.entries(raw as Record<string, unknown>)) {
    const f = String(from ?? '').trim();
    const t = String(to ?? '').trim();
    if (f && t && f !== t) out[f] = t;
  }
  return out;
}

/** The party `id` stands for: its alias when one is set, else itself. One hop. */
export function resolveAlias(aliases: Aliases | null | undefined, id: string): string {
  const key = String(id ?? '');
  const to = aliases?.[key];
  return to ? String(to) : key;
}

export interface ComposeInteriorInput {
  buckets: AllocationBucket[];
  /** The scored roster, for `equation` buckets. */
  scored: AllocationMember[];
  /** Parties flagged in need, for `needs` buckets. */
  needs?: Iterable<string> | null;
  /** Parties who exited: removed from every bucket. */
  exits?: Iterable<string> | null;
  aliases?: Aliases | null;
  /**
   * The roster an `equal` bucket divides among, and the one a `needs` flag
   * must belong to. Default: everyone a custom bucket or the scored roster names.
   */
  members?: Iterable<string> | null;
  nameOf?: (id: string) => string | undefined;
}

export interface ComposedInterior {
  /** One row per party; percentages are of the interior and sum to 100 unless nobody is in. */
  members: AllocationMember[];
  /** Bucket id → party → percent of the interior. */
  byBucket: Record<string, Record<string, number>>;
  /** Buckets with nobody in them; their slice went to the others. */
  empty: string[];
}

/** Weights per party for one bucket, aliases applied and exits removed. Empty when nobody is in. */
function bucketWeights(bucket: AllocationBucket, input: ComposeInteriorInput, exited: Set<string>, roster: string[], needs: Set<string>): Map<string, number> {
  const out = new Map<string, number>();
  const add = (id: string, weight: number) => {
    const party = resolveAlias(input.aliases, id);
    if (!party || exited.has(party) || !(weight > 0) || !Number.isFinite(weight)) return;
    out.set(party, (out.get(party) ?? 0) + weight);
  };
  switch (bucket.mode) {
    case 'custom':
      for (const [id, w] of Object.entries(normalizeInteriorShares(bucket.shares))) add(id, w);
      break;
    case 'equation':
      for (const m of input.scored ?? []) add(String(m.id), Number(m.percentage));
      break;
    case 'needs': {
      const inRoster = input.members ? new Set(roster) : null;
      for (const id of needs) if (!inRoster || inRoster.has(id)) add(id, 1);
      break;
    }
    case 'equal':
      for (const id of roster) add(id, 1);
      break;
  }
  return out;
}

/** Fold every bucket into the one roster `allocate` divides by. */
export function composeInterior(input: ComposeInteriorInput): ComposedInterior {
  const buckets = normalizeBuckets(input.buckets);
  const exited = new Set([...(input.exits ?? [])].map((id) => resolveAlias(input.aliases, String(id))));
  const needs = new Set([...(input.needs ?? [])].map((id) => resolveAlias(input.aliases, String(id))));

  // The roster: what the caller says, else everyone any bucket names.
  const rosterSet = new Set<string>();
  if (input.members) {
    for (const id of input.members) rosterSet.add(resolveAlias(input.aliases, String(id)));
  } else {
    for (const b of buckets) for (const id of Object.keys(b.shares ?? {})) rosterSet.add(resolveAlias(input.aliases, id));
    for (const m of input.scored ?? []) rosterSet.add(resolveAlias(input.aliases, String(m.id)));
  }
  for (const id of exited) rosterSet.delete(id);
  const roster = [...rosterSet].sort();

  const weighted: Array<{ bucket: AllocationBucket; weights: Map<string, number> }> = [];
  const empty: string[] = [];
  for (const bucket of buckets) {
    const weights = bucketWeights(bucket, input, exited, roster, needs);
    if (weights.size === 0 || !(bucket.percent > 0)) {
      if (bucket.percent > 0) empty.push(bucket.id);
      continue;
    }
    weighted.push({ bucket, weights });
  }

  const totalPercent = weighted.reduce((s, w) => s + w.bucket.percent, 0);
  const byBucket: Record<string, Record<string, number>> = {};
  for (const b of buckets) byBucket[b.id] = {};
  const totals = new Map<string, number>();
  if (totalPercent > 0) {
    for (const { bucket, weights } of weighted) {
      const slice = (bucket.percent / totalPercent) * 100;
      const sum = [...weights.values()].reduce((s, w) => s + w, 0);
      for (const [party, w] of weights) {
        const pct = (w / sum) * slice;
        byBucket[bucket.id][party] = (byBucket[bucket.id][party] ?? 0) + pct;
        totals.set(party, (totals.get(party) ?? 0) + pct);
      }
    }
  }

  const names = new Map<string, string>();
  for (const m of input.scored ?? []) if (m.name) names.set(resolveAlias(input.aliases, String(m.id)), m.name);
  const members: AllocationMember[] = [...totals.entries()]
    .filter(([, pct]) => pct > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, percentage]) => ({ id, name: input.nameOf?.(id) || names.get(id) || id, percentage }));

  return { members, byBucket, empty };
}

/**
 * A plain roster (no buckets) with the same standing applied: placeholders
 * resolved to who claimed them, exited parties removed, duplicates merged.
 */
export function applyStanding(
  members: readonly AllocationMember[],
  standing: { aliases?: Aliases | null; exits?: Iterable<string> | null },
): AllocationMember[] {
  const exited = new Set([...(standing.exits ?? [])].map((id) => resolveAlias(standing.aliases, String(id))));
  const out = new Map<string, AllocationMember>();
  for (const m of members) {
    const id = resolveAlias(standing.aliases, String(m.id));
    if (exited.has(id) || !(m.percentage > 0)) continue;
    const seen = out.get(id);
    if (seen) seen.percentage += m.percentage;
    else out.set(id, { id, name: id === m.id ? m.name : m.name || id, percentage: m.percentage });
  }
  return [...out.values()];
}

/** Ring placements with the same standing applied; an exited party loses its ring, an alias moves it. */
export function applyStandingToRings(
  rings: Record<string, number>,
  standing: { aliases?: Aliases | null; exits?: Iterable<string> | null },
): Record<string, number> {
  const exited = new Set([...(standing.exits ?? [])].map((id) => resolveAlias(standing.aliases, String(id))));
  const out: Record<string, number> = {};
  for (const [id, zone] of Object.entries(rings ?? {})) {
    const party = resolveAlias(standing.aliases, id);
    if (exited.has(party)) continue;
    // Two seats on different rings: the nearer one is the party's.
    out[party] = out[party] == null ? zone : Math.min(out[party], zone);
  }
  return out;
}

/** Until when a node's seats may be claimed, and which of them need no claim. */
export interface ClaimWindow {
  /** The window closes at this instant (ms). */
  until: number;
  /** Seats that stand without a claim — the funds beside the projects in a Pot. */
  keep: string[];
}

export interface LapsedSeatsInput {
  window: ClaimWindow | null | undefined;
  now: number;
  buckets?: readonly AllocationBucket[] | null;
  /** The single-mode custom split, when the node has no buckets. */
  shares?: InteriorShares | null;
  aliases?: Aliases | null;
}

/**
 * The seats a closed claim window retires: hand-set seats nobody claimed (no
 * alias points them at a claimant) and the window does not `keep`. They are
 * read as exits — in no bucket of the node, their share spread over everyone
 * left in proportion to what each holds. Empty while the window is open, or
 * when the node has none.
 */
export function lapsedSeats(input: LapsedSeatsInput): string[] {
  const window = input.window;
  if (!window || !(window.until > 0) || !(input.now >= window.until)) return [];
  const keep = new Set(window.keep ?? []);
  const buckets = normalizeBuckets(input.buckets ?? []);
  const seats = new Set<string>();
  if (buckets.length) {
    for (const b of buckets) for (const id of Object.keys(b.shares ?? {})) seats.add(id);
  } else {
    for (const id of Object.keys(normalizeInteriorShares(input.shares))) seats.add(id);
  }
  return [...seats].filter((id) => !keep.has(id) && !input.aliases?.[id]).sort();
}

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) out[key] = canonical((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
};

export interface SplitRule {
  interiorPercent: number;
  buckets?: readonly AllocationBucket[] | null;
  /** The single-mode custom split, when the holon has no buckets. */
  shares?: InteriorShares | null;
}

/** The rule a genesis lock pins: sha256 over the canonical split, aliases and codes excluded. */
export function splitHash(rule: SplitRule): string {
  const buckets = normalizeBuckets(rule.buckets ?? []).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const body = canonical({
    interiorPercent: Number(rule.interiorPercent),
    buckets: buckets.map((b) => ({ id: b.id, percent: b.percent, mode: b.mode, ...(b.shares ? { shares: b.shares } : {}) })),
    shares: buckets.length ? {} : normalizeInteriorShares(rule.shares),
  });
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify(body))));
}
