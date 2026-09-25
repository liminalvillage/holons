// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** A lens is either sealed on the wire or in the clear. */
export type PrivacyLensMode = 'private' | 'public';

/** The public hint kept on the holon's settings record (`settings.privacy`). */
export interface PrivacySettings {
  lenses: Record<string, PrivacyLensMode>;
}

/** What one pubkey has been granted in a holon. */
export interface GranteeView {
  /** Whole lenses this pubkey can read. */
  lenses: string[];
  /** Single items, per lens. */
  items: Record<string, string[]>;
}

/** The privacy state of a holon as this identity sees it. */
export interface PrivacySnapshot {
  /** Lens → mode. Owned vaults win over the public hint. */
  lenses: Record<string, PrivacyLensMode>;
  /** Lenses whose vault this identity owns (it can grant and revoke them). */
  owned: string[];
  /** The grant ledger of the owned lenses, by grantee pubkey. */
  grants: Record<string, GranteeView>;
}

/** A grant as it travels (NIP-17 DM, subject `holons/grant`). */
export interface GrantPayload {
  t: 'holons/grant';
  v: 1;
  id: string;
  holon: string;
  lens: string;
  /** Key id: 16 hex chars of sha256(lens key). */
  kid: string;
  /** Lens key (hex) — a lens grant. */
  key?: string;
  /** Item id + its content key (hex) — an item grant. */
  item?: string;
  cek?: string;
  at: string;
}

export const GRANT_SUBJECT = 'holons/grant';
export const GRANT_TYPE = 'holons/grant';
export const GRANT_VERSION = 1;

/** Lenses that can never be private (the machinery itself, or public by design). */
export const NEVER_PRIVATE_LENSES: readonly string[] = Object.freeze([
  'settings', '_vault', '_members', '_check', 'users', 'federation', 'holons_registry', 'schemas', 'hubclaims',
]);
