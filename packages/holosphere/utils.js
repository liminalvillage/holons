// SPDX-License-Identifier: AGPL-3.0-or-later

import * as h3 from 'h3-js';
import { warnHologramUnresolvedOnce, clearHologramUnresolvedWarning } from './hologram.js';
import { clone } from './content.js';

/**
 * Converts latitude and longitude to a holon identifier.
 */
export async function getHolon(lat, lng, resolution) {
    return h3.latLngToCell(lat, lng, resolution);
}

/**
 * Retrieves all containing hexagons at all scales for given coordinates.
 */
export function getScalespace(lat, lng) {
    const list = [];
    const cell = h3.latLngToCell(lat, lng, 14);
    list.push(cell);
    for (let i = 13; i >= 0; i--) {
        list.push(h3.cellToParent(cell, i));
    }
    return list;
}

/**
 * Retrieves all containing hexagons at all scales for a given holon.
 */
export function getHolonScalespace(holon) {
    const list = [];
    const res = h3.getResolution(holon);
    for (let i = res; i >= 0; i--) {
        list.push(h3.cellToParent(holon, i));
    }
    return list;
}

// A correctly-written consumer opens a bounded number of live subscriptions per
// (holon, lens) path. A reactive loop that re-subscribes without tearing down
// will blow past this — warn (then back off, doubling) so the leak surfaces in
// dev instead of silently exhausting the heap.
const SUBSCRIBE_WARN_THRESHOLD = 64;

// A hologram whose source has not synced yet resolves 'unresolved'. The
// source lens sync is bounded by the relay timeout, so a couple of timed
// re-resolves close the gap for a slow relay without any echo machinery.
const HOLO_RETRY_MS = [3000, 10000];

/**
 * A "bare" tombstone carries nothing but the deletion marker. It is how
 * `delete()` travels, and it is delivered to subscribers as `callback(null,
 * key)`. A soft-delete that keeps the record's fields (`{ ...record,
 * _deleted: true }`) is delivered as the object so consumers can inspect it.
 */
const TOMBSTONE_KEYS = new Set(['id', '_deleted', 'updated', 'deletedAt', 'deleted_at', '_federation', '_hologram']);
export function isBareTombstone(item) {
    if (!item || typeof item !== 'object' || item._deleted !== true) return false;
    return Object.keys(item).every((k) => TOMBSTONE_KEYS.has(k));
}

/**
 * Subscribes to changes in a specific holon and lens.
 *
 * Returns **synchronously** — `const sub = holosphere.subscribe(...);
 * sub.unsubscribe();` is the canonical pattern (`await` on the return value
 * still works). Every subscriber gets the current snapshot replayed, then one
 * callback per change: `callback(object, key)` for live values,
 * `callback(null, key)` for deletions (opt out with `includeDeletes: false`).
 * Hologram pointers are resolved to their source before delivery.
 */
