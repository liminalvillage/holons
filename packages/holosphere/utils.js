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

        // Get the Gun chain up to the map()
        const mapChain = holoInstance.gun.get(holoInstance.appname).get(holon).get(lens).map();

        // Create the subscription by calling .on() on the map chain
        const gunListener = mapChain.on(async (data, key) => {
            // Fire-storm breaker. A write to a cyclic / over-subscribed federated
            // node can make Gun re-fire map().on() handlers in an unbounded burst,
            // exhausting the heap before any await yields. Count instance-wide
            // fires in a 1s window; past a clear-runaway threshold, log the path +
            // stack ONCE and bail (no parse/resolve/allocate) so the tab survives
            // and the culprit is identifiable.
            const __fnow = Date.now();
            // Already quarantined? Listeners can outlive the detach below — gun
            // 0.2020's map().off() doesn't reliably unhook per-child listeners —
            // and each surviving fire used to re-enter the quarantine branch and
            // re-log the storm (a console.error per fire, thousands/s). Swallow
            // silently for the cooldown; afterwards lift the quarantine so a
            // repaired lens resumes without a reload.
            const __qAt = holoInstance.__quarantined && holoInstance.__quarantined.get(groupKey);
            if (__qAt) {
                if (__fnow - __qAt < QUARANTINE_COOLDOWN_MS) return;
                holoInstance.__quarantined.delete(groupKey);
            }
            // Per-PATH fire window (on the group) so we can pin the runaway lens and
            // QUARANTINE it specifically — not just bail instance-wide and let Gun
            // keep re-firing forever.
            const gfw = group.fires;
            gfw.push(__fnow);
            if (gfw.length > 64) { while (gfw.length && __fnow - gfw[0] > 1000) gfw.shift(); }
            if (gfw.length > QUARANTINE_FIRE_THRESHOLD) {
                // Sustained storm on THIS lens: detach every listener on it and mark
                // it quarantined so re-subscribes are refused for a cooldown. The tab
                // recovers and the lens read in __repairCircular stops being starved.
                holoInstance.__onFireWarnedAt = __fnow; // also quiets the enforce wrapper
                holoInstance.__quarantined ||= new Map();
                holoInstance.__quarantined.set(groupKey, __fnow);
                const __st = (new Error().stack || '').split('\n').slice(2, 8).join('\n');
                console.error(`[subscribe] FIRE-STORM on ${holon}/${lens} (${gfw.length}/s) — QUARANTINING this lens (detaching listeners). Almost certainly a circular hologram; run __repairCircular('${holon}','${lens}') or __nuke the bad pointer, then reload. Stack:\n${__st}`);
                for (const id of [...group.ids]) {
                    const sub = holoInstance.subscriptions[id];
                    try { sub && sub.mapChain && sub.mapChain.off(); } catch { /* ignore */ }
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
                    console.error(`[subscribe] FIRE-STORM: ${__fw.length} map().on() fires/s — runaway. Latest path=${holon}/${lens} key=${key}. Stack:\n${__st}`);
                }
                return;
            }
            // Check if subscription ID still exists (might have been unsubscribed)
            if (!holoInstance.subscriptions[subscriptionId]) {
                return;
            }

            if (data) {
                try {
                    let parsed = await holoInstance.parse(data);
                    if (parsed && holoInstance.isHologram(parsed)) {
                        const hologramSoul = parsed.soul;
                        const res = await holoInstance.resolveHologramDetailed(parsed, { followHolograms: true });
                        if (res.status === 'deleted') {
                            // The source was soft-deleted (_deleted:true) — a
                            // DEFINITIVE removal. Notify consumers the item is
                            // gone, exactly like a local tombstone. This is the
                            // payoff of typed resolution: a deleted federated
                            // source now propagates as a deletion to the live UI
                            // instead of silently lingering. Also emit the
                            // janitor-parseable line so the dead pointer is GC'd.
                            console.warn(`Hologram at ${holon}/${lens}/${key} did not resolve (soul=${hologramSoul}); skipping.`);
                            if (holoInstance.subscriptions[subscriptionId]) {
                                callback(null, key);
                            }
                            return;
                        }
                        if (res.status !== 'resolved') {
                            // Transient (unresolved/error) or structural
                            // (circular/depth/invalid). Emit the SAME
                            // janitor-parseable warning `get`/`getAll` emit — it
                            // carries the LOCAL pointer (holon/lens/key) a cleaner
                            // needs, which `resolveHologram`'s own source-soul log
                            // does not. Unlike a deletion we do NOT emit a removal:
                            // a transient miss must not flicker the item out of a
                            // live view; it stays until it resolves or is GC'd.
                            console.warn(`Hologram at ${holon}/${lens}/${key} did not resolve (soul=${hologramSoul}); skipping.`);
                            return;
                        }
                        if (res.data !== parsed) {
                            parsed = res.data;
                        }
                    }

                    // Subscribers expect `object | null`. `parse()` can return
                    // a string/number/boolean when a legacy or corrupted leaf
                    // happened to be a JSON-encoded primitive (e.g.
                    // `'"hello"'` parses to `'hello'`). Drop those so every
                    // consumer can stop guarding with
                    // `typeof x === 'string' ? JSON.parse(x) : x`.
                    if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
                        console.warn(`[holosphere.subscribe] dropping non-object payload at ${holon}/${lens}/${key}:`, typeof parsed);
                        return;
                    }

                    // Check again if subscription ID still exists before calling callback
                    if (holoInstance.subscriptions[subscriptionId]) {
                        callback(parsed, key);
                    }
                } catch (error) {
                    console.error('Error processing subscribed data:', error);
                }
            } else if (includeDeletes && key && key !== '_' && holoInstance.subscriptions[subscriptionId]) {
                // delete / tombstone — notify consumers the item is gone
                callback(null, key);
            }
        });

        // Store the subscription with its ID on the instance
        holoInstance.subscriptions[subscriptionId] = {
            id: subscriptionId,
            holon,
            lens,
            callback,
            mapChain,
            gunListener,
            groupKey,
        };

        // Return an object with unsubscribe method.
        // `unsubscribe` is sync — nothing it does (`mapChain.off()`,
        // `delete subscriptions[id]`) blocks. Keeping it sync means the
        // returned shape is `{ unsubscribe: () => void }` rather than
        // `() => Promise<void>`, matching what callers expect when they
        // store it in a `() => void` cleanup slot.
        return {
            unsubscribe: () => {
                const sub = holoInstance.subscriptions[subscriptionId];
                if (!sub) {
                    return;
                }

                try {
                    // Turn off THIS subscriber's own Gun listener.
                    if (sub.mapChain) {
                        sub.mapChain.off();
                    }

                    // Drop it from the per-path counter (for the leak warnings).
                    const g = holoInstance._subscriptionGroups &&
                        holoInstance._subscriptionGroups.get(groupKey);
                    if (g) {
                        g.ids.delete(subscriptionId);
                        if (g.ids.size === 0) {
                            holoInstance._subscriptionGroups.delete(groupKey);
                        }
                    }

                    // Remove from subscriptions object AFTER turning off listener
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
        if (holoInstance.gun) {
            // Unsubscribe from all subscriptions
            const subscriptionIds = Object.keys(holoInstance.subscriptions);
            for (const id of subscriptionIds) {
                try {
                    const subscription = holoInstance.subscriptions[id];
                    if (subscription) {
                        // Turn off the Gun subscription using the stored mapChain reference
                        if (subscription.mapChain) {
                            subscription.mapChain.off();
                        } // Also turn off listener directly? Might be redundant.
                        // if (subscription.gunListener) {
                        //     subscription.gunListener.off();
                        // }
                    }
                } catch (error) {
                    console.warn(`Error cleaning up subscription ${id}:`, error);
                }
            }

            // Clear subscriptions (the loop above already `.off()`'d the
            // shared map chains) and drop the dedup registry so a reopened
            // instance starts with zero listener groups.
            holoInstance.subscriptions = {};
            if (holoInstance._subscriptionGroups) {
                holoInstance._subscriptionGroups.clear();
            }

            // Clear schema cache using instance method
            holoInstance.clearSchemaCache();

            // Close Gun connections
            if (holoInstance.gun.back) {
                try {
                    // Clean up mesh connections
                    const mesh = holoInstance.gun.back('opt.mesh');
                    if (mesh) {
                        // Clean up mesh.hear
                        if (mesh.hear) {
                            try {
                                // Safely clear mesh.hear without modifying function properties
                                const hearKeys = Object.keys(mesh.hear);
                                for (const key of hearKeys) {
                                    // Check if it's an array before trying to clear it
                                    if (Array.isArray(mesh.hear[key])) {
                                        mesh.hear[key] = [];
                                    }
                                }

                                // Create a new empty object for mesh.hear
                                // Only if mesh.hear is not a function
                                if (typeof mesh.hear !== 'function') {
                                    mesh.hear = {};
                                }
                            } catch (meshError) {
                                console.warn('Error cleaning up Gun mesh hear:', meshError);
                            }
                        }

                        // Close any open sockets in the mesh
                        if (mesh.way) {
                            try {
                                Object.values(mesh.way).forEach(connection => {
                                    if (connection && connection.wire && connection.wire.close) {
                                        connection.wire.close();
                                    }
                                });
                            } catch (sockError) {
                                console.warn('Error closing mesh sockets:', sockError);
                            }
                        }

                        // Clear the peers list
                        if (mesh.opt && mesh.opt.peers) {
                            mesh.opt.peers = {};
                        }
                    }

                    // Attempt to clean up any TCP connections
                    if (holoInstance.gun.back('opt.web')) {
                        try {
                            const server = holoInstance.gun.back('opt.web');
                            if (server && server.close) {
                                server.close();
                            }
                        } catch (webError) {
                            console.warn('Error closing web server:', webError);
                        }
                    }
                } catch (error) {
                    console.warn('Error accessing Gun mesh:', error);
                }
            }

            // Clear all Gun instance listeners
            try {
                holoInstance.gun.off();
            } catch (error) {
                console.warn('Error turning off Gun listeners:', error);
            }

            // Wait a moment for cleanup to complete
            await new Promise(resolve => setTimeout(resolve, 100));
        }

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