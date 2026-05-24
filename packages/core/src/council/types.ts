// @holons/core/council — proposal + voting types.
// UI-agnostic. No LLM coupling. No Svelte stores. Both harvest-web and
// telegram-ui share these shapes via holosphere's `quests` lens.

/**
 * A user that has cast a vote on a proposal. The shape mirrors the loose
 * subset both UIs already persist:
 *  - harvest-web stores plain string IDs (e.g. "current-user")
 *  - telegram-ui stores Telegram user objects (`{ id, first_name, ... }`)
 *
 * Core treats voters as identifiable by `id`. Anything else is opaque
 * metadata the UI may use for display.
 */
export type VoterId = string | number;

export interface Voter {
  id: VoterId;
  // Optional display fields preserved for telegram-ui compatibility.
  first_name?: string;
  last_name?: string;
  username?: string;
  [extra: string]: unknown;
}

/** Anything a UI persists as a "who voted" entry. */
export type VoteEntry = Voter | string | number;

export type ProposalStatus = 'ongoing' | 'stopped' | 'completed';

/**
 * Canonical proposal record. Both UIs persist this shape under the
 * `quests` lens with `type === 'proposal'` (proposals share storage with
 * quests; status fields like `participants`/`stoppers` are reused).
 */
export interface Proposal {
  id: string;
  type: 'proposal';
  title: string;
  description?: string;
  /** Yea-votes / agreements. */
  participants: VoteEntry[];
  /** Veto / block votes. */
  stoppers: VoteEntry[];
  /** Canonical creation timestamp (ISO string). */
  created?: string;
  /** @deprecated Legacy `date` field — web used Unix **seconds**, bot used ms. Readers should prefer `created` and only fall back here for back-compat. */
  date?: number;
  /** Free-form creator label or user object. */
  creator?: VoteEntry;
  status?: ProposalStatus;

  // Federation/hologram bookkeeping kept opaque so federated views still
  // round-trip cleanly through core helpers.
  _hologram?: { isHologram?: boolean; sourceHolon?: string; soul?: string };
  _federation?: { origin?: string; sourceLens?: string };

  // Allow UIs to carry extra fields without losing them on round-trip.
  [extra: string]: unknown;
}

/** Result of `tallyVotes` — a UI-agnostic snapshot of a proposal's state. */
export interface VoteTally {
  agreements: number;
  blocks: number;
  status: ProposalStatus;
  /** True iff `agreements >= quorum` AND no active blockers. */
  hasReachedQuorum: boolean;
  /** Net support (agreements - blocks). Useful for sorting. */
  netSupport: number;
}

/** Direction of a single vote action. */
export type VoteDirection = 'agree' | 'block';

/**
 * Minimal persistence interface a UI provides so core can read/write
 * proposals without taking a hard dep on holosphere's full surface.
 *
 * Both harvest-web (`HoloSphere`) and telegram-ui (`HolonDB`) satisfy
 * this shape — see `proposals.ts` for adapter helpers.
 */
export interface ProposalStore {
  put(holonId: string, lens: string, data: Proposal): Promise<unknown> | unknown;
  get(holonId: string, lens: string, key: string): Promise<Proposal | null | undefined>;
  delete?(holonId: string, lens: string, key: string): Promise<unknown> | unknown;
  subscribe?(
    holonId: string,
    lens: string,
    cb: (data: Proposal | null, key?: string) => void
  ): Promise<{ unsubscribe: () => void }> | { unsubscribe: () => void };
}

/** Lens name proposals are stored under (shared with quests). */
export const PROPOSAL_LENS = 'quests';
