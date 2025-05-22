// holo_global.js

/**
 * Stores data in a global (non-holon-specific) table.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} tableName - The table name to store data in.
 * @param {object} data - The data to store. If it has an 'id' field, it will be used as the key.
 * @param {string} [password] - Optional password for private holon.
 * @returns {Promise<void>}
 */
export async function putGlobal(holoInstance, tableName, data, password = null) {
    try {
        if (!tableName || !data) {
            throw new Error('Table name and data are required');
        }

        let user = null;
        if (password) {
            user = holoInstance.gun.user();
            await new Promise((resolve, reject) => {
                const userNameString = holoInstance.userName(tableName);
                user.auth(userNameString, password, (authAck) => {
                    if (authAck.err) {
                        // If auth fails, try to create the user
                        console.log(`Initial auth failed for ${userNameString}, attempting to create...`);
                        user.create(userNameString, password, (createAck) => {
                            if (createAck.err) {
                                // Check if error is "User already created"
                                if (createAck.err.includes("already created")) {
                                    // This means user exists but password might be wrong, or some other issue
                                    // Proceed with auth again, it might have been a temporary glitch or race.
                                    // Or, it could be that the password is indeed wrong.
                                    console.log(`User ${userNameString} already existed, re-attempting auth with fresh user object.`);
                                    const freshUser = holoInstance.gun.user(); // Get a new user object
                                    freshUser.auth(userNameString, password, (secondAuthAck) => {
                                        if (secondAuthAck.err) {
                                            reject(new Error(`Failed to auth with fresh user object after create attempt (user existed): ${secondAuthAck.err}`));
                                        } else {
                                            resolve();
                                        }
                                    });
                                } else {
                                    reject(new Error(`Failed to create user ${userNameString}: ${createAck.err}`));
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
        }

        return new Promise((resolve, reject) => {
            try {
                const payload = JSON.stringify(data);

                const dataPath = password ?
                    user.get('private').get(tableName) :
                    holoInstance.gun.get(holoInstance.appname).get(tableName);

                if (data.id) {
                    const itemPath = dataPath.get(data.id);
                    itemPath.put(payload, ack => {
                        if (ack.err) {
                            reject(new Error(ack.err));
                        } else {
                            resolve();
                        }
                    });
                } else {
                    dataPath.put(payload, ack => {
                        if (ack.err) {
                            reject(new Error(ack.err));
                        } else {
                            resolve();
                        }
                    });
                }
            } catch (error) {
                reject(error);
            }
        });
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
        let user = null;
        if (password) {
            user = holoInstance.gun.user();
            await new Promise((resolve, reject) => {
                const userNameString = holoInstance.userName(tableName);
                user.auth(userNameString, password, (authAck) => {
                    if (authAck.err) {
                        // If auth fails, try to create the user
                        console.log(`Initial auth failed for ${userNameString}, attempting to create...`);
                        user.create(userNameString, password, (createAck) => {
                            if (createAck.err) {
                                 // Check if error is "User already created"
                                if (createAck.err.includes("already created")) {
                                    console.log(`User ${userNameString} already existed, re-attempting auth with fresh user object.`);
                                    const freshUser = holoInstance.gun.user(); // Get a new user object
                                    freshUser.auth(userNameString, password, (secondAuthAck) => {
                                        if (secondAuthAck.err) {
                                            reject(new Error(`Failed to auth with fresh user object after create attempt (user existed): ${secondAuthAck.err}`));
                                        } else {
                                            resolve();
                                        }
                                    });
                                } else {
                                    reject(new Error(`Failed to create user ${userNameString}: ${createAck.err}`));
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
        }

        return new Promise(async (resolve) => {
            const handleData = async (data) => {
                if (!data) {
                    resolve(null);
                    return;
                }

                try {
                    // The data should be a stringified JSON from putGlobal
                    const parsed = await holoInstance.parse(data); // Use instance's parse

                    if (!parsed) {
                        resolve(null);
                        return;
                    }

                    // Check if this is a hologram that needs to be resolved
                    if (holoInstance.isHologram(parsed)) { // Use instance's isHologram
                        const resolved = await holoInstance.resolveHologram(parsed, { // Use instance's resolveHologram
                            followHolograms: true // Always follow holograms
                        });

                        if (resolved === null) {
                            console.log(`Hologram at ${tableName}/${key} points to non-existent data. Deleting hologram.`);
                            try {
                                await holoInstance.deleteGlobal(tableName, key, password); // Use instance's deleteGlobal
                            } catch (deleteError) {
                                console.error(`Failed to delete invalid global hologram at ${tableName}/${key}:`, deleteError);
                            }
                            resolve(null); // Return null as the hologram is invalid
                            return;
                        }

                        if (resolved !== parsed) {
                            // Hologram was resolved successfully
                            resolve(resolved);
                            return;
                        }
                    }

                    resolve(parsed);
                } catch (e) {
                    console.error('Error parsing data in getGlobal:', e);
                    resolve(null);
                }
            };

            const dataPath = password ?
                user.get('private').get(tableName) :
                holoInstance.gun.get(holoInstance.appname).get(tableName);

            const itemPath = dataPath.get(key);
            itemPath.once(handleData);
        });
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
        let user = null;
        if (password) {
            user = holoInstance.gun.user();
            await new Promise((resolve, reject) => {
                const userNameString = holoInstance.userName(tableName);
                user.auth(userNameString, password, (authAck) => {
                    if (authAck.err) {
                        // If auth fails, try to create the user
                        console.log(`Initial auth failed for ${userNameString}, attempting to create...`);
                        user.create(userNameString, password, (createAck) => {
                            if (createAck.err) {
                                 // Check if error is "User already created"
                                if (createAck.err.includes("already created")) {
                                    console.log(`User ${userNameString} already existed, re-attempting auth with fresh user object.`);
                                    const freshUser = holoInstance.gun.user(); // Get a new user object
                                    freshUser.auth(userNameString, password, (secondAuthAck) => {
                                        if (secondAuthAck.err) {
                                            reject(new Error(`Failed to auth with fresh user object after create attempt (user existed): ${secondAuthAck.err}`));
                                        } else {
                                            resolve();
                                        }
                                    });
                                } else {
                                    reject(new Error(`Failed to create user ${userNameString}: ${createAck.err}`));
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
        }

        return new Promise((resolve) => {
            let output = [];
            let isResolved = false;
            let timeout = setTimeout(() => {
                if (!isResolved) {
                    isResolved = true;
                    resolve(output);
                }
            }, 5000);

            const handleData = async (data) => {
                if (!data) {
                    clearTimeout(timeout);
                    isResolved = true;
                    resolve([]);
                    return;
                }

                const keys = Object.keys(data).filter(key => key !== '_');
                const promises = keys.map(key =>
                    new Promise(async (resolveItem) => {
                        const itemPath = password ?
                            user.get('private').get(tableName).get(key) :
                            holoInstance.gun.get(holoInstance.appname).get(tableName).get(key);

                        const itemData = await new Promise(resolveData => {
                            itemPath.once(resolveData);
                        });

                        if (itemData) {
                            try {
                                const parsed = await holoInstance.parse(itemData); // Use instance's parse
                                if (parsed) {
                                    // Check if this is a hologram that needs to be resolved
                                    if (holoInstance.isHologram(parsed)) { // Use instance's isHologram
                                        const resolved = await holoInstance.resolveHologram(parsed, { // Use instance's resolveHologram
                                            followHolograms: true // Always follow holograms
                                        });

                                        if (resolved === null) {
                                            console.log(`Hologram at ${tableName}/${key} points to non-existent data. Deleting hologram.`);
                                            try {
                                                await holoInstance.deleteGlobal(tableName, key, password); // Use instance's deleteGlobal
                                            } catch (deleteError) {
                                                console.error(`Failed to delete invalid global hologram at ${tableName}/${key}:`, deleteError);
                                            }
                                            resolveItem();
                                            return;
                                        }

                                        if (resolved !== parsed) {
                                            // Hologram was resolved successfully
                                            output.push(resolved);
                                        } else {
                                            // If resolution didn't change it (e.g., circular ref guard), push original parsed (which is a hologram)
                                            output.push(parsed);
                                        }
                                    } else {
                                        output.push(parsed);
                                    }
                                }
                            } catch (error) {
                                console.error('Error parsing data:', error);
                            }
                        }
                        resolveItem();
                    })
                );

                await Promise.all(promises);
                clearTimeout(timeout);
                if (!isResolved) {
                    isResolved = true;
                    resolve(output);
                }
            };

            const dataPath = password ?
                user.get('private').get(tableName) :
                holoInstance.gun.get(holoInstance.appname).get(tableName);

            dataPath.once(handleData);
        });
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
        // console.log('deleteGlobal - Starting deletion:', { tableName, key, hasPassword: !!password }); // Optional logging

        let user = null;
        if (password) {
            user = holoInstance.gun.user();
            await new Promise((resolve, reject) => {
                const userNameString = holoInstance.userName(tableName);
                user.auth(userNameString, password, (authAck) => {
                    if (authAck.err) {
                        // If auth fails, try to create the user
                        console.log(`Initial auth failed for ${userNameString}, attempting to create...`);
                        user.create(userNameString, password, (createAck) => {
                            if (createAck.err) {
                                 // Check if error is "User already created"
                                if (createAck.err.includes("already created")) {
                                    console.log(`User ${userNameString} already existed, re-attempting auth with fresh user object.`);
                                    const freshUser = holoInstance.gun.user(); // Get a new user object
                                    freshUser.auth(userNameString, password, (secondAuthAck) => {
                                        if (secondAuthAck.err) {
                                            reject(new Error(`Failed to auth with fresh user object after create attempt (user existed): ${secondAuthAck.err}`));
                                        } else {
                                            resolve();
                                        }
                                    });
                                } else {
                                    reject(new Error(`Failed to create user ${userNameString}: ${createAck.err}`));
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
        }

        return new Promise((resolve, reject) => {
            const dataPath = password ?
                user.get('private').get(tableName).get(key) :
                holoInstance.gun.get(holoInstance.appname).get(tableName).get(key);

            // Request deletion
            dataPath.put(null, ack => {
                // console.log('deleteGlobal - Deletion acknowledgment:', ack); // Optional logging
                if (ack.err) {
                    console.error('deleteGlobal - Deletion error:', ack.err);
                    reject(new Error(ack.err));
                } else {
                    // Resolve directly on success, like deleteFunc
                    resolve(true); 
                }
            });
        });
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
        let user = null;
        if (password) {
            user = holoInstance.gun.user();
            await new Promise((resolve, reject) => {
                const userNameString = holoInstance.userName(tableName);
                user.auth(userNameString, password, (authAck) => {
                    if (authAck.err) {
                        // If auth fails, try to create the user
                        console.log(`Initial auth failed for ${userNameString}, attempting to create...`);
                        user.create(userNameString, password, (createAck) => {
                            if (createAck.err) {
                                 // Check if error is "User already created"
                                if (createAck.err.includes("already created")) {
                                    console.log(`User ${userNameString} already existed, re-attempting auth with fresh user object.`);
                                    const freshUser = holoInstance.gun.user(); // Get a new user object
                                    freshUser.auth(userNameString, password, (secondAuthAck) => {
                                        if (secondAuthAck.err) {
                                            reject(new Error(`Failed to auth with fresh user object after create attempt (user existed): ${secondAuthAck.err}`));
                                        } else {
                                            resolve();
                                        }
                                    });
                                } else {
                                    reject(new Error(`Failed to create user ${userNameString}: ${createAck.err}`));
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
        }

        return new Promise((resolve, reject) => {
            try {
                const deletions = new Set();
                let timeout = setTimeout(() => {
                    if (deletions.size === 0) {
                        resolve(true); // No data to delete
                    }
                }, 5000);

                const dataPath = password ?
                    user.get('private').get(tableName) :
                    holoInstance.gun.get(holoInstance.appname).get(tableName);

                dataPath.once(async (data) => {
                    if (!data) {
                        clearTimeout(timeout);
                        resolve(true);
                        return;
                    }

                    const keys = Object.keys(data).filter(key => key !== '_');
                    const promises = keys.map(key =>
                        new Promise((resolveDelete, rejectDelete) => {
                            const deletePath = password ?
                                user.get('private').get(tableName).get(key) :
                                holoInstance.gun.get(holoInstance.appname).get(tableName).get(key);

                            deletePath.put(null, ack => {
                                if (ack.err) {
                                    console.error(`Failed to delete ${key}:`, ack.err);
                                    rejectDelete(new Error(ack.err));
                                } else {
                                    resolveDelete();
                                }
                            });
                        })
                    );

                    try {
                        await Promise.all(promises);
                        // Finally delete the table itself
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
    } catch (error) {
        console.error('Error in deleteAllGlobal:', error);
        throw error;
    }
} 