export function subscribe(holoInstance, holon, lens, callback, options = {}) {
    if (!holon || !lens) {
        throw new Error(`subscribe: Missing holon or lens parameters: ${holon} ${lens}`);
    }
    if (!callback || typeof callback !== 'function') {
        throw new Error('subscribe: Callback must be a function');
    }

    const includeDeletes = options.includeDeletes !== false;
    const subscriptionId = holoInstance.generateId();

    // Global odometer: catches a runaway that re-subscribes with an
    // ever-changing (holon, lens) too. Warns at exponential milestones with
    // the calling stack, so the loop is identifiable.
    holoInstance._subscribeCallCount = (holoInstance._subscribeCallCount || 0) + 1;
    holoInstance._subscribeWarnAt = holoInstance._subscribeWarnAt || 500;
    if (holoInstance._subscribeCallCount >= holoInstance._subscribeWarnAt) {
        const stack = (new Error().stack || '').split('\n').slice(2, 8).join('\n');
        console.warn(`[holosphere.subscribe] ${holoInstance._subscribeCallCount} total subscribe() calls this session — runaway re-subscribe likely. Latest: ${holon}/${lens}. Caller stack:\n${stack}`);
        holoInstance._subscribeWarnAt *= 2;
    }

    if (!holoInstance._subscriptionGroups) {
        holoInstance._subscriptionGroups = new Map();
    }
    const groupKey = `${holon} ${lens}`;
    let group = holoInstance._subscriptionGroups.get(groupKey);
    if (!group) {
        group = { holon, lens, ids: new Set(), warnThreshold: SUBSCRIBE_WARN_THRESHOLD };
        holoInstance._subscriptionGroups.set(groupKey, group);
    }
    group.ids.add(subscriptionId);
    if (group.ids.size >= group.warnThreshold) {
        const stack = (new Error().stack || '').split('\n').slice(2, 8).join('\n');
        console.warn(`[holosphere.subscribe] ${group.ids.size} live subscriptions on ${holon}/${lens} — likely a subscription leak (a caller is re-subscribing without calling unsubscribe()). Caller stack:\n${stack}`);
        group.warnThreshold *= 2;
    }

    let active = true;
    const retries = new Map(); // key -> { attempts, timer }

    const scheduleRetry = (key, pointer) => {
        const e = retries.get(key) || { attempts: 0, timer: null };
        if (e.timer || e.attempts >= HOLO_RETRY_MS.length) { retries.set(key, e); return; }
        const delay = HOLO_RETRY_MS[e.attempts++];
        e.timer = setTimeout(async () => {
            e.timer = null;
            if (!active) return;
            try {
                const res = await holoInstance.resolveHologramDetailed(pointer, { followHolograms: true });
                if (!active) return;
                if (res.status === 'resolved') {
                    retries.delete(key);
                    clearHologramUnresolvedWarning(holon, lens, key, pointer.soul);
                    callback(res.data, key);
                } else if (res.status === 'deleted') {
                    retries.delete(key);
                    callback(null, key);
                } else {
                    scheduleRetry(key, pointer);
                }
            } catch {
                scheduleRetry(key, pointer);
            }
        }, delay);
        if (typeof e.timer.unref === 'function') e.timer.unref();
        retries.set(key, e);
    };

    const deliver = async (item, key, meta) => {
        if (!active) return;
        if (meta.tombstone) {
            // A pending hologram retry for this key is moot once it is deleted.
            const r = retries.get(key);
            if (r && r.timer) clearTimeout(r.timer);
            retries.delete(key);
            if (isBareTombstone(item)) {
                if (includeDeletes) callback(null, key);
            } else {
                callback(clone(item), key);
            }
            return;
        }

        let parsed = clone(item);
        if (parsed && holoInstance.isHologram(parsed)) {
            const hologramSoul = parsed.soul;
            const pending = retries.get(key);
            if (pending && pending.timer) { clearTimeout(pending.timer); pending.timer = null; }
            const res = await holoInstance.resolveHologramDetailed(parsed, { followHolograms: true });
            if (!active) return;
            if (res.status === 'deleted') {
                // The source was soft-deleted — a DEFINITIVE removal. Notify
                // consumers the item is gone, exactly like a local tombstone,
                // and emit the janitor-parseable line so the pointer is GC'd.
                warnHologramUnresolvedOnce(holon, lens, key, hologramSoul);
                callback(null, key);
                return;
            }
            if (res.status !== 'resolved') {
                // Transient (unresolved/error) or structural (circular/depth/
                // invalid). Emit the janitor-parseable warning; a transient
                // miss must not flicker the item out of a live view, so no
                // removal is emitted — a couple of timed re-resolves follow.
                warnHologramUnresolvedOnce(holon, lens, key, hologramSoul);
                if (res.status === 'unresolved' || res.status === 'error') {
                    scheduleRetry(key, parsed);
                }
                return;
            }
            retries.delete(key);
            clearHologramUnresolvedWarning(holon, lens, key, hologramSoul);
            if (res.data !== parsed) parsed = res.data;
        }

        // Subscribers expect `object | null`.
        if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
            console.warn(`[holosphere.subscribe] dropping non-object payload at ${holon}/${lens}/${key}:`, typeof parsed);
            return;
        }
        if (active) callback(parsed, key);
    };

    const off = holoInstance.store.watch(holon, lens, (item, key, meta) => {
        deliver(item, key, meta).catch((error) => {
            console.error('Error processing subscribed data:', error);
        });
    });

    holoInstance.subscriptions[subscriptionId] = { id: subscriptionId, holon, lens, callback, groupKey, off };

    return {
        unsubscribe: () => {
            const sub = holoInstance.subscriptions[subscriptionId];
            if (!sub) return;
            active = false;
            try {
                for (const e of retries.values()) {
                    if (e.timer) clearTimeout(e.timer);
                }
                retries.clear();
                off();
                const g = holoInstance._subscriptionGroups && holoInstance._subscriptionGroups.get(groupKey);
                if (g) {
                    g.ids.delete(subscriptionId);
                    if (g.ids.size === 0) holoInstance._subscriptionGroups.delete(groupKey);
                }
                delete holoInstance.subscriptions[subscriptionId];
            } catch (error) {
                console.error(`Error during unsubscribe logic for ${subscriptionId}:`, error);
            }
        }
    };
}

/**
 * @deprecated Subscribers are notified by the store's change feed; this is a
 * no-op kept for API compatibility.
 */
export function notifySubscribers() {}

export function generateId() {
    return Date.now().toString(10) + Math.random().toString(2);
}

/**
 * Closes the HoloSphere instance and cleans up resources.
 */
export async function close(holoInstance) {
    try {
        for (const id of Object.keys(holoInstance.subscriptions || {})) {
            try { holoInstance.subscriptions[id]?.off?.(); } catch { /* ignore */ }
        }
        holoInstance.subscriptions = {};
        if (holoInstance._subscriptionGroups) holoInstance._subscriptionGroups.clear();
        holoInstance.clearSchemaCache();
        if (holoInstance.store) await holoInstance.store.close();
    } catch (error) {
        console.error('Error closing HoloSphere instance:', error);
    }
}

export default {
    getHolon,
    getScalespace,
    getHolonScalespace,
    subscribe,
    notifySubscribers,
    generateId,
    close,
    isBareTombstone,
};
