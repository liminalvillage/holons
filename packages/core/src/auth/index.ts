// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

/**
 * `@holons/core/auth` — provider-agnostic identity rules.
 *
 * Holons has one signing identity model (a Nostr keypair) and several ways to
 * obtain one: Telegram (server-derived), a passkey, the user's own Nostr key,
 * or an Ethereum wallet. This domain owns the parts that must agree across
 * every UI — how entropy becomes a key, and how a key proves itself to a
 * server. Browser/OS specifics (WebAuthn calls, `window.ethereum`) stay in
 * the UIs.
 *
 * Note: `@holons/core/identity` is *name* resolution and unrelated to auth.
 */

export type AuthProvider = 'telegram' | 'passkey' | 'nostr' | 'ethereum';

export interface AuthIdentity {
  provider: AuthProvider;
  /** 64-char hex Nostr pubkey — the signing identity. */
  pubkey: string;
  /** Provider-side subject: Telegram id, `0x…` address, passkey credential id. */
  subject?: string;
  /** Short human label for menus (e.g. `@handle`, `0x12…abcd`, `npub1…`). */
  label?: string;
}

/** Holon id for a key-based (non-Telegram) identity is its pubkey hex. */
export function holonIdForIdentity(identity: AuthIdentity): string {
  return identity.provider === 'telegram' && identity.subject ? identity.subject : identity.pubkey;
}

export {
  IDENTITY_DERIVATION_PREFIX,
  ETH_IDENTITY_MESSAGE,
  PASSKEY_PRF_SALT,
  deriveNostrKeyFromEntropy,
  deriveTelegramNostrKey,
  entropyFromBytes,
  type DerivedNostrKey,
} from './derive.js';

export {
  NIP98_KIND,
  NIP98_MAX_AGE_S,
  buildAuthEventTemplate,
  signAuthEvent,
  verifyAuthEvent,
  type AuthEventTarget,
  type AuthEventVerdict,
} from './nip98.js';
