// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Liquid democracy, half two: the reputation-weighted tally.
 *
 * The whitepaper weights votes "by the amount of reputation the participant
 * has collected". Here that is the stars a member has earned on settled
 * exchanges (see needs/reputation), plus a floor of one so a fresh holon —
 * where nobody has been rated yet — still gets one-member-one-vote.
 *
 * Voting is either what it always was (a participant toggle on a
 * `type:'proposal'` quest — `tallyProposal`) or the signed ballots the
 * `governance_votes` log folds to (`votes.ts` — `tallyBallots`); the
 * weighting and the delegation routing happen at count time either way,
 * and the two counts agree on a proposal whose only votes are yes.
 */

import type { ReputationSummary } from '../needs/index.js';
import { resolveDelegate, type Delegations } from './delegation.js';

export type VoteWeights = Record<string, number>;

/** One vote for existing, plus every star ever earned as ratee. */
export function voteWeightOf(rep: ReputationSummary | undefined): number {
  if (!rep || !(rep.count > 0)) return 1;
  return 1 + Math.round(rep.average * rep.count);
}

export function computeVoteWeights(
  memberIds: Array<string | number>,
  reputation: Record<string, ReputationSummary>
): VoteWeights {
  const weights: VoteWeights = {};
  for (const id of memberIds ?? []) {
    const key = String(id);
    weights[key] = voteWeightOf(reputation?.[key]);
  }
  return weights;
}

export interface ProposalTally {
  /** Weight voting yes — direct plus delegated. */
  yes: number;
  /** Weight of everyone counted (members ∪ voters). */
  total: number;
  /** yes / total, 0 when nobody is counted. */
  ratio: number;
  /** Strict majority of the total eligible weight (quorum built in). */
  passed: boolean;
  direct: number;
  delegated: number;
}

/** Party → choice, as `foldVotes` yields per proposal. */
export type Ballot = Record<string, 'yes' | 'no' | 'abstain'>;

export interface BallotTally extends ProposalTally {
  /** Weight voting no — direct plus delegated. */
  no: number;
  /** Weight abstaining on the record — direct plus delegated. */
  abstain: number;
}

export interface TallyOptions {
  /** Per-user reputation, e.g. `reputationByUser(quests)`. Default none. */
  reputation?: Record<string, ReputationSummary>;
  /** Live delegation map, e.g. `foldDelegations(records)`. Default none. */
  delegations?: Delegations;
  /** Pass when `yes / total > threshold`. Default 0.5. */
  threshold?: number;
}

/**
 * Count a proposal. Direct voters carry their own weight; a non-voter's
 * weight follows their delegation chain to whoever voted (if anyone). The
 * denominator is every known member plus any voter from outside the list,
 * so passing requires convincing the holon, not just the room.
 */
export function tallyProposal(
  proposal: { participants?: Array<{ id?: string | number } | null> },
  memberIds: Array<string | number>,
  opts: TallyOptions = {}
): ProposalTally {
  const ballot: Ballot = {};
  for (const p of proposal?.participants ?? []) if (p?.id != null && String(p.id)) ballot[String(p.id)] = 'yes';
  const { no: _no, abstain: _abstain, ...tally } = tallyBallots(ballot, memberIds, opts);
  return tally;
}

/**
 * Count a ballot of choices. A voter carries their own weight to their
 * choice; a non-voter's weight follows their delegation chain to whoever
 * voted and lands on THAT voter's choice. The denominator is every known
 * member plus any voter from outside the list; an abstention is on the
 * record but, like silence, does not help the proposal pass.
 */
export function tallyBallots(ballot: Ballot, memberIds: Array<string | number>, opts: TallyOptions = {}): BallotTally {
  const votes = new Set(Object.keys(ballot ?? {}));
  const counted = [...new Set([...(memberIds ?? []).map(String), ...votes])];
  const weights = computeVoteWeights(counted, opts.reputation ?? {});

  const sums = { yes: 0, no: 0, abstain: 0 };
  let direct = 0;
  let delegated = 0;
  let total = 0;
  for (const id of counted) {
    const w = weights[id];
    total += w;
    if (votes.has(id)) {
      sums[ballot[id]] += w;
      direct += w;
      continue;
    }
    const via = resolveDelegate(id, opts.delegations ?? {}, votes);
    if (via) {
      sums[ballot[via]] += w;
      delegated += w;
    }
  }
  const ratio = total > 0 ? sums.yes / total : 0;
  const threshold = opts.threshold ?? 0.5;
  return { yes: sums.yes, no: sums.no, abstain: sums.abstain, total, ratio, passed: total > 0 && ratio > threshold, direct, delegated };
}
