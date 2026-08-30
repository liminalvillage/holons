// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Per-lens projection codecs: how a HoloSphere record is ALSO published as a
// standard Nostr kind (NIP-52 calendar, NIP-99 classified, kind-0 profile,
// NIP-51 set) next to the canonical kind-30078 event. Phase 1 is one-way —
// the 30078 event stays the source of truth; `parse`/`primary` are the seam
// for a later phase where a lens can make the standard kind primary.

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
}

export interface Companion {
  template: EventTemplate;
  /** Who should sign this. The host signs only if it has that user's key. */
  authorHint?: { userId: string | number };
}

export interface Projected {
  primary: EventTemplate;
  companions?: Companion[];
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
  /** Phase-2 seam: rebuild the record from its standard event. Not implemented. */
  parse?(event: NostrEventLike): T | null;
  /** Phase-2 seam: which encoding is authoritative. Always `'30078'` today. */
  primary?: '30078' | 'standard';
}

/** The generic, framework-free hook shape `holosphere/projections.js` consumes. */
export interface ProjectionHook {
  lens: string;
  kinds: number[];
  requiresAuthor?: 'user';
  project(holon: string, lens: string, item: unknown): Projected | null;
  retract(holon: string, lens: string, id: string): EventTemplate[];
}
