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
 * @returns {Promise<boolean>} - True if federation was created successfully
 */
export async function federate(holosphere, spaceId1, spaceId2, password1 = null, password2 = null, bidirectional = true) {
    console.log('FEDERATING', spaceId1, spaceId2, password1, password2, bidirectional)
    if (!spaceId1 || !spaceId2) {
        throw new Error('federate: Missing required space IDs');
    }

    // Prevent self-federation
    if (spaceId1 === spaceId2) {
        throw new Error('Cannot federate a space with itself');
    }

    try {
        // Get or create federation info for first space (A)
        let fedInfo1  = null;

        try {
            fedInfo1 = await holosphere.getGlobal('federation', spaceId1, password1);
        } catch (error) {
            console.warn(`Could not get federation info for ${spaceId1}: ${error.message}`);
            // Create new federation info if it doesn't exist
            
        }
        if (fedInfo1 == null) {
            fedInfo1 = {
                id: spaceId1,
                name: spaceId1,
                federation: [],
                notify: [],
                timestamp: Date.now()
            };
        }
        

        // Ensure arrays exist
        if (!fedInfo1.federation) fedInfo1.federation = [];
        if (!fedInfo1.notify) fedInfo1.notify = [];

        // Add space2 to space1's federation and notify lists if not already present
        if (!fedInfo1.federation.includes(spaceId2)) {
            fedInfo1.federation.push(spaceId2);
        }
        // // Always add to notify list for the first space (primary direction)
        // if (!fedInfo1.notify.includes(spaceId2)) {
        //     fedInfo1.notify.push(spaceId2);
        // }

        // Update timestamp
        fedInfo1.timestamp = Date.now();

        // Save updated federation info for space1
        try {
            await holosphere.putGlobal('federation', fedInfo1, password1);
            console.log(`Updated federation info for ${spaceId1}`);
        } catch (error) {
            console.warn(`Could not update federation info for ${spaceId1}: ${error.message}`);
            throw new Error(`Failed to create federation: ${error.message}`);
        }
        
        // If bidirectional is true, handle space2 (B) as well
        //if (bidirectional && password2) {
        {
            let fedInfo2 = null;
            try {
                fedInfo2 = await holosphere.getGlobal('federation', spaceId2, password2);
            } catch (error) {
                console.warn(`Could not get federation info for ${spaceId2}: ${error.message}`);
                // Create new federation info if it doesn't exist
                
            }
            if (fedInfo2 == null) {
                fedInfo2 = {
                    id: spaceId2,
                    name: spaceId2,
                    federation: [],
                    notify: [],
                    timestamp: Date.now()
                };
            }
            
            // Add nEnsure arrays exist
    
            if (!fedInfo2.notify) fedInfo2.notify = [];

            // Add space1 to space2's federation list if not already present
            if (!fedInfo2.notify.includes(spaceId1)) {
                fedInfo2.notify.push(spaceId1);
            }
 

            // Update timestamp
            fedInfo2.timestamp = Date.now();

            // Save updated federation info for space2
            try {
                await holosphere.putGlobal('federation', fedInfo2, password2);
                console.log(`Updated federation info for ${spaceId2}`);
            } catch (error) {
                console.warn(`Could not update federation info for ${spaceId2}: ${error.message}`);
                // Don't throw here as the main federation was successful
            }
        }

        // Create federation metadata record
        const federationMeta = {
            id: `${spaceId1}_${spaceId2}`,
            space1: spaceId1,
            space2: spaceId2,
            created: Date.now(),
            status: 'active',
            bidirectional: bidirectional
        };
        
        try {
            await holosphere.putGlobal('federationMeta', federationMeta);
            console.log(`Created federation metadata for ${spaceId1} and ${spaceId2}`);
        } catch (error) {
            console.warn(`Could not create federation metadata: ${error.message}`);
        }

        return true;
    } catch (error) {
        console.error(`Federation creation failed: ${error.message}`);
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
                            console.warn('Federation notification error:', error);
                        }
                    });
                    
                    if (sub && typeof sub.unsubscribe === 'function') {
                        subscriptions.push(sub);
                    }
                } catch (error) {
                    console.warn(`Error creating subscription for ${federatedSpace}/${lens}:`, error);
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
                    console.warn('Error unsubscribing:', error);
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
            console.warn(`Could not get federation info for ${spaceId1}: ${error.message}`);
        }
        
        if (!fedInfo1 || !fedInfo1.federation) {
            console.warn(`Federation not found for space ${spaceId1}`);
            // Continue anyway to clean up any potential metadata
        } else {
            // Update first space federation info
            fedInfo1.federation = fedInfo1.federation.filter(id => id !== spaceId2);
            fedInfo1.timestamp = Date.now();
            
            try {
                await holosphere.putGlobal('federation', fedInfo1, password1);
                console.log(`Updated federation info for ${spaceId1}`);
            } catch (error) {
                console.warn(`Could not update federation info for ${spaceId1}: ${error.message}`);
            }
        }

        // Update second space federation info if password provided
        if (password2) {
            let fedInfo2 = null;
            try {
                fedInfo2 = await holosphere.getGlobal('federation', spaceId2, password2);
            } catch (error) {
                console.warn(`Could not get federation info for ${spaceId2}: ${error.message}`);
            }
            
            if (fedInfo2 && fedInfo2.notify) {
                fedInfo2.notify = fedInfo2.notify.filter(id => id !== spaceId1);
                fedInfo2.timestamp = Date.now();
                
                try {
                    await holosphere.putGlobal('federation', fedInfo2, password2);
                    console.log(`Updated federation info for ${spaceId2}`);
                } catch (error) {
                    console.warn(`Could not update federation info for ${spaceId2}: ${error.message}`);
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
                await holosphere.putGlobal('federationMeta', meta);
                console.log(`Updated federation metadata for ${spaceId1} and ${spaceId2}`);
            }
        } catch (error) {
            console.warn(`Could not update federation metadata: ${error.message}`);
        }

        return true;
    } catch (error) {
        console.error(`Federation removal failed: ${error.message}`);
        throw error;
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
            console.log(`Removed ${spaceId2} from ${spaceId1}'s notify list`);
            return true;
        } else {
            console.log(`${spaceId2} not found in ${spaceId1}'s notify list`);
            return false;
        }
    } catch (error) {
        console.error(`Remove notification failed: ${error.message}`);
        throw error;
    }
}

