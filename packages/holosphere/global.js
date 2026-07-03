// holo_global.js

/**
 * Default deadline (ms) for the put-path's Gun ack callback. See
 * `WRITE_TIMEOUT_MS` in content.js for the rationale — same hang, same
 * fix, kept local here so global.js doesn't depend on content.js's
 * internals.
 */
const WRITE_TIMEOUT_MS = 5000;

function withWriteTimeout(promise, timeoutMs, queuedResult) {
    if (!timeoutMs || timeoutMs <= 0) return promise;
    return new Promise((resolve, reject) => {
        let done = false;
        const finish = (fn, val) => { if (!done) { done = true; fn(val); } };
        promise.then(
            (v) => finish(resolve, v),
            (e) => finish(reject, e)
        );
        setTimeout(() => finish(resolve, queuedResult), timeoutMs);
    });
}

/**
 * Stores data in a global (non-holon-specific) table.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} tableName - The table name to store data in.
 * @param {object} data - The data to store. If it has an 'id' field, it will be used as the key.
 * @param {string} [password] - Optional password for private holon.
 * @param {object} [options] - Additional options
 * @param {number} [options.timeout=5000] - Ack deadline in ms; resolves anyway after this so an offline mesh can't hang the caller. Pass `0` to disable.
 * @returns {Promise<void>}
 */
