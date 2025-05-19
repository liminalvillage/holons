// holo_content.js

/**
 * Stores content in the specified holon and lens.
 * If the target path already contains a hologram, the put operation will be
 * redirected to store the new data at the location specified in the existing
 * hologram's soul.
 * If the stored data (after potential redirection) is a hologram, this function
 * also attempts to update the target data node's `_holograms` set.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holon - The initial holon identifier.
 * @param {string} lens - The initial lens under which to store the content.
 * @param {object} data - The data to store.
 * @param {string} [password] - Optional password for private holon.
 * @param {object} [options] - Additional options
 * @param {boolean} [options.autoPropagate=true] - Whether to automatically propagate to federated holons (default: true)
 * @param {object} [options.propagationOptions] - Options to pass to propagate
 * @param {boolean} [options.propagationOptions.useHolograms=true] - Whether to use holograms instead of duplicating data
 * @returns {Promise<boolean>} - Returns true if successful, false if there was an error
 */
export async function put(holoInstance, holon, lens, data, password = null, options = {}) {
    if (!data) { // Check data first as it's used for id generation
        throw new Error('put: Missing required data parameter');
    }
    if (!holon || !lens) {
        throw new Error('put: Missing required holon or lens parameters:', holon, lens);
    }

    let targetHolon = holon;
    let targetLens = lens;
    let targetKey = data.id; // Use data.id as the key

    if (!targetKey) {
        targetKey = holoInstance.generateId();
        data.id = targetKey; // Assign the generated ID back to the data
    }

    // --- Start: Target Path Hologram Redirection Logic ---
    try {
        // Get the item at the original target path, WITHOUT resolving holograms
        const existingItemAtPath = await get(holoInstance, targetHolon, targetLens, targetKey, password, { resolveHolograms: false });

        if (existingItemAtPath && holoInstance.isHologram(existingItemAtPath)) {
            const soulInfo = holoInstance.parseSoulPath(existingItemAtPath.soul);
            if (soulInfo) {
                // Optional: Check if soulInfo.appname matches holoInstance.appname
                if (soulInfo.appname !== holoInstance.appname) {
                    console.warn(`Existing hologram at ${targetHolon}/${targetLens}/${targetKey} has appname (${soulInfo.appname}) in its soul ${existingItemAtPath.soul} which does not match current HoloSphere instance appname (${holoInstance.appname}). Redirecting put to soul's holon/lens within this instance.`);
                }
                console.log(`Redirecting put for data (ID: ${data.id}). Original target ${targetHolon}/${targetLens}/${targetKey} contained hologram (ID: ${existingItemAtPath.id}, Soul: ${existingItemAtPath.soul}). New target is ${soulInfo.holon}/${soulInfo.lens}/${soulInfo.key}.`);
                targetHolon = soulInfo.holon; // Redirect holon
                targetLens = soulInfo.lens;   // Redirect lens
                targetKey = soulInfo.key;     // Redirect key (important!)
                                              // data.id should ideally match soulInfo.key if this is consistent.
                                              // If data.id is different, it means we are writing data with one ID to a path derived from another ID's soul.
                if (data.id !== targetKey) {
                    console.warn(`Data ID ('${data.id}') differs from redirected target key ('${targetKey}') derived from existing hologram's soul. Data will be stored under key '${targetKey}'.`);
                    // It's crucial that the actual GunDB path uses targetKey.
                    // The 'data' object itself retains its original 'data.id' unless explicitly changed.
                }

            } else {
                console.warn(`Existing item at ${targetHolon}/${targetLens}/${targetKey} (ID: ${existingItemAtPath.id}) is a hologram, but its soul ('${existingItemAtPath.soul}') is invalid. Proceeding with original target.`);
            }
        }
    } catch (error) {
        // If 'get' fails (e.g., item not found, auth error), proceed with original target.
        // A "not found" error is expected if the path is new.
        if (error.message && error.message.includes('RESOLVED_NULL')) {
             // This is fine, means nothing was at the path.
        } else {
            console.warn(`Error checking for existing hologram at ${targetHolon}/${targetLens}/${targetKey}: ${error.message}. Proceeding with original target.`);
        }
    }
    // --- End: Target Path Hologram Redirection Logic ---

    // The data being stored is 'data'. Its 'id' property is 'data.id'.
    // The final storage path key is 'targetKey'.

    // Check if the data *being put* is a hologram (this variable is used later for schema and propagation)
    const isHologram = holoInstance.isHologram(data);

    // Get and validate schema only in strict mode for non-holograms (data being put)
    if (holoInstance.strict && !isHologram) {
        const schema = await holoInstance.getSchema(targetLens); // Use targetLens for schema
        if (!schema) {
            throw new Error('Schema required in strict mode');
        }
        const dataToValidate = JSON.parse(JSON.stringify(data)); // Validate the actual data
        const valid = holoInstance.validator.validate(schema, dataToValidate);

        if (!valid) {
            const errorMsg = `Schema validation failed: ${JSON.stringify(holoInstance.validator.errors)}`;
            throw new Error(errorMsg);
        }
    }

    try {
        let user = null;
        if (password) {
            user = holoInstance.gun.user();
            await new Promise((resolve, reject) => {
                user.auth(holoInstance.userName(targetHolon), password, (ack) => { // Use targetHolon for auth
                    if (ack.err) reject(new Error(ack.err));
                    else resolve();
                });
            });
        }

        return new Promise((resolve, reject) => {
            try {
                const payload = JSON.stringify(data); // The data being stored

                const putCallback = async (ack) => {
                    if (ack.err) {
                        reject(new Error(ack.err));
                    } else {
                        // --- Start: Hologram Tracking Logic (for data *being put*, if it's a hologram) ---
                        if (isHologram) {
                            try {
                                const storedDataSoulInfo = holoInstance.parseSoulPath(data.soul);
                                if (storedDataSoulInfo) {
                                    const targetNodeRef = holoInstance.getNodeRef(data.soul); // Target of the data *being put*
                                    // Soul of the hologram that was *actually stored* at targetHolon/targetLens/targetKey
                                    const storedHologramInstanceSoul = `${holoInstance.appname}/${targetHolon}/${targetLens}/${targetKey}`;
                                    
                                    targetNodeRef.get('_holograms').get(storedHologramInstanceSoul).put(true);
                                    
                                    console.log(`Data (ID: ${data.id}) being put is a hologram. Added its instance soul ${storedHologramInstanceSoul} to its target ${data.soul}'s _holograms set.`);
                                } else {
                                    console.warn(`Data (ID: ${data.id}) being put is a hologram, but could not parse its soul ${data.soul} for tracking.`);
                                }
                            } catch (trackingError) {
                                console.warn(`Error updating _holograms set for the target of the data being put (data ID: ${data.id}, soul: ${data.soul}):`, trackingError);
                            }
                        }
                        // --- End: Hologram Tracking Logic ---
                        
                        // Only notify subscribers for actual data, not holograms
                        if (!isHologram) {
                            holoInstance.notifySubscribers({
                                holon: targetHolon, // Notify with final target
                                lens: targetLens,
                                ...data // The data that was put
                            });
                        }

                        // Auto-propagate to federation by default (if data *being put* is not a hologram)
                        const shouldPropagate = options.autoPropagate !== false && !isHologram;
                        let propagationResult = null;

                        if (shouldPropagate) {
                            try {
                                const propagationOptions = {
                                    useHolograms: true,
                                    ...options.propagationOptions
                                };

                                propagationResult = await holoInstance.propagate(
                                    targetHolon, // Propagate from final target
                                    targetLens,
                                    data, // The data that was put
                                    propagationOptions
                                );

                                if (propagationResult && propagationResult.errors > 0) {
                                    console.warn('Auto-propagation had errors:', propagationResult);
                                }
                            } catch (propError) {
                                console.warn('Error in auto-propagation:', propError);
                            }
                        }

                        resolve({
                            success: true,
                            isHologramAtPath: isHologram, // whether the data *put* was a hologram
                            pathHolon: targetHolon,
                            pathLens: targetLens,
                            pathKey: targetKey,
                            propagationResult
                        });
                    }
                };

                // Use targetHolon, targetLens, and targetKey for the actual storage path
                const dataPath = password ?
                    user.get('private').get(targetLens).get(targetKey) :
                    holoInstance.gun.get(holoInstance.appname).get(targetHolon).get(targetLens).get(targetKey);

                dataPath.put(payload, putCallback);
            } catch (error) {
                reject(error);
            }
        });
    } catch (error) {
        console.error('Error in put:', error);
        throw error;
    }
}