/**
 * Get and combine data from local and federated sources
 * @param {HoloSphere} holosphere The HoloSphere instance
 * @param {string} holon The local holon name
 * @param {string} lens The lens to query
 * @param {Object} options Options for data retrieval and aggregation
 * @param {boolean} options.aggregate Whether to aggregate results by ID (default: false)
 * @param {string} options.idField The field to use as ID (default: '_id')
 * @param {string[]} options.sumFields Fields to sum during aggregation (default: [])
 * @param {string[]} options.concatArrays Array fields to concatenate during aggregation (default: [])
 * @param {boolean} options.removeDuplicates Whether to remove duplicates in concatenated arrays (default: true)
 * @param {Function} options.mergeStrategy Custom merge function for aggregation (default: null)
 * @param {boolean} options.includeLocal Whether to include local data (default: true)
 * @param {boolean} options.includeFederated Whether to include federated data (default: true)
 * @param {boolean} options.resolveReferences Whether to resolve federation references (default: true)
 * @param {number} options.maxFederatedSpaces Maximum number of federated spaces to query (default: -1 for all)
 * @param {number} options.timeout Timeout in milliseconds for federated queries (default: 10000)
 * @returns {Promise<Array>} Combined array of local and federated data
 */
export async function getFederated(holosphere, holon, lens, options = {}) {
    console.log(`getFederated called with options:`, JSON.stringify(options));
    
    // Set default options
    const { 
        aggregate = false,
        idField = 'id',
        sumFields = [],
        concatArrays = [],
        removeDuplicates = true,
        mergeStrategy = null,
        includeLocal = true,
        includeFederated = true,
        resolveReferences = true, // Default to true
        maxFederatedSpaces = -1,
        timeout = 10000
    } = options;
    
    console.log(`resolveReferences option: ${resolveReferences}`);
    
    // Validate required parameters
    if (!holosphere || !holon || !lens) {
        throw new Error('Missing required parameters: holosphere, holon, and lens are required');
    }

    // Get federation info for current space
    // Use holon as the space ID
    const spaceId = holon;
    const fedInfo = await getFederation(holosphere, spaceId);
    
    console.log(`Federation info retrieved:`, JSON.stringify(fedInfo));
    
    // Initialize result array and track processed IDs to avoid duplicates
    const result = [];
    const processedIds = new Set();
    const references = new Map(); // To keep track of references for resolution
    
    // Process each federated space first to prioritize federation data
    if (includeFederated && fedInfo && fedInfo.federation && fedInfo.federation.length > 0) {
        console.log(`Found ${fedInfo.federation.length} federated spaces`);
        
        // Limit number of federated spaces to query
        const federatedSpaces = maxFederatedSpaces === -1 ? fedInfo.federation : fedInfo.federation.slice(0, maxFederatedSpaces);
        console.log(`Will process ${federatedSpaces.length} federated spaces: ${JSON.stringify(federatedSpaces)}`);
        
        // Process federated spaces
        for (const federatedSpace of federatedSpaces) {
            try {
                console.log(`=== PROCESSING FEDERATED SPACE: ${federatedSpace} ===`);
                
                // Get all data for this lens from the federated space
                const federatedItems = await holosphere.getAll(federatedSpace, lens);
                console.log(`Got ${federatedItems.length} items from federated space ${federatedSpace}`);
                console.log(`Federated items:`, JSON.stringify(federatedItems));
                
                // Process each item
                for (const item of federatedItems) {
                    if (!item) {
                        console.log('Item is null or undefined, skipping');
                        continue;
                    }
                    
                    console.log(`Checking item for ID field '${idField}':`, item);
                    
                    if (!item[idField]) {
                        console.log(`Item missing ID field '${idField}', available fields:`, Object.keys(item));
                        continue;
                    }
                    
                    // For now, just add this item to results, we'll resolve references later
                    result.push(item);
                    processedIds.add(item[idField]);
                }
            } catch (error) {
                console.warn(`Error processing federated space ${federatedSpace}: ${error.message}`);
            }
        }
    }
    
    // Now get local data if requested
    if (includeLocal) {
        const localData = await holosphere.getAll(holon, lens);
        console.log(`Got ${localData.length} local items from holon ${holon}`);
        
        // Add each local item to results, but only if not already processed
        for (const item of localData) {
            if (item && item[idField] && !processedIds.has(item[idField])) {
                result.push(item);
                processedIds.add(item[idField]);
            } else if (item && item[idField]) {
                console.log(`Local item ${item[idField]} already in result from federation, skipping`);
            }
        }
    }
    
    // Now resolve references if needed
    if (resolveReferences) {
        console.log(`Resolving references for ${result.length} items`);
        
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
                            console.log(`Reference resolved successfully via soul path, processed item:`, JSON.stringify(result[i]));
                        } else {
                            console.warn(`Could not resolve reference: original data not found at extracted path`);
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
                    console.warn(`Error resolving reference by soul in getFederated: ${refError.message}`);
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
                        console.log(`Legacy reference resolved successfully, processed item:`, JSON.stringify(result[i]));
                    } else {
                        console.warn(`Could not resolve legacy reference: original data not found`);
                    }
                } catch (refError) {
                    console.warn(`Error resolving legacy reference in getFederated: ${refError.message}`);
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
 * @param {boolean} [options.useReferences=true] - Whether to use references instead of duplicating data
 * @param {string[]} [options.targetSpaces] - Specific target spaces to propagate to (defaults to all federated spaces)
 * @param {string} [options.password] - Password for accessing the source holon (if needed)
 * @returns {Promise<object>} - Result with success count and errors
 */
export async function propagate(holosphere, holon, lens, data, options = {}) {
    if (!holosphere || !holon || !lens || !data) {
        throw new Error('propagate: Missing required parameters');
    }
    // Default propagation options
    const {
        useReferences = true,
        targetSpaces = null,
        password = null
    } = options;

    const result = {
        success: 0,
        errors: 0,
        errorDetails: [],
        propagated: false,
        referencesUsed: useReferences
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
        
        // Check if data is already a reference
        const isAlreadyReference = holosphere.isReference(data);
        
        // For each target space, propagate the data
        const propagatePromises = spaces.map(async (targetSpace) => {
            try {
                // If using references and data isn't already a reference, create a reference
                if (useReferences && !isAlreadyReference) {
                    // Create a reference object using the dedicated utility
                    const reference = holosphere.createReference(holon, lens, data);
                    
                    // Add federation metadata
                    reference._federation = {
                        origin: holon,
                        lens: lens,
                        timestamp: Date.now()
                    };
                    
                    console.log(`Using reference: ${reference.soul} for data: ${data.id}`);
                    
                    // Store the reference in the target space without propagation
                    await holosphere.put(targetSpace, lens, reference, null, { autoPropagate: false });
                    
                    result.success++;
                    return true;
                } 
                // If already a reference, propagate it as is
                else if (isAlreadyReference) {
                    // Add federation metadata if needed
                    const referenceToStore = {
                        ...data,
                        _federation: data._federation || {
                            origin: holon,
                            lens: lens,
                            timestamp: Date.now()
                        }
                    };
                    
                    await holosphere.put(targetSpace, lens, referenceToStore, null, { autoPropagate: false });
                    result.success++;
                    return true;
                } 
                // Otherwise, store a full copy without propagation
                else {
                    const dataToStore = {
                        ...data,
                        _federation: {
                            origin: holon,
                            lens: lens,
                            timestamp: Date.now()
                        }
                    };
                    await holosphere.put(targetSpace, lens, dataToStore, null, { autoPropagate: false });
                    result.success++;
                    return true;
                }
            } catch (error) {
                result.errors++;
                result.errorDetails.push({
                    space: targetSpace,
                    error: error.message
                });
                return false;
            }
        });
        
        await Promise.all(propagatePromises);
        
        result.propagated = result.success > 0;
        return result;
    } catch (error) {
        console.error('Error in propagate:', error);
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
            console.warn(`Failed to update federated message in chat ${msg.chatId}:`, error);
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
                        console.log(`Updated federation info for partner ${partnerSpace}`);
                        result.partnersNotified++;
                        return true;
                    }
                    return false;
                } catch (error) {
                    console.warn(`Could not update federation info for partner ${partnerSpace}: ${error.message}`);
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
                        console.log(`Updated federation metadata for ${spaceId} and ${partnerSpace}`);
                    }
                } catch (error) {
                    console.warn(`Could not update federation metadata for ${partnerSpace}: ${error.message}`);
                }
            }
        }
        
        result.success = true;
        return result;
    } catch (error) {
        console.error(`Federation reset failed: ${error.message}`);
        return {
            ...result,
            success: false,
            error: error.message
        };
    }
} 