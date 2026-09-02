// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Raw record access by (holon, lens, key) or by soul. These bypass hologram
// resolution and tombstone filtering — they return what is stored.

import { isHologram } from './hologram.js';
import { addrFromSoul, parseAddr } from './store/address.js';
import * as ContentOps from './content.js';

const clone = ContentOps.clone;

/**
 * The stored record at (holon, lens, key), or null. Holograms come back as
 * their `{ id, soul }` pointer; tombstones as-is.
 */
export async function getNode(holoInstance, holon, lens, key) {
    if (!holon || !lens || !key) {
        throw new Error('getNode: Missing required parameters');
    }
    const rec = holoInstance.store.get(holon, lens, String(key));
    return rec ? clone(rec.item) : null;
}

/** The stored record a soul names (`app/holon/lens/key`), or null. */
export async function getNodeBySoul(holoInstance, soul) {
    if (!soul) {
        throw new Error('getNodeBySoul: Missing soul parameter');
    }
    const a = addrFromSoul(soul, holoInstance.appname);
    if (!a) return null;
    const { holon, lens, id } = parseAddr(a);
    const rec = holoInstance.store.get(holon, lens, id);
    return rec ? clone(rec.item) : null;
}

/** Delete the record at (holon, lens, key). Equivalent to `delete`. */
export async function deleteNode(holoInstance, holon, lens, key) {
    if (!holon || !lens || !key) {
        throw new Error('deleteNode: Missing required parameters');
    }
    return ContentOps.deleteFunc(holoInstance, holon, lens, key, null, { autoPropagate: false });
}

/** Whether the record at a soul is a hologram pointer. */
export function isPointerAt(holoInstance, soul) {
    const a = addrFromSoul(soul, holoInstance.appname);
    if (!a) return false;
    const { holon, lens, id } = parseAddr(a);
    const rec = holoInstance.store.get(holon, lens, id);
    return !!rec && isHologram(rec.item);
}

export default {
    getNode,
    getNodeBySoul,
    deleteNode,
    isPointerAt,
};
