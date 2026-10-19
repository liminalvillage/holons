// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fund claims as signed, append-only actions — the first log the protocol
 * reduces.
 *
 * The model in one breath: a MINT opens access (`mints.ts`), the cascade
 * says how much of it each party has (`allocation.ts`, `cascade.ts`), a
 * CLAIM burns some of it, and a GIVE burns yours and opens the same amount
 * for someone else. Nothing converts, nothing is bearer: every movement is
 * a signed entry in the holon's own `flow_claims` log, judged by the fold.
 *
 * Until now a claim was inferred from the expenses lens (a member fronting
 * money and splitting it with the holon) and from the collective's expense
 * queue, and the two knowingly double-counted (`usage.ts`). Here a claim is
 * a record of its own: a member appends `claim`, attesters (the policy's
 * roles; admins by default) attest or dispute it, and an attester's `payout`
 * consumes it. A `transfer` is the give. Every reader folds the same log to
 * the same statement; nothing is ever overwritten.
 *
 * The rules, in log order:
 *   - the signer must act for the party (`partyOf`), unless the holon key
 *     claims or gives on someone's behalf (`onBehalfOf`, marked `delegated`);
 *   - a party's ACCESS in a unit is their right (`RightsLookup`, the ceiling
 *     the surface sized) plus what was given to them, less what they gave;
 *     a party with no right of their own has exactly what they received;
 *   - a claim or a give that would push the party past their access in that
 *     unit is held as `over` — kept and shown, never counted;
 *   - a give names someone else: giving to yourself is rejected;
 *   - the policy's quorum and disputes apply (`protocol.collapse`), to a
 *     give as to a claim, so a received amount is not claimable until the
 *     give itself is accepted;
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
  type Judged,
  type LensContextInput,
  type LogEvent,
  type PartnerImport,
  type PartyResolver,
  type Policy,
} from '../protocol/index.js';
import { lunationAt } from './lunation.js';

/** The append-only lens fund claims live in. */
export const FLOW_CLAIMS_LENS = 'flow_claims';

/**
 * How a claim is to be paid, or was. `wallet` is the party's payout address;
 * the other three leave through the holon's OpenCollective, which holds the
 * payee's details — none of them ever reach the log.
 */
export type ClaimRail = 'wallet' | 'opencollective' | 'paypal' | 'bank';

export const CLAIM_RAILS: readonly ClaimRail[] = ['wallet', 'opencollective', 'paypal', 'bank'];

/** A rail as written, or nothing: an entry from before rails, or a word we do not know. */
export function readClaimRail(raw: unknown): ClaimRail | undefined {
  const rail = String(raw ?? '').trim().toLowerCase();
  return (CLAIM_RAILS as readonly string[]).includes(rail) ? (rail as ClaimRail) : undefined;
}

/** Where a payout can be looked up — an expense page, a transaction. Kept short; never a bank detail. */
const refOf = (raw: unknown): string | undefined => {
  const ref = String(raw ?? '').trim().slice(0, 300);
  return ref || undefined;
};

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
  /** How the party asks to be paid. */
  rail?: ClaimRail;
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
  /** How it was paid. */
  rail?: ClaimRail;
  /** Where the payment can be looked up. */
  ref?: string;
}

/** A give: `party` burns `amount` of their access in `unit` and `to` gains it. */
export interface TransferBody {
  t: 'action';
  kind: 'transfer';
  /** The giver. */
  party: string;
  /** The receiver — any party the holon can name; never the giver. */
  to: string;
  amount: number;
  unit: string;
  /** The lunar cycle the give was made in (`lunationAt().index`). */
  epoch: number;
  memo?: string;
  /** Set when the holon key gives for a party (the bot on a member's word). */
  onBehalfOf?: string;
}

export type ClaimStatus = 'pending' | 'approved' | 'disputed' | 'over' | 'conflict' | 'settled' | 'rejected';

/** A give is never settled: once accepted it has already moved the access. */
export type TransferStatus = Exclude<ClaimStatus, 'settled'>;

export interface Transfer {
  id: string;
  party: string;
  to: string;
  amount: number;
  unit: string;
  epoch: number;
  memo?: string;
  /** Unix seconds. */
  createdAt: number;
  pubkey: string;
  /** True when the holon key gave for the party. */
  delegated: boolean;
  /** The partner holon whose log the give came from, when imported. */
  origin?: string;
  status: TransferStatus;
  reason?: string;
  attests: number;
  disputes: number;
}

