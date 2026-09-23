// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fund claims as signed, append-only actions — the first log the protocol
 * reduces.
 *
 * A right over the fund (`allocation.ts`) is drawn down by CLAIMS. Until now
 * a claim was inferred from the expenses lens (a member fronting money and
 * splitting it with the holon) and from the collective's expense queue, and
 * the two knowingly double-counted (`usage.ts`). Here a claim is a record of
 * its own: a member appends `claim` to the `flow_claims` log, attesters
 * (the policy's roles; admins by default) attest or dispute it, and an
 * attester's `payout` consumes it. Every reader folds the same log to the
 * same statement; nothing is ever overwritten.
 *
 * The rules, in log order:
 *   - the signer must act for the party (`partyOf`), unless the holon key
 *     claims on someone's behalf (`onBehalfOf`, marked `delegated`);
 *   - a claim that would push the party past their right in that unit is
 *     held as `over` — kept and shown, never counted as available money;
 *   - the policy's quorum and disputes apply (`protocol.collapse`);
 *   - a payout names the claim it settles as `basis`; a second payout for
 *     the same claim is a double-consume and does not count;
 *   - a partner holon with a right on this fund claims it in ITS OWN log:
 *     the entries the partner accepted (`importPartnerLog`) fold here as
 *     claims by the partner party, judged again under this holon's policy —
 *     its attesters, its quorum (`protocol/federation`).
 *
 * Pure: entries in, statement out.
 */

import {
  action,
  attestation,
  collapse,
  federatedActors,
  isAction,
  lensContext,
  normalizePolicy,
  type AcceptedActors,
  type Appendable,
  type AttestationRecord,
  type CollapseResult,
  type LensContextInput,
  type LogEvent,
  type PartnerImport,
  type PartyResolver,
  type Policy,
} from '../protocol/index.js';
import { lunationAt } from './lunation.js';

/** The append-only lens fund claims live in. */
export const FLOW_CLAIMS_LENS = 'flow_claims';

export interface ClaimBody {
  t: 'action';
  kind: 'claim';
  /** The rights-holder drawing on the fund. */
  party: string;
  amount: number;
  unit: string;
  /** The lunar cycle the claim was raised in (`lunationAt().index`). */
  epoch: number;
  /** The party's share at claim time, frozen so a later re-split does not move it. */
  percentage?: number;
  memo?: string;
  /** Set when the holon key claims for a party (the bot on a member's word). */
  onBehalfOf?: string;
}

export interface PayoutBody {
  t: 'action';
  kind: 'payout';
  party: string;
  amount: number;
  unit: string;
  memo?: string;
}

export type ClaimStatus = 'pending' | 'approved' | 'disputed' | 'over' | 'conflict' | 'settled' | 'rejected';

export interface Claim {
  id: string;
  party: string;
  amount: number;
  unit: string;
  epoch: number;
  percentage?: number;
  memo?: string;
  /** Unix seconds. */
  createdAt: number;
  pubkey: string;
  /** True when the holon key raised it for the party. */
  delegated: boolean;
  /** The partner holon whose log the claim came from, when imported. */
  origin?: string;
  status: ClaimStatus;
  /** Why it is not approved, in the reducer's or the domain's words. */
  reason?: string;
  attests: number;
  disputes: number;
  /** The payout entry that settled it. */
  settledBy?: string;
}

export interface Payout {
  id: string;
  claimId: string;
  party: string;
  amount: number;
  unit: string;
  memo?: string;
  createdAt: number;
  pubkey: string;
}

/** A party's position in one unit. */
export interface ClaimTotals {
  /** Approved and still owed. */
  claimed: number;
  /** Paid out through the log. */
  settled: number;
  /** Raised but not yet counting: awaiting quorum, disputed, or conflicting. */
  pending: number;
  /** Held past the party's right. */
  over: number;
}

export interface FoldedClaims {
  /** Every claim in log order, judged. */
  claims: Claim[];
  payouts: Payout[];
  /** The entries that count (claims and payouts), in log order — what a checkpoint covers. */
  accepted: LogEvent<unknown>[];
  /** Party → unit → totals. */
  byParty: Record<string, Record<string, ClaimTotals>>;
  /** Whether the accepted-signer set came from a founded holon or a bootstrap list. */
  source: AcceptedActors['source'];
  policy: Policy;
  epochs: number[];
  /** The partner logs folded in: what each accepted by its own rules, and how it was trusted. */
  imports: Array<{ holon: string; source: AcceptedActors['source']; accepted: number; pending: number; rejected: number }>;
}

/** Rights per party and unit, or a lookup. `null` means "no ceiling known". */
export type RightsLookup =
  | Record<string, Record<string, number | null | undefined>>
  | ((party: string, unit: string) => number | null | undefined);

export interface BuildClaimInput {
  party: string;
  amount: number;
  unit: string;
  memo?: string;
  percentage?: number;
  /** When the claim is raised (ms). Default now. Sets the epoch. */
  at?: number;
  /** The party's previous claim entry, to chain. */
  prev?: string;
  onBehalfOf?: string;
}

const round = (v: number) => Math.round(v * 100) / 100;
const unitOf = (u: unknown) => String(u ?? '').trim().toUpperCase();

/** The `claim` action a member appends. */
export function buildClaim(input: BuildClaimInput): Appendable<ClaimBody> {
  const at = input.at ?? Date.now();
  const body: Omit<ClaimBody, 't' | 'kind'> = {
    party: String(input.party),
    amount: round(Number(input.amount)),
    unit: unitOf(input.unit),
    epoch: lunationAt(at).index,
    ...(input.percentage != null ? { percentage: input.percentage } : {}),
    ...(input.memo ? { memo: String(input.memo) } : {}),
    ...(input.onBehalfOf ? { onBehalfOf: String(input.onBehalfOf) } : {}),
  };
  return action('claim', body as Record<string, unknown>, input.prev ? { prev: input.prev } : undefined) as unknown as Appendable<ClaimBody>;
}

/** The `payout` an attester appends once a claim is paid; it consumes the claim. */
export function buildPayout(input: { claimId: string; party: string; amount: number; unit: string; memo?: string }): Appendable<PayoutBody> {
  const body = {
    party: String(input.party),
    amount: round(Number(input.amount)),
    unit: unitOf(input.unit),
    ...(input.memo ? { memo: String(input.memo) } : {}),
  };
  return action('payout', body, { basis: [input.claimId] }) as unknown as Appendable<PayoutBody>;
}

/** An attester's word on a claim. */
export function buildClaimVerdict(claimId: string, verdict: 'attest' | 'dispute', reason?: string): Appendable<AttestationRecord> {
  return attestation(claimId, verdict, reason);
}

export const isClaim = (item: unknown): item is ClaimBody => isAction(item) && item.kind === 'claim';
export const isPayout = (item: unknown): item is PayoutBody => isAction(item) && item.kind === 'payout';

export interface FoldClaimsInput {
  entries: Iterable<LogEvent<unknown>>;
  actors: AcceptedActors;
  policy?: Partial<Policy> | null;
  /** Which party a signing key acts for. */
  partyOf: (pubkey: string) => string | null | undefined;
  /** The ceiling per party and unit; a missing right means no ceiling. */
  rights?: RightsLookup | null;
  /** The holon's own key, allowed to claim `onBehalfOf` a party. */
  holonPubkey?: string | null;
  /** Partner logs, each already judged by the partner's own rules (`importPartnerLog`). */
  imports?: Iterable<PartnerImport> | null;
}

interface FoldState {
  /** Approved claims by id, with the payout that settled them. */
  claims: Map<string, { entry: LogEvent<ClaimBody>; settledBy?: string }>;
  /** Approved, unsettled amount per `party|unit`. */
  open: Map<string, number>;
  payouts: Payout[];
}

const rightOf = (rights: RightsLookup | null | undefined, party: string, unit: string): number | null => {
  if (!rights) return null;
  const v = typeof rights === 'function' ? rights(party, unit) : rights[party]?.[unit];
  return v == null || !Number.isFinite(Number(v)) ? null : Number(v);
};

/** Fold the `flow_claims` log into every party's statement. */
export function foldClaims(input: FoldClaimsInput): FoldedClaims {
  const holonKey = input.holonPubkey?.toLowerCase() ?? null;
  const attesterRoles = new Set(normalizePolicy(input.policy).attesters);
  const imports = [...(input.imports ?? [])];
  // A partner's key acts for the partner holon; the importer's own word
  // wins for a key it knows.
  const actors = federatedActors(input.actors, imports);
  const partyOf = (pubkey: string, at: number) => {
    const origin = actors.originOf(pubkey, at);
    if (origin) return origin;
    const p = input.partyOf(pubkey);
    return p == null ? null : String(p);
  };
  const entries: LogEvent<unknown>[] = [...input.entries];
  for (const p of imports) entries.push(...p.accepted);

  const result: CollapseResult<unknown, FoldState> = collapse<unknown, FoldState>({
    entries,
    actors,
    policy: input.policy,
    initial: { claims: new Map(), open: new Map(), payouts: [] },
    validate: (e, state) => {
      if (isClaim(e.item)) {
        const c = e.item;
        if (!(Number(c.amount) > 0) || !Number.isFinite(Number(c.amount))) return 'bad-amount';
        if (!unitOf(c.unit)) return 'no-unit';
        const actsFor = partyOf(e.pubkey, e.created_at);
        const delegated = !!holonKey && e.pubkey.toLowerCase() === holonKey && !!c.onBehalfOf;
        if (delegated) {
          if (String(c.onBehalfOf) !== String(c.party)) return 'party-mismatch';
        } else if (!actsFor) {
          return 'unknown-party';
        } else if (actsFor !== String(c.party)) {
          return 'party-mismatch';
        }
        const right = rightOf(input.rights, String(c.party), unitOf(c.unit));
        if (right != null) {
          const key = `${c.party}|${unitOf(c.unit)}`;
          const drawn = (state.open.get(key) ?? 0) + settledOf(state, key);
          if (drawn + Number(c.amount) > right + 0.005) return { status: 'pending', reason: 'over-right' };
        }
        return null;
      }
      if (isPayout(e.item)) {
        const p = e.item;
        // Paying out is attester work: the roles the policy trusts to judge
        // a claim are the ones that may say it was paid.
        const role = actors.roleAt(e.pubkey, e.created_at);
        if (!role || !attesterRoles.has(role)) return 'not-attester';
        if (!(Number(p.amount) > 0)) return 'bad-amount';
        const claimId = e.refs.basis[0];
        if (!claimId || e.refs.basis.length !== 1) return 'no-claim';
        const claim = state.claims.get(claimId);
        if (!claim) return 'unknown-claim';
        if (String(claim.entry.item.party) !== String(p.party)) return 'party-mismatch';
        if (unitOf(claim.entry.item.unit) !== unitOf(p.unit)) return 'unit-mismatch';
        return null;
      }
      return 'unknown-kind';
    },
    fold: (state, e) => {
      if (isClaim(e.item)) {
        const key = `${e.item.party}|${unitOf(e.item.unit)}`;
        state.claims.set(e.id, { entry: e as LogEvent<ClaimBody> });
        state.open.set(key, (state.open.get(key) ?? 0) + Number(e.item.amount));
        return state;
      }
      if (isPayout(e.item)) {
        const claimId = e.refs.basis[0];
        const claim = state.claims.get(claimId)!;
        claim.settledBy = e.id;
        const key = `${e.item.party}|${unitOf(e.item.unit)}`;
        state.open.set(key, Math.max(0, (state.open.get(key) ?? 0) - Number(claim.entry.item.amount)));
        state.payouts.push({
          id: e.id,
          claimId,
          party: String(e.item.party),
          amount: Number(e.item.amount),
          unit: unitOf(e.item.unit),
          ...(e.item.memo ? { memo: e.item.memo } : {}),
          createdAt: e.created_at,
          pubkey: e.pubkey,
        });
        return state;
      }
      return state;
    },
  });

  const byParty: FoldedClaims['byParty'] = {};
  const totals = (party: string, unit: string): ClaimTotals => {
    const perUnit = (byParty[party] ??= {});
    return (perUnit[unit] ??= { claimed: 0, settled: 0, pending: 0, over: 0 });
  };
  const claims: Claim[] = [];
  const epochs = new Set<number>();
  for (const j of result.judged.values()) {
    if (!isClaim(j.entry.item)) continue;
    const c = j.entry.item;
    const unit = unitOf(c.unit);
    const amount = Number(c.amount);
    const folded = result.state.claims.get(j.entry.id);
    let status: ClaimStatus;
    let reason: string | undefined;
    if (j.status === 'accepted') status = folded?.settledBy ? 'settled' : 'approved';
    else if (j.status === 'rejected') {
      status = 'rejected';
      reason = j.detail ?? j.reason ?? undefined;
    } else if (j.reason === 'disputed') status = 'disputed';
    else if (j.reason === 'conflict') status = 'conflict';
    else if (j.reason === 'held' && j.detail === 'over-right') status = 'over';
    else {
      status = 'pending';
      reason = j.detail ?? j.reason ?? undefined;
    }
    if (status === 'pending' && !reason) reason = j.reason ?? undefined;
    epochs.add(Number(c.epoch));
    const origin = actors.originOf(j.entry.pubkey, j.entry.created_at);
    claims.push({
      id: j.entry.id,
      party: String(c.party),
      amount,
      unit,
      epoch: Number(c.epoch),
      ...(c.percentage != null ? { percentage: Number(c.percentage) } : {}),
      ...(c.memo ? { memo: String(c.memo) } : {}),
      createdAt: j.entry.created_at,
      pubkey: j.entry.pubkey,
      delegated: !!holonKey && j.entry.pubkey.toLowerCase() === holonKey && !!c.onBehalfOf,
      ...(origin ? { origin } : {}),
      status,
      ...(reason ? { reason } : {}),
      attests: j.attests,
      disputes: j.disputes,
      ...(folded?.settledBy ? { settledBy: folded.settledBy } : {}),
    });
    if (status === 'rejected') continue;
    const t = totals(String(c.party), unit);
    if (status === 'approved') t.claimed += amount;
    else if (status === 'over') t.over += amount;
    else if (status !== 'settled') t.pending += amount;
  }
  for (const p of result.state.payouts) totals(p.party, p.unit).settled += p.amount;
  for (const perUnit of Object.values(byParty)) {
    for (const t of Object.values(perUnit)) {
      t.claimed = round(t.claimed);
      t.settled = round(t.settled);
      t.pending = round(t.pending);
      t.over = round(t.over);
    }
  }
  claims.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));

  return {
    claims,
    payouts: [...result.state.payouts],
    accepted: result.accepted,
    byParty,
    source: result.source,
    policy: result.policy,
    epochs: [...epochs].sort((a, b) => a - b),
    imports: imports.map((p) => ({ holon: p.holon, source: p.source, accepted: p.accepted.length, pending: p.pending, rejected: p.rejected })),
  };
}

