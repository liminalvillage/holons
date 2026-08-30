// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// NIP-17 private direct messages (NIP-59 gift wrap, NIP-44 encryption) over
// the active relay set. The relay sees only a kind-1059 wrap addressed to the
// recipient, signed by a throwaway key; sender, content and timing are
// hidden inside. Used by the federation handshake (handshake-shim.js) and by
// hosts for notifications. nostr-tools is loaded lazily (optional dep).

import { getPublicKey } from './nostr-events.js';

export const GIFT_WRAP_KIND = 1059;
export const DM_KIND = 14;

let nip17Ready = null;
function nip17() {
  if (!nip17Ready) nip17Ready = import('nostr-tools/nip17');
  return nip17Ready;
}

const toBytes = (k) => (typeof k === 'string' ? Uint8Array.from(Buffer.from(k, 'hex')) : k);

/** Wrap `content` for `recipientPubkey`. Returns the signed kind-1059 event. */
export async function wrapDirectMessage({ senderPrivateKey, recipientPubkey, content, subject }) {
  const { wrapEvent } = await nip17();
  return wrapEvent(toBytes(senderPrivateKey), { publicKey: recipientPubkey }, content, subject);
}

/** Unwrap a kind-1059 addressed to us → { content, sender, createdAt, subject, rumor } or null. */
export async function unwrapDirectMessage(wrap, recipientPrivateKey) {
  try {
    const { unwrapEvent } = await nip17();
    const rumor = unwrapEvent(wrap, toBytes(recipientPrivateKey));
    if (!rumor || rumor.kind !== DM_KIND) return null;
    const subject = (rumor.tags || []).find((t) => t[0] === 'subject')?.[1];
    return { content: rumor.content, sender: rumor.pubkey, createdAt: rumor.created_at, subject, rumor };
  } catch {
    return null;
  }
}

/** Send a DM through the sphere's active relay set. Resolves false without relays. */
export async function sendDirectMessage(holo, { privateKey, recipientPubkey, content, subject }) {
  if (!holo?.nostrRelays?.().length) return false;
  const wrap = await wrapDirectMessage({ senderPrivateKey: privateKey, recipientPubkey, content, subject });
  holo.publishNostrEvents(wrap);
  return true;
}

/**
 * Live-subscribe to DMs addressed to `privateKey`'s pubkey. `onMessage`
 * receives { content, sender, createdAt, subject, wrapId }. Returns close().
 */
export function subscribeDirectMessages(holo, privateKey, onMessage, { sinceSec = 7 * 24 * 3600 } = {}) {
  if (!holo?.nostrRelays?.().length) return () => {};
  const pubkey = getPublicKey(toBytes(privateKey));
  const seen = new Set();
  const since = Math.max(0, Math.floor(Date.now() / 1000) - sinceSec);
  return holo.subscribeNostr({ kinds: [GIFT_WRAP_KIND], '#p': [pubkey], since }, (wrap) => {
    if (!wrap?.id || seen.has(wrap.id)) return;
    seen.add(wrap.id);
    if (seen.size > 5000) seen.delete(seen.values().next().value);
    unwrapDirectMessage(wrap, privateKey).then((m) => { if (m) onMessage({ ...m, wrapId: wrap.id }); }).catch(() => {});
  });
}

export default { wrapDirectMessage, unwrapDirectMessage, sendDirectMessage, subscribeDirectMessages, GIFT_WRAP_KIND, DM_KIND };
