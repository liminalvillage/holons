// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// NIP-17 private direct messages (NIP-59 gift wrap + NIP-44). Pure helpers
// around nostr-tools: hosts publish the returned kind-1059 wrap on whatever
// relay set they have (holosphere.publishNostrEvents) and unwrap incoming
// wraps addressed to their key. Notification payloads are plain text with an
// optional `subject`; federation handshake payloads are JSON (see
// packages/holosphere/handshake-shim.js).

import { wrapEvent, unwrapEvent } from 'nostr-tools/nip17';
import type { NostrEventLike } from './types.js';

export const GIFT_WRAP_KIND = 1059;
export const DM_KIND = 14;

export interface DirectMessage {
  content: string;
  /** Sealed sender — authenticated by the seal, not by the payload. */
  sender: string;
  createdAt: number;
  subject?: string;
}

const toBytes = (k: string | Uint8Array): Uint8Array => (typeof k === 'string' ? hexToBytes(k) : k);

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Wrap `content` for `recipientPubkey`; returns the signed kind-1059 event to publish. */
export function wrapDirectMessage(senderPrivateKey: string | Uint8Array, recipientPubkey: string, content: string, subject?: string): NostrEventLike {
  return wrapEvent(toBytes(senderPrivateKey), { publicKey: recipientPubkey }, content, subject) as NostrEventLike;
}

/** Unwrap a kind-1059 addressed to `recipientPrivateKey`; `null` when not for us / not a DM. */
export function unwrapDirectMessage(wrap: NostrEventLike, recipientPrivateKey: string | Uint8Array): DirectMessage | null {
  try {
    const rumor = unwrapEvent(wrap as never, toBytes(recipientPrivateKey));
    if (!rumor || rumor.kind !== DM_KIND) return null;
    const subject = (rumor.tags || []).find((t: string[]) => t[0] === 'subject')?.[1];
    return { content: rumor.content, sender: rumor.pubkey, createdAt: rumor.created_at, subject };
  } catch {
    return null;
  }
}

/** Filter for wraps addressed to `pubkey`. */
export function directMessageFilter(pubkey: string, sinceSec?: number): Record<string, unknown> {
  return { kinds: [GIFT_WRAP_KIND], '#p': [pubkey], ...(sinceSec ? { since: sinceSec } : {}) };
}
