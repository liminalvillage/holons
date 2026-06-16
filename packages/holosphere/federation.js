/**
 * Federation functionality for HoloSphere
 * Provides methods for creating, managing, and using federated spaces
 */

import * as h3 from 'h3-js';
import { attachHologramMeta, parseSoulPath } from './hologram.js';

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

        // Mirror the removal on space2 if password provided.
        if (password2) {
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
                    console.error(`Failed to update fedInfo2 for ${spaceId2} during unfederate: ${error.message}`);
                    throw error;
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
        // surface unsigned/legacy items tagged `_unverified` instead of
        // dropping them under enforce, so a UI "show all data" toggle can gate
        // them exactly like the local subscribe path. No-op when signing is
        // off. Display-only — NEVER trust `_unverified` items for auth.
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
        const federatedSpaces = maxFederatedSpaces === -1 ? fedInfo.inbound : fedInfo.inbound.slice(0, maxFederatedSpaces);
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
                    // Parse the soul to get the components
                    const soulParts = item.soul.split('/');
                    if (soulParts.length >= 4) {
                        const originHolon = soulParts[1];
                        const originLens = soulParts[2];
                        const originKey = soulParts[3];
                        
                        console.log(`Extracting from soul - holon: ${originHolon}, lens: ${originLens}, key: ${originKey}`);
                        
                        // Get original data using the extracted path - always resolve references
                        const originalData = await holosphere.get(
                            originHolon,
                            originLens,
                            originKey,
                            null,
                            { resolveReferences: true } // Always resolve nested references
                        );
                        
                        console.log(`Original data found via soul path:`, JSON.stringify(originalData));
                        
                        if (originalData) {
                            // Replace the reference with the resolved data, attaching
                            // the canonical _hologram envelope (single source of truth).
                            const withMeta = attachHologramMeta(originalData, item.soul);
                            // Stamp the source holon's display name so consumers
                            // don't need a second round-trip to render it. Use
                            // the per-call cache when possible to avoid duplicate
                            // settings reads across many holograms from the same
                            // source.
                            if (withMeta._hologram?.sourceHolon) {
                                let sourceHolonName = spaceNames.get(withMeta._hologram.sourceHolon);
                                if (sourceHolonName === undefined) {
                                    sourceHolonName = await getHolonName(holosphere, withMeta._hologram.sourceHolon);
                                    spaceNames.set(withMeta._hologram.sourceHolon, sourceHolonName);
                                }
                                if (sourceHolonName) {
                                    withMeta._hologram = {
                                        ...withMeta._hologram,
                                        sourceHolonName
                                    };
                                }
                            }
                            result[i] = withMeta;
                        } else {
                            // Original data not found — keep the id so callers can
                            // identify the broken reference, and surface the error.
                            result[i] = {
                                id: item.id,
                                _hologram: {
                                    isHologram: false,
                                    soul: item.soul,
                                    error: 'Referenced data not found',
                                    resolvedAt: Date.now()
                                }
                            };
                        }
                    } else {
                        console.warn(`Soul doesn't match expected format: ${item.soul}`);
                        result[i] = {
                            id: item.id,
                            _hologram: {
                                isHologram: false,
                                soul: item.soul,
                                error: 'Invalid soul format',
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
        const __stack = (new Error().stack || '').split('\n').slice(2, 7).join('\n');
        console.warn(`[propagate] DEDUP skip ${__dedupKey} (${__now - __last}ms since last) — federation cascade echo. Trigger:\n${__stack}`);
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
                            // to B while B points back to A → a circular hologram Gun
                            // re-emits forever (the map().on() fire-storm). The
                            // federated copy is meant to surface via the read-time
                            // `getFederated` overlay, never by clobbering local storage.
                            if (useHolograms && payloadToPut && typeof payloadToPut.soul === 'string') {
                                try {
                                    const existingAtTarget = await holosphere.get(
                                        targetSpace, lens, data.id, null,
                                        { resolveHolograms: false, _skipAuthorize: true, timeout: 2000 }
                                    );
                                    const existingIsReal = existingAtTarget &&
                                        !holosphere.isHologram(existingAtTarget) &&
                                        !existingAtTarget._deleted;
                                    // The target already holds a hologram pointing back
                                    // INTO the holon we're propagating from — writing
                                    // ours would entrench an A↔B back-edge.
                                    const existingPointsBack = existingAtTarget &&
                                        holosphere.isHologram(existingAtTarget) &&
                                        typeof existingAtTarget.soul === 'string' &&
                                        String(parseSoulPath(existingAtTarget.soul)?.holon) === String(holon);
                                    if (existingIsReal || existingPointsBack) {
                                        result.skipped++;
                                        result.messages.push(
                                            `Skipped propagation of ${data.id} to ${targetSpace}: ${existingIsReal ? 'target holds its own real record' : 'target already points back into the source'} (would create a circular hologram).`
                                        );
                                        return true;
                                    }
                                } catch { /* read failed — fall through and write */ }
                            }

                            // Store in the target space with redirection disabled and no further auto-propagation
                            await holosphere.put(targetSpace, lens, payloadToPut, null, {
                                disableHologramRedirection: true,
                                autoPropagate: false
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
                // Validate if the holon is a proper H3 hexagon
                // H3 hexagons should start with '8' and have a valid format
                let holonResolution;
                let isValidH3 = false;
                
                // First check: H3 hexagons should start with '8' and be at least 15 characters long
                if (typeof holon === 'string' && /^[8][0-9A-Fa-f]+$/.test(holon) && holon.length >= 15) {
                    try {
                        holonResolution = h3.getResolution(holon);
                        // Additional validation: resolution should be >= 0 and <= 15
                        if (holonResolution >= 0 && holonResolution <= 15) {
                            isValidH3 = true;
                        } else {
                            console.log(`[Federation] Holon ${holon} has invalid resolution: ${holonResolution}`);
                        }
                    } catch (error) {
                        console.log(`[Federation] Holon ${holon} failed H3 validation: ${error.message}`);
                    }
                } else {
                }
                
                if (!isValidH3) {
                    result.parentPropagation.messages.push(`Holon ${holon} is not a valid H3 hexagon. Skipping parent propagation.`);
                    result.parentPropagation.skipped++;
                }
                
                if (isValidH3 && holonResolution !== undefined) {
                    // Get all parent hexagons up to the specified max levels
                    const parentHexagons = [];
                    let currentHolon = holon;
                    let currentRes = holonResolution;
                    let levelsProcessed = 0;
                    
                    while (currentRes > 0 && levelsProcessed < maxParentLevels) {
                        try {
                            const parent = h3.cellToParent(currentHolon, currentRes - 1);
                            parentHexagons.push(parent);
                            currentHolon = parent;
                            currentRes--;
                            levelsProcessed++;
                        } catch (error) {
                            console.error(`[Federation] Error getting parent for ${currentHolon}: ${error.message}`);
                            result.parentPropagation.messages.push(`Error getting parent for ${currentHolon}: ${error.message}`);
                            result.parentPropagation.errors++;
                            break;
                        }
                    }
                    
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

                                // Store in the parent hexagon with redirection disabled and no further auto-propagation
                                await holosphere.put(parentHexagon, lens, payloadToPut, null, {
                                    disableHologramRedirection: true,
                                    autoPropagate: false
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
    propagate,
    federateMessage,
    getFederatedMessages,
    updateFederatedMessages,
    resetFederation
}; 