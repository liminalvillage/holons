// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The value equation, decided by the holon's votes.
 *
 * Anyone proposes; the holon votes; at the new moon, what passed takes
 * effect. There is no apply step and nobody holds the switch: the equation
 * in force is a FOLD every reader runs the same way, over the signed
 * `governance_votes` log (votes.ts) —
 *
 *   before anything has passed: the holon's base equation
 *   (`settings.valueEquation`, set by its admins, or the default);
 *   at the first pass: that proposal's `from` (the equation its proposer saw,
 *   which the ballot showed) with its patch laid on — from then on settings
 *   no longer move the equation, so an admin cannot edit around the vote;
 *   after: every later passed patch laid on, in the order they closed.
 *
 * A proposal is an `equation` entry in the log, never a record anyone can
 * overwrite: its patch, its proposer and its signed time — which fixes the
 * new moon it closes at (`equationClosesAt`) — cannot change once written,
 * and votes after the close are `late`. What is NOT fixed yet is who counts:
 * the tally weighs today's roster, not the roster at the close.
 */

import { lunationAt } from '../flows/lunation.js';
import { migrateEquation, type ScoreEquation } from '../scoring/index.js';
import { tallyBallots, type Ballot, type BallotTally, type TallyOptions } from './tally.js';
import type { EquationEntry } from './votes.js';

/** The weights a proposal may move, besides per-currency ones. */
export const EQUATION_WEIGHT_KEYS = [
  'initiated',
  'completed',
  'sent',
  'received',
  'collaboration',
  'participation',
  'coParticipants',
  'activity',
  'groupSize',
  'variance',
] as const;

export type EquationWeightKey = (typeof EQUATION_WEIGHT_KEYS)[number];

/** What a proposal asks to change: some weights, some currency weights. */
export type EquationPatch = Partial<Record<EquationWeightKey, number>> & {
  currencies?: Record<string, number>;
};

const WEIGHT_KEYS = new Set<string>(EQUATION_WEIGHT_KEYS);

function finite(value: unknown): number | null {
  if (value === null || value === '' || typeof value === 'boolean') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * A usable patch, or null when nothing in it would change a weight. Unknown
 * keys and non-finite values are dropped rather than coerced to 0 — a vote
 * for "participation: banana" must not silently zero participation.
 * Currency codes are lowercased, as `parseCurrencyCodes` keeps them.
 */
export function sanitizeEquationPatch(raw: unknown): EquationPatch | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const patch: EquationPatch = {};
  let any = false;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!WEIGHT_KEYS.has(key)) continue;
    const n = finite(value);
    if (n == null) continue;
    patch[key as EquationWeightKey] = n;
    any = true;
  }
  const rawCurrencies = (raw as { currencies?: unknown }).currencies;
  if (rawCurrencies && typeof rawCurrencies === 'object' && !Array.isArray(rawCurrencies)) {
    const currencies: Record<string, number> = {};
    for (const [code, value] of Object.entries(rawCurrencies as Record<string, unknown>)) {
      const c = code.trim().toLowerCase();
      const n = finite(value);
      if (!c || n == null) continue;
      currencies[c] = n;
    }
    if (Object.keys(currencies).length) {
      patch.currencies = currencies;
      any = true;
    }
  }
  return any ? patch : null;
}

/** `current` with `patch` laid over it; currencies merge, they don't replace. */
export function applyEquationPatch(current: unknown, patch: EquationPatch): ScoreEquation {
  const base = migrateEquation(current);
  const { currencies, ...weights } = patch;
  return {
    ...base,
    ...weights,
    currencies: { ...base.currencies, ...(currencies ?? {}) },
  };
}

/** One weight a proposal moves, from what it is to what it would be. */
export interface EquationChange {
  /** A weight key, or `currencies.<code>`. */
  key: string;
  from: number;
  to: number;
}

/**
 * What the patch would actually move on `current` — the lines a ballot
 * shows ("participation 0 → 2"). Weights the patch names but already holds
 * are left out; an empty list means the proposal would change nothing.
 * `onto` is what the patch is laid on when that is not `current` (a first
 * proposal's `from`); every weight that ends up different is listed then.
 */
