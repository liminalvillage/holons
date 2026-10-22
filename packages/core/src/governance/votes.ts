// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Votes as signed, append-only actions — the second log the protocol
 * reduces.
 *
 * A proposal is still a `type:'proposal'` quest, as every UI writes it. A
 * VOTE on it used to be a participant toggle on that record — one writer's
 * word, overwritable, unsigned by the voter. Here a vote is an entry of its
 * own in the `governance_votes` log: the voter appends `vote` with their
 * choice, and every reader folds the same log to the same ballots. Nothing
 * is overwritten: a change of mind is a newer entry, and the fold keeps one
 * counted vote per party per proposal — the newest.
 *
 * The rules, in log order:
 *   - the signer must act for the party (`partyOf`), unless the holon key
 *     votes on someone's word (`onBehalfOf`, marked `delegated`);
 *   - the policy's authors, quorum and disputes apply (`protocol.collapse`):
 *     an attester may dispute a vote, and it stops counting until withdrawn;
 *   - a vote cast after the proposal closed is rejected as `late`, when the
 *     caller knows the close (`closesAt`);
 *   - a partner holon with a seat votes in ITS OWN log; the entries it
 *     accepted fold here as votes by the partner party (`protocol/federation`).
 *
 * Counting — weights, delegation, the threshold — stays in `tally.ts`
 * (`tallyBallots`), over the ballots this fold yields.
 */

import {
  action,
  attestation,
  collapse,
  federatedActors,
  isAction,
  lensContext,
  type AcceptedActors,
  type Appendable,
  type AttestationRecord,
  type LensContextInput,
  type LogEvent,
  type PartnerImport,
  type PartyResolver,
  type Policy,
} from '../protocol/index.js';

/** The append-only lens votes live in. */
export const GOVERNANCE_VOTES_LENS = 'governance_votes';

export type VoteChoice = 'yes' | 'no' | 'abstain';
export const VOTE_CHOICES: readonly VoteChoice[] = ['yes', 'no', 'abstain'];

export interface VoteBody {
  t: 'action';
  kind: 'vote';
  /** The proposal quest's id. */
  proposal: string;
  choice: VoteChoice;
  /** The voter — a member id or a partner holon id. */
  party: string;
  memo?: string;
  /** Set when the holon key votes for a party (the bot on a member's word). */
  onBehalfOf?: string;
}

export type VoteStatus = 'counted' | 'superseded' | 'pending' | 'disputed' | 'rejected';

export interface Vote {
  id: string;
  proposal: string;
  party: string;
  choice: VoteChoice;
  memo?: string;
  /** Unix seconds. */
  createdAt: number;
  pubkey: string;
  /** True when the holon key cast it for the party. */
  delegated: boolean;
  /** The partner holon whose log the vote came from, when imported. */
  origin?: string;
  status: VoteStatus;
  /** Why it does not count, in the reducer's or the domain's words. */
  reason?: string;
  attests: number;
  disputes: number;
}

/** Proposal → party → the counted choice. */
export type Ballots = Record<string, Record<string, VoteChoice>>;

export interface FoldedVotes {
  /** Every vote in log order, judged. */
  votes: Vote[];
  ballots: Ballots;
  /** The entries that count, in log order — what a checkpoint covers. */
  accepted: LogEvent<unknown>[];
  source: AcceptedActors['source'];
  policy: Policy;
  imports: Array<{ holon: string; source: AcceptedActors['source']; accepted: number; pending: number; rejected: number }>;
}

export interface BuildVoteInput {
  proposal: string;
  choice: VoteChoice;
  party: string;
  memo?: string;
  onBehalfOf?: string;
}

const choiceOf = (v: unknown): VoteChoice | null => {
  const c = String(v ?? '').trim().toLowerCase();
  return (VOTE_CHOICES as readonly string[]).includes(c) ? (c as VoteChoice) : null;
};

/** The `vote` action a member appends. */
export function buildVote(input: BuildVoteInput): Appendable<VoteBody> {
  const choice = choiceOf(input.choice);
  if (!choice) throw new Error(`Not a vote: ${String(input.choice)}`);
  const body: Omit<VoteBody, 't' | 'kind'> = {
    proposal: String(input.proposal),
    choice,
    party: String(input.party),
    ...(input.memo ? { memo: String(input.memo).slice(0, 280) } : {}),
    ...(input.onBehalfOf ? { onBehalfOf: String(input.onBehalfOf) } : {}),
  };
  return action('vote', body) as unknown as Appendable<VoteBody>;
}

/** An attester's word on a vote (a dispute stops it counting until withdrawn). */
export function buildVoteVerdict(voteId: string, verdict: 'attest' | 'dispute', reason?: string): Appendable<AttestationRecord> {
  return attestation(voteId, verdict, reason);
}

export const isVote = (item: unknown): item is VoteBody => isAction(item) && item.kind === 'vote';

export interface FoldVotesInput {
  entries: Iterable<LogEvent<unknown>>;
  actors: AcceptedActors;
  policy?: Partial<Policy> | null;
  partyOf: (pubkey: string) => string | null | undefined;
  holonPubkey?: string | null;
  /** When a proposal closed (unix seconds), or null while it is open. Votes after it are `late`. */
  closesAt?: ((proposal: string) => number | null | undefined) | null;
  /** Partner logs, each already judged by the partner's own rules (`importPartnerLog`). */
  imports?: Iterable<PartnerImport> | null;
}

