// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** A private scope: a lens of a holon, or one item of it. */
export interface Scope {
  holon: string;
  lens: string;
  item?: string;
}

/**
 * One entry of a scope's audience, in NIP-51 vocabulary: a group holon
 * (`group` tag, as in kind-10009 group lists) or a personal holon (`p`).
 */
export type AudienceTag = ['group', string] | ['p', string];

/** How a holon resolves to the keys that read on its behalf. */
export type ReaderKind = 'group' | 'personal' | 'none';

export interface HolonReaders {
  /** 64-hex pubkeys, lowercase, deduplicated. Empty when nothing signed says who reads. */
  keys: string[];
  kind: ReaderKind;
}

export type AudienceStatus = 'synced' | 'pending' | 'no-readers';

/** A holon in a scope's audience, as a surface shows it — never a key. */
export interface AudienceEntry {
  holon: string;
  kind: 'group' | 'personal';
  /** The owner holon itself: always present, never removable. */
  self: boolean;
  /** How many keys read on its behalf. */
  readers: number;
  status: AudienceStatus;
}

export interface Audience {
  scope: Scope;
  /** Is the scope private right now (its vault record exists)? */
  locked: boolean;
  /** Does this identity own the vault (it can lock/unlock, share, unshare)? */
  owned: boolean;
  /** Empty unless owned: only the owner can read the audience. */
  holons: AudienceEntry[];
}

/** What a sync did for one scope. */
export interface SyncReport {
  granted: string[];
  revoked: string[];
  /** Readers whose grant did not reach the relay this time (retried next sync). */
  pending: string[];
}

/** The private scopes of a holon, by lens — visible to anyone, keys or not. */
export interface LockedScopes {
  [lens: string]: { locked: boolean; items: string[] };
}

/** A grant as it travels (NIP-17 DM, subject `holons/grant`). */
export interface GrantPayload {
  t: 'holons/grant';
  v: 2;
  holon: string;
  lens: string;
  item?: string;
  /** Key id: 16 hex chars of sha256(key). */
  kid: string;
  /** The scope key (hex). */
  key: string;
  at: string;
}

export const GRANT_SUBJECT = 'holons/grant';
export const GRANT_TYPE = 'holons/grant';
export const GRANT_VERSION = 2;

/** Lenses that can never be private (the machinery itself, or public by design). */
export const NEVER_PRIVATE_LENSES: readonly string[] = Object.freeze([
  'settings', '_vault', '_members', '_check', 'users', 'federation', 'holons_registry', 'schemas', 'hubclaims',
]);
