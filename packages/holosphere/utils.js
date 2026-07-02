// holo_utils.js
import * as h3 from 'h3-js';

/**
 * Converts latitude and longitude to a holon identifier.
 * @param {number} lat - The latitude.
 * @param {number} lng - The longitude.
 * @param {number} resolution - The resolution level.
 * @returns {Promise<string>} - The resulting holon identifier.
 */
export async function getHolon(lat, lng, resolution) { // Doesn't need holoInstance
    return h3.latLngToCell(lat, lng, resolution);
}

/**
 * Retrieves all containing holonagons at all scales for given coordinates.
 * @param {number} lat - The latitude.
 * @param {number} lng - The longitude.
 * @returns {Array<string>} - List of holon identifiers.
 */
export function getScalespace(lat, lng) { // Doesn't need holoInstance
    let list = []
    let cell = h3.latLngToCell(lat, lng, 14);
    list.push(cell)
    for (let i = 13; i >= 0; i--) {
        list.push(h3.cellToParent(cell, i))
    }
    return list
}

/**
 * Retrieves all containing holonagons at all scales for a given holon.
 * @param {string} holon - The holon identifier.
 * @returns {Array<string>} - List of holon identifiers.
 */
export function getHolonScalespace(holon) { // Doesn't need holoInstance
    let list = []
    let res = h3.getResolution(holon)
    for (let i = res; i >= 0; i--) {
        list.push(h3.cellToParent(holon, i))
    }
    return list
}

/**
 * Subscribes to changes in a specific holon and lens.
 *
 * Returns **synchronously** — the call has no internal awaits, so callers
 * never need to `await` the result. (`await` on the return value still
 * works as before; it just resolves through the value unchanged.) This
 * means `const sub = holosphere.subscribe(...); sub.unsubscribe();` is the
 * canonical pattern and there is no `Promise<{ unsubscribe }>` shape to
 * disambiguate against the resolved object.
 *
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holon - The holon identifier.
 * @param {string} lens - The lens to subscribe to.
 * @param {function} callback - The callback to execute on changes.
 * @returns {{ unsubscribe: () => void }} - Subscription with unsubscribe method.
 */
// A correctly-written consumer opens a bounded number of live subscriptions per
// (holon, lens) path. A reactive loop that re-subscribes without tearing down
// will blow past this — warn (then back off, doubling) so the leak surfaces in
// dev instead of silently exhausting the heap.
const SUBSCRIBE_WARN_THRESHOLD = 64;
// Per-lens fire-storm quarantine. If one (holon, lens) sustains more than
// QUARANTINE_FIRE_THRESHOLD map().on() fires inside a 1s window (a corrupt
// circular hologram makes Gun re-emit it without bound), detach every listener
// on that lens and refuse to re-subscribe for QUARANTINE_COOLDOWN_MS so the tab
// recovers and cleanup tools (__repairCircular) stop being starved.
const QUARANTINE_FIRE_THRESHOLD = 2500;
const QUARANTINE_COOLDOWN_MS = 30000;

