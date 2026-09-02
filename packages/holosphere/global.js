// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Global tables are holon-less records: `app/_g/table/key` in the store, the
// `_g` sentinel on the wire. Every operation here is the matching content
// operation with `holon = null`.

import * as ContentOps from './content.js';
import { isTombstone } from './store/store.js';

const clone = ContentOps.clone;

export async function putGlobal(holoInstance, tableName, data, password = null, options = {}) {
    if (!tableName || !data) throw new Error('putGlobal: Missing required parameters');
    return ContentOps.put(holoInstance, null, tableName, data, password, options);
}

export async function getGlobal(holoInstance, tableName, key, password = null, options = {}) {
    if (!tableName || !key) throw new Error('getGlobal: Missing required parameters');
    return ContentOps.get(holoInstance, null, tableName, key, password, options);
}

export async function getAllGlobal(holoInstance, tableName, password = null, options = {}) {
    if (!tableName) throw new Error('getAllGlobal: Missing required parameters');
    return ContentOps.getAll(holoInstance, null, tableName, password, options);
}

export async function deleteGlobal(holoInstance, tableName, key, password = null, options = {}) {
    if (!tableName || !key) throw new Error('deleteGlobal: Missing required parameters');
    return ContentOps.delete(holoInstance, null, tableName, key, password, options);
}

export async function deleteAllGlobal(holoInstance, tableName, password = null, options = {}) {
    if (!tableName) throw new Error('deleteAllGlobal: Missing required parameters');
    return ContentOps.deleteAll(holoInstance, null, tableName, password, options);
}

/**
 * Subscribe to real-time changes in a global table.
 *
 * Returns synchronously — see {@link subscribe} for the same rationale.
 *
 * @param {string|null} key - a specific key, or null for the whole table
 * @param {object} [options]
 * @param {boolean} [options.realtimeOnly] - skip the initial snapshot
 * @returns {{ unsubscribe: () => void, stop: () => void }}
 */
export function subscribeGlobal(holoInstance, tableName, key, callback, options = {}) {
    if (!tableName || typeof callback !== 'function') {
        throw new Error('subscribeGlobal: table name and callback are required');
    }
    let active = true;
    const off = holoInstance.store.watch(null, tableName, (item, k, meta) => {
        if (!active) return;
        if (key && String(k) !== String(key)) return;
        if (meta.tombstone || isTombstone(item)) return;
        try {
            callback(clone(item), k);
        } catch (e) {
            console.warn('[subscribeGlobal] callback threw:', e?.message);
        }
    }, { replay: !options.realtimeOnly });
    const unsubscribe = () => { active = false; off(); };
    return { unsubscribe, stop: unsubscribe };
}

// Export all global operations as default
export default {
    putGlobal,
    getGlobal,
    getAllGlobal,
    deleteGlobal,
    deleteAllGlobal,
    subscribeGlobal
};
