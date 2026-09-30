// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fund mints — what a holon has to divide, as signed, append-only actions.
 *
 * Until now a pot was OpenCollective money: `rightsTotal` read the collective's
 * balance and nothing else could be a fund. But a harvest is a pot too, in
 * litres, and so is a case of wine or a stack of firewood — anything a holon
 * holds and means to divide by its allocation. A MINT is the record that it
 * exists: an attester (the policy's roles; admins by default) appends `mint`
 * to the `flow_mints` log with an amount and a unit, and from then on the
 * allocation divides it, the cascade carries it down, and every party's share
 * of it is a right they draw on with a `claim` (`claims.ts`), in that unit.
 *
 * The rules, in log order:
 *   - only an attester mints: issuing value is the same trust as paying it out;
 *   - the amount is positive and the unit is named;
 *   - the policy's quorum and disputes apply (`protocol.collapse`): a disputed
 *     mint is shown and does not count, so a wrong lot is voided by a word,
 *     never by rewriting.
 *
 * Units never mix: totals are kept per unit, and a holon minting oil and
 * holding euros has two pots, each divided by the same split.
 *
 * Pure: entries in, statement out. Reading the log is `mints-load.ts`.
 */

import {
  action,
  collapse,
  isAction,
  lensContext,
  normalizePolicy,
  type AcceptedActors,
  type Appendable,
  type CollapseResult,
  type LensContextInput,
  type LogEvent,
  type PartyResolver,
  type Policy,
} from '../protocol/index.js';
import { lunationAt } from './lunation.js';

/** The append-only lens fund mints live in. */
export const FLOW_MINTS_LENS = 'flow_mints';

export interface MintBody {
  t: 'action';
  kind: 'mint';
  amount: number;
  unit: string;
  /** The lunar cycle the mint was raised in (`lunationAt().index`). */
  epoch: number;
  memo?: string;
  /** Where the value came from, when it matters: a holon id (the trees), a lot name. */
  source?: string;
}

export type MintStatus = 'issued' | 'pending' | 'disputed' | 'conflict' | 'rejected';

export interface Mint {
  id: string;
  amount: number;
  unit: string;
  epoch: number;
  memo?: string;
  source?: string;
  /** Unix seconds. */
  createdAt: number;
  pubkey: string;
  status: MintStatus;
  /** Why it is not issued, in the reducer's or the domain's words. */
  reason?: string;
  attests: number;
  disputes: number;
}

export interface FoldedMints {
  /** Every mint in log order, judged. */
  mints: Mint[];
  /** The entries that count, in log order — what a checkpoint covers. */
  accepted: LogEvent<unknown>[];
  /** Unit → total issued. Only units with something in them. */
  byUnit: Record<string, number>;
  /** Unit → total raised but not (yet) counting: awaiting quorum, disputed. */
  pendingByUnit: Record<string, number>;
  source: AcceptedActors['source'];
  policy: Policy;
  epochs: number[];
}

export interface BuildMintInput {
  amount: number;
  unit: string;
  memo?: string;
  source?: string;
  /** When the mint is raised (ms). Default now. Sets the epoch. */
  at?: number;
  /** The minter's previous entry, to chain. */
  prev?: string;
}

const round = (v: number) => Math.round(v * 100) / 100;
const unitOf = (u: unknown) => String(u ?? '').trim().toUpperCase();

/** The `mint` action an attester appends. */
export function buildMint(input: BuildMintInput): Appendable<MintBody> {
  const at = input.at ?? Date.now();
  const body: Omit<MintBody, 't' | 'kind'> = {
    amount: round(Number(input.amount)),
    unit: unitOf(input.unit),
    epoch: lunationAt(at).index,
    ...(input.memo ? { memo: String(input.memo) } : {}),
    ...(input.source ? { source: String(input.source) } : {}),
  };
  return action('mint', body as Record<string, unknown>, input.prev ? { prev: input.prev } : undefined) as unknown as Appendable<MintBody>;
}

export const isMint = (item: unknown): item is MintBody => isAction(item) && item.kind === 'mint';

export interface FoldMintsInput {
  entries: Iterable<LogEvent<unknown>>;
  actors: AcceptedActors;
  policy?: Partial<Policy> | null;
}

/** Fold the `flow_mints` log into what the holon has to divide, per unit. */
export function foldMints(input: FoldMintsInput): FoldedMints {
  const attesterRoles = new Set(normalizePolicy(input.policy).attesters);
  const actors = input.actors;

  const result: CollapseResult<unknown, Record<string, number>> = collapse<unknown, Record<string, number>>({
    entries: input.entries,
    actors,
    policy: input.policy,
    initial: {},
    validate: (e) => {
      if (!isMint(e.item)) return 'unknown-kind';
      const m = e.item;
      // Minting is attester work: bringing value into the fund is the same
      // trust as saying it was paid out.
      const role = actors.roleAt(e.pubkey, e.created_at);
      if (!role || !attesterRoles.has(role)) return 'not-attester';
      if (!(Number(m.amount) > 0) || !Number.isFinite(Number(m.amount))) return 'bad-amount';
      if (!unitOf(m.unit)) return 'no-unit';
      return null;
    },
    fold: (state, e) => {
      if (!isMint(e.item)) return state;
      const unit = unitOf(e.item.unit);
      state[unit] = round((state[unit] ?? 0) + Number(e.item.amount));
      return state;
    },
  });

  const mints: Mint[] = [];
  const pendingByUnit: Record<string, number> = {};
  const epochs = new Set<number>();
  for (const j of result.judged.values()) {
    if (!isMint(j.entry.item)) continue;
    const m = j.entry.item;
    const unit = unitOf(m.unit);
    const amount = Number(m.amount);
    let status: MintStatus;
    let reason: string | undefined;
    if (j.status === 'accepted') status = 'issued';
    else if (j.status === 'rejected') {
      status = 'rejected';
      reason = j.detail ?? j.reason ?? undefined;
    } else if (j.reason === 'disputed') status = 'disputed';
    else if (j.reason === 'conflict') status = 'conflict';
    else {
      status = 'pending';
      reason = j.detail ?? j.reason ?? undefined;
    }
    epochs.add(Number(m.epoch));
    mints.push({
      id: j.entry.id,
      amount,
      unit,
      epoch: Number(m.epoch),
      ...(m.memo ? { memo: String(m.memo) } : {}),
      ...(m.source ? { source: String(m.source) } : {}),
      createdAt: j.entry.created_at,
      pubkey: j.entry.pubkey,
      status,
      ...(reason ? { reason } : {}),
      attests: j.attests,
      disputes: j.disputes,
    });
    if (status === 'pending' || status === 'disputed' || status === 'conflict') {
      pendingByUnit[unit] = round((pendingByUnit[unit] ?? 0) + amount);
    }
  }
  mints.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));

  return {
    mints,
    accepted: result.accepted,
    byUnit: { ...result.state },
    pendingByUnit,
    source: result.source,
    policy: result.policy,
    epochs: [...epochs].sort((a, b) => a - b),
  };
}