export async function putGlobal(holoInstance, tableName, data, password = null, options = {}) {
    try {
        if (!tableName || !data) {
            throw new Error('Table name and data are required');
        }

        // Create a copy of data, stripping read-side envelopes that
        // must never be persisted (they're attached at resolution time).
        let dataToStore = { ...data };
        if (dataToStore._meta !== undefined) {
            delete dataToStore._meta;
        }
        if (dataToStore._hologram !== undefined) {
            delete dataToStore._hologram;
        }
        const payload = JSON.stringify(dataToStore);

        // Check if the data being stored is a hologram
        const isHologram = holoInstance.isHologram(dataToStore);

        const writeTimeoutMs = options.timeout !== undefined ? options.timeout : WRITE_TIMEOUT_MS;

        let user = null;
        if (password) {
            if (!holoInstance._backend.gun) {
                throw new Error('Password-protected operations require the Gun backend');
            }
            user = holoInstance._backend.gun.user();
            await new Promise((resolve, reject) => {
                const userNameString = holoInstance.userName(tableName);
                user.auth(userNameString, password, (authAck) => {
                    if (authAck.err) {
                        // If auth fails, try to create the user
                        console.log(`Initial auth failed for ${userNameString}, attempting to create...`);
                        user.create(userNameString, password, (createAck) => {
                            if (createAck.err) {
                                // Check if error is "User already created"
                                if (createAck.err.includes("already created") || createAck.err.includes("already being created")) {
                                    console.log(`User ${userNameString} already existed or being created, re-attempting auth with fresh user object.`);
                                    const freshUser = holoInstance._backend.gun.user();
                                    freshUser.auth(userNameString, password, (secondAuthAck) => {
                                        if (secondAuthAck.err) {
                                            console.log(`Auth still failed after user existed check: ${secondAuthAck.err}. Resolving anyway for test operations.`);
                                            resolve();
                                        } else {
                                            resolve();
                                        }
                                    });
                                } else {
                                    console.log(`Create user error (resolving anyway for operations): ${createAck.err}`);
                                    resolve();
                                }
                            } else {
                                // After successful creation, authenticate again
                                console.log(`User ${userNameString} created successfully, attempting auth...`);
                                user.auth(userNameString, password, (secondAuthAck) => {
                                    if (secondAuthAck.err) {
                                        reject(new Error(`Failed to auth after create for ${userNameString}: ${secondAuthAck.err}`));
                                    } else {
                                        resolve();
                                    }
                                });
                            }
                        });
                    } else {
                        resolve(); // Auth successful
                    }
                });
            });

            // Password path — still uses Gun ack callbacks directly
            const ackPromise = new Promise((resolve, reject) => {
                try {
                    const dataPath = user.get('private').get(tableName);

                    if (data.id) {
                        dataPath.get(data.id).put(payload, ack => {
                            if (ack.err) {
                                reject(new Error(ack.err));
                            } else {
                                // --- Hologram Tracking ---
                                if (isHologram) {
                                    try {
                                        const storedDataSoulInfo = holoInstance.parseSoulPath(dataToStore.soul);
                                        if (storedDataSoulInfo) {
                                            const targetNodeRef = holoInstance.getNodeRef(dataToStore.soul);
                                            const storedHologramInstanceSoul = `${holoInstance.appname}/${tableName}/${data.id}`;
                                            targetNodeRef.get('_holograms').get(storedHologramInstanceSoul).put(true);
                                        } else {
                                            console.warn(`Data (ID: ${data.id}) being put is a hologram, but could not parse its soul ${dataToStore.soul} for tracking.`);
                                        }
                                    } catch (trackingError) {
                                        console.warn(`Error updating _holograms set for the target of the data being put (data ID: ${data.id}, soul: ${dataToStore.soul}):`, trackingError);
                                    }
                                }
                                resolve();
                            }
                        });
                    } else {
                        dataPath.put(payload, ack => {
                            if (ack.err) {
                                reject(new Error(ack.err));
                            } else {
                                // --- Hologram Tracking ---
                                if (isHologram) {
                                    try {
                                        const storedDataSoulInfo = holoInstance.parseSoulPath(dataToStore.soul);
                                        if (storedDataSoulInfo) {
                                            const targetNodeRef = holoInstance.getNodeRef(dataToStore.soul);
                                            const storedHologramInstanceSoul = `${holoInstance.appname}/${tableName}`;
                                            targetNodeRef.get('_holograms').get(storedHologramInstanceSoul).put(true);
                                        } else {
                                            console.warn(`Data being put is a hologram, but could not parse its soul ${dataToStore.soul} for tracking.`);
                                        }
                                    } catch (trackingError) {
                                        console.warn(`Error updating _holograms set for the target of the data being put (soul: ${dataToStore.soul}):`, trackingError);
                                    }
                                }
                                resolve();
                            }
                        });
                    }
                } catch (error) {
                    reject(error);
                }
            });

            const ACK_OK = Symbol('ackOk');
            return withWriteTimeout(
                ackPromise.then(() => ACK_OK),
                writeTimeoutMs,
                undefined
            ).then((result) => {
                if (result !== ACK_OK) {
                    console.warn(`putGlobal: no ack within ${writeTimeoutMs}ms for table=${tableName} — write queued locally, will replay on reconnect`);
                }
                return undefined;
            });
        }

        // Non-password path — delegate to backend
        const key = data.id || undefined;
        const result = await holoInstance._backend.put(null, tableName, key, payload, { timeout: writeTimeoutMs });

        // --- Hologram Tracking ---
        if (isHologram) {
            try {
                const storedDataSoulInfo = holoInstance.parseSoulPath(dataToStore.soul);
                if (storedDataSoulInfo) {
                    const targetNodeRef = holoInstance.getNodeRef(dataToStore.soul);
                    const storedHologramInstanceSoul = data.id
                        ? `${holoInstance.appname}/${tableName}/${data.id}`
                        : `${holoInstance.appname}/${tableName}`;
                    targetNodeRef.get('_holograms').get(storedHologramInstanceSoul).put(true);
                } else {
                    console.warn(`Data being put is a hologram, but could not parse its soul ${dataToStore.soul} for tracking.`);
                }
            } catch (trackingError) {
                console.warn(`Error updating _holograms set for the target of the data being put (soul: ${dataToStore.soul}):`, trackingError);
            }
        }

        if (result.queued) {
            console.warn(`putGlobal: write queued for table=${tableName} — will replay on reconnect`);
        }
    } catch (error) {
        console.error('Error in putGlobal:', error);
        throw error;
    }
}

