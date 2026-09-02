// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Password ("private") lenses. A password-protected write never leaves the
// device: it is encrypted with NIP-44 under a key derived from the password
// and kept in the store's private table — never signed, never published,
// never propagated, never exported.
//
// The scope string `${appName}:${holon ?? lens}` is the SAME string the Gun
// SEA username used to be, so the mental model ("one password per holon, or
// per lens for globals") is unchanged. The scrypt parameters are frozen: a
// change orphans every existing private record (the password alone cannot
// recover data derived with other parameters).

import { scryptAsync } from '@noble/hashes/scrypt';
import { v2 as nip44 } from 'nostr-tools/nip44';

/** Frozen KDF parameters (see the note above). */
export const KDF = Object.freeze({ N: 2 ** 15, r: 8, p: 1, dkLen: 32 });

/** Lens + key of the per-scope password check value. */
export const CHECK_LENS = '_check';
export const CHECK_KEY = '_check';

const utf8 = (s) => new TextEncoder().encode(String(s));
const keyCache = new Map(); // `${scope}\0${password}` -> Promise<Uint8Array>

/** The scope a password applies to: the holon, or the lens for globals. */
export function privateScope(appName, holon, lens) {
    return `${appName}:${holon ?? lens}`;
}

/** Derive (and memoize) the 32-byte NIP-44 conversation key for a scope. */
export function deriveKey(password, scope) {
    if (typeof password !== 'string' || !password) {
        return Promise.reject(new Error('private lens: a non-empty password is required'));
    }
    const cacheKey = `${scope}\0${password}`;
    let p = keyCache.get(cacheKey);
    if (!p) {
        p = scryptAsync(utf8(password), utf8(scope), { N: KDF.N, r: KDF.r, p: KDF.p, dkLen: KDF.dkLen });
        keyCache.set(cacheKey, p);
    }
    return p;
}

/** Forget every memoized key (logout). */
export function forgetKeys() {
    keyCache.clear();
}

/** Encrypt an item to a NIP-44 payload string. */
export function seal(item, key) {
    return nip44.encrypt(JSON.stringify(item), key);
}

/** Decrypt a NIP-44 payload back into an item; throws on a wrong key. */
export function open(payload, key) {
    return JSON.parse(nip44.decrypt(payload, key));
}

/** Store key of one private record. */
export function privateKeyOf(scope, lens, key) {
    return `${scope}${lens}${key}`;
}

/** Prefix shared by every private record of a (scope, lens). */
export function privateLensPrefix(scope, lens) {
    return `${scope}${lens}`;
}
