/**
 * NIP-01 signed events for HoloSphere — backed by nostr-tools.
 *
 * Turns a HoloSphere (holon, lens, item) write into a signed, self-verifying
 * Nostr event so it can be (a) authorized at read time and (b) persisted by any
 * Nostr relay (strfry, etc.). See SIGNING.md.
 *
 * Uses NIP-33 parameterized-replaceable semantics via tags:
 *   [["h", holonId], ["l", lens], ["d", itemId], ...]
 * so (pubkey, kind, d) identifies one current claim per author. h/l/d are
 * single-letter so relays index them and `{"#h":[...]}` filters work.
 */

import {
  finalizeEvent,
  verifyEvent as ntVerifyEvent,
  getEventHash as ntGetEventHash,
  getPublicKey as ntGetPublicKey,
  generateSecretKey as ntGenerateSecretKey,
} from 'nostr-tools/pure';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
import * as nip19 from 'nostr-tools/nip19';

/** Default kind: app-specific parameterized-replaceable (NIP-33 range). */
export const HOLOSPHERE_KIND = 30078;

/**
 * Normalize a secret key given as 64-char hex, NIP-19 `nsec1…` or raw
 * bytes. Strings come back as hex, bytes as-is — so callers can keep
 * whichever shape they hold while accepting the nsec form everywhere.
 */
export function normalizeSecretKey(sk) {
  if (sk == null || sk === '') return sk;
  if (typeof sk !== 'string') return sk;
  const v = sk.trim();
  if (/^nsec1[02-9ac-hj-np-z]+$/i.test(v)) {
    const { type, data } = nip19.decode(v.toLowerCase());
    if (type !== 'nsec') throw new Error(`secret key: expected an nsec, got ${type}`);
    return bytesToHex(data);
  }
  if (!/^[0-9a-f]{64}$/i.test(v)) throw new Error('secret key: expected 64 hex chars or an nsec1… string');
  return v.toLowerCase();
}

/** NIP-19 `nsec1…` encoding of a secret key (hex, nsec or bytes). */
export function toNsec(sk) {
  const n = normalizeSecretKey(sk);
  return nip19.nsecEncode(typeof n === 'string' ? hexToBytes(n) : n);
}

const toBytes = (sk) => {
  const n = normalizeSecretKey(sk);
  return typeof n === 'string' ? hexToBytes(n) : n;
};
const nowSec = () => Math.floor(Date.now() / 1000);

/** Generate a fresh secret key (Uint8Array). */
export function generateSecretKey() {
  return ntGenerateSecretKey();
}

/** x-only public key (hex) for a secret key (hex or bytes). */
export function getPublicKey(sk) {
  return ntGetPublicKey(toBytes(sk));
}

/** NIP-01 event id: sha256 of [0,pubkey,created_at,kind,tags,content] (hex). */
export function getEventHash(event) {
  return ntGetEventHash(event);
}

/**
 * Build + sign a HoloSphere event.
 * @param {object} params
 * @param {string} params.holon - holon id (H3 cell or string)
 * @param {string} params.lens  - lens name
 * @param {object} params.item  - item payload (must carry an `id`)
 * @param {string|Uint8Array} params.sk - author secret key
 * @returns {object} signed NIP-01 event whose content is the item JSON
 */
export function buildEvent({ holon, lens, item, sk, kind = HOLOSPHERE_KIND, created_at, extraTags = [] }) {
  if (!holon || !lens) throw new Error('buildEvent: holon and lens are required');
  if (!item || !item.id) throw new Error('buildEvent: item.id is required (becomes the d-tag)');

  return finalizeEvent(
    {
      kind,
      created_at: created_at ?? nowSec(),
      tags: [
        ['h', String(holon)],
        ['l', String(lens)],
        // NIP-33 replaceable identity is (pubkey, kind, d) — the d-tag must
        // therefore be unique per LOCATION, not per item id. With a bare id,
        // parent-scalespace/federation propagation (which re-puts the same
        // item into parent holons, re-signing each copy) REPLACED the
        // original event on the relay: the last parent cell won and the
        // item's true holon disappeared from every #h query.
        ['d', `${holon}/${lens}/${item.id}`],
        ...extraTags,
      ],
      content: JSON.stringify(item),
    },
    toBytes(sk),
  );
}

/** Sign a (partial) event template: returns a signed event with id + sig. */
export function signEvent(event, sk) {
  return finalizeEvent(
    {
      kind: event.kind ?? HOLOSPHERE_KIND,
      created_at: event.created_at ?? nowSec(),
      tags: event.tags ?? [],
      content: event.content ?? '',
    },
    toBytes(sk),
  );
}

/**
 * Verify an event's signature + id integrity (defeats content/author tampering).
 *
 * We verify a *clean* copy: nostr-tools caches a `verified` flag on the event
 * object, and that flag survives an object spread — so a tampered `{...evt}`
 * could otherwise return a stale `true`. Rebuilding the canonical fields forces
 * a real re-check every time.
 */
export function verifyEvent(event) {
  if (!event || !event.id || !event.sig || !event.pubkey) return false;
  try {
    return ntVerifyEvent({
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      kind: event.kind,
      tags: event.tags,
      content: event.content,
      sig: event.sig,
    });
  } catch {
    return false;
  }
}

/** Pull the item payload back out of an event's content. */
export function eventToItem(event) {
  try {
    return JSON.parse(event.content);
  } catch {
    return null;
  }
}

/** Read a single tag value (first match). */
export function tag(event, name) {
  const t = (event.tags || []).find((x) => x[0] === name);
  return t ? t[1] : undefined;
}

export default {
  HOLOSPHERE_KIND, generateSecretKey, getPublicKey, getEventHash,
  buildEvent, signEvent, verifyEvent, eventToItem, tag,
};