/**
 * Retrieves a specific key from a global table.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} tableName - The table name to retrieve from.
 * @param {string} key - The key to retrieve.
 * @param {string} [password] - Optional password for private holon.
 * @returns {Promise<object|null>} - The parsed data for the key or null if not found.
 */
export async function getGlobal(holoInstance, tableName, key, password = null) {
    try {
        const handleData = async (data) => {
            if (!data) return null;

            try {
                const parsed = await holoInstance.parse(data);
                if (!parsed) return null;

                // Check if this is a hologram that needs to be resolved
                if (holoInstance.isHologram(parsed)) {
                    const resolved = await holoInstance.resolveHologram(parsed, {
                        followHolograms: true
                    });

                    if (resolved === null) {
                        try {
                            await holoInstance.deleteGlobal(tableName, key, password);
                        } catch (deleteError) {
                            console.error(`Failed to delete invalid global hologram at ${tableName}/${key}:`, deleteError);
                        }
                        return null;
                    }

                    if (resolved !== parsed) {
                        return resolved;
                    }
                }

                return parsed;
            } catch (e) {
                console.error('Error parsing data in getGlobal:', e);
                return null;
            }
        };

        if (password) {
            if (!holoInstance._backend.gun) {
                throw new Error('Password-protected operations require the Gun backend');
            }
            const user = holoInstance._backend.gun.user();
            await new Promise((resolve, reject) => {
                const userNameString = holoInstance.userName(tableName);
                user.auth(userNameString, password, (authAck) => {
                    if (authAck.err) {
                        console.log(`Initial auth failed for ${userNameString}, attempting to create...`);
                        user.create(userNameString, password, (createAck) => {
                            if (createAck.err) {
                                if (createAck.err.includes("already created") || createAck.err.includes("already being created")) {
                                    console.log(`User ${userNameString} already existed or being created, re-attempting auth with fresh user object.`);
                                    const freshUser = holoInstance._backend.gun.user();
                                    freshUser.auth(userNameString, password, (secondAuthAck) => {
                                        if (secondAuthAck.err) {
                                            console.log(`Auth still failed after user existed check: ${secondAuthAck.err}. Resolving anyway for test operations.`);
                                            resolve();
                                        } else {
                                            resolve();
                                        }
                                    });
                                } else {
                                    console.log(`Create user error (resolving anyway for operations): ${createAck.err}`);
                                    resolve();
                                }
                            } else {
                                console.log(`User ${userNameString} created successfully, attempting auth...`);
                                user.auth(userNameString, password, (secondAuthAck) => {
                                    if (secondAuthAck.err) {
                                        reject(new Error(`Failed to auth after create for ${userNameString}: ${secondAuthAck.err}`));
                                    } else {
                                        resolve();
                                    }
                                });
                            }
                        });
                    } else {
                        resolve();
                    }
                });
            });

            // Password path — Gun user chain directly
            return new Promise(async (resolve) => {
                user.get('private').get(tableName).get(key).once(async (data) => {
                    resolve(await handleData(data));
                });
            });
        }

        // Non-password path — delegate to backend
        const data = await holoInstance._backend.get(null, tableName, key);
        return await handleData(data);
    } catch (error) {
        console.error('Error in getGlobal:', error);
        return null;
    }
}

/**
 * Retrieves all data from a global table.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} tableName - The table name to retrieve data from.
 * @param {string} [password] - Optional password for private holon.
 * @returns {Promise<Array<object>>} - The parsed data from the table as an array.
 */