/**
 * Retrieves content from the specified holon and lens.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holon - The holon identifier.
 * @param {string} lens - The lens from which to retrieve content.
 * @param {string} key - The specific key to retrieve.
 * @param {string} [password] - Optional password for private holon.
 * @param {object} [options] - Additional options
 * @param {boolean} [options.resolveHolograms=true] - Whether to automatically resolve holograms
 * @param {object} [options.validationOptions] - Options passed to the schema validator
 * @returns {Promise<object|null>} - The retrieved content or null if not found.
 */
export async function get(holoInstance, holon, lens, key, password = null, options = {}) {
    if (!holon || !lens || !key) {
        console.error('get: Missing required parameters');
        return null;
    }

    // Destructure options, including visited
    const { resolveHolograms = true, validationOptions = {}, visited } = options;

    // Get schema for validation if in strict mode
    let schema = null;
    if (holoInstance.strict) {
        schema = await holoInstance.getSchema(lens);
        if (!schema) {
            throw new Error('Schema required in strict mode');
        }
    }

    try {
        let user = null;
        if (password) {
            user = holoInstance.gun.user();
            await new Promise((resolve, reject) => {
                user.auth(holoInstance.userName(holon), password, (ack) => {
                    if (ack.err) reject(new Error(ack.err));
                    else resolve();
                });
            });
        }

        return new Promise((resolve) => {
            const handleData = async (data) => {
                let parsed = null; // Declare parsed here to make it available in catch
                if (!data) {
                    resolve(null);
                    return;
                }

                try {
                    parsed = await holoInstance.parse(data); // Assign to the outer scoped parsed

                    if (!parsed) {
                        resolve(null);
                        return;
                    }

                    // Check if this is a hologram that needs to be resolved
                    if (resolveHolograms && holoInstance.isHologram(parsed)) {
                        const resolvedValue = await holoInstance.resolveHologram(parsed, {
                            followHolograms: resolveHolograms,
                            visited: visited
                        });

                        console.log(`### get/handleData received resolved value:`, resolvedValue);

                        if (resolvedValue === null) {
                            // This means resolveHologram determined the target doesn't exist or a sub-resolution failed to null.
                            console.warn(`Hologram at ${holon}/${lens}/${key} could not be fully resolved (target not found or sub-problem). Resolving null.`);
                            resolve(null);
                            return; // Important to return after resolving
                        }
                        // If resolveHologram encountered a circular ref, it would throw, not return.
                        // If it returned the hologram itself (if we ever revert to that), this logic would need adjustment.
                        // For now, assume resolvedValue is either the resolved data or we've returned null above.

                        if (resolvedValue !== parsed) { 
                            console.log(`### get/handleData using resolved data:`, resolvedValue);
                            parsed = resolvedValue;
                        }
                    }

                    // Perform schema validation if needed
                    if (schema) {
                        const valid = holoInstance.validator.validate(schema, parsed);
                        if (!valid) {
                            console.error('get: Invalid data according to schema:', holoInstance.validator.errors);
                            if (holoInstance.strict) {
                                resolve(null);
                                return;
                            }
                        }
                    }

                    resolve(parsed);
                } catch (error) {
                    if (error.message?.startsWith('CIRCULAR_REFERENCE')) {
                         console.warn(`Caught circular reference during get/handleData for key ${key}. Resolving null.`);
                         resolve(null); 
                    } else {
                        console.error('Error processing data in get/handleData:', error);
                        resolve(null); // For other errors, resolve null
                    }
                }
            };

            const dataPath = password ?
                user.get('private').get(lens).get(key) :
                holoInstance.gun.get(holoInstance.appname).get(holon).get(lens).get(key);

            dataPath.once(handleData);
        });
    } catch (error) {
        console.error('Error in get:', error);
        return null;
    }
}

