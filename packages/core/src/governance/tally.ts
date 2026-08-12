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
 * Voting itself stays what it already was everywhere (a participant toggle
 * on a `type:'proposal'` quest); the weighting and the delegation routing
 * happen at count time, over the same records every UI already writes.
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
  const votes = new Set(
    (proposal?.participants ?? [])
      .map((p) => (p?.id != null ? String(p.id) : ''))
      .filter(Boolean)
  );
  const counted = [...new Set([...(memberIds ?? []).map(String), ...votes])];
  const weights = computeVoteWeights(counted, opts.reputation ?? {});

  let direct = 0;
  let delegated = 0;
  let total = 0;
  for (const id of counted) {
    const w = weights[id];
    total += w;
    if (votes.has(id)) direct += w;
    else if (resolveDelegate(id, opts.delegations ?? {}, votes)) delegated += w;
  }
  const yes = direct + delegated;
  const ratio = total > 0 ? yes / total : 0;
  const threshold = opts.threshold ?? 0.5;
  return { yes, total, ratio, passed: total > 0 && ratio > threshold, direct, delegated };
}
