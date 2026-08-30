// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Per-lens projection codecs: how a HoloSphere record is ALSO published as a
// standard Nostr kind (NIP-52 calendar, NIP-99 classified, kind-0 profile,
// NIP-51 set) next to the canonical kind-30078 event — and, since phase 2,
// how an external edit of that standard event is folded BACK into the record
// (`parse` + `merge`). The 30078 event stays the source of truth: a parsed
// standard event is an authorized *claim* the host merges and re-signs.

/** Unsigned NIP-01 event. */
export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

/** Minimal signed/unsigned event shape accepted by `parse`. */
export interface NostrEventLike {
  id?: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  sig?: string;
}

export interface ProjectionCtx {
  /** App namespace → `['n', appName]` (Holons vs HolonsDebug on a shared relay). */
  appName: string;
  /** Hex pubkey of the holon signer — used to build `a` addresses. */
  holonPubkey: string;
  /** Unix seconds; injectable for tests. */
  now?: () => number;
  /** IANA zone for a holon (from its settings lens) → `start_tzid`. */
  timezoneFor?: (holon: string) => string | undefined;
  /** h3-js `cellToLatLng`, injected so core stays dependency-free. */
  cellToLatLng?: (h3: string) => [number, number];
  /** Telegram/user id → hex pubkey, when the host can derive it. */
  pubkeyFor?: (userId: string | number) => string | undefined;
  /** Reverse lookup for ingest: hex pubkey → the member it belongs to. */
  userIdFor?: (pubkey: string) => string | number | undefined;
}

export interface Companion {
  template: EventTemplate;
  /** Who should sign this. The host signs only if it has that user's key. */
  authorHint?: { userId: string | number };
  /**
   * For non-replaceable kinds (reactions, badge awards): the host publishes
   * only when `state` differs from what it last published under `key`, so
   * re-puts of an unchanged record do not flood the relay.
   */
  dedupe?: { key: string; state: string };
}

export interface Projected {
  primary: EventTemplate;
  companions?: Companion[];
}

/**
 * What a standard event says about a Holons record, as understood by `parse`.
 * Authorization (is `pubkey` allowed to say this?) is the host's job; the
 * codec only maps fields.
 */
export interface Reversed<T = Record<string, unknown>> {
  /** Record address, from the `d` tag (or the `a` tag of an RSVP). */
  lens: string;
  holon: string;
  id: string;
  kind: number;
  pubkey: string;
  createdAt: number;
  eventId?: string;
  /** Field-level update; only fields the event actually carries. */
  patch?: Partial<T>;
  /** NIP-52 RSVP: the SIGNER's participation, never a self-reported id. */
  rsvp?: { pubkey: string; userId?: string | number; status: 'accepted' | 'declined' };
  /** NIP-25 reaction: the SIGNER's appreciation (`+`/emoji = give, `-` = withdraw). */
  reaction?: { pubkey: string; userId?: string | number; status: 'add' | 'remove' };
  /** kind 0: the record must belong to the signer (`userIdFor(pubkey) === id`). */
  ownerOnly?: boolean;
}

export interface LensCodec<T = Record<string, unknown>> {
  lens: string;
  /** Every kind this codec may emit (for filters and retractions). */
  kinds: number[];
  /**
   * `'user'` → the primary event must be signed by the record's own user key
   * (kind 0); the host drops it when it has no such key.
   */
  requiresAuthor?: 'user';
  /** `null` = nothing to publish for this record. */
  project(holon: string, item: T, ctx: ProjectionCtx): Projected | null;
  /** NIP-09 kind-5 templates retracting every projected event for `id`. */
  retract(holon: string, id: string, ctx: ProjectionCtx): EventTemplate[];
  /** Map an external standard event back to a record claim; `null` = not ours / unparsable. */
  parse?(event: NostrEventLike, ctx: ProjectionCtx): Reversed<T> | null;
  /** Fold a claim into the current record; `null` = no change. Pure. */
  merge?(current: T, reversed: Reversed<T>, ctx: ProjectionCtx): T | null;
  /** Which encoding is authoritative. Always `'30078'` today. */
  primary?: '30078' | 'standard';
}

/** The generic, framework-free hook shape `holosphere/projections.js` consumes. */
export interface ProjectionHook {
  lens: string;
  kinds: number[];
  requiresAuthor?: 'user';
  project(holon: string, lens: string, item: unknown): Projected | null;
  retract(holon: string, lens: string, id: string): EventTemplate[];
  parse?(event: NostrEventLike): Reversed | null;
  merge?(current: unknown, reversed: Reversed): unknown | null;
}