/** The approved amount settled so far for a `party|unit` key. */
function settledOf(state: FoldState, key: string): number {
  let sum = 0;
  for (const p of state.payouts) if (`${p.party}|${p.unit}` === key) sum += p.amount;
  return sum;
}

/** A party's totals in a unit; zeros when it never claimed in it. */
export function claimTotalsOf(folded: FoldedClaims | null | undefined, party: string, unit: string): ClaimTotals {
  return { ...(folded?.byParty[String(party)]?.[unitOf(unit)] ?? { claimed: 0, settled: 0, pending: 0, over: 0 }) };
}

// ── From lens data to a folded statement ─────────────────────────────────
// What every surface needs to do before folding: decide who counts and who
// each key is. One function so the kiosk, the web and the bot cannot drift.

export interface ClaimsFromLensesInput extends LensContextInput {
  /** The `flow_claims` log (`getLog`). */
  entries: Iterable<LogEvent<unknown>>;
  rights?: RightsLookup | null;
  /** Pinned partners' logs, judged by their own rules (`importPartnerLogs`). */
  imports?: Iterable<PartnerImport> | null;
}

export interface ClaimsContext {
  folded: FoldedClaims;
  actors: AcceptedActors;
  parties: PartyResolver;
  policy: Policy;
  holonPubkey: string | null;
}

/** Fold the claims log with the signer set and party map the lenses give. */
export function foldClaimsFromLenses(input: ClaimsFromLensesInput): ClaimsContext {
  const ctx = lensContext(input);
  const policy = ctx.policyFor(FLOW_CLAIMS_LENS);
  const folded = foldClaims({
    entries: input.entries,
    actors: ctx.actors,
    policy,
    partyOf: ctx.parties.partyOf,
    rights: input.rights,
    holonPubkey: ctx.holonPubkey,
    imports: input.imports,
  });
  return { folded, actors: ctx.actors, parties: ctx.parties, policy, holonPubkey: ctx.holonPubkey };
}