export function subscribe(holoInstance, holon, lens, callback, options = {}) {
    if (!holon || !lens) {
        throw new Error('subscribe: Missing holon or lens parameters:', holon, lens);
    }

    if (!callback || typeof callback !== 'function') {
        throw new Error('subscribe: Callback must be a function');
    }

    // Notify on deletes too (callback(null, key)) — consumers already expect
    // `object | null`. Opt out with `{ includeDeletes: false }`.
    const includeDeletes = options.includeDeletes !== false;
    const subscriptionId = holoInstance.generateId(); // Use instance's generateId

    // Global odometer: catches a runaway that re-subscribes with an
    // ever-changing (holon, lens) too (which keeps every group small, so the
    // per-path warning below would never fire). Warns at exponential
    // milestones with the calling stack, so the loop is identifiable.
    holoInstance._subscribeCallCount = (holoInstance._subscribeCallCount || 0) + 1;
    holoInstance._subscribeWarnAt = holoInstance._subscribeWarnAt || 500;
    if (holoInstance._subscribeCallCount >= holoInstance._subscribeWarnAt) {
        const stack = (new Error().stack || '').split('\n').slice(2, 8).join('\n');
        console.warn(`[holosphere.subscribe] ${holoInstance._subscribeCallCount} total subscribe() calls this session — runaway re-subscribe likely. Latest: ${holon}/${lens}. Caller stack:\n${stack}`);
        holoInstance._subscribeWarnAt *= 2;
    }

    try {
        // Per-subscriber Gun listener. We intentionally give EACH subscribe its
        // own `gun...map().on()` rather than sharing one listener per path:
        // Gun replays the existing graph to a listener only at attach time, so a
        // shared listener would starve every subscriber that joins after the
        // first of its initial snapshot (which broke enforce-mode provenance
        // tagging — late joiners like QueryManager got only live updates, never
        // the tagged initial items). Leak prevention is handled by callers
        // tearing down via the returned `unsubscribe` (every `.map().on()` is
        // `.off()`d here); the per-path + global counters below only *detect* a
        // caller that re-subscribes without cleaning up and surface it loudly.
        if (!holoInstance._subscriptionGroups) {
            holoInstance._subscriptionGroups = new Map();
        }
        const groupKey = `${holon} ${lens}`;

        // Fire-storm quarantine: if this lens was recently detached for a runaway
        // map().on() storm (a corrupt circular hologram makes Gun re-emit forever),
        // refuse to re-attach for a cooldown — otherwise a caller that re-subscribes
        // on every update (e.g. QueryManager) instantly restarts the storm. The raw
        // data is untouched; clean up the cycle and reload to resume live updates.
        const qAt = holoInstance.__quarantined && holoInstance.__quarantined.get(groupKey);
        if (qAt && Date.now() - qAt < QUARANTINE_COOLDOWN_MS) {
            console.warn(`[holosphere.subscribe] ${holon}/${lens} is quarantined after a fire-storm — not re-subscribing. Run __repairCircular('${holon}','${lens}') (or __nuke the bad pointer) and reload.`);
            return { unsubscribe: () => {} };
        }

        let group = holoInstance._subscriptionGroups.get(groupKey);
        if (!group) {
            group = { holon, lens, ids: new Set(), warnThreshold: SUBSCRIBE_WARN_THRESHOLD, fires: [] };
            holoInstance._subscriptionGroups.set(groupKey, group);
        }
        group.ids.add(subscriptionId);

        if (group.ids.size >= group.warnThreshold) {
            // Include the calling stack so the runaway caller is identifiable
            // straight from the console — strip this frame's own line.
            const stack = (new Error().stack || '').split('\n').slice(2, 8).join('\n');
            console.warn(`[holosphere.subscribe] ${group.ids.size} live subscriptions on ${holon}/${lens} — likely a subscription leak (a caller is re-subscribing without calling unsubscribe()). Caller stack:\n${stack}`);
            group.warnThreshold *= 2;
        }

        // Delegate to the backend's subscribe method.  The backend handles
        // the raw storage subscription (Gun map().on() or AD4M model query);
        // we keep the orchestration concerns here: parse, hologram resolution,
        // object-only filtering, fire-storm detection.
        const backendSub = holoInstance._backend.subscribe(holon, lens, async (key, data) => {
            // Fire-storm breaker (backend-agnostic).
            const __fnow = Date.now();
            const gfw = group.fires;
            gfw.push(__fnow);
            if (gfw.length > 64) { while (gfw.length && __fnow - gfw[0] > 1000) gfw.shift(); }
            if (gfw.length > QUARANTINE_FIRE_THRESHOLD) {
                holoInstance.__onFireWarnedAt = __fnow;
                holoInstance.__quarantined ||= new Map();
                holoInstance.__quarantined.set(groupKey, __fnow);
                const __st = (new Error().stack || '').split('\n').slice(2, 8).join('\n');
                console.error(`[subscribe] FIRE-STORM on ${holon}/${lens} (${gfw.length}/s) — QUARANTINING this lens. Stack:\n${__st}`);
                for (const id of [...group.ids]) {
                    const sub = holoInstance.subscriptions[id];
                    try { sub?.backendSub?.unsubscribe(); } catch { /* ignore */ }
                    delete holoInstance.subscriptions[id];
                }
                group.ids.clear();
                holoInstance._subscriptionGroups.delete(groupKey);
                return;
            }
            const __fw = (holoInstance.__onFireWindow ||= []);
            __fw.push(__fnow);
            if (__fw.length > 64) { while (__fw.length && __fnow - __fw[0] > 1000) __fw.shift(); }
            if (__fw.length > 4000) {
                if (!holoInstance.__onFireWarnedAt || __fnow - holoInstance.__onFireWarnedAt > 2000) {
                    holoInstance.__onFireWarnedAt = __fnow;
                    const __st = (new Error().stack || '').split('\n').slice(2, 8).join('\n');
                    console.error(`[subscribe] FIRE-STORM: ${__fw.length} fires/s — runaway. Latest path=${holon}/${lens} key=${key}. Stack:\n${__st}`);
                }
                return;
            }

            if (!holoInstance.subscriptions[subscriptionId]) return;

            if (data) {
                try {
                    let parsed = await holoInstance.parse(data);
                    if (parsed && holoInstance.isHologram(parsed)) {
                        const hologramSoul = parsed.soul;
                        const res = await holoInstance.resolveHologramDetailed(parsed, { followHolograms: true });
                        if (res.status === 'deleted') {
                            console.warn(`Hologram at ${holon}/${lens}/${key} did not resolve (soul=${hologramSoul}); skipping.`);
                            if (holoInstance.subscriptions[subscriptionId]) {
                                callback(null, key);
                            }
                            return;
                        }
                        if (res.status !== 'resolved') {
                            console.warn(`Hologram at ${holon}/${lens}/${key} did not resolve (soul=${hologramSoul}); skipping.`);
                            return;
                        }
                        if (res.data !== parsed) {
                            parsed = res.data;
                        }
                    }

                    if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
                        console.warn(`[holosphere.subscribe] dropping non-object payload at ${holon}/${lens}/${key}:`, typeof parsed);
                        return;
                    }

                    if (holoInstance.subscriptions[subscriptionId]) {
                        callback(parsed, key);
                    }
                } catch (error) {
                    console.error('Error processing subscribed data:', error);
                }
            } else if (includeDeletes && key && key !== '_' && holoInstance.subscriptions[subscriptionId]) {
                callback(null, key);
            }
        }, { includeDeletes });

        holoInstance.subscriptions[subscriptionId] = {
            id: subscriptionId,
            holon,
            lens,
            callback,
            backendSub,
            groupKey,
        };

        return {
            unsubscribe: () => {
                const sub = holoInstance.subscriptions[subscriptionId];
                if (!sub) return;

                try {
                    if (sub.backendSub?.unsubscribe) sub.backendSub.unsubscribe();

                    const g = holoInstance._subscriptionGroups &&
                        holoInstance._subscriptionGroups.get(groupKey);
                    if (g) {
                        g.ids.delete(subscriptionId);
                        if (g.ids.size === 0) {
                            holoInstance._subscriptionGroups.delete(groupKey);
                        }
                    }

                    delete holoInstance.subscriptions[subscriptionId];
                } catch (error) {
                    console.error(`Error during unsubscribe logic for ${subscriptionId}:`, error);
                }
            }
        };
    } catch (error) {
        console.error('Error creating subscription:', error);
        throw error;
    }
}