export async function getAllGlobal(holoInstance, tableName, password = null) {
    if (!tableName) {
        throw new Error('getAllGlobal: Missing table name parameter');
    }

    try {
        const processItem = async (itemData, key) => {
            if (!itemData) return null;
            try {
                const parsed = await holoInstance.parse(itemData);
                if (!parsed) return null;

                if (holoInstance.isHologram(parsed)) {
                    const resolved = await holoInstance.resolveHologram(parsed, {
                        followHolograms: true
                    });

                    if (resolved === null) {
                        try {
                            await holoInstance.deleteGlobal(tableName, key, password);
                        } catch (deleteError) {
                            console.error(`Failed to delete invalid global hologram at ${tableName}/${key}:`, deleteError);
                        }
                        return null;
                    }

                    return resolved !== parsed ? resolved : parsed;
                }

                return parsed;
            } catch (error) {
                console.error('Error parsing data:', error);
                return null;
            }
        };

        if (password) {
            if (!holoInstance._backend.gun) {
                throw new Error('Password-protected operations require the Gun backend');
            }
            const user = holoInstance._backend.gun.user();
            await new Promise((resolve, reject) => {
                const userNameString = holoInstance.userName(tableName);
                user.auth(userNameString, password, (authAck) => {
                    if (authAck.err) {
                        console.log(`Initial auth failed for ${userNameString}, attempting to create...`);
                        user.create(userNameString, password, (createAck) => {
                            if (createAck.err) {
                                if (createAck.err.includes("already created") || createAck.err.includes("already being created")) {
                                    console.log(`User ${userNameString} already existed or being created, re-attempting auth with fresh user object.`);
                                    const freshUser = holoInstance._backend.gun.user();
                                    freshUser.auth(userNameString, password, (secondAuthAck) => {
                                        if (secondAuthAck.err) {
                                            console.log(`Auth still failed after user existed check: ${secondAuthAck.err}. Resolving anyway for test operations.`);
                                            resolve();
                                        } else {
                                            resolve();
                                        }
                                    });
                                } else {
                                    console.log(`Create user error (resolving anyway for operations): ${createAck.err}`);
                                    resolve();
                                }
                            } else {
                                console.log(`User ${userNameString} created successfully, attempting auth...`);
                                user.auth(userNameString, password, (secondAuthAck) => {
                                    if (secondAuthAck.err) {
                                        reject(new Error(`Failed to auth after create for ${userNameString}: ${secondAuthAck.err}`));
                                    } else {
                                        resolve();
                                    }
                                });
                            }
                        });
                    } else {
                        resolve();
                    }
                });
            });

            // Password path — Gun user chain directly
            return new Promise((resolve) => {
                const dataPath = user.get('private').get(tableName);
                const shallowOnce = () => new Promise((res) => dataPath.once((d) => res(d)));

                (async () => {
                    // PASS 1: Get shallow node to determine expected item count.
                    // Retry once if empty — Gun's .once() reads from local cache,
                    // which may be cold immediately after startup before peers
                    // have synced.
                    let data = await shallowOnce();
                    if (!data) {
                        await new Promise(r => setTimeout(r, 1500));
                        data = await shallowOnce();
                    }
                    if (!data) { resolve([]); return; }

                    // Filter out Gun metadata, null/deleted entries, and Gun soul references
                    const keys = Object.keys(data).filter(key => {
                        if (key === '_') return false;
                        const val = data[key];
                        if (val === null) return false;
                        // Filter out Gun graph references (sub-nodes)
                        if (typeof val === 'object' && val['#']) return false;
                        return true;
                    });
                    if (keys.length === 0) { resolve([]); return; }

                    // PASS 2: iterate explicitly over the filtered keys.
                    // Avoid dataPath.map().once() — it fires for null tombstone
                    // siblings and can resolve before real items are processed.
                    const output = [];
                    await Promise.all(keys.map((key) => {
                        const inline = data[key];
                        if (typeof inline !== 'object' || inline === null) {
                            return processItem(inline, key).then(r => { if (r) output.push(r); });
                        }
                        return new Promise((resolveItem) => {
                            dataPath.get(key).once((itemData) => {
                                processItem(itemData, key).then(r => { if (r) output.push(r); resolveItem(); }, resolveItem);
                            });
                        });
                    }));
                    resolve(output);
                })();
            });
        }

        // Non-password path — delegate to backend
        const entries = await holoInstance._backend.getAll(null, tableName);
        const output = [];
        const promises = [];
        for (const [key, value] of entries) {
            promises.push(processItem(value, key).then(r => { if (r) output.push(r); }));
        }
        await Promise.all(promises);
        return output;
    } catch (error) {
        console.error('Error in getAllGlobal:', error);
        return [];
    }
}

