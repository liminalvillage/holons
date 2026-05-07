// @holons/core/council — proposal lifecycle + voting tally.
// UI-agnostic. LLM advisor prompts and Svelte stores stay in their UIs.

export type {
  Proposal,
  ProposalStatus,
  ProposalStore,
  VoteDirection,
  VoteEntry,
  VoteTally,
  Voter,
  VoterId,
} from './types.js';
export { PROPOSAL_LENS } from './types.js';

export {
  DEFAULT_QUORUM,
  applyVote,
  deriveStatus,
  hasAgreed,
  hasBlocked,
  tallyVotes,
} from './voting.js';

export {
  agree,
  block,
  castVote,
  createAndSaveProposal,
  createProposal,
  deleteProposal,
  saveProposal,
  subscribeToProposals,
} from './proposals.js';
export type { CreateProposalInput } from './proposals.js';
