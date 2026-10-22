// SPDX-License-Identifier: AGPL-3.0-or-later

/** The as-of-time authorization oracle folded from a holon's `_members` log. */
export interface MembershipTimeline {
  /** The trust anchor, or null when no genesis was found. */
  genesisPub: string | null;
  isAuthorizedAt(pubkey: string, at: number): boolean;
  roleAt(pubkey: string, at: number): 'admin' | 'member' | null;
  currentMembers(): Map<string, 'admin' | 'member'>;
}

/** A signed `_members` envelope (kind 30078; `content` is the JSON op). */
export interface MembershipEnvelope {
  id: string;
  pubkey: string;
  created_at: number;
  content: string;
  kind?: number;
  tags?: string[][];
  sig?: string;
}

/**
 * Fold `_members` envelopes into an as-of-time oracle. Genesis is pinned or
 * TOFU (earliest self-signed genesis); only admins mutate membership; a key
 * removed later keeps the writes it signed before.
 */
export function buildTimeline(events: MembershipEnvelope[], pinnedGenesis?: string | null): MembershipTimeline;

export const MEMBERSHIP_LENS: '_members';
export function createSigner(opts: Record<string, unknown>): any;
