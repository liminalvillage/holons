// Proposal lifecycle + persistence helpers.
// Wraps a {@link ProposalStore} (holosphere or HolonDB-shaped adapter) so
// both UIs can route reads and writes through the same code path.

import type {
  Proposal,
  ProposalStore,
  VoteEntry,
  VoteDirection,
} from './types.js';
import { PROPOSAL_LENS } from './types.js';
import { applyVote } from './voting.js';

/** Options for {@link createProposal}. */
export interface CreateProposalInput {
  title: string;
  description?: string;
  creator?: VoteEntry;
  /** Override the timestamp (unix seconds). Defaults to now. */
  date?: number;
  /** Override the id. Defaults to `crypto.randomUUID()` (or a fallback). */
  id?: string;
}

function makeId(): string {
  // Prefer crypto.randomUUID where available (browsers, Node ≥ 19).
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback — good enough for local proposal ids.
  return `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Build a fresh, well-formed proposal record. Does NOT persist — see
 * {@link saveProposal} or {@link createAndSaveProposal}.
 */
export function createProposal(input: CreateProposalInput): Proposal {
  const title = input.title?.trim();
  if (!title) throw new Error('createProposal: title is required');

  return {
    id: input.id ?? makeId(),
    type: 'proposal',
    title,
    description: input.description?.trim() ?? '',
    participants: [],
    stoppers: [],
    date: input.date ?? Math.floor(Date.now() / 1000),
    creator: input.creator,
    status: 'ongoing',
  };
}

/** Persist a proposal under the shared `quests` lens. */
export function saveProposal(
  store: ProposalStore,
  holonId: string,
  proposal: Proposal
): Promise<unknown> | unknown {
  return store.put(holonId, PROPOSAL_LENS, proposal);
}

/** Create and persist in one call. Returns the new proposal. */
export async function createAndSaveProposal(
  store: ProposalStore,
  holonId: string,
  input: CreateProposalInput
): Promise<Proposal> {
  const proposal = createProposal(input);
  await saveProposal(store, holonId, proposal);
  return proposal;
}

/**
 * Apply a vote and persist. Reads the latest record from the store first
 * to avoid clobbering concurrent updates.
 *
 * @returns The updated proposal, or `null` if it no longer exists.
 */
export async function castVote(
  store: ProposalStore,
  holonId: string,
  proposalId: string,
  voter: VoteEntry,
  direction: VoteDirection
): Promise<Proposal | null> {
  const current = await store.get(holonId, PROPOSAL_LENS, proposalId);
  if (!current) return null;
  const next = applyVote(current as Proposal, voter, direction);
  await saveProposal(store, holonId, next);
  return next;
}

/** Convenience: cast an agree vote. */
export function agree(
  store: ProposalStore,
  holonId: string,
  proposalId: string,
  voter: VoteEntry
): Promise<Proposal | null> {
  return castVote(store, holonId, proposalId, voter, 'agree');
}

/** Convenience: cast a block vote. */
export function block(
  store: ProposalStore,
  holonId: string,
  proposalId: string,
  voter: VoteEntry
): Promise<Proposal | null> {
  return castVote(store, holonId, proposalId, voter, 'block');
}

/** Delete a proposal. No-op if the store does not implement `delete`. */
export function deleteProposal(
  store: ProposalStore,
  holonId: string,
  proposalId: string
): Promise<unknown> | unknown {
  if (!store.delete) return undefined;
  return store.delete(holonId, PROPOSAL_LENS, proposalId);
}

/**
 * Subscribe to proposal updates under a holon. The callback only fires for
 * records with `type === 'proposal'` — quests stored under the same lens
 * are filtered out.
 *
 * Returns a teardown function. If the store does not support subscriptions,
 * returns a no-op teardown.
 */
export async function subscribeToProposals(
  store: ProposalStore,
  holonId: string,
  cb: (proposal: Proposal | null, key?: string) => void
): Promise<() => void> {
  if (!store.subscribe) return () => {};
  const sub = await store.subscribe(holonId, PROPOSAL_LENS, (data, key) => {
    if (data == null) {
      cb(null, key);
      return;
    }
    if ((data as Proposal).type === 'proposal') {
      cb(data as Proposal, key);
    }
  });
  return sub.unsubscribe;
}
