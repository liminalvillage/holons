/**
 * Federation functionality for HoloSphere
 * Provides methods for creating, managing, and using federated spaces
 */


/**
 * Creates a federation relationship between two spaces
 * Federation is bidirectional by default, and data propagation uses soul references by default.
 * 
 * @param {object} holosphere - The HoloSphere instance
 * @param {string} spaceId1 - The first space ID
 * @param {string} spaceId2 - The second space ID
 * @param {string} [password1] - Optional password for the first space
 * @param {string} [password2] - Optional password for the second space
 * @param {boolean} [bidirectional=true] - Whether to set up bidirectional notifications (default: true)
 * @param {object} [lensConfig] - Optional lens-specific configuration
 * @param {string[]} [lensConfig.federate] - List of lenses to federate (default: all)
 * @param {string[]} [lensConfig.notify] - List of lenses to notify (default: all)
 * @returns {Promise<boolean>} - True if federation was created successfully
 */
export async function federate(holosphere, spaceId1, spaceId2, password1 = null, password2 = null, bidirectional = true, lensConfig = {}) {
    if (!spaceId1 || !spaceId2) {
        throw new Error('federate: Missing required space IDs');
    }

    // Prevent self-federation
    if (spaceId1 === spaceId2) {
        throw new Error('Cannot federate a space with itself');
    }

    // Validate lens configuration
    const { federate = [], notify = [] } = lensConfig;
    if (!Array.isArray(federate) || !Array.isArray(notify)) {
        throw new Error('federate: lensConfig.federate and lensConfig.notify must be arrays');
    }

    // Use the provided lens configurations directly
    const federateLenses = federate;
    const notifyLenses = notify;

    try {
        // Get or create federation info for first space (A)
        let fedInfo1 = null;

        try {
            fedInfo1 = await holosphere.getGlobal('federation', spaceId1, password1);
        } catch (error) {
        }

        if (fedInfo1 == null) {
            fedInfo1 = {
                id: spaceId1,
                name: spaceId1,
                federation: [],
                notify: [],
                lensConfig: {}, // New field for lens-specific settings
                timestamp: Date.now()
            };
        }

        // Ensure arrays and lensConfig exist
        if (!fedInfo1.federation) fedInfo1.federation = [];
        if (!fedInfo1.notify) fedInfo1.notify = [];
        if (!fedInfo1.lensConfig) fedInfo1.lensConfig = {};

        // Add space2 to space1's federation list if not already present
        if (!fedInfo1.federation.includes(spaceId2)) {
            fedInfo1.federation.push(spaceId2);
        }

        // Add space2 to space1's notify list if not already present
        if (!fedInfo1.notify.includes(spaceId2)) {
            fedInfo1.notify.push(spaceId2);
        }

        // Store lens configuration for space2
        const newLensConfigsForSpace1 = { ...(fedInfo1.lensConfig || {}) }; // Shallow copy existing lensConfigs for space1
        newLensConfigsForSpace1[spaceId2] = { // Add/update config for the target spaceId2
            federate: [...federateLenses], // federateLenses & notifyLenses are from the main lensConfig parameter
            notify: [...notifyLenses], 
            timestamp: Date.now()
        };
        fedInfo1.lensConfig = newLensConfigsForSpace1; // Assign the new/modified object back to fedInfo1.lensConfig

        // Update timestamp
        fedInfo1.timestamp = Date.now();

        // Save updated federation info for space1
        try {
            await holosphere.putGlobal('federation', fedInfo1, password1);
        } catch (error) {
            throw new Error(`Failed to create federation: ${error.message}`);
        }

        // If bidirectional is true, handle space2 (B) as well
        {
            let fedInfo2 = null;
            try {
                fedInfo2 = await holosphere.getGlobal('federation', spaceId2, password2);
            } catch (error) {
            }

            if (fedInfo2 == null) {
                fedInfo2 = {
                    id: spaceId2,
                    name: spaceId2,
                    federation: [],
                    notify: [],
                    lensConfig: {}, // New field for lens-specific settings
                    timestamp: Date.now()
                };
            }

            // Ensure arrays and lensConfig exist
            if (!fedInfo2.federation) fedInfo2.federation = [];
            if (!fedInfo2.notify) fedInfo2.notify = [];
            if (!fedInfo2.lensConfig) fedInfo2.lensConfig = {};

            // Add space1 to space2's federation list if bidirectional
            if (bidirectional && !fedInfo2.federation.includes(spaceId1)) {
                fedInfo2.federation.push(spaceId1);
            }

            // Add space1 to space2's notify list if not already present
            if (!fedInfo2.notify.includes(spaceId1)) {
                fedInfo2.notify.push(spaceId1);
            }

            // Store lens configuration for space1
            fedInfo2.lensConfig[spaceId1] = {
                federate: bidirectional ? [...federateLenses] : [], // Create a copy of the array
                notify: bidirectional ? [...notifyLenses] : [], // Create a copy of the array
                timestamp: Date.now()
            };

            // Update timestamp
            fedInfo2.timestamp = Date.now();

            // Save updated federation info for space2
            try {
                await holosphere.putGlobal('federation', fedInfo2, password2);
            } catch (error) {
            }
        }

        // Create federation metadata record
        const federationMeta = {
            id: `${spaceId1}_${spaceId2}`,
            space1: spaceId1,
            space2: spaceId2,
            created: Date.now(),
            status: 'active',
            bidirectional: bidirectional,
            lensConfig: {
                federate: [...federateLenses], // Create a copy of the array
                notify: [...notifyLenses] // Create a copy of the array
            }
        };

        try {
            await holosphere.putGlobal('federationMeta', federationMeta);
        } catch (error) {
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
    
    if (fedInfo.federation && fedInfo.federation.length > 0) {
        for (const federatedSpace of fedInfo.federation) {
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
                            
                            // Add federation metadata if not present
                            if (!data.federation) {
                                data.federation = {
                                    origin: federatedSpace,
                                    timestamp: now
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
 * @returns {Promise<object|null>} - An object with 'federate' and 'notify' arrays, or null if not found.
 */
export async function getFederatedConfig(holosphere, spaceId, targetSpaceId, password = null) {
    if (!holosphere || !spaceId || !targetSpaceId) {
        throw new Error('getFederatedConfig: Missing required parameters');
    }

    try {
        const fedInfo = await getFederation(holosphere, spaceId, password);

        if (fedInfo && fedInfo.lensConfig && fedInfo.lensConfig[targetSpaceId]) {
            return {
                federate: fedInfo.lensConfig[targetSpaceId].federate || [],
                notify: fedInfo.lensConfig[targetSpaceId].notify || []
            };
        }
        return null; // Or return an empty config: { federate: [], notify: [] }
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
            // If fedInfo1 doesn't exist, log and proceed to metadata cleanup.
            console.warn(`No federation info found for ${spaceId1}. Skipping its update.`);
        } else {
            // Ensure arrays exist
            if (!fedInfo1.federation) fedInfo1.federation = [];
            if (!fedInfo1.notify) fedInfo1.notify = [];
            
            // Update first space federation info - remove from both federation and notify arrays
            const originalFederationLength = fedInfo1.federation.length;
            const originalNotifyLength = fedInfo1.notify.length;
            
            fedInfo1.federation = fedInfo1.federation.filter(id => id !== spaceId2);
            fedInfo1.notify = fedInfo1.notify.filter(id => id !== spaceId2);
            fedInfo1.timestamp = Date.now();
            
            console.log(`Unfederate: Removed ${spaceId2} from ${spaceId1}: federation ${originalFederationLength} -> ${fedInfo1.federation.length}, notify ${originalNotifyLength} -> ${fedInfo1.notify.length}`);
            
            try {
                await holosphere.putGlobal('federation', fedInfo1, password1);
            } catch (error) {
                console.error(`Failed to update fedInfo1 for ${spaceId1} during unfederate: ${error.message}`);
                throw error; // RE-THROW to signal failure
            }
        }

        // Update second space federation info (remove spaceId1 from spaceId2's notify list)
        // This part is usually for full bidirectional unfederation cleanup.
        // The original code only did this if password2 was provided.
        if (password2) { // Retaining original condition for this block
            let fedInfo2 = null;
            try {
                fedInfo2 = await holosphere.getGlobal('federation', spaceId2, password2);
            } catch (error) {
                console.error(`Error getting fedInfo2 for ${spaceId2} during unfederate: ${error.message}`);
            }
            
            if (!fedInfo2 || !fedInfo2.notify) {
                console.warn(`No notify array found for ${spaceId2} or fedInfo2 is null. Skipping its update.`);
            } else {
                fedInfo2.notify = fedInfo2.notify.filter(id => id !== spaceId1);
                fedInfo2.timestamp = Date.now();
                
                try {
                    await holosphere.putGlobal('federation', fedInfo2, password2);
                } catch (error) {
                    console.error(`Failed to update fedInfo2 for ${spaceId2} during unfederate: ${error.message}`);
                    throw error; // RE-THROW to signal failure
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
 * Removes a notification relationship between two spaces
 * This removes spaceId2 from the notify list of spaceId1
 * 
 * @param {object} holosphere - The HoloSphere instance
 * @param {string} spaceId1 - The space to modify (remove from its notify list)
 * @param {string} spaceId2 - The space to be removed from notifications
 * @param {string} [password1] - Optional password for the first space
 * @returns {Promise<boolean>} - True if notification was removed successfully
 */
export async function removeNotify(holosphere, spaceId1, spaceId2, password1 = null) {
    if (!spaceId1 || !spaceId2) {
        throw new Error('removeNotify: Missing required space IDs');
    }

    try {
        // Get federation info for space
        let fedInfo = await holosphere.getGlobal('federation', spaceId1, password1);
        
        if (!fedInfo) {
            throw new Error(`No federation info found for ${spaceId1}`);
        }

        // Ensure notify array exists
        if (!fedInfo.notify) fedInfo.notify = [];
        
        // Remove space2 from space1's notify list if present
        if (fedInfo.notify.includes(spaceId2)) {
            fedInfo.notify = fedInfo.notify.filter(id => id !== spaceId2);
            
            // Update timestamp
            fedInfo.timestamp = Date.now();
            
            // Save updated federation info
            await holosphere.putGlobal('federation', fedInfo, password1);
            return true;
        } else {
            return false;
        }
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
        timeout = 10000
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
    if (includeFederated && fedInfo && fedInfo.federation && fedInfo.federation.length > 0) {
        const federatedSpaces = maxFederatedSpaces === -1 ? fedInfo.federation : fedInfo.federation.slice(0, maxFederatedSpaces);
        spacesToQuery = spacesToQuery.concat(federatedSpaces);
    }

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
                                fetchedItems.set(itemId, item);
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
            fetchPromises.push(
                holosphere.getAll(currentSpace, lens)
                    .then(items => {
                        for (const item of items) {
                            if (item && item[idField] && !fetchedItems.has(item[idField])) {
                                fetchedItems.set(item[idField], item);
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
                            // Replace the reference with the original data
                            result[i] = {
                                ...originalData,
                                _federation: {
                                    isReference: true,
                                    resolved: true,
                                    soul: item.soul,
                                    timestamp: Date.now()
                                }
                            };
                        } else {
                            // Instead of leaving the original reference, create an error object
                            result[i] = {
                                id: item.id,
                                _federation: {
                                    isReference: true,
                                    resolved: false,
                                    soul: item.soul,
                                    error: 'Referenced data not found',
                                    timestamp: Date.now()
                                }
                            };
                        }
                    } else {
                        console.warn(`Soul doesn't match expected format: ${item.soul}`);
                        // Instead of leaving the original reference, create an error object
                        result[i] = {
                            id: item.id,
                            _federation: {
                                isReference: true,
                                resolved: false,
                                soul: item.soul,
                                error: 'Invalid soul format',
                                timestamp: Date.now()
                            }
                        };
                    }
                } catch (refError) {
                    // Instead of leaving the original reference, create an error object
                    result[i] = {
                        id: item.id,
                        _federation: {
                            isReference: true,
                            resolved: false,
                            soul: item.soul,
                            error: refError.message || 'Error resolving reference',
                            timestamp: Date.now()
                        }
                    };
                }
            } 
            // For backward compatibility, check for old-style references
            else if (item._federation && item._federation.isReference) {
                console.log(`Found legacy reference: ${item._federation.origin}/${item._federation.lens}/${item[idField]}`);
                
                try {
                    const reference = item._federation;
                    console.log(`Getting original data from ${reference.origin} / ${reference.lens} / ${item[idField]}`);
                    
                    // Get original data
                    const originalData = await holosphere.get(
                        reference.origin,
                        reference.lens,
                        item[idField],
                        null,
                        { resolveReferences: false } // Prevent infinite recursion
                    );
                    
                    console.log(`Original data found:`, JSON.stringify(originalData));
                    
                    if (originalData) {
                        // Add federation information to the resolved data
                        result[i] = {
                            ...originalData,
                            _federation: {
                                ...reference,
                                resolved: true,
                                timestamp: Date.now()
                            }
                        };
                    } else {
                        console.warn(`Could not resolve legacy reference: original data not found`);
                    }
                } catch (refError) {
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
        
        return aggregatedData;
    }
    
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
 * @returns {Promise<object>} - Result with success count and errors
 */
export async function propagate(holosphere, holon, lens, data, options = {}) {
    if (!holosphere || !holon || !lens || !data) {
        throw new Error('propagate: Missing required parameters');
    }
    // Default propagation options
    const { useHolograms = true, targetSpaces = null, password = null } = options;

    const result = {
        success: 0,
        errors: 0,
        skipped: 0,
        messages: []
    };

    try {
        // Get federation info for this holon using getFederation
        const fedInfo = await getFederation(holosphere, holon, password);
        
        // If no federation info or no federation list, return with message
        if (!fedInfo || !fedInfo.federation || fedInfo.federation.length === 0) {
            return {
                ...result,
                message: `No federation found for ${holon}`
            };
        }
        
        // If no notification list or it's empty, return with message
        if (!fedInfo.notify || fedInfo.notify.length === 0) {
            return {
                ...result,
                message: `No notification targets found for ${holon}`
            };
        }
        
        // Filter federation spaces to those in notify list
        let spaces = fedInfo.notify;
        
        // Further filter by targetSpaces if provided
        if (targetSpaces && Array.isArray(targetSpaces) && targetSpaces.length > 0) {
            spaces = spaces.filter(space => targetSpaces.includes(space));
        }
        
        if (spaces.length === 0) {
            return {
                ...result,
                message: 'No valid target spaces found after filtering'
            };
        }

        // Filter spaces based on lens configuration
        spaces = spaces.filter(targetSpace => {
            const spaceConfig = fedInfo.lensConfig?.[targetSpace];
            if (!spaceConfig) {
                result.messages.push(`No lens configuration for target space ${targetSpace}. Skipping propagation of lens '${lens}'.`);
                result.skipped++;
                return false;
            }

            // Ensure .federate is an array before calling .includes
            const federateLenses = Array.isArray(spaceConfig.federate) ? spaceConfig.federate : [];

            const shouldFederate = federateLenses.includes('*') || federateLenses.includes(lens);
            
            // Propagation now only depends on the 'federate' list configuration for the lens
            const shouldPropagate = shouldFederate;
            
            if (!shouldPropagate) {
                result.messages.push(`Propagation of lens '${lens}' to target space ${targetSpace} skipped: lens not in 'federate' configuration.`);
                result.skipped++;
            }
            
            return shouldPropagate;
        });

        if (spaces.length === 0) {
            // If no specific skip messages were added and spaces is empty, add a general one.
            if (result.skipped === 0 && fedInfo.notify && fedInfo.notify.length > 0) { 
                result.messages.push('No target spaces were configured for federation of this specific lens, out of available notification partners.');
            } else if (fedInfo.notify && fedInfo.notify.length === 0) {
                result.messages.push('No notification partners available to filter for lens propagation.');
            }
            return {
                ...result,
                message: result.messages.join('; ') || 'No valid target spaces for propagation after lens filtering.'
            };
        }
        
        // Check if data is already a hologram
        const isAlreadyHologram = holosphere.isHologram(data);

        // If data is already a hologram, don't re-wrap it
        if (isAlreadyHologram && useHolograms) {
        }

        // If propagating a non-hologram and useHolograms is false, add warning
        if (!isAlreadyHologram && !useHolograms) {
        }
        
        // For each target space, propagate the data
        const propagatePromises = spaces.map(async (targetSpace) => {
            try {
                let payloadToPut;
                const federationMeta = {
                    origin: holon,       // The space from which this data is being propagated
                    sourceLens: lens,    // The lens from which this data is being propagated
                    propagatedAt: Date.now(),
                    originalId: data.id
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
        
        result.propagated = result.success > 0;
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

        // Store counts for reporting
        result.federatedCount = fedInfo.federation?.length || 0;
        result.notifyCount = fedInfo.notify?.length || 0;

        // Create empty federation record
        const emptyFedInfo = {
            id: spaceId,
            name: spaceName || spaceId,
            federation: [],
            notify: [],
            timestamp: Date.now()
        };

        // Update federation record with empty lists
        await holosphere.putGlobal('federation', emptyFedInfo, password);

        // Notify federation partners if requested
        if (notifyPartners && fedInfo.federation && fedInfo.federation.length > 0) {
            const updatePromises = fedInfo.federation.map(async (partnerSpace) => {
                try {
                    // Get partner's federation info
                    const partnerFedInfo = await getFederation(holosphere, partnerSpace);
                    
                    if (partnerFedInfo) {
                        // Remove this space from partner's federation list
                        if (partnerFedInfo.federation) {
                            partnerFedInfo.federation = partnerFedInfo.federation.filter(
                                id => id !== spaceId.toString()
                            );
                        }
                        
                        // Remove this space from partner's notify list
                        if (partnerFedInfo.notify) {
                            partnerFedInfo.notify = partnerFedInfo.notify.filter(
                                id => id !== spaceId.toString()
                            );
                        }
                        
                        partnerFedInfo.timestamp = Date.now();
                        
                        // Save partner's updated federation info
                        await holosphere.putGlobal('federation', partnerFedInfo);
                        result.partnersNotified++;
                        return true;
                    }
                    return false;
                } catch (error) {
                    result.errors.push({
                        partner: partnerSpace,
                        error: error.message
                    });
                    return false;
                }
            });
            
            await Promise.all(updatePromises);
        }
        
        // Update federation metadata records if they exist
        if (fedInfo.federation && fedInfo.federation.length > 0) {
            for (const partnerSpace of fedInfo.federation) {
                try {
                    const metaId = `${spaceId}_${partnerSpace}`;
                    const altMetaId = `${partnerSpace}_${spaceId}`;
                    
                    const meta = await holosphere.getGlobal('federationMeta', metaId) || 
                                await holosphere.getGlobal('federationMeta', altMetaId);
                    
                    if (meta) {
                        meta.status = 'inactive';
                        meta.endedAt = Date.now();
                        await holosphere.putGlobal('federationMeta', meta);
                    }
                } catch (error) {
                }
            }
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