/**
 * Retrieves all content from the specified holon and lens.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holon - The holon identifier.
 * @param {string} lens - The lens from which to retrieve content.
 * @param {string} [password] - Optional password for private holon.
 * @returns {Promise<Array<object>>} - The retrieved content.
 */
export async function getAll(holoInstance, holon, lens, password = null) {
    if (!holon || !lens) {
        throw new Error('getAll: Missing required parameters');
    }

    const schema = await holoInstance.getSchema(lens);
    if (!schema && holoInstance.strict) {
        throw new Error('getAll: Schema required in strict mode');
    }

    try {
        let user = null;
        if (password) {
            user = holoInstance.gun.user();
            await new Promise((resolve, reject) => {
                user.auth(holoInstance.userName(holon), password, (ack) => {
                    if (ack.err) reject(new Error(ack.err));
                    else resolve();
                });
            });
        }

        return new Promise((resolve) => {
            const output = new Map();

            const processData = async (data, key) => {
                if (!data || key === '_') return;

                try {
                    const parsed = await holoInstance.parse(data); // Use instance's parse
                    if (!parsed || !parsed.id) return;

                    // Check if this is a hologram that needs to be resolved
                    if (holoInstance.isHologram(parsed)) {
                        const resolved = await holoInstance.resolveHologram(parsed, {
                            followHolograms: true
                        });

                        if (resolved !== parsed) {
                            // Hologram was resolved successfully
                            if (schema) {
                                const valid = holoInstance.validator.validate(schema, resolved);
                                if (valid || !holoInstance.strict) {
                                    output.set(resolved.id, resolved);
                                }
                            } else {
                                output.set(resolved.id, resolved);
                            }
                            return;
                        }
                    }

                    if (schema) {
                        const valid = holoInstance.validator.validate(schema, parsed);
                        if (valid || !holoInstance.strict) {
                            output.set(parsed.id, parsed);
                        }
                    } else {
                        output.set(parsed.id, parsed);
                    }
                } catch (error) {
                    console.error('Error processing data:', error);
                }
            };

            const handleData = async (data) => {
                if (!data) {
                    resolve([]);
                    return;
                }

                const initialPromises = [];
                Object.keys(data)
                    .filter(key => key !== '_')
                    .forEach(key => {
                        initialPromises.push(processData(data[key], key));
                    });

                try {
                    await Promise.all(initialPromises);
                    resolve(Array.from(output.values()));
                } catch (error) {
                    console.error('Error in getAll:', error);
                    resolve([]);
                }
            };

            const dataPath = password ?
                user.get('private').get(lens) :
                holoInstance.gun.get(holoInstance.appname).get(holon).get(lens);

            dataPath.once(handleData);
        });
    } catch (error) {
        console.error('Error in getAll:', error);
        return [];
    }
}

