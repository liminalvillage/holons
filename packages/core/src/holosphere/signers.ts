// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Nostr signing behind holosphere: UIs receive sign functions, never keys.
//
// Rule 4 (one Holosphere factory / identity-aware I/O through
// `@holons/core/holosphere`) extends to Nostr signing. A `NostrSigner` wraps a
// derived or user-held key so relay clients and codecs can sign as a member,
// as the identity provider, or as a browser-held identity without the private
// key ever crossing a module boundary.

import { finalizeEvent, getPublicKey, type Event } from 'nostr-tools/pure';
import { hexToBytes } from '@noble/hashes/utils';
import { deriveIdentityProviderKey, deriveTelegramNostrKey } from '../auth/derive.js';

/** The unsigned shape every builder in core produces. */
export interface SignableTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

/** An identity that can sign events. The key stays inside the closure. */
export interface NostrSigner {
  /** 64-char hex x-only pubkey the signatures verify against. */
  readonly pubkey: string;
  sign(template: SignableTemplate): Event;
}

/** Wrap a caller-held 64-hex secret key (kiosk nsec/wallet login, tests). */
export function signerFromSecretKey(hex: string): NostrSigner {
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('signerFromSecretKey: expected a 64-char hex secret key');
  }
  const sk = hexToBytes(hex.toLowerCase());
  return {
    pubkey: getPublicKey(sk),
    sign: (template) => finalizeEvent(template, sk),
  };
}

/**
 * Signers for every identity a server-side surface can act as: each member's
 * derived key and the service-level identity provider (kind-31926 author).
 * All methods return null when `derivationSecret` is absent — callers treat
 * that as "signing unavailable", the same degradation the projection layer
 * uses when the secret is unset.
 */
export interface IdentityContext {
  memberSigner(telegramId: string | number): NostrSigner | null;
  memberPubkey(telegramId: string | number): string | null;
  providerSigner(): NostrSigner | null;
  providerPubkey(): string | null;
}

export function createIdentityContext(
  opts: { derivationSecret?: string | null } = {},
): IdentityContext {
  const secret = (opts.derivationSecret ?? '').trim();
  const members = new Map<string, NostrSigner | null>();
  let provider: NostrSigner | null | undefined;

  function memberSigner(telegramId: string | number): NostrSigner | null {
    if (!secret) return null;
    const id = String(telegramId);
    let signer = members.get(id);
    if (signer === undefined) {
      try {
        signer = signerFromSecretKey(deriveTelegramNostrKey(id, secret).privateKey);
      } catch {
        signer = null;
      }
      members.set(id, signer);
    }
    return signer;
  }

  function providerSigner(): NostrSigner | null {
    if (!secret) return null;
    if (provider === undefined) {
      try {
        provider = signerFromSecretKey(deriveIdentityProviderKey(secret).privateKey);
      } catch {
        provider = null;
      }
    }
    return provider;
  }

  return {
    memberSigner,
    memberPubkey: (telegramId) => memberSigner(telegramId)?.pubkey ?? null,
    providerSigner,
    providerPubkey: () => providerSigner()?.pubkey ?? null,
  };
}
