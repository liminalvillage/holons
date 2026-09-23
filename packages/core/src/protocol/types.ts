// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The shapes the protocol reduces over.
 *
 * Nostr supplies immutable signed claims; a holon supplies validity, trust
 * and state. A `LogEvent` is one verified claim as holosphere hands it back
 * from an append-only lens (`getLog`); `AcceptedActors` is the holon's
 * answer to "did this key count, at that moment"; `Policy` is the holon's
 * rule for a lens. Everything here is structural — no holosphere import —
 * so a reduce runs anywhere, over entries from any source.
 */

/** The entries an entry points at, by `e`-tag marker. */
export interface LogRefs {
  /** The author's previous entry in this log (a chain that must not fork). */
  prev: string[];
  /** The entries this one consumes (spent twice = a conflict). */
  basis: string[];
  attests: string[];
  disputes: string[];
  other: string[];
}

/** One verified, signed entry of an append-only lens. */
export interface LogEvent<T = Record<string, unknown>> {
  /** The event id — content-addressed, and the entry's identity. */
  id: string;
  pubkey: string;
  /** Unix seconds, as the author stamped them. */
  created_at: number;
  refs: LogRefs;
  item: T;
}

/** What `append` takes: the body plus the refs that go on `e` tags. */
export type RefsInput = Partial<Record<'prev' | 'basis' | 'attests' | 'disputes', string | string[]>>;
export interface Appendable<T = Record<string, unknown>> {
  item: T;
  refs?: RefsInput;
}

/** The one deterministic order: by time, then by id. */
export function byLogOrder(a: { created_at: number; id: string }, b: { created_at: number; id: string }): number {
  return a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export type Role = 'admin' | 'member';

/**
 * Who counts, as of when. `source` says whether this came from the holon's
 * signed membership log (as-of-time, revocation keeps past writes) or from a
 * bootstrap list (time-blind: the current list, applied to every moment) —
 * a UI shows the latter as provisional.
 */
export interface AcceptedActors {
  source: 'log' | 'bootstrap';
  /** The trust anchor, when known. */
  genesis: string | null;
  isAcceptedAt(pubkey: string, at: number): boolean;
  roleAt(pubkey: string, at: number): Role | null;
}

/** A holon's rule for one log lens. */
export interface Policy {
  /** Roles whose actions count. */
  authors: Role[];
  /** Roles whose attestations and disputes count. */
  attesters: Role[];
  /** Attestations an action needs before it is accepted. 0 = none. */
  quorum: number;
  /**
   * Two actions consuming the same basis: `earliest` keeps the first in log
   * order and rejects the other; `quorum` leaves the later one pending, so a
   * human decides with an attestation.
   */
  conflict: 'earliest' | 'quorum';
}
