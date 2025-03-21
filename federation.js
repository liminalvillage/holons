/**
 * Federation functionality for HoloSphere
 * Provides methods for creating, managing, and using federated spaces
 */

/**
 * Creates a federation relationship between two spaces
 * @param {object} holosphere - The HoloSphere instance
 * @param {string} spaceId1 - The first space ID
 * @param {string} spaceId2 - The second space ID
 * @param {string} [password1] - Optional password for the first space
 * @param {string} [password2] - Optional password for the second space
 * @param {boolean} [bidirectional=true] - Whether to set up bidirectional notifications
 * @returns {Promise<boolean>} - True if federation was created successfully
 */
export async function federate(holosphere, spaceId1, spaceId2, password1 = null, password2 = null, bidirectional = true) {
    if (!spaceId1 || !spaceId2) {
        throw new Error('federate: Missing required space IDs');
    }

    // Prevent self-federation
    if (spaceId1 === spaceId2) {
        throw new Error('Cannot federate a space with itself');
    }

    // Verify access to both spaces before proceeding
    let canAccessSpace1 = false;
    let canAccessSpace2 = false;
    
    try {
        // Test authentication for first space
        if (password1) {
            try {
                await new Promise((resolve, reject) => {
                    const user = holosphere.gun.user();
                    user.auth(holosphere.userName(spaceId1), password1, (ack) => {
                        if (ack.err) {
                            console.warn(`Authentication test for ${spaceId1} failed: ${ack.err}`);
                            reject(new Error(`Authentication failed for ${spaceId1}: ${ack.err}`));
                        } else {
                            canAccessSpace1 = true;
                            resolve();
                        }
                    });
                });
            } catch (error) {
                // Try to create the user if authentication fails
                try {
                    await new Promise((resolve, reject) => {
                        const user = holosphere.gun.user();
                        user.create(holosphere.userName(spaceId1), password1, (ack) => {
                            if (ack.err && !ack.err.includes('already created')) {
                                reject(new Error(`User creation failed for ${spaceId1}: ${ack.err}`));
                            } else {
                                // Try to authenticate again
                                user.auth(holosphere.userName(spaceId1), password1, (authAck) => {
                                    if (authAck.err) {
                                        reject(new Error(`Authentication failed after creation for ${spaceId1}: ${authAck.err}`));
                                    } else {
                                        canAccessSpace1 = true;
                                        resolve();
                                    }
                                });
                            }
                        });
                    });
                } catch (createError) {
                    console.warn(`Could not create or authenticate user for ${spaceId1}: ${createError.message}`);
                    // Continue with limited functionality
                }
            }
        } else {
            // No password required, assume we can access
            canAccessSpace1 = true;
        }
        
        // Test authentication for second space if password provided
        if (password2) {
            try {
                await new Promise((resolve, reject) => {
                    const user = holosphere.gun.user();
                    user.auth(holosphere.userName(spaceId2), password2, (ack) => {
                        if (ack.err) {
                            console.warn(`Authentication test for ${spaceId2} failed: ${ack.err}`);
                            reject(new Error(`Authentication failed for ${spaceId2}: ${ack.err}`));
                        } else {
                            canAccessSpace2 = true;
                            resolve();
                        }
                    });
                });
            } catch (error) {
                // Try to create the user if authentication fails
                try {
                    await new Promise((resolve, reject) => {
                        const user = holosphere.gun.user();
                        user.create(holosphere.userName(spaceId2), password2, (ack) => {
                            if (ack.err && !ack.err.includes('already created')) {
                                reject(new Error(`User creation failed for ${spaceId2}: ${ack.err}`));
                            } else {
                                // Try to authenticate again
                                user.auth(holosphere.userName(spaceId2), password2, (authAck) => {
                                    if (authAck.err) {
                                        reject(new Error(`Authentication failed after creation for ${spaceId2}: ${authAck.err}`));
                                    } else {
                                        canAccessSpace2 = true;
                                        resolve();
                                    }
                                });
                            }
                        });
                    });
                } catch (createError) {
                    console.warn(`Could not create or authenticate user for ${spaceId2}: ${createError.message}`);
                    // Continue with limited functionality
                }
            }
        } else {
            // No password required, assume we can access
            canAccessSpace2 = true;
        }
        
        // Warn if we can't access one or both spaces
        if (!canAccessSpace1) {
            console.warn(`Limited access to space ${spaceId1} - federation may be incomplete`);
        }
        if (password2 && !canAccessSpace2) {
            console.warn(`Limited access to space ${spaceId2} - federation may be incomplete`);
        }

        // Get existing federation info for both spaces
        let fedInfo1 = null;
        let fedInfo2 = null;
        
        try {
            fedInfo1 = await holosphere.getGlobal('federation', spaceId1, password1);
        } catch (error) {
            console.warn(`Could not get federation info for ${spaceId1}: ${error.message}`);
            // Create new federation info if we couldn't get existing
            fedInfo1 = {
                id: spaceId1,
                name: spaceId1,
                federation: [],
                notify: [],
                timestamp: Date.now()
            };
        }
        
        if (password2) {
            try {
                fedInfo2 = await holosphere.getGlobal('federation', spaceId2, password2);
            } catch (error) {
                console.warn(`Could not get federation info for ${spaceId2}: ${error.message}`);
                // Create new federation info if we couldn't get existing
                fedInfo2 = {
                    id: spaceId2,
                    name: spaceId2,
                    federation: [],
                    notify: [],
                    timestamp: Date.now()
                };
            }
        }

        // Check if federation already exists
        if (fedInfo1 && fedInfo1.federation && fedInfo1.federation.includes(spaceId2)) {
            console.log(`Federation already exists between ${spaceId1} and ${spaceId2}`);
            return true;
        }

        // Create or update federation info for first space
        if (!fedInfo1) {
            fedInfo1 = {
                id: spaceId1,
                name: spaceId1,
                federation: [],
                notify: [],
                timestamp: Date.now()
            };
        }
        
        if (!fedInfo1.federation) fedInfo1.federation = [];
        if (!fedInfo1.federation.includes(spaceId2)) {
            fedInfo1.federation.push(spaceId2);
        }
        
        // Automatically add notify setting for space1 to notify space2
        if (!fedInfo1.notify) fedInfo1.notify = [];
        if (bidirectional && !fedInfo1.notify.includes(spaceId2)) {
            fedInfo1.notify.push(spaceId2);
        }
        
        fedInfo1.timestamp = Date.now();

        // Create or update federation info for second space
        if (password2 && canAccessSpace2) {
            if (!fedInfo2) {
                fedInfo2 = {
                    id: spaceId2,
                    name: spaceId2,
                    federation: [],
                    notify: [],
                    timestamp: Date.now()
                };
            }
            
            // Add space1 to space2's federation if not already there
            if (!fedInfo2.federation) fedInfo2.federation = [];
            if (!fedInfo2.federation.includes(spaceId1)) {
                fedInfo2.federation.push(spaceId1);
            }
            
            // Automatically add notify setting for space2 to notify space1
            if (!fedInfo2.notify) fedInfo2.notify = [];
            if (bidirectional && !fedInfo2.notify.includes(spaceId1)) {
                fedInfo2.notify.push(spaceId1);
            }
            
            fedInfo2.timestamp = Date.now();
            
            // Save second federation record if we have password and access
            try {
                await holosphere.putGlobal('federation', fedInfo2, password2);
                console.log(`Updated federation info for ${spaceId2}`);
            } catch (error) {
                console.warn(`Could not update federation info for ${spaceId2}: ${error.message}`);
            }
        }

        // Save first federation record
        try {
            await holosphere.putGlobal('federation', fedInfo1, password1);
            console.log(`Updated federation info for ${spaceId1}`);
        } catch (error) {
            console.warn(`Could not update federation info for ${spaceId1}: ${error.message}`);
            throw new Error(`Failed to create federation: ${error.message}`);
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
        idField = '_id',
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
                        
                        // Get original data using the extracted path
                        const originalData = await holosphere.get(
                            originHolon,
                            originLens,
                            originKey,
                            null,
                            { resolveReferences: false } // Prevent infinite recursion
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
                        }
                    } else {
                        console.warn(`Soul doesn't match expected format: ${item.soul}`);
                    }
                } catch (refError) {
                    console.warn(`Error resolving reference by soul in getFederated: ${refError.message}`);
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
 * @param {string[]} [options.targetSpaces] - Specific spaces to propagate to (default: all federated)
 * @param {boolean} [options.addFederationMetadata=true] - Whether to add federation metadata
 * @param {boolean} [options.useReferences=true] - Whether to use references instead of duplicating data
 * @returns {Promise<object>} - Result with success count and errors
 */
export async function propagateToFederation(holosphere, holon, lens, data, options = {}) {
    if (!holon || !lens || !data) {
        return { message: 'Missing required parameters', errors: 1, success: 0 };
    }

    const {
        targetSpaces = [],
        addFederationMetadata = true,
        useReferences = true
    } = options;

    try {
        // Get federation info for the source holon
        const fedInfo = await getFederation(holosphere, holon);
        if (!fedInfo || !fedInfo.notify || fedInfo.notify.length === 0) {
            return {
                message: `No federation notify settings found for ${holon}`,
                errors: 0,
                success: 0,
                notPropagated: true
            };
        }

        // Filter notify spaces based on targetSpaces if provided
        const spacesToNotify = targetSpaces.length > 0 
            ? fedInfo.notify.filter(space => targetSpaces.includes(space))
            : fedInfo.notify;

        if (spacesToNotify.length === 0) {
            return {
                message: 'No matching spaces to notify',
                errors: 0,
                success: 0,
                notPropagated: true
            };
        }

        let successes = 0;
        let errors = 0;
        const errorDetails = [];

        // Create federation metadata
        const dataWithMetadata = { ...data };
        if (addFederationMetadata && !dataWithMetadata.federation) {
            dataWithMetadata.federation = {
                origin: holon,
                timestamp: Date.now(),
                propagated: true
            };
        }

        // If using references, generate the soul path for the original data
        const dataSoul = useReferences 
            ? `${holosphere.appname}/${holon}/${lens}/${data.id}`
            : null;
            
        console.log(`Using soul reference: ${dataSoul} for data:`, data.id);

        // Create the reference object that will be stored in federated spaces
        const referenceObject = useReferences 
            ? {
                id: data.id,
                soul: dataSoul  // Store just the soul reference to the original data
            }
            : dataWithMetadata;

        // Propagate to each space in the notify list
        for (const targetSpace of spacesToNotify) {
            try {
                // Skip self-propagation
                if (targetSpace === holon) continue;

                // Store either the reference or the full data in the target space
                await holosphere.put(targetSpace, lens, referenceObject);
                successes++;
            } catch (error) {
                console.error(`Error propagating to ${targetSpace}:`, error);
                errors++;
                errorDetails.push({
                    space: targetSpace,
                    error: error.message
                });
            }
        }

        return {
            success: successes,
            errors,
            errorDetails,
            propagated: successes > 0,
            referencesUsed: useReferences
        };
    } catch (error) {
        console.error('Error in propagateToFederation:', error);
        return {
            message: error.message,
            errors: 1,
            success: 0
        };
    }
} 