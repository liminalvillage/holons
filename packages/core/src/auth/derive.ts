// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Deterministic Nostr key derivation from provider-supplied entropy.
//
// Every login provider that is not Telegram (passkey PRF output, an Ethereum
// wallet signature, …) ends here: a fixed-length secret plus a provider
// context string → a stable secp256k1 keypair the HoloSphere signing layer
// can use. The same entropy + context always yields the same key, so a user
// lands on the same holon from any device.

import { schnorr } from '@noble/curves/secp256k1';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

const enc = new TextEncoder();

/**
 * Domain-separation prefix for all derived keys. Bumping this (or any of the
 * provider constants below) silently rotates EVERY user's identity — treat
 * them as frozen.
 */
export const IDENTITY_DERIVATION_PREFIX = 'holons-identity-v1';

/**
 * The message an Ethereum wallet signs to unlock its Holons identity. EOAs
 * sign deterministically (RFC 6979), so the signature — and the key derived
 * from it — is stable across sessions. Frozen: changing a single character
 * changes every wallet user's holon.
 */
export const ETH_IDENTITY_MESSAGE =
  'Sign in to Holons.\n\n' +
  'This signature unlocks your Holons identity key. ' +
  'It costs no gas and sends no transaction.\n\n' +
  'Version: 1';

/**
 * Salt handed to the WebAuthn PRF extension (`prf.eval.first`). The
 * authenticator returns HMAC(credential secret, salt) — 32 bytes that never
 * leave the device except as this derivation's input. Frozen for the same
 * reason as the message above.
 */
export const PASSKEY_PRF_SALT: Uint8Array = sha256(enc.encode('holons-passkey-prf-v1'));

export interface DerivedNostrKey {
  /** 64-char hex secp256k1 secret. */
  privateKey: string;
  /** 64-char hex x-only public key (NIP-01). */
  publicKey: string;
}

/**
 * Derive a Nostr keypair from `entropy` under a provider `context`
 * (e.g. `"passkey"`, `"eth:0xabc…"`).
 *
 * key = HMAC-SHA256(entropy, "<prefix>:<context>"), re-hashed with a counter
 * suffix on the astronomically unlikely out-of-range scalar — the same shape
 * the server-side Telegram derivation uses, so both paths share one
 * documented rule.
 */
export function deriveNostrKeyFromEntropy(entropy: Uint8Array, context: string): DerivedNostrKey {
  if (!(entropy instanceof Uint8Array) || entropy.length < 16) {
    throw new Error('deriveNostrKeyFromEntropy: entropy must be at least 16 bytes');
  }
  if (!context) throw new Error('deriveNostrKeyFromEntropy: a context is required');

  for (let i = 0; i < 1000; i++) {
    const msg = `${IDENTITY_DERIVATION_PREFIX}:${context}` + (i ? `:${i}` : '');
    const candidate = hmac(sha256, entropy, enc.encode(msg));
    try {
      const publicKey = bytesToHex(schnorr.getPublicKey(candidate));
      return { privateKey: bytesToHex(candidate), publicKey };
    } catch {
      // out-of-range scalar — try the next counter
    }
  }
  throw new Error('failed to derive a valid Nostr key');
}

/** Hash an arbitrary byte string (e.g. a 65-byte wallet signature) down to 32 bytes of entropy. */
export function entropyFromBytes(bytes: Uint8Array): Uint8Array {
  return sha256(bytes);
}

/**
 * Context for the service-level identity-provider key — the author of
 * kind-31926 identity attestations (Elinor's Telegram↔npub directory).
 * Frozen: changing it rotates the provider pubkey, which orphans every
 * attestation we ever published (a provider may only replace its own).
 */
export const IDENTITY_PROVIDER_CONTEXT = 'service:identity-provider';

/**
 * Derive the stable identity-provider keypair from the server-held
 * `NOSTR_DERIVATION_SECRET`. Every surface holding the secret (bot, kiosk
 * server, web server) derives the SAME provider key, so their kind-31926
 * republishes replace each other instead of duplicating.
 *
 * Domain-separated from all user keys: member keys are
 * HMAC(secret, "telegram:<id>") with no prefix, and passkey/eth keys are
 * derived from user-supplied entropy — never from this secret.
 */
export function deriveIdentityProviderKey(derivationSecret: string): DerivedNostrKey {
  if (!derivationSecret) throw new Error('NOSTR_DERIVATION_SECRET is not configured');
  return deriveNostrKeyFromEntropy(enc.encode(derivationSecret), IDENTITY_PROVIDER_CONTEXT);
}

/**
 * Derive the Nostr keypair for a Telegram user from the server-held
 * `NOSTR_DERIVATION_SECRET`. This is the SAME rule the web login uses, so the
 * bot can sign on a member's behalf under the pubkey they get when they log
 * into the dashboard.
 *
 * key = HMAC-SHA256(secret, "telegram:<id>"), re-hashed with a counter on the
 * (astronomically unlikely) out-of-range scalar. Frozen — see prefix note.
 */
export function deriveTelegramNostrKey(telegramId: string | number, derivationSecret: string): DerivedNostrKey {
  if (!derivationSecret) throw new Error('NOSTR_DERIVATION_SECRET is not configured');
  const secretBytes = enc.encode(derivationSecret);
  for (let i = 0; i < 1000; i++) {
    const msg = `telegram:${telegramId}` + (i ? `:${i}` : '');
    const candidate = hmac(sha256, secretBytes, enc.encode(msg));
    try {
      const publicKey = bytesToHex(schnorr.getPublicKey(candidate));
      return { privateKey: bytesToHex(candidate), publicKey };
    } catch {
      // out-of-range scalar — try the next counter
    }
  }
  throw new Error('failed to derive a valid Nostr key');
}