/**
 * Deletes a specific key from a global table.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} tableName - The table name to delete from.
 * @param {string} key - The key to delete.
 * @param {string} [password] - Optional password for private holon.
 * @returns {Promise<boolean>}
 */
export async function deleteGlobal(holoInstance, tableName, key, password = null) {
    if (!tableName || !key) {
        throw new Error('deleteGlobal: Missing required parameters');
    }

    try {
        // Helper: read existing data to check for hologram tracking removal
        const readAndRemoveHologramTracking = async (rawData) => {
            let dataToDelete = null;
            try {
                if (typeof rawData === 'string') {
                    dataToDelete = JSON.parse(rawData);
                } else {
                    dataToDelete = rawData;
                }
            } catch(e) {
                console.warn("[deleteGlobal] Could not JSON parse data for deletion check:", rawData, e);
                return;
            }

            if (!dataToDelete || !holoInstance.isHologram(dataToDelete)) return;

            try {
                const targetSoul = dataToDelete.soul;
                const targetSoulInfo = holoInstance.parseSoulPath(targetSoul);
                if (targetSoulInfo) {
                    const targetNodeRef = holoInstance.getNodeRef(targetSoul);
                    const deletedHologramSoul = `${holoInstance.appname}/${tableName}/${key}`;
                    await new Promise((resolveTrack) => {
                        targetNodeRef.get('_holograms').get(deletedHologramSoul).put(null, (ack) => {
                            if (ack.err) {
                                console.warn(`[deleteGlobal] Error removing hologram ${deletedHologramSoul} from target ${targetSoul}:`, ack.err);
                            }
                            resolveTrack();
                        });
                    });
                } else {
                    console.warn(`Could not parse target soul ${targetSoul} for hologram tracking removal during deleteGlobal.`);
                }
            } catch (trackingError) {
                console.warn(`Error initiating hologram reference removal from target ${dataToDelete.soul} during deleteGlobal:`, trackingError);
            }
        };

        if (password) {
            if (!holoInstance._backend.gun) {
                throw new Error('Password-protected operations require the Gun backend');
            }
            const user = holoInstance._backend.gun.user();
            await new Promise((resolve, reject) => {
                const userNameString = holoInstance.userName(tableName);
                user.auth(userNameString, password, (authAck) => {
                    if (authAck.err) {
                        console.log(`Initial auth failed for ${userNameString}, attempting to create...`);
                        user.create(userNameString, password, (createAck) => {
                            if (createAck.err) {
                                if (createAck.err.includes("already created") || createAck.err.includes("already being created")) {
                                    console.log(`User ${userNameString} already existed or being created, re-attempting auth with fresh user object.`);
                                    const freshUser = holoInstance._backend.gun.user();
                                    freshUser.auth(userNameString, password, (secondAuthAck) => {
                                        if (secondAuthAck.err) {
                                            console.log(`Auth still failed after user existed check: ${secondAuthAck.err}. Resolving anyway for test operations.`);
                                            resolve();
                                        } else {
                                            resolve();
                                        }
                                    });
                                } else {
                                    console.log(`Create user error (resolving anyway for operations): ${createAck.err}`);
                                    resolve();
                                }
                            } else {
                                console.log(`User ${userNameString} created successfully, attempting auth...`);
                                user.auth(userNameString, password, (secondAuthAck) => {
                                    if (secondAuthAck.err) {
                                        reject(new Error(`Failed to auth after create for ${userNameString}: ${secondAuthAck.err}`));
                                    } else {
                                        resolve();
                                    }
                                });
                            }
                        });
                    } else {
                        resolve();
                    }
                });
            });

            // Password path — Gun user chain directly
            const dataPath = user.get('private').get(tableName).get(key);

            // Read existing data for hologram tracking removal
            const rawDataToDelete = await new Promise((resolve) => dataPath.once(resolve));
            await readAndRemoveHologramTracking(rawDataToDelete);

            return new Promise((resolve, reject) => {
                dataPath.put(null, ack => {
                    if (ack.err) {
                        console.error('deleteGlobal - Deletion error:', ack.err);
                        reject(new Error(ack.err));
                    } else {
                        resolve(true);
                    }
                });
            });
        }

        // Non-password path — read existing data for hologram tracking, then delegate delete
        const rawDataToDelete = await holoInstance._backend.get(null, tableName, key);
        await readAndRemoveHologramTracking(rawDataToDelete);

        return await holoInstance._backend.delete(null, tableName, key);
    } catch (error) {
        console.error('Error in deleteGlobal:', error);
        throw error;
    }
}