/** What was issued in one unit; zero when nothing was. */
export function mintedTotal(folded: FoldedMints | null | undefined, unit: string): number {
  return folded?.byUnit[unitOf(unit)] ?? 0;
}

/** The units anything was issued in, largest total first. */
export function mintedUnits(folded: FoldedMints | null | undefined): string[] {
  return Object.entries(folded?.byUnit ?? {})
    .filter(([, total]) => total > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([unit]) => unit);
}

// ── From lens data to a folded statement ─────────────────────────────────

export interface MintsFromLensesInput extends LensContextInput {
  /** The `flow_mints` log (`getLog`). */
  entries: Iterable<LogEvent<unknown>>;
}

export interface MintsContext {
  folded: FoldedMints;
  actors: AcceptedActors;
  parties: PartyResolver;
  policy: Policy;
  holonPubkey: string | null;
}

/** Fold the mints log with the signer set the lenses give — one function for every surface. */
export function foldMintsFromLenses(input: MintsFromLensesInput): MintsContext {
  const ctx = lensContext(input);
  const policy = ctx.policyFor(FLOW_MINTS_LENS);
  const folded = foldMints({ entries: input.entries, actors: ctx.actors, policy });
  return { folded, actors: ctx.actors, parties: ctx.parties, policy, holonPubkey: ctx.holonPubkey };
}
