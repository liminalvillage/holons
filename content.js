// holo_content.js

/**
 * Stores content in the specified holon and lens.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holon - The holon identifier.
 * @param {string} lens - The lens under which to store the content.
 * @param {object} data - The data to store.
 * @param {string} [password] - Optional password for private holon.
 * @param {object} [options] - Additional options
 * @param {boolean} [options.autoPropagate=true] - Whether to automatically propagate to federated holons (default: true)
 * @param {object} [options.propagationOptions] - Options to pass to propagate
 * @param {boolean} [options.propagationOptions.useHolograms=true] - Whether to use holograms instead of duplicating data
 * @returns {Promise<boolean>} - Returns true if successful, false if there was an error
 */
export async function put(holoInstance, holon, lens, data, password = null, options = {}) {
    if (!holon || !lens || !data) {
        throw new Error('put: Missing required parameters:', holon, lens, data);
    }

    if (!data.id) {
        data.id = holoInstance.generateId();
    }

    // Check if this is a hologram we're storing
    const isHolo = holoInstance.isHologram(data);

    // Get and validate schema only in strict mode for non-holograms
    if (holoInstance.strict && !isHolo) {
        const schema = await holoInstance.getSchema(lens);
        if (!schema) {
            throw new Error('Schema required in strict mode');
        }
        const dataToValidate = JSON.parse(JSON.stringify(data));
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
                user.auth(holoInstance.userName(holon), password, (ack) => {
                    if (ack.err) reject(new Error(ack.err));
                    else resolve();
                });
            });
        }

        return new Promise((resolve, reject) => {
            try {
                const payload = JSON.stringify(data);

                const putCallback = async (ack) => {
                    if (ack.err) {
                        reject(new Error(ack.err));
                    } else {
                        // --- Start: Hologram Tracking Logic ---
                        if (isHolo) {
                            try {
                                const targetSoulInfo = holoInstance.parseSoulPath(data.soul);
                                if (targetSoulInfo) {
                                    const targetNodeRef = holoInstance.getNodeRef(data.soul);
                                    // Construct the soul of the hologram *being stored*
                                    const storedHologramSoul = `${holoInstance.appname}/${holon}/${lens}/${data.id}`;
                                    
                                    // Use the stored hologram's soul as the key in the _holograms set
                                    targetNodeRef.get('_holograms').get(storedHologramSoul).put(true); // Store simple marker
                                    
                                    console.log(`Added hologram ${storedHologramSoul} to target ${data.soul}\'s _holograms set.`);
                                } else {
                                    console.warn(`Could not parse target soul ${data.soul} for hologram tracking.`);
                                }
                            } catch (trackingError) {
                                console.warn(`Error updating _holograms set for target ${data.soul}:`, trackingError);
                            }
                        }
                        // --- End: Hologram Tracking Logic ---
                        
                        // Only notify subscribers for actual data, not holograms
                        if (!isHolo) {
                            holoInstance.notifySubscribers({
                                holon,
                                lens,
                                ...data
                            });
                        }

                        // Auto-propagate to federation by default (if not a hologram)
                        const shouldPropagate = options.autoPropagate !== false && !isHolo;
                        let propagationResult = null;

                        if (shouldPropagate) {
                            try {
                                // Default to using holograms
                                const propagationOptions = {
                                    useHolograms: true,
                                    ...options.propagationOptions
                                };

                                propagationResult = await holoInstance.propagate(
                                    holon,
                                    lens,
                                    data,
                                    propagationOptions
                                );

                                // Still resolve with true even if propagation had errors
                                if (propagationResult.errors > 0) {
                                    console.warn('Auto-propagation had errors:', propagationResult);
                                }
                            } catch (propError) {
                                console.warn('Error in auto-propagation:', propError);
                            }
                        }

                        resolve({
                            success: true,
                            isHologram: isHolo,
                            propagationResult
                        });
                    }
                };

                const dataPath = password ?
                    user.get('private').get(lens).get(data.id) :
                    holoInstance.gun.get(holoInstance.appname).get(holon).get(lens).get(data.id);

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
                if (!data) {
                    resolve(null);
                    return;
                }

                try {
                    let parsed = await holoInstance.parse(data);
                    console.log(`### get/handleData received raw data:`, data, `| Parsed:`, parsed);

                    if (!parsed) {
                        console.log('### get/handleData resolving null because parsed is null/falsy');
                        resolve(null);
                        return;
                    }

                    // Check if this is a hologram that needs to be resolved
                    if (resolveHolograms && holoInstance.isHologram(parsed)) {
                        const resolved = await holoInstance.resolveHologram(parsed, {
                            followHolograms: resolveHolograms,
                            visited: visited
                        });

                        console.log(`### get/handleData received resolved value:`, resolved);

                        if (resolved === null) {
                            console.warn(`Hologram at ${holon}/${lens}/${key} points to non-existent data. Resolving null.`);
                            resolve(null);
                            // Throw after resolving to ensure handleData execution stops
                            throw new Error(`RESOLVED_NULL:${key}`); 
                        }

                        if (resolved !== parsed) {
                            console.log(`### get/handleData using resolved data:`, resolved);
                            parsed = resolved;
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

                    console.log(`### get/handleData resolving final value:`, parsed);
                    resolve(parsed);
                } catch (error) {
                    // Catch specific errors if needed, otherwise log and resolve null
                    if (error.message?.startsWith('RESOLVED_NULL')) {
                        // This is expected when resolving a null, already handled by resolve(null)
                        console.log(`Caught RESOLVED_NULL for key ${key}, already resolved null.`);
                    } else if (error.message?.startsWith('CIRCULAR_REFERENCE')) {
                         console.warn(`Caught circular reference during get/handleData for key ${key}. Resolving null.`);
                         // Resolve null to indicate failure due to loop
                         resolve(null);
                    } else {
                        console.error('Error processing data in get/handleData:', error);
                        resolve(null);
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

        // --- Start: Hologram Tracking Removal ---
        const dataPath = password ?
            user.get('private').get(lens).get(key) :
            holoInstance.gun.get(holoInstance.appname).get(holon).get(lens).get(key);

        // 1. Get the data first to check if it's a hologram
        const dataToDelete = await new Promise((resolve) => dataPath.once(resolve));

        // 2. If it is a hologram, try to remove its reference from the target
        if (dataToDelete && holoInstance.isHologram(dataToDelete)) {
            try {
                const targetSoul = dataToDelete.soul;
                const targetSoulInfo = holoInstance.parseSoulPath(targetSoul);
                
                if (targetSoulInfo) {
                    const targetNodeRef = holoInstance.getNodeRef(targetSoul);
                    // The soul of the hologram being deleted IS the soul of dataPath
                    const deletedHologramSoul = Gun.node.soul(dataToDelete);
                    
                    if(deletedHologramSoul) {
                        // Remove the entry from the target's _holograms set by putting null
                        targetNodeRef.get('_holograms').get(deletedHologramSoul).put(null);
                        console.log(`Removed hologram ${deletedHologramSoul} from target ${targetSoul}\'s _holograms set.`);
                    } else {
                        console.warn(`Could not determine soul for hologram being deleted at ${holon}/${lens}/${key}`);
                    }
                } else {
                    console.warn(`Could not parse target soul ${targetSoul} for hologram tracking removal.`);
                }
            } catch (trackingError) {
                console.warn(`Error removing hologram reference from target ${dataToDelete.soul}:`, trackingError);
            }
        }
        // --- End: Hologram Tracking Removal ---

        // 3. Proceed with the actual deletion
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