export interface Claim {
  id: string;
  party: string;
  amount: number;
  unit: string;
  epoch: number;
  percentage?: number;
  memo?: string;
  /** How the party asked to be paid. */
  rail?: ClaimRail;
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
  rail?: ClaimRail;
  ref?: string;
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
  /** Held past the party's access — claims and gives alike. */
  over: number;
  /** Given away, accepted. */
  given: number;
  /** Received from others, accepted. */
  received: number;
}

export interface FoldedClaims {
  /** Every claim in log order, judged. */
  claims: Claim[];
  /** Every give in log order, judged. */
  transfers: Transfer[];
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

/**
 * Rights per party and unit, or a lookup. Passing none at all means "no
 * ceiling known" (an uncapped fold, to size a pot); once a lookup IS passed,
 * a party or unit it does not name has a right of ZERO — a member with no
 * seat, or a unit nobody minted, has nothing to draw.
 */
export type RightsLookup =
  | Record<string, Record<string, number | null | undefined>>
  | ((party: string, unit: string) => number | null | undefined);

export interface BuildClaimInput {
  party: string;
  amount: number;
  unit: string;
  memo?: string;
  rail?: ClaimRail;
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
    ...(readClaimRail(input.rail) ? { rail: readClaimRail(input.rail) } : {}),
    ...(input.onBehalfOf ? { onBehalfOf: String(input.onBehalfOf) } : {}),
  };
  return action('claim', body as Record<string, unknown>, input.prev ? { prev: input.prev } : undefined) as unknown as Appendable<ClaimBody>;
}

export interface BuildTransferInput {
  /** The giver. */
  party: string;
  /** The receiver. */
  to: string;
  amount: number;
  unit: string;
  memo?: string;
  /** When the give is made (ms). Default now. Sets the epoch. */
  at?: number;
  /** The party's previous entry, to chain. */
  prev?: string;
  onBehalfOf?: string;
}

/** The `transfer` action a party appends to give part of their access away. */
export function buildTransfer(input: BuildTransferInput): Appendable<TransferBody> {
  const at = input.at ?? Date.now();
  const party = String(input.party ?? '');
  const to = String(input.to ?? '').trim();
  if (!to) throw new Error('A give names who receives it');
  if (to === party) throw new Error('A give names someone else');
  const body: Omit<TransferBody, 't' | 'kind'> = {
    party,
    to,
    amount: round(Number(input.amount)),
    unit: unitOf(input.unit),
    epoch: lunationAt(at).index,
    ...(input.memo ? { memo: String(input.memo) } : {}),
    ...(input.onBehalfOf ? { onBehalfOf: String(input.onBehalfOf) } : {}),
  };
  return action('transfer', body as Record<string, unknown>, input.prev ? { prev: input.prev } : undefined) as unknown as Appendable<TransferBody>;
}

/** The `payout` an attester appends once a claim is paid; it consumes the claim. */
export function buildPayout(input: {
  claimId: string;
  party: string;
  amount: number;
  unit: string;
  memo?: string;
  rail?: ClaimRail;
  ref?: string;
}): Appendable<PayoutBody> {
  const body = {
    party: String(input.party),
    amount: round(Number(input.amount)),
    unit: unitOf(input.unit),
    ...(input.memo ? { memo: String(input.memo) } : {}),
    ...(readClaimRail(input.rail) ? { rail: readClaimRail(input.rail) } : {}),
    ...(refOf(input.ref) ? { ref: refOf(input.ref) } : {}),
  };
  return action('payout', body, { basis: [input.claimId] }) as unknown as Appendable<PayoutBody>;
}

/** An attester's word on a claim. */
export function buildClaimVerdict(claimId: string, verdict: 'attest' | 'dispute', reason?: string): Appendable<AttestationRecord> {
  return attestation(claimId, verdict, reason);
}

export const isClaim = (item: unknown): item is ClaimBody => isAction(item) && item.kind === 'claim';
export const isPayout = (item: unknown): item is PayoutBody => isAction(item) && item.kind === 'payout';
export const isTransfer = (item: unknown): item is TransferBody => isAction(item) && item.kind === 'transfer';

