// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Bring-your-own Nostr key: import an nsec/hex, or create a new one.

import { nostrUtils } from "holosphere";
import { AuthUiError, type ProviderLogin } from "./types";

const {
  parseNsecOrHex,
  getPublicKey,
  generatePrivateKey,
  hexToNpub,
  hexToNsec,
  shortenNpub,
} = nostrUtils;

export function npubLabel(pubkeyHex: string): string {
  try {
    return shortenNpub(hexToNpub(pubkeyHex));
  } catch {
    return pubkeyHex.slice(0, 8);
  }
}

/** Validate an nsec/hex without committing to it — for live preview. */
export function previewNostrKey(
  input: string,
): { publicKey: string; npub: string } | null {
  const sk = parseNsecOrHex(input.trim());
  if (!sk) return null;
  try {
    const publicKey = getPublicKey(sk);
    return { publicKey, npub: hexToNpub(publicKey) };
  } catch {
    return null;
  }
}

export function importNostrKey(input: string): ProviderLogin {
  const privateKey = parseNsecOrHex(input.trim());
  if (!privateKey)
    throw new AuthUiError(
      "That doesn't look like an nsec or a 64-character hex key.",
      "failed",
    );
  const publicKey = getPublicKey(privateKey);
  return {
    privateKey,
    publicKey,
    identity: {
      provider: "nostr",
      pubkey: publicKey,
      label: npubLabel(publicKey),
    },
  };
}

export function generateNostrKey(): ProviderLogin & { nsec: string } {
  const privateKey = generatePrivateKey();
  const publicKey = getPublicKey(privateKey);
  return {
    privateKey,
    publicKey,
    nsec: hexToNsec(privateKey),
    identity: {
      provider: "nostr",
      pubkey: publicKey,
      label: npubLabel(publicKey),
    },
  };
}