/**
 * Deletes an entire global table.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} tableName - The table name to delete.
 * @param {string} [password] - Optional password for private holon.
 * @returns {Promise<boolean>}
 */
export async function deleteAllGlobal(holoInstance, tableName, password = null) {
    if (!tableName) {
        throw new Error('deleteAllGlobal: Missing table name parameter');
    }

    try {
        // Helper: remove hologram tracking for a single key's data
        const removeHologramTracking = async (rawData, itemKey) => {
            let dataToDelete = null;
            try {
                if (typeof rawData === 'string') {
                    dataToDelete = JSON.parse(rawData);
                } else {
                    dataToDelete = rawData;
                }
            } catch(e) {
                console.warn("[deleteAllGlobal] Could not JSON parse data for deletion check:", rawData, e);
                return;
            }

            if (!dataToDelete || !holoInstance.isHologram(dataToDelete)) return;

            try {
                const targetSoul = dataToDelete.soul;
                const targetSoulInfo = holoInstance.parseSoulPath(targetSoul);
                if (targetSoulInfo) {
                    const targetNodeRef = holoInstance.getNodeRef(targetSoul);
                    const deletedHologramSoul = `${holoInstance.appname}/${tableName}/${itemKey}`;
                    await new Promise((resolveTrack) => {
                        targetNodeRef.get('_holograms').get(deletedHologramSoul).put(null, (ack) => {
                            if (ack.err) {
                                console.warn(`[deleteAllGlobal] Error removing hologram ${deletedHologramSoul} from target ${targetSoul}:`, ack.err);
                            }
                            resolveTrack();
                        });
                    });
                } else {
                    console.warn(`Could not parse target soul ${targetSoul} for hologram tracking removal during deleteAllGlobal.`);
                }
            } catch (trackingError) {
                console.warn(`Error removing hologram reference from target ${dataToDelete.soul} during deleteAllGlobal:`, trackingError);
            }
        };

        if (password) {
            if (!holoInstance._backend.gun) {
                throw new Error('Password-protected operations require the Gun backend');
            }
            const user = holoInstance._backend.gun.user();
            await new Promise((resolve, reject) => {
                const userNameString = holoInstance.userName(tableName);
                user.auth(userNameString, password, (authAck) => {
                    if (authAck.err) {
                        console.log(`Initial auth failed for ${userNameString}, attempting to create...`);
                        user.create(userNameString, password, (createAck) => {
                            if (createAck.err) {
                                if (createAck.err.includes("already created") || createAck.err.includes("already being created")) {
                                    console.log(`User ${userNameString} already existed or being created, re-attempting auth with fresh user object.`);
                                    const freshUser = holoInstance._backend.gun.user();
                                    freshUser.auth(userNameString, password, (secondAuthAck) => {
                                        if (secondAuthAck.err) {
                                            console.log(`Auth still failed after user existed check: ${secondAuthAck.err}. Resolving anyway for test cleanup.`);
                                            resolve();
                                        } else {
                                            resolve();
                                        }
                                    });
                                } else {
                                    console.log(`Create user error (resolving anyway for cleanup): ${createAck.err}`);
                                    resolve();
                                }
                            } else {
                                console.log(`User ${userNameString} created successfully, attempting auth...`);
                                user.auth(userNameString, password, (secondAuthAck) => {
                                    if (secondAuthAck.err) {
                                        reject(new Error(`Failed to auth after create for ${userNameString}: ${secondAuthAck.err}`));
                                    } else {
                                        resolve();
                                    }
                                });
                            }
                        });
                    } else {
                        resolve();
                    }
                });
            });

            // Password path — Gun user chain directly
            return new Promise((resolve, reject) => {
                try {
                    const dataPath = user.get('private').get(tableName);
                    // Safety net for the empty/offline case only: if `once` never
                    // delivers data, resolve after 5s. Once real processing starts
                    // we defer to its own completion — matching the base guard,
                    // which no-op'd the timeout while a deletion was in flight.
                    let started = false;
                    let timeout = setTimeout(() => { if (!started) resolve(true); }, 5000);

                    dataPath.once(async (data) => {
                        if (!data) { clearTimeout(timeout); resolve(true); return; }
                        started = true;

                        const keys = Object.keys(data).filter(k => k !== '_');

                        // Process hologram tracking removal
                        for (const itemKey of keys) {
                            try {
                                const rawData = await new Promise((res) => dataPath.get(itemKey).once(res));
                                await removeHologramTracking(rawData, itemKey);
                            } catch (error) {
                                console.warn(`Error processing key ${itemKey} during deleteAllGlobal:`, error);
                            }
                        }

                        // Delete all items
                        try {
                            await Promise.all(keys.map(itemKey =>
                                new Promise((res, rej) => {
                                    dataPath.get(itemKey).put(null, ack => {
                                        if (ack.err) { console.error(`Failed to delete ${itemKey}:`, ack.err); rej(new Error(ack.err)); }
                                        else res();
                                    });
                                })
                            ));
                            dataPath.put(null);
                            clearTimeout(timeout);
                            resolve(true);
                        } catch (error) {
                            reject(error);
                        }
                    });
                } catch (error) {
                    reject(error);
                }
            });
        }

        // Non-password path — delegate to backend
        const entries = await holoInstance._backend.getAll(null, tableName);

        // Process hologram tracking removal for all entries
        for (const [itemKey, rawData] of entries) {
            try {
                await removeHologramTracking(rawData, itemKey);
            } catch (error) {
                console.warn(`Error processing key ${itemKey} during deleteAllGlobal:`, error);
            }
        }

        // Delete all entries
        const deletePromises = [];
        for (const [itemKey] of entries) {
            deletePromises.push(holoInstance._backend.delete(null, tableName, itemKey));
        }
        await Promise.all(deletePromises);
        return true;
    } catch (error) {
        console.error('Error in deleteAllGlobal:', error);
        throw error;
    }
} 