/**
 * Notifies subscribers about data changes
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {object} data - The data to notify about
 * @private
 */
export function notifySubscribers(holoInstance, data) {
    if (!data || !data.holon || !data.lens) {
        return;
    }

    try {
        Object.values(holoInstance.subscriptions).forEach(subscription => {
            if (subscription.holon === data.holon &&
                subscription.lens === data.lens) {
                try {
                    if (subscription.callback && typeof subscription.callback === 'function') {
                        subscription.callback(data);
                    }
                } catch (error) {
                    console.warn('Error in subscription callback:', error);
                }
            }
        });
    } catch (error) {
        console.warn('Error notifying subscribers:', error);
    }
}

// Add ID generation method
export function generateId() { // Doesn't need holoInstance
    return Date.now().toString(10) + Math.random().toString(2);
}

/**
 * Closes the HoloSphere instance and cleans up resources.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @returns {Promise<void>}
 */
export async function close(holoInstance) {
    try {
        // Unsubscribe from all subscriptions
        for (const [id, sub] of Object.entries(holoInstance.subscriptions)) {
            try {
                if (sub.backendSub?.unsubscribe) sub.backendSub.unsubscribe();
            } catch (error) {
                console.warn(`Error cleaning up subscription ${id}:`, error);
            }
        }

        holoInstance.subscriptions = {};
        if (holoInstance._subscriptionGroups) {
            holoInstance._subscriptionGroups.clear();
        }

        holoInstance.clearSchemaCache();

        await holoInstance._backend.close();

        await new Promise(resolve => setTimeout(resolve, 100));
        console.log('HoloSphere instance closed successfully');
    } catch (error) {
        console.error('Error closing HoloSphere instance:', error);
    }
}

/**
 * Creates a namespaced username for Gun authentication
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holonId - The holon ID
 * @returns {string} - Namespaced username
 */
export function userName(holoInstance, holonId) {
    if (!holonId) return null;
    return `${holoInstance.appname}:${holonId}`;
} 

// Export all utility operations as default
export default {
    getHolon,
    getScalespace,
    getHolonScalespace,
    subscribe,
    notifySubscribers,
    generateId,
    close,
    userName
}; 