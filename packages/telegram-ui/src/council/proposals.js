/**
 * @fileoverview Bot-side facade over @holons/core/council.
 *
 * Quests.js stores proposals under the `quests` lens (`type === 'proposal'`)
 * using its own holonDB instance. This facade re-exports the shared core
 * helpers so all proposal lifecycle + voting tally logic lives in
 * @holons/core. New bot code (and gradual refactors of Quests.js) should
 * route writes through here instead of hand-rolling vote toggles.
 *
 * The HolonDB shape (`put` / `get` / `delete` / `subscribe`) satisfies the
 * core `ProposalStore` interface as-is — no adapter required.
 *
 * @module src/council/proposals
 */

export {
  PROPOSAL_LENS,
  agree,
  applyVote,
  block,
  castVote,
  createAndSaveProposal,
  createProposal,
  deleteProposal,
  saveProposal,
  subscribeToProposals,
  tallyVotes,
  hasAgreed,
  hasBlocked,
  deriveStatus,
  DEFAULT_QUORUM,
} from '@holons/core/council';
