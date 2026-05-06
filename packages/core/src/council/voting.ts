// Pure voting tally + vote-mutation helpers. No I/O, no LLM, no UI.

import type {
  Proposal,
  ProposalStatus,
  Voter,
  VoteEntry,
  VoteDirection,
  VoteTally,
  VoterId,
} from './types.js';

/** Default quorum used by the web proposals view. */
export const DEFAULT_QUORUM = 5;

function entryId(entry: VoteEntry): VoterId | undefined {
  if (entry == null) return undefined;
  if (typeof entry === 'string' || typeof entry === 'number') return entry;
  if (typeof entry === 'object' && 'id' in entry) return (entry as Voter).id;
  return undefined;
}

function sameVoter(entry: VoteEntry, voter: VoteEntry): boolean {
  const a = entryId(entry);
  const b = entryId(voter);
  if (a === undefined || b === undefined) return false;
  // Loose equality so "42" (string) matches 42 (number) — telegram-ui mixes
  // both depending on how the user record was loaded.
  // eslint-disable-next-line eqeqeq
  return a == b;
}

function withoutVoter(list: VoteEntry[] | undefined, voter: VoteEntry): VoteEntry[] {
  if (!list?.length) return [];
  return list.filter((e) => !sameVoter(e, voter));
}

function toggleVoter(list: VoteEntry[] | undefined, voter: VoteEntry): VoteEntry[] {
  const without = withoutVoter(list, voter);
  // If the voter was present, length shrinks → return the filtered list.
  // Otherwise, append.
  if (without.length !== (list?.length ?? 0)) return without;
  return [...without, voter];
}

/**
 * Compute the derived status for a proposal given its current vote arrays.
 * Mirrors the rule used by both UIs:
 *   any block      → 'stopped'
 *   already done   → 'completed'   (preserved from input)
 *   otherwise      → 'ongoing'
 */
export function deriveStatus(proposal: Pick<Proposal, 'participants' | 'stoppers' | 'status'>): ProposalStatus {
  if (proposal.status === 'completed') return 'completed';
  if ((proposal.stoppers?.length ?? 0) > 0) return 'stopped';
  return 'ongoing';
}

/**
 * Snapshot the tally for a proposal. Pure — does not mutate.
 *
 * @param proposal The proposal to inspect.
 * @param quorum   Threshold for `hasReachedQuorum`. Defaults to `DEFAULT_QUORUM`.
 */
export function tallyVotes(proposal: Proposal, quorum: number = DEFAULT_QUORUM): VoteTally {
  const agreements = proposal.participants?.length ?? 0;
  const blocks = proposal.stoppers?.length ?? 0;
  const status = deriveStatus(proposal);
  return {
    agreements,
    blocks,
    status,
    hasReachedQuorum: blocks === 0 && agreements >= quorum,
    netSupport: agreements - blocks,
  };
}

/**
 * Apply a vote. Returns a NEW proposal object — never mutates input.
 *
 * Rules (matching the existing UIs):
 *  - 'agree' toggles membership in `participants`. Casting an agree-vote
 *    also clears any prior block from the same voter.
 *  - 'block' toggles membership in `stoppers`. Casting a block-vote also
 *    clears any prior agree from the same voter.
 *  - `status` is recomputed via {@link deriveStatus}.
 */
export function applyVote(
  proposal: Proposal,
  voter: VoteEntry,
  direction: VoteDirection
): Proposal {
  if (entryId(voter) === undefined) {
    throw new Error('applyVote: voter must have an id');
  }

  const participants = proposal.participants ?? [];
  const stoppers = proposal.stoppers ?? [];

  // Casting a vote toggles membership on its side and clears any vote on the
  // opposing side from the same voter.
  const next: Proposal =
    direction === 'agree'
      ? {
          ...proposal,
          participants: toggleVoter(participants, voter),
          stoppers: withoutVoter(stoppers, voter),
        }
      : {
          ...proposal,
          participants: withoutVoter(participants, voter),
          stoppers: toggleVoter(stoppers, voter),
        };
  next.status = deriveStatus(next);
  return next;
}

/** Has this voter agreed to the proposal? */
export function hasAgreed(proposal: Proposal, voter: VoteEntry): boolean {
  return (proposal.participants ?? []).some((e) => sameVoter(e, voter));
}

/** Has this voter blocked the proposal? */
export function hasBlocked(proposal: Proposal, voter: VoteEntry): boolean {
  return (proposal.stoppers ?? []).some((e) => sameVoter(e, voter));
}