export interface FoldClaimsInput {
  entries: Iterable<LogEvent<unknown>>;
  actors: AcceptedActors;
  policy?: Partial<Policy> | null;
  /** Which party a signing key acts for. */
  partyOf: (pubkey: string) => string | null | undefined;
  /** The ceiling per party and unit; omit it for an uncapped fold. Under a lookup, a missing right is zero. */
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
  /** Received less given per `party|unit`, accepted gives only. */
  net: Map<string, number>;
  /** Received per `party|unit`: a party who received anything has access even with no right. */
  received: Map<string, number>;
}

const rightOf = (rights: RightsLookup | null | undefined, party: string, unit: string): number | null => {
  if (!rights) return null;
  const v = typeof rights === 'function' ? rights(party, unit) : rights[party]?.[unit];
  // A lookup that does not name the party or the unit says they hold nothing:
  // treating that as "unknown" would let an unseated member draw without limit.
  return v == null || !Number.isFinite(Number(v)) ? 0 : Number(v);
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

  /** Does the signer act for `party`? Null when yes, the reason when not. */
  const signerFor = (e: LogEvent<unknown>, party: string, onBehalfOf: unknown): string | null => {
    const delegated = !!holonKey && e.pubkey.toLowerCase() === holonKey && !!onBehalfOf;
    if (delegated) return String(onBehalfOf) === party ? null : 'party-mismatch';
    const actsFor = partyOf(e.pubkey, e.created_at);
    if (!actsFor) return 'unknown-party';
    return actsFor === party ? null : 'party-mismatch';
  };

  /**
   * A party's access in a unit: their right plus what they received less what
   * they gave. With no lookup at all there is no ceiling (the surface sized
   * none) unless something was received — then exactly that.
   */
  const accessOf = (state: FoldState, party: string, unit: string): number | null => {
    const key = `${party}|${unit}`;
    const right = rightOf(input.rights, party, unit);
    const net = state.net.get(key) ?? 0;
    if (right == null) return (state.received.get(key) ?? 0) > 0 ? net : null;
    return right + net;
  };

  /** Would drawing `amount` more push `party` past their access? */
  const overAccess = (state: FoldState, party: string, unit: string, amount: number): boolean => {
    const access = accessOf(state, party, unit);
    if (access == null) return false;
    const key = `${party}|${unit}`;
    const drawn = (state.open.get(key) ?? 0) + settledOf(state, key);
    return drawn + amount > access + 0.005;
  };

  const result: CollapseResult<unknown, FoldState> = collapse<unknown, FoldState>({
    entries,
    actors,
    policy: input.policy,
    initial: { claims: new Map(), open: new Map(), payouts: [], net: new Map(), received: new Map() },
    validate: (e, state) => {
      if (isClaim(e.item)) {
        const c = e.item;
        if (!(Number(c.amount) > 0) || !Number.isFinite(Number(c.amount))) return 'bad-amount';
        if (!unitOf(c.unit)) return 'no-unit';
        const who = signerFor(e, String(c.party), c.onBehalfOf);
        if (who) return who;
        if (overAccess(state, String(c.party), unitOf(c.unit), Number(c.amount))) return { status: 'pending', reason: 'over-right' };
        return null;
      }
      if (isTransfer(e.item)) {
        const t = e.item;
        if (!(Number(t.amount) > 0) || !Number.isFinite(Number(t.amount))) return 'bad-amount';
        if (!unitOf(t.unit)) return 'no-unit';
        const to = String(t.to ?? '').trim();
        if (!to) return 'no-receiver';
        if (to === String(t.party)) return 'self';
        const who = signerFor(e, String(t.party), t.onBehalfOf);
        if (who) return who;
        if (overAccess(state, String(t.party), unitOf(t.unit), Number(t.amount))) return { status: 'pending', reason: 'over-right' };
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
      if (isTransfer(e.item)) {
        const unit = unitOf(e.item.unit);
        const amount = Number(e.item.amount);
        const from = `${e.item.party}|${unit}`;
        const to = `${String(e.item.to).trim()}|${unit}`;
        state.net.set(from, (state.net.get(from) ?? 0) - amount);
        state.net.set(to, (state.net.get(to) ?? 0) + amount);
        state.received.set(to, (state.received.get(to) ?? 0) + amount);
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
          ...(readClaimRail(e.item.rail) ? { rail: readClaimRail(e.item.rail) } : {}),
          ...(refOf(e.item.ref) ? { ref: refOf(e.item.ref) } : {}),
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
    return (perUnit[unit] ??= { claimed: 0, settled: 0, pending: 0, over: 0, given: 0, received: 0 });
  };
  /** The judged status of a claim or a give, in the domain's words. */
  const statusOf = (j: Judged<unknown>, settled: boolean): { status: ClaimStatus; reason?: string } => {
    if (j.status === 'accepted') return { status: settled ? 'settled' : 'approved' };
    if (j.status === 'rejected') return { status: 'rejected', reason: j.detail ?? j.reason ?? undefined };
    if (j.reason === 'disputed') return { status: 'disputed' };
    if (j.reason === 'conflict') return { status: 'conflict' };
    if (j.reason === 'held' && j.detail === 'over-right') return { status: 'over' };
    return { status: 'pending', reason: j.detail ?? j.reason ?? undefined };
  };
  const claims: Claim[] = [];
  const transfers: Transfer[] = [];
  const epochs = new Set<number>();
  for (const j of result.judged.values()) {
    if (isTransfer(j.entry.item)) {
      const t = j.entry.item;
      const unit = unitOf(t.unit);
      const amount = Number(t.amount);
      const to = String(t.to ?? '').trim();
      const { status, reason } = statusOf(j, false);
      epochs.add(Number(t.epoch));
      const origin = actors.originOf(j.entry.pubkey, j.entry.created_at);
      transfers.push({
        id: j.entry.id,
        party: String(t.party),
        to,
        amount,
        unit,
        epoch: Number(t.epoch),
        ...(t.memo ? { memo: String(t.memo) } : {}),
        createdAt: j.entry.created_at,
        pubkey: j.entry.pubkey,
        delegated: !!holonKey && j.entry.pubkey.toLowerCase() === holonKey && !!t.onBehalfOf,
        ...(origin ? { origin } : {}),
        status: status as TransferStatus,
        ...(reason ? { reason } : {}),
        attests: j.attests,
        disputes: j.disputes,
      });
      if (status === 'rejected') continue;
      const giver = totals(String(t.party), unit);
      if (status === 'approved') {
        giver.given += amount;
        totals(to, unit).received += amount;
      } else if (status === 'over') giver.over += amount;
      else giver.pending += amount;
      continue;
    }
    if (!isClaim(j.entry.item)) continue;
    const c = j.entry.item;
    const unit = unitOf(c.unit);
    const amount = Number(c.amount);
    const folded = result.state.claims.get(j.entry.id);
    const { status, reason } = statusOf(j, !!folded?.settledBy);
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
      ...(readClaimRail(c.rail) ? { rail: readClaimRail(c.rail) } : {}),
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
      t.given = round(t.given);
      t.received = round(t.received);
    }
  }
  const byLog = <T extends { createdAt: number; id: string }>(a: T, b: T) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);
  claims.sort(byLog);
  transfers.sort(byLog);

  return {
    claims,
    transfers,
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
  return { claimed: 0, settled: 0, pending: 0, over: 0, given: 0, received: 0, ...(folded?.byParty[String(party)]?.[unitOf(unit)] ?? {}) };
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

const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * A key no lens binds to a party speaks for the party named by that very
 * key, and for nobody else. A person who signs in with a key IS their key —
 * the rule that makes a pubkey holon its key — and a split may seat them
 * under it; without this their right could never be drawn, because no
 * directory attests a bare key. It widens nothing: whether the signer is
 * ACCEPTED is still the holon's membership's call (`collapse`), and a key
 * already bound — an attested identity, the holon's own key — keeps that
 * binding.
 */
export function selfKeyedPartyOf(partyOf: (pubkey: string) => string | null | undefined): (pubkey: string) => string | null {
  return (pubkey) => {
    const bound = partyOf(pubkey);
    if (bound != null) return String(bound);
    const key = String(pubkey ?? '').toLowerCase();
    return HEX64.test(key) ? key : null;
  };
}

/** Fold the claims log with the signer set and party map the lenses give. */
export function foldClaimsFromLenses(input: ClaimsFromLensesInput): ClaimsContext {
  const ctx = lensContext(input);
  const policy = ctx.policyFor(FLOW_CLAIMS_LENS);
  const folded = foldClaims({
    entries: input.entries,
    actors: ctx.actors,
    policy,
    partyOf: selfKeyedPartyOf(ctx.parties.partyOf),
    rights: input.rights,
    holonPubkey: ctx.holonPubkey,
    imports: input.imports,
  });
  return { folded, actors: ctx.actors, parties: ctx.parties, policy, holonPubkey: ctx.holonPubkey };
}