/**
 * Parses data from GunDB, handling various data formats and references.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {*} data - The data to parse, could be a string, object, or GunDB reference.
 * @returns {Promise<object>} - The parsed data.
 */
export async function parse(holoInstance, rawData) {
    if (rawData === null || rawData === undefined) {
        console.warn('Parse received null or undefined data.');
        return null;
    }

    // 1. Handle string data (attempt JSON parse)
    if (typeof rawData === 'string') {
        try {
            return JSON.parse(rawData);
        } catch (error) {
            // It's a string, but not valid JSON. Return null.
            console.warn("Data was a string but not valid JSON, returning null:", rawData);
            return null;
        }
    }

    // 2. Handle object data
    if (typeof rawData === 'object' && rawData !== null) {
        // Check for GunDB soul link (less common now?)
        if (rawData.soul && typeof rawData.soul === 'string' && rawData.id) {
             // This looks like a Hologram object based on structure.
             // Return it as is; resolution happens later if needed.
             return rawData;
        } else if (holoInstance.isHologram(rawData)) {
             // Explicitly check using isHologram (might be redundant if structure check above is reliable)
             return rawData;
        } else if (rawData._) {
            // Handle potential GunDB metadata remnants (attempt cleanup)
            console.warn('Parsing raw Gun object with metadata (_) - attempting cleanup:', rawData);
            const potentialData = Object.keys(rawData).reduce((acc, k) => {
                if (k !== '_') {
                    acc[k] = rawData[k];
                }
                return acc;
            }, {});
            if (Object.keys(potentialData).length === 0) {
                console.warn('Raw Gun object had only metadata (_), returning null.');
                return null;
            }
            return potentialData; // Return cleaned-up object
        } else {
            // Assume it's a regular plain object
            return rawData;
        }
    }

    // 3. Handle other unexpected types
    console.warn("Parsing encountered unexpected data type, returning null:", typeof rawData, rawData);
    return null;
}

