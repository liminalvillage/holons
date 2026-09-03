/**
 * Federation functionality for HoloSphere
 * Provides methods for creating, managing, and using federated spaces
 */

import * as h3 from 'h3-js';
import { parseSoulPath } from './hologram.js';

/**
 * Look up a holon's display name from its `settings` lens.
 *
 * Returns the `name` field of the holon's settings document, or null if
 * settings are missing or unnamed. Callers should fall back to the bare
 * holon id when this returns null.
 *
 * @param {HoloSphere} holosphere
 * @param {string} space - holon id
 * @returns {Promise<string|null>}
 */
async function getHolonName(holosphere, space) {
    if (!holosphere || !space) return null;
    try {
        const settings = await holosphere.get(space, 'settings', space);
        if (!settings) return null;
        if (Array.isArray(settings)) {
            const found = settings.find(s => s && typeof s.name === 'string' && s.name.trim() !== '');
            return found ? found.name : null;
        }
        if (typeof settings.name === 'string' && settings.name.trim() !== '') {
            return settings.name;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Creates a directional federation relationship between two spaces.
 *
 * Directions are stated from spaceId1's perspective:
 *  - `lensConfig.inbound`: lenses spaceId1 receives FROM spaceId2.
 *  - `lensConfig.outbound`: lenses spaceId1 sends TO spaceId2.
 *
 * When `bidirectional` is true (default), spaceId2's record is mirrored with
 * inverted directions so it agrees with the relationship from its own view.
 *
 * @param {object} holosphere - The HoloSphere instance
 * @param {string} spaceId1 - The first space ID
 * @param {string} spaceId2 - The second space ID
 * @param {string} [password1] - Optional password for the first space
 * @param {string} [password2] - Optional password for the second space
 * @param {boolean} [bidirectional=true] - Mirror the relationship onto spaceId2
 * @param {object} [lensConfig] - Lens-direction config from spaceId1's perspective
 * @param {string[]} [lensConfig.inbound]  - Lenses spaceId1 receives from spaceId2
 * @param {string[]} [lensConfig.outbound] - Lenses spaceId1 sends to spaceId2
 * @returns {Promise<boolean>} - True if federation was created successfully
 */
export async function federate(holosphere, spaceId1, spaceId2, password1 = null, password2 = null, bidirectional = true, lensConfig = {}) {
    if (!spaceId1 || !spaceId2) {
        throw new Error('federate: Missing required space IDs');
    }
    if (spaceId1 === spaceId2) {
        throw new Error('Cannot federate a space with itself');
    }

    const { inbound = [], outbound = [] } = lensConfig;
    if (!Array.isArray(inbound) || !Array.isArray(outbound)) {
        throw new Error('federate: lensConfig.inbound and lensConfig.outbound must be arrays');
    }

    const applyDirection = (fedInfo, partnerId, partnerInbound, partnerOutbound) => {
        if (!fedInfo.federated) fedInfo.federated = [];
        if (!fedInfo.inbound)   fedInfo.inbound   = [];
        if (!fedInfo.outbound)  fedInfo.outbound  = [];
        if (!fedInfo.lensConfig) fedInfo.lensConfig = {};

        // `federated` is the canonical list — partner is recorded regardless of
        // whether any lenses flow yet.
        if (!fedInfo.federated.includes(partnerId)) {
            fedInfo.federated.push(partnerId);
        }

        const hasInbound  = partnerInbound.length  > 0;
        const hasOutbound = partnerOutbound.length > 0;

        if (hasInbound && !fedInfo.inbound.includes(partnerId)) {
            fedInfo.inbound.push(partnerId);
        } else if (!hasInbound) {
            fedInfo.inbound = fedInfo.inbound.filter(id => id !== partnerId);
        }
        if (hasOutbound && !fedInfo.outbound.includes(partnerId)) {
            fedInfo.outbound.push(partnerId);
        } else if (!hasOutbound) {
            fedInfo.outbound = fedInfo.outbound.filter(id => id !== partnerId);
        }

        fedInfo.lensConfig[partnerId] = {
            inbound:  [...partnerInbound],
            outbound: [...partnerOutbound],
            timestamp: Date.now()
        };
        fedInfo.timestamp = Date.now();
    };

    try {
        // Space 1: directions as given.
        let fedInfo1 = null;
        try { fedInfo1 = await holosphere.getGlobal('federation', spaceId1, password1); } catch {}
        if (fedInfo1 == null) {
            fedInfo1 = {
                id: spaceId1, name: spaceId1,
                federated: [], inbound: [], outbound: [],
                lensConfig: {}, partnerNames: {},
                timestamp: Date.now()
            };
        }
        applyDirection(fedInfo1, spaceId2, inbound, outbound);

        try {
            await holosphere.putGlobal('federation', fedInfo1, password1);
        } catch (error) {
            throw new Error(`Failed to create federation: ${error.message}`);
        }

        // Space 2 (mirrored): directions are inverted from its perspective.
        if (bidirectional) {
            let fedInfo2 = null;
            try { fedInfo2 = await holosphere.getGlobal('federation', spaceId2, password2); } catch {}
            if (fedInfo2 == null) {
                fedInfo2 = {
                    id: spaceId2, name: spaceId2,
                    federated: [], inbound: [], outbound: [],
                    lensConfig: {}, partnerNames: {},
                    timestamp: Date.now()
                };
            }
            // From spaceId2's view, spaceId1's outbound lenses arrive as inbound,
            // and spaceId1's inbound lenses go out as outbound.
            applyDirection(fedInfo2, spaceId1, outbound, inbound);

            try {
                await holosphere.putGlobal('federation', fedInfo2, password2);
            } catch {}
        }

        return true;
    } catch (error) {
        throw error;
    }
}

/**
 * Subscribes to federation notifications for a space
 * @param {object} holosphere - The HoloSphere instance
 * @param {string} spaceId - The space ID to subscribe to
 * @param {string} [password] - Optional password for the space
 * @param {function} callback - The callback to execute on notifications
 * @param {object} [options] - Subscription options
 * @param {string[]} [options.lenses] - Specific lenses to subscribe to (default: all)
 * @param {number} [options.throttle] - Throttle notifications in ms (default: 0)
 * @returns {Promise<object>} - Subscription object with unsubscribe() method
 */
export async function subscribeFederation(holosphere, spaceId, password = null, callback, options = {}) {
    if (!spaceId || !callback) {
        throw new Error('subscribeFederation: Missing required parameters');
    }

    const { lenses = ['*'], throttle = 0 } = options;
    
    // Get federation info
    const fedInfo = await holosphere.getGlobal('federation', spaceId, password);
    if (!fedInfo) {
        throw new Error('No federation info found for space');
    }

    // Create subscription for each federated space
    const subscriptions = [];
    let lastNotificationTime = {};
    
    // Cache partner display names once at setup. Each callback firing for
    // a given partner uses the same name without re-reading settings.
    const partnerNames = new Map();

    if (fedInfo.inbound && fedInfo.inbound.length > 0) {
        await Promise.all(
            fedInfo.inbound.map(async space => {
                const name = await getHolonName(holosphere, space);
                partnerNames.set(space, name);
            })
        );

        for (const federatedSpace of fedInfo.inbound) {
            // For each lens specified (or all if '*')
            for (const lens of lenses) {
                try {
                    const sub = await holosphere.subscribe(federatedSpace, lens, async (data) => {
                        try {
                            // Skip if data is missing or not from federated space
                            if (!data || !data.id) return;

                            // Apply throttling if configured
                            const now = Date.now();
                            const key = `${federatedSpace}_${lens}_${data.id}`;

                            if (throttle > 0) {
                                if (lastNotificationTime[key] &&
                                    (now - lastNotificationTime[key]) < throttle) {
                                    return; // Skip this notification (throttled)
                                }
                                lastNotificationTime[key] = now;
                            }

                            // Add federation metadata if not present.
                            // Use the canonical `_federation` envelope so it
                            // matches what propagate() and getFederated()
                            // produce, and what consumers (UI badges, etc.)
                            // already check for.
                            if (!data._federation) {
                                const partnerName = partnerNames.get(federatedSpace);
                                data._federation = {
                                    origin: federatedSpace,
                                    sourceLens: lens,
                                    timestamp: now,
                                    ...(partnerName ? { originName: partnerName } : {})
                                };
                            }

                            // Execute callback with the data
                            await callback(data, federatedSpace, lens);
                        } catch (error) {
                        }
                    });
                    
                    if (sub && typeof sub.unsubscribe === 'function') {
                        subscriptions.push(sub);
                    }
                } catch (error) {
                }
            }
        }
    }

    // Return combined subscription object
    return {
        unsubscribe: () => {
            subscriptions.forEach(sub => {
                try {
                    if (sub && typeof sub.unsubscribe === 'function') {
                        sub.unsubscribe();
                    }
                } catch (error) {
                }
            });
            // Clear the subscriptions array
            subscriptions.length = 0;
            // Clear throttling data
            lastNotificationTime = {};
        },
        getSubscriptionCount: () => subscriptions.length
    };
}

/**
 * Gets federation info for a space
 * @param {object} holosphere - The HoloSphere instance
 * @param {string} spaceId - The space ID
 * @param {string} [password] - Optional password for the space
 * @returns {Promise<object|null>} - Federation info or null if not found
 */
export async function getFederation(holosphere, spaceId, password = null) {
    if (!spaceId) {
        throw new Error('getFederation: Missing space ID');
    }
    return await holosphere.getGlobal('federation', spaceId, password);
}

/**
 * Retrieves the lens-specific configuration for a federation link between two spaces.
 * @param {object} holosphere - The HoloSphere instance
 * @param {string} spaceId - The ID of the source space.
 * @param {string} targetSpaceId - The ID of the target space in the federation link.
 * @param {string} [password] - Optional password for the source space.
 * @returns {Promise<object|null>} - An object with 'inbound' and 'outbound' arrays, or null if not found.
 */
export async function getFederatedConfig(holosphere, spaceId, targetSpaceId, password = null) {
    if (!holosphere || !spaceId || !targetSpaceId) {
        throw new Error('getFederatedConfig: Missing required parameters');
    }

    try {
        const fedInfo = await getFederation(holosphere, spaceId, password);

        if (fedInfo && fedInfo.lensConfig && fedInfo.lensConfig[targetSpaceId]) {
            return {
                inbound:  fedInfo.lensConfig[targetSpaceId].inbound  || [],
                outbound: fedInfo.lensConfig[targetSpaceId].outbound || []
            };
        }
        return null;
    } catch (error) {
        console.error(`Error getting federated config for ${spaceId} -> ${targetSpaceId}: ${error.message}`);
        throw error;
    }
}

/**
 * Removes a federation relationship between spaces
 * @param {object} holosphere - The HoloSphere instance
 * @param {string} spaceId1 - The first space ID
 * @param {string} spaceId2 - The second space ID
 * @param {string} [password1] - Optional password for the first space
 * @param {string} [password2] - Optional password for the second space
 * @returns {Promise<boolean>} - True if federation was removed successfully
 */
export async function unfederate(holosphere, spaceId1, spaceId2, password1 = null, password2 = null) {
    if (!spaceId1 || !spaceId2) {
        throw new Error('unfederate: Missing required space IDs');
    }

    try {
        // Get federation info for first space
        let fedInfo1 = null;
        try {
            fedInfo1 = await holosphere.getGlobal('federation', spaceId1, password1);
        } catch (error) {
            console.error(`Error getting fedInfo1 for ${spaceId1} during unfederate: ${error.message}`);
            // If we can't get fedInfo1, we can't modify it. Decide if this is a critical failure.
            // For now, we'll let it proceed to attempt metadata cleanup, but a throw here might be valid.
        }
        
        if (!fedInfo1) {
            console.warn(`No federation info found for ${spaceId1}. Skipping its update.`);
        } else {
            if (!fedInfo1.federated) fedInfo1.federated = [];
            if (!fedInfo1.inbound)   fedInfo1.inbound   = [];
            if (!fedInfo1.outbound)  fedInfo1.outbound  = [];
            if (!fedInfo1.lensConfig) fedInfo1.lensConfig = {};
            if (!fedInfo1.partnerNames) fedInfo1.partnerNames = {};

            const beforeIn  = fedInfo1.inbound.length;
            const beforeOut = fedInfo1.outbound.length;

            fedInfo1.federated = fedInfo1.federated.filter(id => id !== spaceId2);
            fedInfo1.inbound   = fedInfo1.inbound.filter(id => id !== spaceId2);
            fedInfo1.outbound  = fedInfo1.outbound.filter(id => id !== spaceId2);
            delete fedInfo1.lensConfig[spaceId2];
            delete fedInfo1.partnerNames[spaceId2];
            fedInfo1.timestamp = Date.now();

            console.log(`Unfederate: removed ${spaceId2} from ${spaceId1}: inbound ${beforeIn} -> ${fedInfo1.inbound.length}, outbound ${beforeOut} -> ${fedInfo1.outbound.length}`);

            try {
                await holosphere.putGlobal('federation', fedInfo1, password1);
            } catch (error) {
                console.error(`Failed to update fedInfo1 for ${spaceId1} during unfederate: ${error.message}`);
                throw error;
            }
        }

        // Mirror the removal on space2 — federate() records the link on BOTH
        // sides (even with null passwords), so removal must mirror too or the
        // partner's record keeps pointing back forever. Best-effort: if
        // space2's record is password-protected and we don't hold the
        // password, the local removal above still stands.
        {
            let fedInfo2 = null;
            try {
                fedInfo2 = await holosphere.getGlobal('federation', spaceId2, password2);
            } catch (error) {
                console.error(`Error getting fedInfo2 for ${spaceId2} during unfederate: ${error.message}`);
            }

            if (!fedInfo2) {
                console.warn(`No federation info found for ${spaceId2}. Skipping its update.`);
            } else {
                if (!fedInfo2.federated) fedInfo2.federated = [];
                if (!fedInfo2.inbound)   fedInfo2.inbound   = [];
                if (!fedInfo2.outbound)  fedInfo2.outbound  = [];
                if (!fedInfo2.lensConfig) fedInfo2.lensConfig = {};
                if (!fedInfo2.partnerNames) fedInfo2.partnerNames = {};

                fedInfo2.federated = fedInfo2.federated.filter(id => id !== spaceId1);
                fedInfo2.inbound   = fedInfo2.inbound.filter(id => id !== spaceId1);
                fedInfo2.outbound  = fedInfo2.outbound.filter(id => id !== spaceId1);
                delete fedInfo2.lensConfig[spaceId1];
                delete fedInfo2.partnerNames[spaceId1];
                fedInfo2.timestamp = Date.now();

                try {
                    await holosphere.putGlobal('federation', fedInfo2, password2);
                } catch (error) {
                    // Best-effort: the local removal succeeded; don't fail the
                    // whole unfederate over the partner-side mirror.
                    console.error(`Failed to update fedInfo2 for ${spaceId2} during unfederate: ${error.message}`);
                }
            }
        }

        // Update federation metadata
        const metaId = `${spaceId1}_${spaceId2}`;
        const altMetaId = `${spaceId2}_${spaceId1}`;
        
        try {
            const meta = await holosphere.getGlobal('federationMeta', metaId) || 
                         await holosphere.getGlobal('federationMeta', altMetaId);
            
            if (meta) {
                meta.status = 'inactive';
                meta.endedAt = Date.now();
                await holosphere.putGlobal('federationMeta', meta); // Not re-throwing here as it's metadata cleanup
            }
        } catch (error) {
            console.warn(`Failed to update federationMeta during unfederate: ${error.message}`);
        }

        return true;
    } catch (error) {
        // This will catch errors re-thrown from putGlobal or from getGlobal if they occur before specific catches.
        console.error(`Critical error during unfederate operation for ${spaceId1}-${spaceId2}: ${error.message}`);
        throw error; // Ensure the main operation failure is propagated
    }
}

/**
 * Stops outbound propagation from spaceId1 to spaceId2.
 * Removes spaceId2 from spaceId1's `outbound` list and clears the outbound
 * lens config for that partner. Inbound subscriptions are untouched.
 *
 * @param {object} holosphere - The HoloSphere instance
 * @param {string} spaceId1 - The space to modify
 * @param {string} spaceId2 - The partner to stop sending to
 * @param {string} [password1] - Optional password for the first space
 * @returns {Promise<boolean>} - True if outbound was removed
 */
export async function removeNotify(holosphere, spaceId1, spaceId2, password1 = null) {
    if (!spaceId1 || !spaceId2) {
        throw new Error('removeNotify: Missing required space IDs');
    }

    try {
        const fedInfo = await holosphere.getGlobal('federation', spaceId1, password1);
        if (!fedInfo) {
            throw new Error(`No federation info found for ${spaceId1}`);
        }
        if (!fedInfo.outbound) fedInfo.outbound = [];

        if (!fedInfo.outbound.includes(spaceId2)) return false;

        fedInfo.outbound = fedInfo.outbound.filter(id => id !== spaceId2);
        if (fedInfo.lensConfig?.[spaceId2]) {
            fedInfo.lensConfig[spaceId2].outbound = [];
        }
        fedInfo.timestamp = Date.now();

        await holosphere.putGlobal('federation', fedInfo, password1);
        return true;
    } catch (error) {
        throw error;
    }
}

/**
 * Get and combine data from local and federated sources.
 * If `options.queryIds` is provided, fetches only those specific IDs using `get()`.
 * Otherwise, falls back to fetching all data using `getAll()` (potentially inefficient).
 * 
 * @param {HoloSphere} holosphere The HoloSphere instance
 * @param {string} holon The local holon name (used as the space ID for federation info)
 * @param {string} lens The lens to query
 * @param {Object} options Options for data retrieval and aggregation
 * @param {string[]} [options.queryIds] Optional array of specific item IDs to fetch.
 * @param {boolean} [options.aggregate=false] Whether to aggregate results by ID
 * @param {string} [options.idField='id'] The field to use as ID
 * @param {string[]} [options.sumFields=[]] Fields to sum during aggregation
 * @param {string[]} [options.concatArrays=[]] Array fields to concatenate during aggregation
 * @param {boolean} [options.removeDuplicates=true] Whether to remove duplicates in concatenated arrays
 * @param {Function} [options.mergeStrategy=null] Custom merge function for aggregation
 * @param {boolean} [options.includeLocal=true] Whether to include local data
 * @param {boolean} [options.includeFederated=true] Whether to include federated data
 * @param {boolean} [options.resolveReferences=true] Whether to resolve federation references
 * @param {number} [options.maxFederatedSpaces=-1] Maximum number of federated spaces to query (-1 for all)
 * @param {number} [options.timeout=10000] Timeout in milliseconds for federated queries
 * @returns {Promise<Array>} Combined array of local and federated data
 */
export async function getFederated(holosphere, holon, lens, options = {}) {
    // Set default options and extract queryIds
    const {
        queryIds = null, // New option
        aggregate = false,
        idField = 'id',
        sumFields = [],
        concatArrays = [],
        removeDuplicates = true,
        mergeStrategy = null,
        includeLocal = true,
        includeFederated = true,
        resolveReferences = true,
        maxFederatedSpaces = -1,
        timeout = 10000,
        // When `resolveReferences` is on, source-soul fetches that fail get
        // replaced with `{ id, _hologram: { isHologram: false, error } }`
        // error stubs (federation.js around line 654). By default we filter
        // those out of the response so consumers never render broken-card
        // placeholders. Set `includeUnresolvedStubs: true` if you actually
        // want to surface the failure to the user (e.g. an admin/debug view).
        includeUnresolvedStubs = false,
        // Provenance-annotated dual-source read (signing shadow/enforce only):
        // surface unsigned items tagged `_unverified` instead of dropping them
        // under enforce, so a UI can gate them exactly like the local
        // subscribe path. No-op when signing is off. Display-only — NEVER
        // trust `_unverified` items for auth.
        includeUnverified = false
    } = options;
    
    console.log(`resolveReferences option: ${resolveReferences}`);
    console.log(`Querying specific IDs:`, queryIds ? queryIds.join(', ') : 'No (fetching all)');

    // Validate required parameters
    if (!holosphere || !holon || !lens) {
        throw new Error('Missing required parameters: holosphere, holon, and lens are required');
    }

    // Get federation info for current space (using holon as spaceId)
    const spaceId = holon;
    const fedInfo = await getFederation(holosphere, spaceId);
    
    // Initialize result array and track processed IDs to avoid duplicates/redundant fetches
    const fetchedItems = new Map(); // Use Map to store fetched items by ID
    const processedIds = new Set(); // Track IDs added to the final result

    const fetchPromises = [];

    // Determine list of spaces to query (local + federated)
    let spacesToQuery = [];
    if (includeLocal) {
        spacesToQuery.push(holon); // Add local holon first
    }
    if (includeFederated && fedInfo && fedInfo.inbound && fedInfo.inbound.length > 0) {
        // Federation is directional AND per-lens: a partner only contributes
        // `lens` when WE configured that lens as inbound (receiving) from them
        // in `lensConfig[partner].inbound`. `fedInfo.inbound` alone is just
        // partner-level ("receives SOME lens"), so querying it directly would
        // pull lenses we never opted into from that partner. Filter per-lens.
        const lensConfig = fedInfo.lensConfig || {};
        const receiving = fedInfo.inbound.filter(space => {
            const inboundLenses = lensConfig[space] && lensConfig[space].inbound;
            return Array.isArray(inboundLenses) && inboundLenses.includes(lens);
        });
        const federatedSpaces = maxFederatedSpaces === -1 ? receiving : receiving.slice(0, maxFederatedSpaces);
        spacesToQuery = spacesToQuery.concat(federatedSpaces);
    }

    // Resolve display names for federated partner spaces in parallel, so
    // every tagged item can carry the holon's name. Compute once per call.
    const remoteSpaces = spacesToQuery.filter(s => s !== holon);
    const spaceNames = new Map();
    await Promise.all(
        remoteSpaces.map(async space => {
            const name = await getHolonName(holosphere, space);
            spaceNames.set(space, name);
        })
    );

    // Tag items pulled from a federated partner with the space they came
    // from (and its resolved display name, if any). Local items are left
    // untouched so consumers can distinguish own vs. external by absence
    // or presence of `_federation`.
    const tagWithSource = (item, space) => {
        if (!item || space === holon) return item;
        const originName = spaceNames.get(space);
        const fed = {
            ...(item._federation || {}),
            origin: space,
            sourceLens: lens
        };
        if (originName) fed.originName = originName;
        return { ...item, _federation: fed };
    };

    // Fetch data from all relevant spaces
    for (const currentSpace of spacesToQuery) {
        if (queryIds && Array.isArray(queryIds)) {
            // --- Fetch specific IDs using holosphere.get ---
            console.log(`Fetching specific IDs from ${currentSpace}: ${queryIds.join(', ')}`);
            for (const itemId of queryIds) {
                if (fetchedItems.has(itemId)) continue; // Skip if already fetched
                fetchPromises.push(
                    holosphere.get(currentSpace, lens, itemId)
                        .then(item => {
                            if (item) {
                                fetchedItems.set(itemId, tagWithSource(item, currentSpace));
                            }
                        })
                        .catch(err => console.warn(`Error fetching item ${itemId} from ${currentSpace}: ${err.message}`))
                );
            }
        } else {
            // --- Fetch all data using holosphere.getAll (Fallback - inefficient) ---
            if(currentSpace === holon && includeLocal) { // Only warn once for local
                 console.warn(`getFederated: No queryIds provided. Falling back to fetching ALL items from ${currentSpace} using getAll. This can be inefficient.`);
            }
            console.log(`Fetching ALL items from ${currentSpace}`);
            // Only surface tagged `_unverified` rows under enforce — mirrors the
            // local subscribe path (QueryManager passes includeUnverified:
            // enforceActive). In shadow/off, getAll already returns raw rows
            // unchanged, so the caller's "show all data" toggle is a no-op there
            // just like locally; we must not change shadow-mode read output.
            const wantUnverified = includeUnverified && !!holosphere.enforceActive;
            fetchPromises.push(
                holosphere.getAll(currentSpace, lens, null, { includeUnverified: wantUnverified })
                    .then(items => {
                        for (const item of items) {
                            if (item && item[idField] && !fetchedItems.has(item[idField])) {
                                fetchedItems.set(item[idField], tagWithSource(item, currentSpace));
                            }
                        }
                    })
                    .catch(err => console.warn(`Error fetching all items from ${currentSpace}: ${err.message}`))
            );
        }
    }

    // Wait for all fetches to complete
    await Promise.all(fetchPromises);

    // Convert Map values to array for processing
    const result = Array.from(fetchedItems.values());

    // Now resolve references if needed
    if (resolveReferences && result.length > 0) {
        console.log(`Resolving references for ${result.length} fetched items`);
        
        for (let i = 0; i < result.length; i++) {
            const item = result[i];
            
            // Check for simplified reference (item with id and soul)
            if (item.soul && item.id) {
                console.log(`Found simple reference with soul: ${item.soul}`);
                
                try {
                    // Resolve via the typed resolver: it reads the source with
                    // includeDeleted + awaitNetwork, so we can distinguish a
                    // DELETED reference from a transient miss, and it already
                    // stamps the canonical _hologram envelope incl. sourceHolonName.
                    const res = await holosphere.resolveHologramDetailed(
                        { id: item.id, soul: item.soul },
                        { followHolograms: true }
                    );

                    if (res.status === 'resolved') {
                        result[i] = res.data;
                    } else {
                        // Replace the reference with an error stub recording WHY it
                        // failed. `_hologram.isHologram === false` is the marker
                        // getFederated filters out by default (see
                        // includeUnresolvedStubs); `status`/`deleted` let opted-in
                        // callers tell a removed reference from a transient one.
                        const errorByStatus = {
                            deleted: 'Referenced data deleted',
                            unresolved: 'Referenced data not found',
                            invalid: 'Invalid soul format',
                            circular: 'Circular reference',
                            depth: 'Reference chain too deep',
                            error: res.reason || 'Error resolving reference',
                        };
                        result[i] = {
                            id: item.id,
                            _hologram: {
                                isHologram: false,
                                soul: item.soul,
                                status: res.status,
                                deleted: res.status === 'deleted',
                                error: errorByStatus[res.status] || 'Unresolved reference',
                                resolvedAt: Date.now()
                            }
                        };
                    }
                } catch (refError) {
                    result[i] = {
                        id: item.id,
                        _hologram: {
                            isHologram: false,
                            soul: item.soul,
                            status: 'error',
                            error: refError.message || 'Error resolving reference',
                            resolvedAt: Date.now()
                        }
                    };
                }
            }
        }
    }
    
    // Apply aggregation if requested
    if (aggregate && result.length > 0) {
        // Group items by ID
        const groupedById = result.reduce((acc, item) => {
            const id = item[idField];
            if (!acc[id]) {
                acc[id] = [];
            }
            acc[id].push(item);
            return acc;
        }, {});
        
        // Aggregate each group
        const aggregatedData = Object.values(groupedById).map(group => {
            // If only one item in group, no aggregation needed
            if (group.length === 1) return group[0];
            
            // Use custom merge strategy if provided
            if (mergeStrategy && typeof mergeStrategy === 'function') {
                return mergeStrategy(group);
            }
            
            // Default aggregation strategy
            const base = { ...group[0] };
            
            // Sum numeric fields
            for (const field of sumFields) {
                if (typeof base[field] === 'number') {
                    base[field] = group.reduce((sum, item) => sum + (Number(item[field]) || 0), 0);
                }
            }
            
            // Concatenate array fields
            for (const field of concatArrays) {
                if (Array.isArray(base[field])) {
                    const allValues = group.reduce((all, item) => {
                        return Array.isArray(item[field]) ? [...all, ...item[field]] : all;
                    }, []);
                    
                    // Remove duplicates if requested
                    base[field] = removeDuplicates ? Array.from(new Set(allValues)) : allValues;
                }
            }
            
            // Add aggregation metadata
            base._aggregated = {
                count: group.length,
                timestamp: Date.now()
            };

            return base;
        });

        return includeUnresolvedStubs ? aggregatedData : aggregatedData.filter(isResolved);
    }

    return includeUnresolvedStubs ? result : result.filter(isResolved);
}

/**
 * True for any record that isn't an unresolved-reference error stub.
 *
 * `getFederated` produces stubs of the shape
 * `{ id, _hologram: { isHologram: false, error, ... } }` when a source
 * soul can't be resolved (peer offline, federation in flight, etc.).
 * Default response now filters those out so consumers don't render
 * broken-card placeholders.
 */
function isResolved(item) {
    if (!item || typeof item !== 'object') return false;
    return item._hologram?.isHologram !== false;
}

// subscribeFederated's federation-config read is a point-in-time get():
// on a cold store (fresh page load, nothing synced) it can resolve null before
// the relay has synced the config node, and a single failed read would
// silently attach ZERO partners for the life of the subscription. Retry on
// this ladder (delays before attempts 2..n) until the config shows up.
const FEDERATION_CONFIG_RETRY_MS = [1000, 3000, 8000];

// Delays before re-reading a propagation target that came back empty. A cold
// `get` loses the race against the relay, and mistaking that for an empty slot
// is precisely how a propagated copy overwrites a real record. Kept to ONE
// retry: this runs per target, and an ancestry walk has nine of them, so a
// longer ladder costs seconds on the overwhelmingly common empty-slot path.
const PROPAGATE_READ_RETRY_MS = [0, 500];

/**
 * Live federated read — the streaming equivalent of {@link getFederated}.
 *
 * Subscribes to `lens` on `holon` AND on every partner that `holon` *receives*
 * `lens` from (per-lens inbound direction, identical to getFederated's space
 * selection — NOT the coarse partner-level `inbound`, which would pull lenses we
 * never opted into). Partner items are stamped with the canonical `_federation`
 * envelope (`{ origin, sourceLens, originName }`); the holon's own items are left
 * untagged so consumers tell own-vs-external by its presence. `callback(items)`
 * fires after every change with a fresh, id-deduped snapshot — on an id
 * collision across spaces the LOCAL item wins (a holon's own record shadows a
 * partner's), matching getFederated's local-first `Map` fill.
 *
 * This is the one place federation fan-out lives for live reads, so a UI can
 * `subscribeFederated(...)` once instead of re-implementing partner aggregation
 * (and re-inventing a provenance tag) itself.
 *
 * That cross-space collapse assumes an id identifies a RECORD, not a record
 * within a holon. For a lens whose ids are only holon-local — `checklists`,
 * whose id IS the list's name, so the special `agenda`/`shopping` lists exist
 * under that exact id in EVERY holon — pass `dedupeAcrossSpaces: false`. A
 * partner's same-named record then survives instead of being shadowed by ours,
 * and the consumer keys them by origin.
 *
 * It still collapses a partner record that our own copy provably came FROM
 * (see {@link isCopyOfPartnerRecord}) — otherwise a holon that both receives
 * pushed copies (outbound propagation) and aggregates live shows every such
 * list twice. Records are always deduped WITHIN a space (the store is keyed
 * `${space} ${id}`).
 *
 * The federation config is read at setup (with a short retry ladder — a cold
 * store's first read loses the race against the relay handshake
 * and returns null; see FEDERATION_CONFIG_RETRY_MS): the local subscription
 * attaches synchronously and partner subscriptions attach after that async read
 * resolves. A federation link added/removed at runtime is still not picked up
 * live — resubscribe to pick up a changed partner set (callers already do this
 * on a holon/toggle change).
 *
 * @param {object} holosphere - The HoloSphere instance.
 * @param {string} holon - The viewing holon.
 * @param {string} lens - The lens to aggregate.
 * @param {(items: object[]) => void} callback - Fired with a deduped snapshot.
 * @param {object} [options]
 * @param {boolean} [options.includeLocal=true] - Include the holon's own items.
 * @param {boolean} [options.includeFederated=true] - Fold in inbound partners.
 * @param {boolean} [options.dedupe=true] - Collapse cross-space id collisions (local wins).
 * @param {boolean} [options.dedupeAcrossSpaces=true] - False when ids are only holon-unique:
 *   keep a partner's same-named record instead of letting ours shadow it. Partner
 *   records our own copy came from are still collapsed.
 * @param {string} [options.idField='id'] - Field used as the item id.
 * @param {number} [options.maxFederatedSpaces=-1] - Cap partner count (-1 = all).
 * @returns {{ unsubscribe: () => void }} - Handle; tears down every sub-subscription.
 */
/**
 * Whether `local` — a record stored in the viewing holon — is a COPY of the
 * partner's `remote` record rather than an independently authored record that
 * merely shares its id.
 *
 * Two signals, because the first one erodes:
 *   • Propagation stamps the copy it writes with `_federation.origin` (via the
 *     internal `preserveFederationMeta` flag). That's the authoritative mark.
 *   • But an ORDINARY write strips `_federation` (see content.js) — so the
 *     first time a UI ticks an item on a propagated copy, the stamp is gone and
 *     the copy becomes byte-identical to a locally authored record. Fall back
 *     to the creation instant, which propagation copies verbatim: two lists
 *     independently created in two holons don't share one to the millisecond.
 *
 * Used only when `dedupeAcrossSpaces` is off — where a same-id collision is
 * normally a genuine second record, and this is the exception.
 */
function isCopyOfPartnerRecord(local, remote, partnerSpace) {
    if (!local || !remote) return false;
    const stamped = local._federation && local._federation.origin;
    if (stamped != null && String(stamped) === String(partnerSpace)) return true;
    const a = local.created;
    const b = remote.created;
    return a != null && b != null && String(a) === String(b);
}

export function subscribeFederated(holosphere, holon, lens, callback, options = {}) {
    if (!holosphere || !holon || !lens || typeof callback !== 'function') {
        throw new Error('subscribeFederated: Missing required parameters');
    }
    const {
        includeLocal = true,
        includeFederated = true,
        dedupe = true,
        dedupeAcrossSpaces = true,
        idField = 'id',
        maxFederatedSpaces = -1,
    } = options;

    const SEP = ' ';
    // key `${space} ${id}` → already-tagged item. Namespaced by space so
    // identical ids across holons don't collide before dedup.
    const store = new Map();
    const subs = new Map(); // space → unsubscribe()
    // Live tombstones per `${space} ${id}` key: async seeds (getAll)
    // resolve AFTER the live subscription attaches, so without this a slow
    // seed could resurrect an item a live event already deleted. Shared
    // across spaces (keys embed the space) and kept across removeSpace so a
    // re-attached partner can't resurrect either.
    const tombstones = new Set();
    let closed = false;

    const emit = () => {
        if (closed) return;
        // `store` is already keyed `${space} ${id}`, so every path below dedupes
        // within a space; only the cross-space collapse differs.
        if (!dedupe) {
            callback([...store.values()]);
            return;
        }
        if (!dedupeAcrossSpaces) {
            // Ids are only holon-unique: a partner's same-id record is its own
            // record and stays — UNLESS our copy provably came from it.
            const ownById = new Map();
            for (const [k, item] of store) {
                if (k.slice(0, k.indexOf(SEP)) !== holon) continue;
                const id = item && item[idField];
                if (id != null) ownById.set(String(id), item);
            }
            const out = [];
            for (const [k, item] of store) {
                const space = k.slice(0, k.indexOf(SEP));
                if (space === holon) {
                    out.push(item);
                    continue;
                }
                const id = item && item[idField];
                const own = id != null ? ownById.get(String(id)) : undefined;
                if (own && isCopyOfPartnerRecord(own, item, space)) continue;
                out.push(item);
            }
            callback(out);
            return;
        }
        // Two passes so a local item always wins an id collision with a partner.
        const byId = new Map();
        for (const [k, item] of store) {
            if (k.slice(0, k.indexOf(SEP)) !== holon) continue;
            const id = item && item[idField];
            if (id != null) byId.set(String(id), item);
        }
        for (const [k, item] of store) {
            if (k.slice(0, k.indexOf(SEP)) === holon) continue;
            const id = item && item[idField];
            if (id != null && !byId.has(String(id))) byId.set(String(id), item);
        }
        callback([...byId.values()]);
    };

    const tagWithSource = (item, space, originName) => {
        if (!item || space === holon) return item;
        const fed = { ...(item._federation || {}), origin: space, sourceLens: lens };
        if (originName) fed.originName = originName;
        return { ...item, _federation: fed };
    };

    const addSpace = (space, originName) => {
        if (closed || subs.has(space)) return;
        const raw = holosphere.subscribe(space, lens, (data, key) => {
            if (closed) return;
            const id = String((data && (data[idField] ?? key)) ?? key ?? '');
            if (!id) return;
            const k = `${space}${SEP}${id}`;
            if (data == null || data._deleted) {
                tombstones.add(k);
                store.delete(k);
            } else {
                tombstones.delete(k);
                store.set(k, tagWithSource(data, space, originName));
            }
            emit();
        });
        subs.set(space, raw && typeof raw.unsubscribe === 'function'
            ? () => raw.unsubscribe()
            : () => {});
        // Seed with a point-in-time snapshot as well: getAll awaits the relay
        // backfill for a (space, lens) the local store has never synced, so a
        // partner attached cold fills in as soon as its events land. Live
        // events win on overlap (they're newer by construction).
        Promise.resolve()
            .then(() => holosphere.getAll(space, lens))
            .then((items) => {
                if (closed || !subs.has(space) || !Array.isArray(items)) return;
                let added = false;
                for (const item of items) {
                    if (!item || item._deleted) continue;
                    const id = item[idField];
                    if (id == null) continue;
                    const k = `${space}${SEP}${String(id)}`;
                    if (store.has(k) || tombstones.has(k)) continue;
                    store.set(k, tagWithSource(item, space, originName));
                    added = true;
                }
                if (added) emit();
            })
            .catch(() => { /* seed is best-effort; the live sub still streams */ });
    };

    const removeSpace = (space) => {
        const un = subs.get(space);
        if (!un) return;
        try { un(); } catch { /* best-effort teardown */ }
        subs.delete(space);
        for (const k of [...store.keys()]) {
            if (k.slice(0, k.indexOf(SEP)) === space) store.delete(k);
        }
    };

    // Attach a subscription to every partner this holon receives `lens` from.
    // Idempotent and guarded by a token so a rapid toggle can't attach a stale
    // partner set after the async config read resolves.
    let attachToken = 0;
    let partnersOn = false;
    const attachPartners = async () => {
        if (closed) return;
        partnersOn = true;
        const token = ++attachToken;
        try {
            // Cold-store resilience: the first read of the config
            // races the relay handshake and can return null even though the
            // holon IS federated — retry before concluding "no partners".
            let fedInfo = await getFederation(holosphere, holon);
            for (let i = 0; !fedInfo && i < FEDERATION_CONFIG_RETRY_MS.length; i++) {
                await new Promise((r) => setTimeout(r, FEDERATION_CONFIG_RETRY_MS[i]));
                if (closed || !partnersOn || token !== attachToken) return;
                fedInfo = await getFederation(holosphere, holon);
            }
            if (closed || !partnersOn || token !== attachToken) return;
            if (!fedInfo || !Array.isArray(fedInfo.inbound)) return;
            const lensConfig = fedInfo.lensConfig || {};
            let receiving = fedInfo.inbound.filter(space => {
                const inb = lensConfig[space] && lensConfig[space].inbound;
                return Array.isArray(inb) && inb.includes(lens);
            });
            if (maxFederatedSpaces !== -1) receiving = receiving.slice(0, maxFederatedSpaces);
            await Promise.all(receiving.map(async space => {
                if (closed || !partnersOn || token !== attachToken || space === holon) return;
                const name = await getHolonName(holosphere, space).catch(() => null);
                addSpace(space, name);
            }));
            if (!closed && partnersOn && token === attachToken) emit();
        } catch (err) {
            console.warn(`subscribeFederated: federation setup failed for ${holon}/${lens}: ${err.message}`);
        }
    };
    const detachPartners = () => {
        partnersOn = false;
        attachToken++; // cancel any in-flight attach
        for (const space of [...subs.keys()]) {
            if (space !== holon) removeSpace(space);
        }
        emit();
    };

    // Local first (synchronous), then one emit so an empty lens still clears
    // any "loading" state before partners resolve.
    if (includeLocal) addSpace(holon, null);
    emit();
    if (includeFederated) attachPartners();

    return {
        /**
         * Fold inbound partners in (`true`) or drop them (`false`) live, WITHOUT
         * disturbing the local subscription — so a UI's federation toggle never
         * blanks the board. Re-reads the federation config on each enable.
         */
        setFederated(on) {
            if (closed) return;
            if (on) attachPartners();
            else detachPartners();
        },
        unsubscribe() {
            closed = true;
            for (const un of subs.values()) {
                try { un(); } catch { /* best-effort teardown */ }
            }
            subs.clear();
            store.clear();
        },
    };
}

/**
 * Ancestor hexagons of an H3-cell holon, finest-first (res-1 … res-0).
 *
 * Shared by `propagate` and `propagateDeletion` so a record is retracted from
 * exactly the holons its write fanned it out to — the two must never disagree
 * about where a copy lives.
 *
 * @param {string} holon - Holon identifier (an H3 cell, or anything else)
 * @param {number} [maxParentLevels=15] - How many levels up to walk
 * @returns {{isValidH3: boolean, resolution: number|undefined, parents: string[], messages: string[], error?: string}}
 */
export function parentHexagonsFor(holon, maxParentLevels = 15) {
    const out = { isValidH3: false, resolution: undefined, parents: [], messages: [] };

    // H3 hexagons start with '8' and are at least 15 characters long.
    if (!(typeof holon === 'string' && /^[8][0-9A-Fa-f]+$/.test(holon) && holon.length >= 15)) {
        out.messages.push(`Holon ${holon} is not a valid H3 hexagon.`);
        return out;
    }
    try {
        const resolution = h3.getResolution(holon);
        if (!(resolution >= 0 && resolution <= 15)) {
            out.messages.push(`Holon ${holon} has invalid resolution: ${resolution}`);
            return out;
        }
        out.isValidH3 = true;
        out.resolution = resolution;
    } catch (error) {
        out.messages.push(`Holon ${holon} failed H3 validation: ${error.message}`);
        return out;
    }

    let currentHolon = holon;
    let currentRes = out.resolution;
    let levelsProcessed = 0;
    while (currentRes > 0 && levelsProcessed < maxParentLevels) {
        try {
            const parent = h3.cellToParent(currentHolon, currentRes - 1);
            out.parents.push(parent);
            currentHolon = parent;
            currentRes--;
            levelsProcessed++;
        } catch (error) {
            out.messages.push(`Error getting parent for ${currentHolon}: ${error.message}`);
            out.error = error.message;
            break;
        }
    }
    return out;
}

/**
 * Is `record` a copy this holon propagated (rather than a record the target
 * owns, or one that arrived from somewhere else)? Full-copy propagation stamps
 * `_federation.origin`; hologram propagation leaves a soul pointing home.
 */
function isPropagatedCopyOf(holosphere, record, holon, lens) {
    if (!record || typeof record !== 'object') return false;
    const origin = record._federation?.origin;
    if (origin != null && String(origin) === String(holon)) return true;
    if (typeof record.soul === 'string' && holosphere.isHologram?.(record)) {
        const info = parseSoulPath(record.soul);
        if (info && String(info.holon) === String(holon) && String(info.lens) === String(lens)) return true;
    }
    return false;
}

/**
 * May propagation write `id` into `targetSpace`? This is the write-side twin of
 * the rule `propagateDeletion` already enforces: a propagated copy may only
 * touch a slot that is EMPTY, tombstoned, or already holds a copy this holon
 * put there. Anything else at that key belongs to the target — its own record,
 * or a copy from a different source — and propagation must leave it alone.
 *
 * Without this, a full-copy propagation blind-writes the slot. That is not a
 * merge: a record holding a collection (a checklist's `items`, say) is replaced
 * whole, so one partner's write silently destroys the other's list. Per-item
 * lenses hid the problem because their ids differ; whole-record lenses don't.
 *
 * The read is retried, because a cold `get` races the relay handshake and a
 * single null would read as "slot is free" on a slot that is not. Only after
 * the retries come back empty do we treat it as absent.
 */
async function mayPropagateInto(holosphere, targetSpace, lens, id, holon, readTimeoutMs = 1500) {
    let existing = null;
    for (let i = 0; i < PROPAGATE_READ_RETRY_MS.length; i++) {
        try {
            existing = await holosphere.get(targetSpace, lens, id, null, {
                resolveHolograms: false,
                _skipAuthorize: true,
                timeout: readTimeoutMs,
            });
        } catch {
            existing = null; // read error — treated like an empty read, then retried
        }
        if (existing) break;
        if (i < PROPAGATE_READ_RETRY_MS.length - 1) {
            await new Promise((r) => setTimeout(r, PROPAGATE_READ_RETRY_MS[i]));
        }
    }
    if (!existing || existing._deleted) return { ok: true };
    if (isPropagatedCopyOf(holosphere, existing, holon, lens)) return { ok: true };
    return {
        ok: false,
        reason: holosphere.isHologram?.(existing)
            ? "target holds a hologram of its own"
            : "target holds its own record",
    };
}

/**
 * Retracts a record from the parent hexagons `propagate` copied it to.
 *
 * A put on an H3 holon fans full copies (or holograms) up the whole ancestry,
 * so a delete that only removes the original leaves it readable at every
 * coarser scale forever. This is the mirror image: same ancestry walk, and a
 * copy is removed ONLY when it is provably ours (`_federation.origin` is this
 * holon, or a hologram soul pointing back at this holon/lens). Anything else
 * at that key — the parent's own record, or a copy from a different child —
 * is left untouched, so an id collision between two children can't turn one
 * holon's delete into another's data loss.
 *
 * @param {object} holosphere - The HoloSphere instance
 * @param {string} holon - The holon the record was deleted from
 * @param {string} lens - The lens identifier
 * @param {string|null} [key] - Record id; `null` retracts every copy this holon propagated into `lens`
 * @param {object} [options] - Options
 * @param {boolean} [options.propagateToParents=true] - Set false to disable
 * @param {number} [options.maxParentLevels=15] - Maximum parent levels to walk
 * @param {number} [options.readTimeoutMs=2000] - Per-read deadline at each parent
 * @returns {Promise<object>} - Result with success/skipped/error counts
 */
export async function propagateDeletion(holosphere, holon, lens, key = null, options = {}) {
    if (!holosphere || !holon || !lens) {
        throw new Error('propagateDeletion: Missing required parameters');
    }
    const {
        propagateToParents = true,
        maxParentLevels = 15,
        readTimeoutMs = 2000
    } = options;

    const result = { success: 0, errors: 0, skipped: 0, messages: [] };
    if (!propagateToParents) return result;

    const ancestry = parentHexagonsFor(holon, maxParentLevels);
    result.messages.push(...ancestry.messages);
    if (!ancestry.isValidH3) {
        result.skipped++;
        return result;
    }
    if (ancestry.error) result.errors++;
    if (ancestry.parents.length === 0) {
        result.messages.push(`No parent hexagons found for ${holon} (already at resolution 0 or max levels reached)`);
        result.skipped++;
        return result;
    }

    const readOpts = { resolveHolograms: false, _skipAuthorize: true, timeout: readTimeoutMs };

    await Promise.all(ancestry.parents.map(async (parentHexagon) => {
        try {
            // One read per parent — either the single record, or the whole lens
            // for a sweep. The records come back with the read, so ownership is
            // decided from what we already have rather than re-fetching each id.
            let candidates;
            if (key != null) {
                const record = await holosphere.get(parentHexagon, lens, String(key), null, readOpts);
                candidates = [{ id: String(key), record }];
            } else {
                const items = await holosphere.getAll(parentHexagon, lens, null, readOpts);
                candidates = (items || [])
                    .filter((it) => it && it.id != null)
                    .map((it) => ({ id: String(it.id), record: it }));
            }

            for (const { id, record } of candidates) {
                if (!record || record._deleted) {
                    result.skipped++;
                    continue;
                }
                if (!isPropagatedCopyOf(holosphere, record, holon, lens)) {
                    result.skipped++;
                    // Only worth naming when the caller asked about one record;
                    // a lens-wide sweep would otherwise log every foreign record
                    // at every level of the ancestry.
                    if (key != null) {
                        result.messages.push(`Kept ${parentHexagon}/${lens}/${id}: not a copy propagated from ${holon}.`);
                    }
                    continue;
                }
                // autoPropagate:false — the ancestry was already walked here;
                // letting each parent delete re-walk its own would fan out
                // redundant deletes at every level.
                await holosphere.delete(parentHexagon, lens, id, null, { autoPropagate: false });
                result.success++;
            }
        } catch (error) {
            console.error(`[Federation] Error retracting ${key ?? '*'} from parent hexagon ${parentHexagon}: ${error.message}`);
            result.errors++;
            result.messages.push(`Error retracting ${key ?? '*'} from parent hexagon ${parentHexagon}: ${error.message}`);
        }
    }));

    result.propagated = result.success > 0;
    return result;
}

/**
 * Propagates data to federated spaces
 * @param {object} holosphere - The HoloSphere instance
 * @param {string} holon - The holon identifier
 * @param {string} lens - The lens identifier
 * @param {object} data - The data to propagate
 * @param {object} [options] - Propagation options
 * @param {boolean} [options.useHolograms=true] - Use holograms for propagation (default: true)
 * @param {string[]} [options.targetSpaces] - Specific target spaces to propagate to (defaults to all federated spaces)
 * @param {string} [options.password] - Password for accessing the source holon (if needed)
 * @param {boolean} [options.propagateToParents=true] - Whether to automatically propagate to parent hexagons (default: true)
 * @param {number} [options.maxParentLevels=15] - Maximum number of parent levels to propagate to (default: 15)
 * @returns {Promise<object>} - Result with success count and errors
 */
export async function propagate(holosphere, holon, lens, data, options = {}) {
    if (!holosphere || !holon || !lens || !data) {
        throw new Error('propagate: Missing required parameters');
    }

    // Cascade / re-entrancy guard. Under mutual federation a propagated item can
    // echo back and re-propagate, and the echoes compound until the heap blows
    // up. If we already propagated THIS item very recently, treat it as an echo:
    // skip it and log the trigger stack so the cascade source is identifiable.
    // A genuine fresh write is always the first occurrence, so it passes.
    const __dedupKey = `${holon}/${lens}/${data.id}`;
    const __now = Date.now();
    if (!holosphere._recentPropagations) holosphere._recentPropagations = new Map();
    const __recent = holosphere._recentPropagations;
    const __last = __recent.get(__dedupKey);
    const PROPAGATE_DEDUP_MS = 4000;
    if (__last && (__now - __last) < PROPAGATE_DEDUP_MS) {
        // Working as designed (the guard exists to swallow echoes), so keep the
        // console clean: debug-level, visible only under the Verbose filter.
        const __stack = (new Error().stack || '').split('\n').slice(2, 7).join('\n');
        console.debug(`[propagate] dedup skip ${__dedupKey} (${__now - __last}ms since last) — federation cascade echo. Trigger:\n${__stack}`);
        return { success: 0, errors: 0, skipped: 1, messages: ['deduped: recent propagation'], parentPropagation: { success: 0, errors: 0, skipped: 0, messages: [] } };
    }
    __recent.set(__dedupKey, __now);
    if (__recent.size > 5000) {
        for (const [k, t] of __recent) { if (__now - t > PROPAGATE_DEDUP_MS) __recent.delete(k); }
    }

    // Default propagation options
    const { 
        useHolograms = true, 
        targetSpaces = null, 
        password = null,
        propagateToParents = true,
        maxParentLevels = 15
    } = options;

    const result = {
        success: 0,
        errors: 0,
        skipped: 0,
        messages: [],
        parentPropagation: {
            success: 0,
            errors: 0,
            skipped: 0,
            messages: []
        }
    };

    try {
        // ================================ FEDERATION PROPAGATION ================================
        
        // Get federation info for this holon using getFederation
        const fedInfo = await getFederation(holosphere, holon, password);
        
        // Only propagate if we have outbound partners configured.
        if (fedInfo && fedInfo.outbound && fedInfo.outbound.length > 0) {
            // Never propagate back to ourselves. Writing a hologram to the
            // source holon overwrites the original data with a self-
            // referencing pointer, and HoloSphere's get() then auto-deletes
            // it as a "broken hologram" (resolveHologram returns null because
            // the soul resolves to itself), silently destroying the entry.
            let spaces = fedInfo.outbound.filter(s => String(s) !== String(holon));

            if (targetSpaces && Array.isArray(targetSpaces) && targetSpaces.length > 0) {
                spaces = spaces.filter(space => targetSpaces.includes(space));
            }

            if (spaces.length > 0) {
                // Keep only partners whose outbound lens config includes this lens.
                spaces = spaces.filter(targetSpace => {
                    const spaceConfig = fedInfo.lensConfig?.[targetSpace];
                    if (!spaceConfig) {
                        result.messages.push(`No lens configuration for target space ${targetSpace}. Skipping propagation of lens '${lens}'.`);
                        result.skipped++;
                        return false;
                    }

                    const outboundLenses = Array.isArray(spaceConfig.outbound) ? spaceConfig.outbound : [];
                    const shouldPropagate = outboundLenses.includes('*') || outboundLenses.includes(lens);

                    if (!shouldPropagate) {
                        result.messages.push(`Propagation of lens '${lens}' to target space ${targetSpace} skipped: lens not in 'outbound' configuration.`);
                        result.skipped++;
                    }
                    return shouldPropagate;
                });

                if (spaces.length > 0) {
                    // Check if data is already a hologram
                    const isAlreadyHologram = holosphere.isHologram(data);

                    // Resolve our own holon's name once so every propagated
                    // payload carries it. Falls back to undefined (the field
                    // is omitted) so consumers can use the bare holon id.
                    const ownName = await getHolonName(holosphere, holon);

                    // For each target space, propagate the data
                    const propagatePromises = spaces.map(async (targetSpace) => {
                        try {
                            let payloadToPut;
                            const federationMeta = {
                                origin: holon,       // The space from which this data is being propagated
                                sourceLens: lens,    // The lens from which this data is being propagated
                                propagatedAt: Date.now(),
                                originalId: data.id,
                                ...(ownName ? { originName: ownName } : {})
                            };

                            if (useHolograms && !isAlreadyHologram) {
                                // Create a new hologram referencing the original data
                                const newHologram = holosphere.createHologram(holon, lens, data);
                                payloadToPut = {
                                    ...newHologram, // This will be { id: data.id, soul: 'path/to/original' }
                                    _federation: federationMeta
                                };
                            } else {
                                // Propagate existing data (could be a full object or an existing hologram)
                                // Make a shallow copy and update/add _federation metadata
                                payloadToPut = {
                                    ...data, 
                                    _federation: {
                                        ...(data._federation || {}), // Preserve existing _federation fields if any
                                        ...federationMeta // Add/overwrite with current propagation info
                                    }
                                };
                            }

                            // Never write a hologram to the holon its soul
                            // already points at — that overwrites the original
                            // record with a pointer to itself (a circular
                            // hologram that can never resolve, so get() logs
                            // "CIRCULAR … Breaking loop" forever). Two cases:
                            //   • target === source: the source already holds
                            //     the original; don't self-hologram it.
                            //   • forwarding a RECEIVED hologram back toward its
                            //     birthplace via a third hop (A→B propagates,
                            //     then B→A federation echoes the hologram — whose
                            //     soul still points at A — home). The plain
                            //     `target === holon` check misses this because
                            //     here `holon` is B, not A.
                            const soulTargetHolon =
                                payloadToPut && typeof payloadToPut.soul === 'string'
                                    ? parseSoulPath(payloadToPut.soul)?.holon
                                    : null;
                            if (
                                String(targetSpace) === String(holon) ||
                                (soulTargetHolon != null &&
                                    String(soulTargetHolon) === String(targetSpace))
                            ) {
                                result.skipped++;
                                result.messages.push(
                                    `Skipped self-referential propagation of ${data.id} to ${targetSpace} (hologram soul already points there).`
                                );
                                return true;
                            }

                            // Never overwrite the target's OWN real record with a
                            // federated hologram. Propagation writes with
                            // `disableHologramRedirection:true`, so a hologram put
                            // here CLOBBERS whatever is at targetSpace/id. If that
                            // slot already holds a real (non-hologram, non-deleted)
                            // object, overwriting it with a pointer is exactly what
                            // closes an A↔B cycle: A's source record becomes a pointer
                            // to B while B points back to A → a circular hologram that
                            // resolution would chase forever (historically a Gun
                            // map().on() fire-storm). The
                            // federated copy is meant to surface via the read-time
                            // `getFederated` overlay, never by clobbering local storage.
                            // Applies to EVERY propagation, hologram or full copy.
                            // It used to run only in hologram mode, which left the
                            // full-copy path free to blind-write the target — and a
                            // whole-record lens (a checklist and its `items`) is
                            // REPLACED by that write, not merged, so a partner's list
                            // was destroyed by an unrelated edit on ours.
                            const allowed = await mayPropagateInto(
                                holosphere, targetSpace, lens, data.id, holon, 1500
                            );
                            if (!allowed.ok) {
                                result.skipped++;
                                result.messages.push(
                                    `Skipped propagation of ${data.id} to ${targetSpace}: ${allowed.reason} — refusing to overwrite it.`
                                );
                                return true;
                            }

                            // Store in the target space with redirection disabled and no further auto-propagation.
                            // preserveFederationMeta keeps the `_federation` provenance on the stored
                            // copy — that stamp is what lets propagateDeletion prove the copy is ours.
                            await holosphere.put(targetSpace, lens, payloadToPut, null, {
                                disableHologramRedirection: true,
                                autoPropagate: false,
                                preserveFederationMeta: true
                            });

                            result.success++;
                            return true;
                        } catch (error) {
                            result.errors++;
                            result.messages.push(`Error propagating ${data.id} to ${targetSpace}: ${error.message}`);
                            return false;
                        }
                    });
                    
                    await Promise.all(propagatePromises);
                } else {
                    result.messages.push('No valid target spaces for federation propagation after lens filtering.');
                }
            } else {
                result.messages.push('No valid target spaces found for federation propagation.');
            }
        } else {
            result.messages.push(`No federation found for ${holon} or no notification targets available.`);
        }
        
        // ================================ PARENT PROPAGATION ================================
        
        // Check if we should propagate to parent hexagons
        if (propagateToParents) {
            
            try {
                // Shared with propagateDeletion — a delete must retract copies
                // from exactly the hexagons this walk writes them to.
                const ancestry = parentHexagonsFor(holon, maxParentLevels);
                const { isValidH3, resolution: holonResolution, parents: parentHexagons } = ancestry;
                for (const message of ancestry.messages) {
                    result.parentPropagation.messages.push(message);
                    if (!isValidH3) console.log(`[Federation] ${message}`);
                }
                if (!isValidH3) {
                    result.parentPropagation.messages.push(`Skipping parent propagation for ${holon}.`);
                    result.parentPropagation.skipped++;
                }
                if (ancestry.error) {
                    console.error(`[Federation] ${ancestry.error}`);
                    result.parentPropagation.errors++;
                }
                
                if (isValidH3 && holonResolution !== undefined) {
                    if (parentHexagons.length > 0) {
                        result.parentPropagation.messages.push(`Found ${parentHexagons.length} parent hexagons to propagate to: ${parentHexagons.join(', ')}`);
                        
                        // Check if data is already a hologram (reuse from federation section)
                        const isAlreadyHologram = holosphere.isHologram(data);

                        // Resolve our own holon's name once for parent propagation
                        // (same as the federation block above).
                        const ownNameParent = await getHolonName(holosphere, holon);

                        // Propagate to each parent hexagon
                        const parentPropagatePromises = parentHexagons.map(async (parentHexagon) => {
                            try {
                                let payloadToPut;
                                const parentFederationMeta = {
                                    origin: holon,           // The original holon from which this data is being propagated
                                    sourceLens: lens,        // The lens from which this data is being propagated
                                    propagatedAt: Date.now(),
                                    originalId: data.id,
                                    propagationType: 'parent', // Indicate this is parent propagation
                                    parentLevel: holonResolution - h3.getResolution(parentHexagon), // How many levels up
                                    ...(ownNameParent ? { originName: ownNameParent } : {})
                                };

                                if (useHolograms && !isAlreadyHologram) {
                                    // Create a new hologram referencing the original data
                                    const newHologram = holosphere.createHologram(holon, lens, data);
                                    payloadToPut = {
                                        ...newHologram, // This will be { id: data.id, soul: 'path/to/original' }
                                        _federation: parentFederationMeta
                                    };
                                } else {
                                    // Propagate existing data (could be a full object or an existing hologram)
                                    // Make a shallow copy and update/add _federation metadata
                                    payloadToPut = {
                                        ...data, 
                                        _federation: {
                                            ...(data._federation || {}), // Preserve existing _federation fields if any
                                            ...parentFederationMeta // Add/overwrite with current propagation info
                                        }
                                    };
                                }
                                
                                // Same self-reference guard as partner
                                // propagation: never write a hologram to the
                                // holon its soul points at (would create a
                                // circular self-pointer that can never resolve).
                                const soulTargetHolonParent =
                                    payloadToPut && typeof payloadToPut.soul === 'string'
                                        ? parseSoulPath(payloadToPut.soul)?.holon
                                        : null;
                                if (
                                    String(parentHexagon) === String(holon) ||
                                    (soulTargetHolonParent != null &&
                                        String(soulTargetHolonParent) === String(parentHexagon))
                                ) {
                                    result.parentPropagation.skipped =
                                        (result.parentPropagation.skipped || 0) + 1;
                                    result.parentPropagation.messages.push(
                                        `Skipped self-referential parent propagation of ${data.id} to ${parentHexagon} (hologram soul already points there).`
                                    );
                                    return true;
                                }

                                // Same no-overwrite rule as partner propagation: two
                                // children of one hexagon can share a record id, so a
                                // blind write up the ancestry turns one child's edit
                                // into another child's data loss at every parent.
                                const parentAllowed = await mayPropagateInto(
                                    holosphere, parentHexagon, lens, data.id, holon, 1500
                                );
                                if (!parentAllowed.ok) {
                                    result.parentPropagation.skipped =
                                        (result.parentPropagation.skipped || 0) + 1;
                                    result.parentPropagation.messages.push(
                                        `Skipped parent propagation of ${data.id} to ${parentHexagon}: ${parentAllowed.reason} — refusing to overwrite it.`
                                    );
                                    return true;
                                }

                                // Store in the parent hexagon with redirection disabled and no further
                                // auto-propagation. preserveFederationMeta keeps the `_federation`
                                // stamp so the copy stays identifiable as ours (see propagateDeletion).
                                await holosphere.put(parentHexagon, lens, payloadToPut, null, {
                                    disableHologramRedirection: true,
                                    autoPropagate: false,
                                    preserveFederationMeta: true
                                });

                                console.log(`[Federation] Successfully propagated to parent hexagon: ${parentHexagon}`);
                                result.parentPropagation.success++;
                                return true;
                            } catch (error) {
                                console.error(`[Federation] Error propagating ${data.id} to parent hexagon ${parentHexagon}: ${error.message}`);
                                result.parentPropagation.errors++;
                                result.parentPropagation.messages.push(`Error propagating ${data.id} to parent hexagon ${parentHexagon}: ${error.message}`);
                                return false;
                            }
                        });
                        
                        await Promise.all(parentPropagatePromises);
                    } else {
                        result.parentPropagation.messages.push(`No parent hexagons found for ${holon} (already at resolution 0 or max levels reached)`);
                        result.parentPropagation.skipped++;
                    }
                }
            } catch (error) {
                console.error(`[Federation] Error during parent propagation: ${error.message}`);
                result.parentPropagation.errors++;
                result.parentPropagation.messages.push(`Error during parent propagation: ${error.message}`);
            }
        }
        
        // ================================ END PARENT PROPAGATION ================================
        
        result.propagated = result.success > 0 || result.parentPropagation.success > 0;
        return result;
    } catch (error) {
        return {
            ...result,
            error: error.message
        };
    }
}

/**
 * Tracks a federated message across different chats
 * @param {object} holosphere - The HoloSphere instance
 * @param {string} originalChatId - The ID of the original chat
 * @param {string} messageId - The ID of the original message
 * @param {string} federatedChatId - The ID of the federated chat
 * @param {string} federatedMessageId - The ID of the message in the federated chat
 * @param {string} type - The type of message (e.g., 'quest', 'announcement')
 * @returns {Promise<void>}
 */
export async function federateMessage(holosphere, originalChatId, messageId, federatedChatId, federatedMessageId, type = 'generic') {
    const trackingKey = `${originalChatId}_${messageId}_fedmsgs`;
    const tracking = await holosphere.getGlobal('federation_messages', trackingKey) || {
        id: trackingKey,
        originalChatId,
        originalMessageId: messageId,
        type,
        messages: []
    };

    // Update or add the federated message info
    const existingMsg = tracking.messages.find(m => m.chatId === federatedChatId);
    if (existingMsg) {
        existingMsg.messageId = federatedMessageId;
        existingMsg.timestamp = Date.now();
    } else {
        tracking.messages.push({
            chatId: federatedChatId,
            messageId: federatedMessageId,
            timestamp: Date.now()
        });
    }

    await holosphere.putGlobal('federation_messages', tracking);
}

/**
 * Gets all federated messages for a given original message
 * @param {object} holosphere - The HoloSphere instance
 * @param {string} originalChatId - The ID of the original chat
 * @param {string} messageId - The ID of the original message
 * @returns {Promise<Object|null>} The tracking information for the message
 */
export async function getFederatedMessages(holosphere, originalChatId, messageId) {
    const trackingKey = `${originalChatId}_${messageId}_fedmsgs`;
    return await holosphere.getGlobal('federation_messages', trackingKey);
}

/**
 * Updates a federated message across all federated chats
 * @param {object} holosphere - The HoloSphere instance
 * @param {string} originalChatId - The ID of the original chat
 * @param {string} messageId - The ID of the original message
 * @param {Function} updateCallback - Function to update the message in each chat
 * @returns {Promise<void>}
 */
export async function updateFederatedMessages(holosphere, originalChatId, messageId, updateCallback) {
    const tracking = await getFederatedMessages(holosphere, originalChatId, messageId);
    if (!tracking?.messages) return;

    for (const msg of tracking.messages) {
        try {
            await updateCallback(msg.chatId, msg.messageId);
        } catch (error) {
        }
    }
}

/**
 * Resets all federation relationships for a space
 * @param {object} holosphere - The HoloSphere instance
 * @param {string} spaceId - The ID of the space to reset federation for
 * @param {string} [password] - Optional password for the space
 * @param {object} [options] - Reset options
 * @param {boolean} [options.notifyPartners=true] - Whether to notify federation partners about the reset
 * @param {string} [options.spaceName] - Optional name for the space (defaults to spaceId if not provided)
 * @returns {Promise<object>} - Result object with success/error info
 */
export async function resetFederation(holosphere, spaceId, password = null, options = {}) {
    if (!spaceId) {
        throw new Error('resetFederation: Missing required space ID');
    }

    const { 
        notifyPartners = true,
        spaceName = null
    } = options;

    const result = {
        success: false,
        federatedCount: 0,
        notifyCount: 0,
        partnersNotified: 0,
        errors: []
    };

    try {
        // Get current federation info to know what we're clearing
        const fedInfo = await getFederation(holosphere, spaceId, password);
        
        if (!fedInfo) {
            return {
                ...result,
                success: true,
                message: 'No federation configuration found for this space'
            };
        }

        const allPartners = fedInfo.federated || [];
        result.federatedCount = allPartners.length;
        result.inboundCount   = fedInfo.inbound?.length  || 0;
        result.outboundCount  = fedInfo.outbound?.length || 0;

        // Reset federation record to empty.
        const emptyFedInfo = {
            id: spaceId,
            name: spaceName || spaceId,
            federated: [],
            inbound: [],
            outbound: [],
            lensConfig: {},
            partnerNames: {},
            timestamp: Date.now()
        };
        await holosphere.putGlobal('federation', emptyFedInfo, password);

        // Tell each partner to drop us from their lists.
        if (notifyPartners && allPartners.length > 0) {
            const updatePromises = allPartners.map(async (partnerSpace) => {
                try {
                    const partnerFedInfo = await getFederation(holosphere, partnerSpace);
                    if (!partnerFedInfo) return false;

                    const sid = spaceId.toString();
                    if (partnerFedInfo.federated) {
                        partnerFedInfo.federated = partnerFedInfo.federated.filter(id => id !== sid);
                    }
                    if (partnerFedInfo.inbound) {
                        partnerFedInfo.inbound = partnerFedInfo.inbound.filter(id => id !== sid);
                    }
                    if (partnerFedInfo.outbound) {
                        partnerFedInfo.outbound = partnerFedInfo.outbound.filter(id => id !== sid);
                    }
                    if (partnerFedInfo.lensConfig) {
                        delete partnerFedInfo.lensConfig[sid];
                    }
                    if (partnerFedInfo.partnerNames) {
                        delete partnerFedInfo.partnerNames[sid];
                    }
                    partnerFedInfo.timestamp = Date.now();

                    await holosphere.putGlobal('federation', partnerFedInfo);
                    result.partnersNotified++;
                    return true;
                } catch (error) {
                    result.errors.push({ partner: partnerSpace, error: error.message });
                    return false;
                }
            });

            await Promise.all(updatePromises);
        }

        // Mark any federationMeta records inactive.
        for (const partnerSpace of allPartners) {
            try {
                const metaId    = `${spaceId}_${partnerSpace}`;
                const altMetaId = `${partnerSpace}_${spaceId}`;

                const meta = await holosphere.getGlobal('federationMeta', metaId) ||
                             await holosphere.getGlobal('federationMeta', altMetaId);

                if (meta) {
                    meta.status = 'inactive';
                    meta.endedAt = Date.now();
                    await holosphere.putGlobal('federationMeta', meta);
                }
            } catch {}
        }
        
        result.success = true;
        return result;
    } catch (error) {
        return {
            ...result,
            success: false,
            error: error.message
        };
    }
} 

// Export all federation operations as default
export default {
    federate,
    subscribeFederation,
    getFederation,
    getFederatedConfig,
    unfederate,
    removeNotify,
    getFederated,
    subscribeFederated,
    propagate,
    federateMessage,
    getFederatedMessages,
    updateFederatedMessages,
    resetFederation
}; 