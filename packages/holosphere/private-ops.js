// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Password ("private") lens operations. A password scopes records to
// `${appName}:${holon ?? lens}` and encrypts them with NIP-44 under a key
// derived from the password (store/private.js). Private records never touch
// the relay, the signing layer, holograms or propagation — they are exactly
// as isolated as the old SEA user space was.

import { privateLens } from './store/index.js';
import { isTombstone } from './store/store.js';

const { deriveKey, seal, open, privateScope, CHECK_LENS, CHECK_KEY } = privateLens;

const normHolon = (h) => (h === null || h === undefined || h === '' ? null : h);
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

/**
 * Derive the scope key and verify the password against the scope's check
 * value. With `create` the check value is written on first use; without it a
 * scope that was never written is simply empty, while a scope with data and
 * a wrong password throws `Authentication failed for <scope>` (put refuses to
 * write; reads and deletes report nothing there — see unlockOrNull).
 */
export async function unlock(holoInstance, holon, lens, password, { create = false } = {}) {
    const scope = privateScope(holoInstance.appname, normHolon(holon), lens);
    const key = await deriveKey(password, scope);
    const store = holoInstance.store;
    const check = store.privateGet(scope, CHECK_LENS, CHECK_KEY);
    if (check) {
        try {
            open(check, key);
        } catch {
            throw new Error(`Authentication failed for ${scope}`);
        }
    } else if (create) {
        store.privatePut(scope, CHECK_LENS, CHECK_KEY, seal({ ok: true, at: Date.now() }, key));
    }
    return { scope, key, store };
}

export async function put(holoInstance, holon, lens, data, password, options = {}) {
    if (!data || typeof data !== 'object') throw new Error('put: Missing required data parameter');
    if (!lens) throw new Error('put: Missing required lens parameter');
    const { scope, key, store } = await unlock(holoInstance, holon, lens, password, { create: true });
    const id = data.id ?? holoInstance.generateId();
    data.id = id;
    const payload = clone(data) || {};
    delete payload._meta;
    delete payload._hologram;
    if (!options.preserveFederationMeta) delete payload._federation;
    store.privatePut(scope, lens, String(id), seal(payload, key));
    return {
        success: true,
        private: true,
        isHologramAtPath: false,
        pathHolon: normHolon(holon),
        pathLens: lens,
        pathKey: String(id),
        propagationResult: null,
        updatedHolograms: [],
    };
}

/** A wrong password reads as "nothing there" (warned), never as someone else's data. */
async function unlockOrNull(holoInstance, holon, lens, password) {
    try {
        return await unlock(holoInstance, holon, lens, password);
    } catch (e) {
        console.warn(`[holosphere] private lens: ${e?.message}`);
        return null;
    }
}

export async function get(holoInstance, holon, lens, keyName, password, options = {}) {
    const u = await unlockOrNull(holoInstance, holon, lens, password);
    if (!u) return null;
    const { key, scope, store } = u;
    const cipher = store.privateGet(scope, lens, String(keyName));
    if (!cipher) return null;
    let item;
    try {
        item = open(cipher, key);
    } catch {
        console.warn(`[holosphere] private lens: Authentication failed for ${scope}`);
        return null;
    }
    if (!options.includeDeleted && isTombstone(item)) return null;
    return item;
}

export async function getAll(holoInstance, holon, lens, password, options = {}) {
    const u = await unlockOrNull(holoInstance, holon, lens, password);
    if (!u) return [];
    const { key, scope, store } = u;
    const out = [];
    for (const { cipher } of store.privateList(scope, lens)) {
        let item;
        try {
            item = open(cipher, key);
        } catch {
            continue; // written under another password for the same scope name — not ours
        }
        if (!item || item.id === undefined || item.id === null) continue;
        if (!options.includeDeleted && isTombstone(item)) continue;
        out.push(item);
    }
    return out;
}

export async function deleteFunc(holoInstance, holon, lens, keyName, password) {
    const u = await unlockOrNull(holoInstance, holon, lens, password);
    if (!u) return false;
    const { scope, store } = u;
    store.privateDelete(scope, lens, String(keyName));
    return true;
}

export async function deleteAll(holoInstance, holon, lens, password) {
    const u = await unlockOrNull(holoInstance, holon, lens, password);
    if (!u) return false;
    const { scope, store } = u;
    store.privateClear(scope, lens);
    return true;
}

export default { unlock, put, get, getAll, delete: deleteFunc, deleteAll };