/**
 * Deletes a specific key from a given holon and lens.
 * If the deleted data was a hologram, this function also attempts to update the
 * target data node's `_holograms` set by marking the deleted hologram's soul as 'DELETED'.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holon - The holon identifier.
 * @param {string} lens - The lens from which to delete the key.
 * @param {string} key - The specific key to delete.
 * @param {string} [password] - Optional password for private holon.
 * @returns {Promise<boolean>} - Returns true if successful
 */
export async function deleteFunc(holoInstance, holon, lens, key, password = null) { // Renamed to deleteFunc to avoid keyword conflict
    if (!holon || !lens || !key) {
        throw new Error('delete: Missing required parameters');
    }

    try {
        let user = null;
        if (password) {
            user = holoInstance.gun.user();
            await new Promise((resolve, reject) => {
                user.auth(holoInstance.userName(holon), password, (ack) => {
                    if (ack.err) reject(new Error(ack.err));
                    else resolve();
                });
            });
        }

        const dataPath = password ?
            user.get('private').get(lens).get(key) :
            holoInstance.gun.get(holoInstance.appname).get(holon).get(lens).get(key);

        // --- Start: Hologram Tracking Removal ---
        let trackingRemovalPromise = Promise.resolve(); // Default to resolved promise
        
        // 1. Get the data first to check if it's a hologram
        const rawDataToDelete = await new Promise((resolve) => dataPath.once(resolve));
        let dataToDelete = null;
        try {
            if (typeof rawDataToDelete === 'string') {
                dataToDelete = JSON.parse(rawDataToDelete);
            } else {
                // Handle cases where it might already be an object (though likely string)
                dataToDelete = rawDataToDelete; 
            }
        } catch(e) {
            console.warn("[deleteFunc] Could not JSON parse data for deletion check:", rawDataToDelete, e);
            dataToDelete = null; // Ensure it's null if parsing fails
        }

        // 2. If it is a hologram, try to remove its reference from the target
        const isDataHologram = dataToDelete && holoInstance.isHologram(dataToDelete);
        
        if (isDataHologram) {
            try {
                const targetSoul = dataToDelete.soul;
                const targetSoulInfo = holoInstance.parseSoulPath(targetSoul);
                
                if (targetSoulInfo) {
                    const targetNodeRef = holoInstance.getNodeRef(targetSoul);
                    const deletedHologramSoul = `${holoInstance.appname}/${holon}/${lens}/${key}`;

                    // Create a promise that resolves when the put('DELETED') ack is received
                    trackingRemovalPromise = new Promise((resolveTrack) => { // No reject needed, just warn on error
                        targetNodeRef.get('_holograms').get(deletedHologramSoul).put('DELETED', (ack) => { // <-- Use 'DELETED' string
                            if (ack.err) {
                                // Keep this warning for actual errors
                                console.warn(`[deleteFunc] Error ack for marking hologram ${deletedHologramSoul} as DELETED in target ${targetSoul}:`, ack.err);
                            }
                            // Ack received log removed
                            resolveTrack(); // Resolve regardless of ack error to not block main delete
                        });
                    });
                } else {
                    // Keep this warning
                    console.warn(`Could not parse target soul ${targetSoul} for hologram tracking removal.`);
                }
            } catch (trackingError) {
                 // Keep this warning
                console.warn(`Error initiating hologram reference removal from target ${dataToDelete.soul}:`, trackingError);
                // Ensure trackingRemovalPromise remains resolved if setup fails
                trackingRemovalPromise = Promise.resolve(); 
            }
        }
        // --- End: Hologram Tracking Removal ---

        // 3. Wait for the tracking removal attempt to be acknowledged
        await trackingRemovalPromise;
        // Log removed

        // 4. Proceed with the actual deletion of the hologram node itself
        return new Promise((resolve, reject) => {
            dataPath.put(null, ack => {
                if (ack.err) {
                    reject(new Error(ack.err));
                } else {
                    resolve(true);
                }
            });
        });
    } catch (error) {
        console.error('Error in delete:', error);
        throw error;
    }
}

