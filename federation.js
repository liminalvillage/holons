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
 * @returns {Promise<boolean>} - True if federation was created successfully
 */
export async function federate(holosphere, spaceId1, spaceId2, password1 = null, password2 = null) {
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
            if (!fedInfo2.notify) fedInfo2.notify = [];
            if (!fedInfo2.notify.includes(spaceId1)) {
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
            status: 'active'
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
 * Gets data from a holon and lens, including data from federated spaces with optional aggregation
 * @param {object} holosphere - The HoloSphere instance
 * @param {string} holon - The holon identifier
 * @param {string} lens - The lens identifier
 * @param {object} options - Options for data retrieval and aggregation
 * @param {boolean} [options.aggregate=false] - Whether to aggregate data
 * @param {string} [options.idField='id'] - Field to use as unique identifier
 * @param {string[]} [options.sumFields=[]] - Fields to sum when aggregating
 * @param {string[]} [options.concatArrays=[]] - Array fields to concatenate
 * @param {boolean} [options.removeDuplicates=true] - Whether to remove duplicates
 * @param {function} [options.mergeStrategy=null] - Custom merge function
 * @param {boolean} [options.includeLocal=true] - Whether to include local data
 * @param {boolean} [options.includeFederated=true] - Whether to include federated data
 * @param {string} [password] - Optional password for accessing private data
 * @returns {Promise<Array>} - Combined array of local and federated data
 */
export async function getFederated(holosphere, holon, lens, options = {}, password = null) {
    // Validate required parameters
    if (!holon || !lens) {
        throw new Error('getFederated: Missing required parameters');
    }

    const {
        aggregate = false,
        idField = 'id',
        sumFields = [],
        concatArrays = [],
        removeDuplicates = true,
        mergeStrategy = null,
        includeLocal = true,
        includeFederated = true,
        maxFederatedSpaces = 10,
        timeout = 5000
    } = options;

    // Get federation info for current space
    // Use holon as the space ID
    const spaceId = holon;
    const fedInfo = await getFederation(holosphere, spaceId, password);
    
    // Initialize result array
    let allData = [];
    
    // Get local data if requested
    if (includeLocal) {
        const localData = await holosphere.getAll(holon, lens, password);
        allData = [...localData];
    }

    // If federation is disabled or no federation exists, return local data only
    if (!includeFederated || !fedInfo || !fedInfo.federation || fedInfo.federation.length === 0) {
        return allData;
    }

    // Limit number of federated spaces to query
    const federatedSpaces = fedInfo.federation.slice(0, maxFederatedSpaces);
    
    // Get data from each federated space with timeout
    const federatedDataPromises = federatedSpaces.map(async (federatedSpace) => {
        try {
            // Create a promise that rejects after timeout
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Federation request timed out')), timeout);
            });
            
            // Create the actual data fetch promise
            const dataPromise = holosphere.getAll(federatedSpace, lens, password);
            
            // Race the promises
            const data = await Promise.race([dataPromise, timeoutPromise]);
            
            // Add federation metadata to each item
            return (data || []).map(item => ({
                ...item,
                federation: {
                    ...item.federation,
                    origin: federatedSpace,
                    timestamp: item.federation?.timestamp || Date.now()
                }
            }));
        } catch (error) {
            console.warn(`Error getting data from federated space ${federatedSpace}:`, error);
            return [];
        }
    });

    // Wait for all federated data requests to complete
    const federatedResults = await Promise.allSettled(federatedDataPromises);
    
    // Add successful results to allData
    federatedResults.forEach(result => {
        if (result.status === 'fulfilled') {
            allData = [...allData, ...result.value];
        }
    });

    // If aggregating, use enhanced aggregation logic
    if (aggregate) {
        const aggregated = new Map();

        for (const item of allData) {
            const itemId = item[idField];
            if (!itemId) continue;

            const existing = aggregated.get(itemId);
            if (!existing) {
                aggregated.set(itemId, { ...item });
            } else {
                // If custom merge strategy is provided, use it
                if (mergeStrategy && typeof mergeStrategy === 'function') {
                    aggregated.set(itemId, mergeStrategy(existing, item));
                    continue;
                }

                // Enhanced default merge strategy
                const merged = { ...existing };

                // Sum numeric fields
                for (const field of sumFields) {
                    if (typeof item[field] === 'number') {
                        merged[field] = (merged[field] || 0) + (item[field] || 0);
                    }
                }

                // Concatenate and deduplicate array fields
                for (const field of concatArrays) {
                    if (Array.isArray(item[field])) {
                        const combinedArray = [
                            ...(merged[field] || []),
                            ...(item[field] || [])
                        ];
                        // Remove duplicates if elements are primitive
                        merged[field] = Array.from(new Set(combinedArray));
                    }
                }

                // Update federation metadata
                merged.federation = {
                    ...merged.federation,
                    timestamp: Math.max(
                        merged.federation?.timestamp || 0,
                        item.federation?.timestamp || 0
                    ),
                    origins: Array.from(new Set([
                        ...(Array.isArray(merged.federation?.origins) ? merged.federation.origins : 
                            (merged.federation?.origin ? [merged.federation.origin] : [])),
                        ...(Array.isArray(item.federation?.origins) ? item.federation.origins : 
                            (item.federation?.origin ? [item.federation.origin] : []))
                    ]))
                };

                // Update the aggregated item
                aggregated.set(itemId, merged);
            }
        }

        return Array.from(aggregated.values());
    }

    // If not aggregating, optionally remove duplicates based on idField
    if (!removeDuplicates) {
        return allData;
    }

    // Remove duplicates keeping the most recent version
    const uniqueMap = new Map();
    allData.forEach(item => {
        const id = item[idField];
        if (!id) return;

        const existing = uniqueMap.get(id);
        if (!existing ||
            (item.federation?.timestamp > (existing.federation?.timestamp || 0))) {
            uniqueMap.set(id, item);
        }
    });
    return Array.from(uniqueMap.values());
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
 * @returns {Promise<object>} - Result with success count and errors
 */
export async function propagateToFederation(holosphere, holon, lens, data, options = {}) {
    if (!holon || !lens || !data) {
        throw new Error('propagateToFederation: Missing required parameters');
    }
    
    if (!data.id) {
        data.id = holosphere.generateId();
    }
    
    const {
        targetSpaces = null,
        addFederationMetadata = true
    } = options;
    
    try {
        // Get federation info for current space
        // Use holon as the space ID
        const spaceId = holon;
        const fedInfo = await getFederation(holosphere, spaceId);
        if (!fedInfo || !fedInfo.notify || fedInfo.notify.length === 0) {
            return { success: 0, errors: 0, message: 'No federation to propagate to' };
        }
        
        // Determine which spaces to propagate to
        const spacesToNotify = targetSpaces ? 
            fedInfo.notify.filter(spaceId => targetSpaces.includes(spaceId)) : 
            fedInfo.notify;
            
        if (spacesToNotify.length === 0) {
            return { success: 0, errors: 0, message: 'No matching spaces to propagate to' };
        }
        
        // Add federation metadata if requested
        const dataToPropagate = { ...data };
        if (addFederationMetadata) {
            dataToPropagate.federation = {
                ...dataToPropagate.federation,
                origin: spaceId,
                timestamp: Date.now()
            };
        }
        
        // Track results
        const results = {
            success: 0,
            errors: 0,
            errorDetails: []
        };

        // Propagate to each federated space
        const propagationPromises = spacesToNotify.map(spaceId =>
            new Promise((resolve) => {
                try {
                    // Store data in the federated space's lens
                    holosphere.gun.get(holosphere.appname)
                        .get(spaceId)
                        .get(lens)
                        .get(dataToPropagate.id)
                        .put(JSON.stringify(dataToPropagate), ack => {
                            if (ack.err) {
                                results.errors++;
                                results.errorDetails.push({
                                    space: spaceId,
                                    error: ack.err
                                });
                            } else {
                                results.success++;
                            }
                            resolve();
                        });
                } catch (error) {
                    results.errors++;
                    results.errorDetails.push({
                        space: spaceId,
                        error: error.message
                    });
                    resolve();
                }
            })
        );

        await Promise.all(propagationPromises);
        return results;
    } catch (error) {
        console.warn('Federation propagation error:', error);
        return { 
            success: 0, 
            errors: 1, 
            message: error.message,
            errorDetails: [{ error: error.message }]
        };
    }
} 