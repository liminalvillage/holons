// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sealed content: NIP-44 ciphertext inside an ordinary kind-30078 envelope.
//
// A private lens keeps the envelope's tags (holon, lens, item id, namespace,
// time) in the clear so NIP-33 replacement, last-writer-wins and the relay
// filters work unchanged — only `content` differs. Envelope encryption:
//
//   { enc: 'nip44', v: 1, kid, ct: nip44(JSON(item), CEK), k: nip44(hex(CEK), K_lens) }
//
// Every item has its own content key (CEK), wrapped under the lens key
// (K_lens). Sharing a lens = sharing K_lens; sharing one item = sharing that
// item's CEK. `kid` is a prefix of sha256(K_lens): a key someone hands us is
// accepted only if it hashes to the kid it claims (self-certifying), so a
// bogus key can never evict a good one from the keyring.
//
// The owner's own vault records use `kid: 'self'` and no `k`: their `ct` is
// sealed under the NIP-44 conversation key of the owner's key with itself,
// which any device holding that key can recompute.
//
// What the store keeps when it cannot open a sealed record is a LOCKED STUB
// `{ id, _locked: true, _kid }` — a record, so it supersedes an older
// plaintext claim at the same address (dropping the claim would leave that
// plaintext current), and re-decodes in place once a key arrives.

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { getPublicKey } from '../nostr-events.js';

export const SEALED_ENC = 'nip44';
export const SEALED_V = 1;
/** The kid of a record sealed to its author alone (vault records). */
export const SELF_KID = 'self';
/** Refuse ciphertext past this: NIP-44 caps plaintext at 65 535 B and relays
 *  reject events around 64 KB. */
export const MAX_CT_BYTES = 60 * 1024;

const toBytes = (k) => (typeof k === 'string' ? hexToBytes(k) : k);

/** Is this decoded `content` a sealed payload (never a plaintext item)? */
export function isSealed(obj) {
    return !!obj && typeof obj === 'object' && !Array.isArray(obj)
        && obj.enc === SEALED_ENC && obj.v === SEALED_V
        && typeof obj.ct === 'string' && typeof obj.kid === 'string'
        && !('id' in obj);
}

/** The key id of a lens key: 16 hex chars of sha256(key). */
export function kidOf(lensKey) {
    return bytesToHex(sha256(toBytes(lensKey))).slice(0, 16);
}

/** A fresh 32-byte symmetric key (lens key or content key). */
export function generateKey() {
    return randomBytes(32);
}

/** The NIP-44 conversation key of a secret key with its own pubkey. */
export function selfKey(sk) {
    const bytes = toBytes(sk);
    return nip44.utils.getConversationKey(bytes, getPublicKey(bytes));
}

/** Wrap a content key under a lens key. */
export function wrapCek(cek, lensKey) {
    return nip44.encrypt(bytesToHex(toBytes(cek)), toBytes(lensKey));
}

/** Unwrap a content key; throws on a wrong lens key. */
export function unwrapCek(k, lensKey) {
    return hexToBytes(nip44.decrypt(k, toBytes(lensKey)));
}

function assertSize(ct) {
    if (ct.length > MAX_CT_BYTES) {
        throw new Error(`sealed content is ${ct.length} bytes; the limit is ${MAX_CT_BYTES} (relays reject larger events)`);
    }
}

/**
 * Seal an item. `k` may be passed verbatim to keep an existing wrap (an
 * editor that holds only the CEK, not the lens key, re-uses it unchanged).
 */
export function sealItem(item, { cek, lensKey, kid, k } = {}) {
    if (!item || typeof item !== 'object') throw new Error('sealItem: item must be an object');
    if (!cek) throw new Error('sealItem: a content key is required');
    const wrap = k ?? (lensKey ? wrapCek(cek, lensKey) : null);
    if (!wrap) throw new Error('sealItem: a lens key (or an existing wrap) is required');
    const keyId = kid ?? (lensKey ? kidOf(lensKey) : null);
    if (!keyId) throw new Error('sealItem: a kid is required when no lens key is given');
    const ct = nip44.encrypt(JSON.stringify(item), toBytes(cek));
    assertSize(ct);
    return { enc: SEALED_ENC, v: SEALED_V, kid: keyId, ct, k: wrap };
}

/**
 * Open a sealed item with either the lens key (unwraps `k`) or the item's own
 * content key. Throws on a wrong key (NIP-44 MAC failure).
 */
export function unsealItem(sealed, { lensKey, cek } = {}) {
    if (!isSealed(sealed)) throw new Error('unsealItem: not a sealed payload');
    let contentKey = cek ? toBytes(cek) : null;
    if (!contentKey) {
        if (!lensKey) throw new Error('unsealItem: a lens key or content key is required');
        if (typeof sealed.k !== 'string') throw new Error('unsealItem: payload carries no wrapped content key');
        contentKey = unwrapCek(sealed.k, lensKey);
    }
    const item = JSON.parse(nip44.decrypt(sealed.ct, contentKey));
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('unsealItem: payload is not an item');
    return item;
}

/** The content key of a sealed record, via the lens key. */
export function cekOf(sealed, lensKey) {
    if (!isSealed(sealed) || typeof sealed.k !== 'string') throw new Error('cekOf: not a wrapped sealed payload');
    return unwrapCek(sealed.k, lensKey);
}

/** Seal an object to the author alone (vault records). */
export function sealSelf(obj, sk) {
    const ct = nip44.encrypt(JSON.stringify(obj), selfKey(sk));
    assertSize(ct);
    return { enc: SEALED_ENC, v: SEALED_V, kid: SELF_KID, ct };
}

/** Open a self-sealed object; throws on another author's payload. */
export function unsealSelf(sealed, sk) {
    if (!isSealed(sealed) || sealed.kid !== SELF_KID) throw new Error('unsealSelf: not a self-sealed payload');
    const obj = JSON.parse(nip44.decrypt(sealed.ct, selfKey(sk)));
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('unsealSelf: payload is not an object');
    return obj;
}

/** The record a store keeps for a sealed event it cannot open. */
export function lockedStub(id, sealed) {
    return { id: String(id), _locked: true, _kid: sealed?.kid ?? null };
}

/** Is this item a locked stub? */
export function isLocked(item) {
    return !!item && typeof item === 'object' && item._locked === true;
}

export default {
    SEALED_ENC, SEALED_V, SELF_KID, MAX_CT_BYTES,
    isSealed, kidOf, generateKey, selfKey, wrapCek, unwrapCek, cekOf,
    sealItem, unsealItem, sealSelf, unsealSelf, lockedStub, isLocked,
};
