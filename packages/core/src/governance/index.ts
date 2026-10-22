// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @holons/core/governance
 *
 * The coop's self-rule, per the WeQuest whitepaper: liquid democracy
 * (revocable, transitive vote delegation + reputation-weighted tallies over
 * the `type:'proposal'` quests every UI already writes), signed votes on
 * the append-only `governance_votes` log (folded by the protocol's reduce —
 * one counted vote per party per proposal, the newest) and the treasury
 * (a per-settlement fee into a virtual account on the expenses lens, spent
 * by executing passed funding proposals).
 */

export {
  DELEGATIONS_LENS,
  DELEGATION_TYPE,
  buildDelegation,
  clearDelegate,
  foldDelegations,
  isDelegation,
  resolveDelegate,
  setDelegate,
  type BuildDelegationResult,
  type DelegationRecord,
  type DelegationStoreLike,
  type Delegations,
} from './delegation.js';

export {
  computeVoteWeights,
  tallyBallots,
  tallyProposal,
  voteWeightOf,
  type Ballot,
  type BallotTally,
  type ProposalTally,
  type TallyOptions,
  type VoteWeights,
} from './tally.js';

export {
  GOVERNANCE_VOTES_LENS,
  VOTE_CHOICES,
  ballotsFor,
  buildVote,
  buildVoteVerdict,
  foldVotes,
  foldVotesFromLenses,
  isVote,
  voteOf,
  type Ballots,
  type BuildVoteInput,
  type FoldVotesInput,
  type FoldedVotes,
  type Vote,
  type VoteBody,
  type VoteChoice,
  type VoteStatus,
  type VotesContext,
  type VotesFromLensesInput,
} from './votes.js';

export {
  TREASURY_ID,
  TREASURY_RATE_KEY,
  clampTreasuryRate,
  executeProposal,
  fundingExpenseId,
  readTreasuryRate,
  splitHours,
  treasuryBalance,
  type ExecuteProposalOptions,
  type ExecuteProposalResult,
  type ExecuteStoreLike,
  type FundableProposal,
} from './treasury.js';
