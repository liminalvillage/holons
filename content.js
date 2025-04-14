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
 * @param {boolean} [options.propagationOptions.useReferences=true] - Whether to use references instead of duplicating data
 * @returns {Promise<boolean>} - Returns true if successful, false if there was an error
 */
export async function put(holoInstance, holon, lens, data, password = null, options = {}) {
    if (!holon || !lens || !data) {
        throw new Error('put: Missing required parameters:', holon, lens, data);
    }

    if (!data.id) {
        data.id = holoInstance.generateId();
    }

    // Check if this is a reference we're storing
    const isRef = holoInstance.isReference(data);

    // Get and validate schema only in strict mode for non-references
    if (holoInstance.strict && !isRef) {
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
                        // Only notify subscribers for actual data, not references
                        if (!isRef) {
                            holoInstance.notifySubscribers({
                                holon,
                                lens,
                                ...data
                            });
                        }

                        // Auto-propagate to federation by default (if not a reference)
                        const shouldPropagate = options.autoPropagate !== false && !isRef;
                        let propagationResult = null;

                        if (shouldPropagate) {
                            try {
                                // Default to using references
                                const propagationOptions = {
                                    useReferences: true,
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
                            isReference: isRef,
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
 * @param {boolean} [options.resolveReferences=true] - Whether to automatically resolve federation references
 * @returns {Promise<object|null>} - The retrieved content or null if not found.
 */
export async function get(holoInstance, holon, lens, key, password = null, options = {}) {
    if (!holon || !lens || !key) {
        console.error('get: Missing required parameters:', { holon, lens, key });
        return null;
    }

    const { resolveReferences = true } = options;

    // Only check schema in strict mode
    let schema;
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
                    const parsed = await holoInstance.parse(data); // Use instance's parse

                    if (!parsed) {
                        resolve(null);
                        return;
                    }

                    // Check if this is a reference that needs to be resolved
                    if (resolveReferences && holoInstance.isReference(parsed)) {
                        const resolved = await holoInstance.resolveReference(parsed, {
                            followReferences: true // Always follow nested references when resolving
                        });

                        if (resolved === null) {
                            // resolveReference signaled that the target data was not found.
                            console.log(`Reference at ${holon}/${lens}/${key} points to non-existent data. Deleting reference.`);
                            try {
                                await holoInstance.delete(holon, lens, key, password); // Use instance's delete
                            } catch (deleteError) {
                                console.error(`Failed to delete invalid reference at ${holon}/${lens}/${key}:`, deleteError);
                            }
                            resolve(null); // Return null as the reference is invalid
                            return;
                        }

                        if (schema && resolved._federation) {
                            // Skip schema validation for resolved references
                            resolve(resolved);
                            return;
                        } else if (resolved !== parsed) {
                            // Reference was resolved successfully
                            resolve(resolved);
                            return;
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
                    console.error('Error parsing data:', error);
                    resolve(null);
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

                    // Check if this is a reference that needs to be resolved
                    if (holoInstance.isReference(parsed)) {
                        const resolved = await holoInstance.resolveReference(parsed, {
                            followReferences: true // Always follow references
                        });

                        if (resolved !== parsed) {
                            // Reference was resolved successfully
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
    let parsedData = {};

    if (!rawData) {
        throw new Error('parse: No data provided');
    }

    try {

        if (typeof rawData === 'string') {
            parsedData = await JSON.parse(rawData);
        }


        if (rawData.soul) {
            const data = await holoInstance.getNodeRef(rawData.soul).once(); // Use instance's getNodeRef
            if (!data) {
                throw new Error('Referenced data not found');
            }
            return JSON.parse(data);
        }


        if (typeof rawData === 'object' && rawData !== null) {
            if (rawData._ && rawData._["#"]) {
                const pathParts = rawData._['#'].split('/');
                if (pathParts.length < 4) {
                    throw new Error('Invalid reference format');
                }
                parsedData = await holoInstance.get(pathParts[1], pathParts[2], pathParts[3]); // Use instance's get
                if (!parsedData) {
                    throw new Error('Referenced data not found');
                }
            } else if (rawData._ && rawData._['>']) {
                const nodeValue = Object.values(rawData).find(v => typeof v !== 'object' && v !== '_');
                if (!nodeValue) {
                    throw new Error('Invalid node data');
                }
                parsedData = JSON.parse(nodeValue);
            } else {
                parsedData = rawData;
            }
        }

        return parsedData;

    } catch (error) {
        console.log("Parsing not a JSON, returning raw data", rawData);
        return rawData;
        //throw new Error(`Parse error: ${error.message}`);
    }
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

        return new Promise((resolve, reject) => {
            const dataPath = password ?
                user.get('private').get(lens).get(key) :
                holoInstance.gun.get(holoInstance.appname).get(holon).get(lens).get(key);

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