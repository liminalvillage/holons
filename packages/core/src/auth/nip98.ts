// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// NIP-98 HTTP auth events — how a key-based identity proves it holds a Nostr
// key to the web server, so it can be issued the same session cookie a
// Telegram login gets. Stateless by design: the proof is bound to the request
// URL + method and a short `created_at` window, so no server-side challenge
// store is needed.

import { finalizeEvent, verifyEvent, type Event, type EventTemplate } from 'nostr-tools/pure';
import { hexToBytes } from '@noble/hashes/utils';

/** NIP-98 event kind. */
export const NIP98_KIND = 27235;

/** Default acceptance window for `created_at`, in seconds (both directions). */
export const NIP98_MAX_AGE_S = 60;

export interface AuthEventTarget {
  /** Absolute URL the proof is bound to, e.g. `https://app/api/auth/key`. */
  url: string;
  /** HTTP method, case-insensitive. */
  method: string;
}

/** Build the unsigned template a client signs with its key (`finalizeEvent`). */
export function buildAuthEventTemplate(target: AuthEventTarget, now = Math.floor(Date.now() / 1000)): EventTemplate {
  return {
    kind: NIP98_KIND,
    created_at: now,
    tags: [
      ['u', target.url],
      ['method', target.method.toUpperCase()],
    ],
    content: '',
  };
}

/** Build and sign the proof for `target` with a hex private key. */
export function signAuthEvent(target: AuthEventTarget, privateKeyHex: string, now?: number): Event {
  if (!/^[0-9a-f]{64}$/.test(privateKeyHex)) throw new Error('signAuthEvent: privateKey must be 64-char hex');
  return finalizeEvent(buildAuthEventTemplate(target, now), hexToBytes(privateKeyHex));
}

export type AuthEventVerdict = { ok: true; pubkey: string } | { ok: false; reason: string };

function tag(event: Event, name: string): string | undefined {
  return event.tags.find((t) => t[0] === name)?.[1];
}

/**
 * Verify a NIP-98 proof against the request it was meant for. Returns the
 * signer's pubkey on success, or a short machine-readable reason.
 */
export function verifyAuthEvent(
  event: unknown,
  target: AuthEventTarget,
  opts: { maxAgeS?: number; now?: number } = {},
): AuthEventVerdict {
  const maxAge = opts.maxAgeS ?? NIP98_MAX_AGE_S;
  const now = opts.now ?? Math.floor(Date.now() / 1000);

  if (!event || typeof event !== 'object') return { ok: false, reason: 'malformed' };
  const ev = event as Event;
  if (ev.kind !== NIP98_KIND) return { ok: false, reason: 'wrong-kind' };
  if (typeof ev.pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(ev.pubkey)) {
    return { ok: false, reason: 'bad-pubkey' };
  }
  if (typeof ev.created_at !== 'number' || Math.abs(now - ev.created_at) > maxAge) {
    return { ok: false, reason: 'expired' };
  }
  if (tag(ev, 'u') !== target.url) return { ok: false, reason: 'wrong-url' };
  if ((tag(ev, 'method') ?? '').toUpperCase() !== target.method.toUpperCase()) {
    return { ok: false, reason: 'wrong-method' };
  }
  let valid = false;
  try {
    // Re-materialise a plain event: nostr-tools caches a "verified" mark on
    // the object it checked, so verifying the caller's object as-is could
    // trust a previously verified (then mutated) instance.
    const clean: Event = {
      kind: ev.kind,
      pubkey: ev.pubkey,
      created_at: ev.created_at,
      tags: Array.isArray(ev.tags) ? ev.tags.map((t) => [...t]) : [],
      content: String(ev.content ?? ''),
      id: String(ev.id ?? ''),
      sig: String(ev.sig ?? ''),
    };
    valid = verifyEvent(clean);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad-signature' };
  return { ok: true, pubkey: ev.pubkey };
}