/**
 * Deletes all keys from a given holon and lens.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holon - The holon identifier.
 * @param {string} lens - The lens from which to delete all keys.
 * @param {string} [password] - Optional password for private holon.
 * @returns {Promise<boolean>} - Returns true if successful
 */
export async function deleteAll(holoInstance, holon, lens, password = null) {
    if (!holon || !lens) {
        console.error('deleteAll: Missing holon or lens parameter');
        return false;
    }

    try {
        let user = null;
        if (password) {
            user = holoInstance.gun.user();
            await new Promise((resolve, reject) => {
                user.auth(holoInstance.userName(holon), password, (ack) => {
                    if (ack.err) reject(new Error(ack.err));
                    else resolve();
                });
            });
        }

        return new Promise((resolve) => {
            let deletionPromises = [];

            const dataPath = password ?
                user.get('private').get(lens) :
                holoInstance.gun.get(holoInstance.appname).get(holon).get(lens);

            // First get all the data to find keys to delete
            dataPath.once((data) => {
                if (!data) {
                    resolve(true); // Nothing to delete
                    return;
                }

                // Get all keys except Gun's metadata key '_'
                const keys = Object.keys(data).filter(key => key !== '_');

                // Create deletion promises for each key
                keys.forEach(key => {
                    deletionPromises.push(
                        new Promise((resolveDelete) => {
                            const deletePath = password ?
                                user.get('private').get(lens).get(key) :
                                holoInstance.gun.get(holoInstance.appname).get(holon).get(lens).get(key);

                            deletePath.put(null, ack => {
                                resolveDelete(!!ack.ok); // Convert to boolean
                            });
                        })
                    );
                });

                // Wait for all deletions to complete
                Promise.all(deletionPromises)
                    .then(results => {
                        const allSuccessful = results.every(result => result === true);
                        resolve(allSuccessful);
                    })
                    .catch(error => {
                        console.error('Error in deleteAll:', error);
                        resolve(false);
                    });
            });
        });
    } catch (error) {
        console.error('Error in deleteAll:', error);
        return false;
    }
} 