export function equationChanges(current: unknown, patch: EquationPatch, onto?: unknown): EquationChange[] {
  const before = migrateEquation(current);
  const after = applyEquationPatch(onto ?? before, patch);
  const out: EquationChange[] = [];
  for (const key of EQUATION_WEIGHT_KEYS) {
    const from = before[key] ?? 0;
    const to = after[key] ?? 0;
    if (from !== to) out.push({ key, from, to });
  }
  const codes = new Set([...Object.keys(patch.currencies ?? {}), ...Object.keys(before.currencies), ...Object.keys(after.currencies)]);
  for (const code of codes) {
    const from = before.currencies[code] ?? 0;
    const to = after.currencies[code] ?? 0;
    if (from !== to) out.push({ key: `currencies.${code}`, from, to });
  }
  return out;
}

// ── When a vote closes ─────────────────────────────────────────────────────

/** A vote stays open at least this long; a moon closer than that is skipped. */
export const MIN_OPEN_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * The new moon an equation proposal written at `createdMs` closes at (ms):
 * the next one, or the one after when the next is under `MIN_OPEN_MS` away
 * — so everyone gets a few days to vote.
 */
export function equationClosesAt(createdMs: number): number {
  let close = lunationAt(createdMs).to + 1;
  while (close - createdMs < MIN_OPEN_MS) close = lunationAt(close).to + 1;
  return close;
}

export interface FoldEquationInput {
  /** The holon's base equation (`settings.valueEquation`), or nothing. */
  base: unknown;
  /** The accepted equation proposals (`foldVotes(...).equations`). */
  proposals: Iterable<EquationEntry>;
  /** Ballots per proposal, as `foldVotes` yields them. */
  ballots: Record<string, Ballot>;
  /** Who counts — the denominator of every tally. */
  memberIds: Array<string | number>;
  /** Delegations, reputation, threshold — as for any tally. */
  tally?: TallyOptions;
  /** Defaults to now. */
  now?: number;
}

/** One equation proposal, judged at `now`. */
export interface EquationProposalState extends EquationEntry {
  /** False while votes are still open. */
  closed: boolean;
  tally: BallotTally;
  /** Closed and carried. */
  passed: boolean;
  /** What it moves: on the equation in force (open), or what it moved (passed). */
  changes: EquationChange[];
}

export interface GovernedEquation {
  /** The equation in force at `now`. */
  equation: ScoreEquation;
  /** Every equation proposal, closing order (soonest first), judged at `now`. */
  proposals: EquationProposalState[];
  /** The next close still ahead, ms — when a reader should fold again. */
  nextCloseAt: number | null;
  /**
   * True once a proposal has passed: from then on only votes change the
   * equation, and editors of `settings.valueEquation` should refuse.
   */
  governed: boolean;
}

/** What an editor says when the holon's votes have taken the equation over. */
export const EQUATION_GOVERNED_MESSAGE =
  'This holon decides its value equation by vote now: propose the change instead.';

/**
 * The equation in force: the base until the first pass, then every closed,
 * passed proposal in the order they closed (ties by signing time, then id).
 * Open proposals change nothing yet; they come back with their tally so far
 * and the changes they would make if they passed next.
 */
export function foldEquation(input: FoldEquationInput): GovernedEquation {
  const now = input.now ?? Date.now();
  const listed = [...input.proposals].sort(
    (a, b) => a.closesAt - b.closesAt || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  );
  let equation = migrateEquation(input.base);
  let governed = false;
  let nextCloseAt: number | null = null;
  const closed: EquationProposalState[] = [];
  const open: Array<EquationEntry & { tally: BallotTally }> = [];
  // What a proposal lays its patch on: the equation its proposer saw while
  // nothing has passed yet, the equation in force once something has.
  const onto = (p: EquationEntry) => (governed || !p.from ? equation : migrateEquation(p.from));
  for (const p of listed) {
    const tally = tallyBallots(input.ballots[p.id] ?? {}, input.memberIds, input.tally);
    if (p.closesAt > now) {
      open.push({ ...p, tally });
      if (nextCloseAt == null) nextCloseAt = p.closesAt;
      continue;
    }
    const before = equation;
    const base = onto(p);
    const passed = tally.passed;
    if (passed) {
      equation = applyEquationPatch(base, p.patch);
      governed = true;
    }
    closed.push({ ...p, closed: true, tally, passed, changes: passed ? equationChanges(before, p.patch, base) : [] });
  }
  const pending = open.map((p) => ({
    ...p,
    closed: false,
    passed: false,
    changes: equationChanges(equation, p.patch, onto(p)),
  }));
  return { equation, proposals: [...closed, ...pending], nextCloseAt, governed };
}