interface FoldState {
  /** `proposal|party` → the counted vote's id. */
  latest: Map<string, string>;
}

/** Fold the `governance_votes` log into ballots. */
export function foldVotes(input: FoldVotesInput): FoldedVotes {
  const holonKey = input.holonPubkey?.toLowerCase() ?? null;
  const imports = [...(input.imports ?? [])];
  const actors = federatedActors(input.actors, imports);
  const partyOf = (pubkey: string, at: number) => {
    const origin = actors.originOf(pubkey, at);
    if (origin) return origin;
    const p = input.partyOf(pubkey);
    return p == null ? null : String(p);
  };
  const entries: LogEvent<unknown>[] = [...input.entries];
  for (const p of imports) entries.push(...p.accepted);

  const result = collapse<unknown, FoldState>({
    entries,
    actors,
    policy: input.policy,
    initial: { latest: new Map() },
    validate: (e) => {
      if (!isVote(e.item)) return 'unknown-kind';
      const v = e.item;
      if (!String(v.proposal ?? '').trim()) return 'no-proposal';
      if (!choiceOf(v.choice)) return 'bad-choice';
      const delegated = !!holonKey && e.pubkey.toLowerCase() === holonKey && !!v.onBehalfOf;
      if (delegated) {
        if (String(v.onBehalfOf) !== String(v.party)) return 'party-mismatch';
      } else {
        const actsFor = partyOf(e.pubkey, e.created_at);
        if (!actsFor) return 'unknown-party';
        if (actsFor !== String(v.party)) return 'party-mismatch';
      }
      const closes = input.closesAt?.(String(v.proposal));
      if (closes != null && Number.isFinite(Number(closes)) && e.created_at > Number(closes)) return 'late';
      return null;
    },
    fold: (state, e) => {
      const v = e.item as VoteBody;
      state.latest.set(`${v.proposal}|${v.party}`, e.id);
      return state;
    },
  });

  const counted = new Set(result.state.latest.values());
  const votes: Vote[] = [];
  const ballots: Ballots = {};
  for (const j of result.judged.values()) {
    if (!isVote(j.entry.item)) continue;
    const v = j.entry.item;
    let status: VoteStatus;
    let reason: string | undefined;
    if (j.status === 'accepted') status = counted.has(j.entry.id) ? 'counted' : 'superseded';
    else if (j.status === 'rejected') {
      status = 'rejected';
      reason = j.detail ?? j.reason ?? undefined;
    } else if (j.reason === 'disputed') status = 'disputed';
    else {
      status = 'pending';
      reason = j.detail ?? j.reason ?? undefined;
    }
    const origin = actors.originOf(j.entry.pubkey, j.entry.created_at);
    const vote: Vote = {
      id: j.entry.id,
      proposal: String(v.proposal),
      party: String(v.party),
      choice: choiceOf(v.choice) ?? 'abstain',
      ...(v.memo ? { memo: String(v.memo) } : {}),
      createdAt: j.entry.created_at,
      pubkey: j.entry.pubkey,
      delegated: !!holonKey && j.entry.pubkey.toLowerCase() === holonKey && !!v.onBehalfOf,
      ...(origin ? { origin } : {}),
      status,
      ...(reason ? { reason } : {}),
      attests: j.attests,
      disputes: j.disputes,
    };
    votes.push(vote);
    if (status === 'counted') (ballots[vote.proposal] ??= {})[vote.party] = vote.choice;
  }
  votes.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  return {
    votes,
    ballots,
    accepted: result.accepted,
    source: result.source,
    policy: result.policy,
    imports: imports.map((p) => ({ holon: p.holon, source: p.source, accepted: p.accepted.length, pending: p.pending, rejected: p.rejected })),
  };
}

/** The counted choice per party on one proposal; empty when nobody voted. */
export function ballotsFor(folded: FoldedVotes | null | undefined, proposal: string): Record<string, VoteChoice> {
  return { ...(folded?.ballots[String(proposal)] ?? {}) };
}

/** A party's counted vote on a proposal, or null. */
export function voteOf(folded: FoldedVotes | null | undefined, proposal: string, party: string): VoteChoice | null {
  return folded?.ballots[String(proposal)]?.[String(party)] ?? null;
}

// ── From lens data to folded ballots ──────────────────────────────────────

export interface VotesFromLensesInput extends LensContextInput {
  /** The `governance_votes` log (`getLog`). */
  entries: Iterable<LogEvent<unknown>>;
  closesAt?: FoldVotesInput['closesAt'];
  /** Pinned partners' logs, judged by their own rules (`importPartnerLogs`). */
  imports?: Iterable<PartnerImport> | null;
}

export interface VotesContext {
  folded: FoldedVotes;
  actors: AcceptedActors;
  parties: PartyResolver;
  policy: Policy;
  holonPubkey: string | null;
}

/** Fold the votes log with the signer set and party map the lenses give. */
export function foldVotesFromLenses(input: VotesFromLensesInput): VotesContext {
  const ctx = lensContext(input);
  const policy = ctx.policyFor(GOVERNANCE_VOTES_LENS);
  const folded = foldVotes({
    entries: input.entries,
    actors: ctx.actors,
    policy,
    partyOf: ctx.parties.partyOf,
    holonPubkey: ctx.holonPubkey,
    closesAt: input.closesAt,
    imports: input.imports,
  });
  return { folded, actors: ctx.actors, parties: ctx.parties, policy, holonPubkey: ctx.holonPubkey };
}