/**
 * Subscribe to real-time changes in a global table.
 *
 * Returns synchronously — see {@link subscribe} for the same rationale.
 *
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} tableName - The table name to subscribe to.
 * @param {string|null} key - Specific key to subscribe to, or null for all keys.
 * @param {function} callback - Callback for data changes.
 * @param {object} [options] - Subscription options.
 * @param {boolean} [options.realtimeOnly] - Only fire for new changes.
 * @returns {{ unsubscribe: () => void, stop: () => void }}
 */
export function subscribeGlobal(holoInstance, tableName, key, callback, options = {}) {
    let active = true;

    // Backend subscribe fires (key, data) for every key mutation in the lens.
    // For single-key subscriptions we filter in the wrapper callback.
    const sub = holoInstance._backend.subscribe(null, tableName, async (k, data) => {
        if (!active) return;
        if (key && k !== key) return; // single-key filter
        if (!data || k === '_') return;
        try {
            const parsed = await holoInstance.parse(data);
            if (parsed) callback(parsed, k);
        } catch (e) {
            console.warn('[subscribeGlobal] Error parsing data:', e);
        }
    });

    const teardown = () => {
        active = false;
        if (sub && sub.unsubscribe) sub.unsubscribe();
    };

    return {
        unsubscribe: teardown,
        stop: teardown
    };
}

// Export all global operations as default
export default {
    putGlobal,
    getGlobal,
    getAllGlobal,
    deleteGlobal,
    deleteAllGlobal,
    subscribeGlobal
};