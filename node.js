// holo_node.js

/**
 * Stores a specific gun node in a given holon and lens.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holon - The holon identifier.
 * @param {string} lens - The lens under which to store the node.
 * @param {object} data - The node to store.
 */
export async function putNode(holoInstance, holon, lens, data) {
    if (!holon || !lens || !data) {
        throw new Error('putNode: Missing required parameters');
    }

    return new Promise((resolve, reject) => {
        try {
            // Remove isHologram field before storing - NO LONGER NEEDED
            // if (data && data.isHologram !== undefined) {
            // delete data.isHologram;
            // }
            
            // Check if the data being stored is a hologram
            const isHologram = data.value && holoInstance.isHologram(data.value);
            
            holoInstance.gun.get(holoInstance.appname)
                .get(holon)
                .get(lens)
                .get('value')  // Store at 'value' key
                .put(data.value, ack => {  // Store the value directly
                    if (ack.err) {
                        reject(new Error(ack.err));
                    } else {
                        // --- Start: Hologram Tracking Logic (for data *being put*, if it's a hologram) ---
                        if (isHologram) {
                            try {
                                const storedDataSoulInfo = holoInstance.parseSoulPath(data.value.soul);
                                if (storedDataSoulInfo) {
                                    const targetNodeRef = holoInstance.getNodeRef(data.value.soul); // Target of the data *being put*
                                    // Soul of the hologram that was *actually stored* at holon/lens/value
                                    const storedHologramInstanceSoul = `${holoInstance.appname}/${holon}/${lens}/value`;
                                    
                                                                targetNodeRef.get('_holograms').get(storedHologramInstanceSoul).put(true);
                        } else {
                                    console.warn(`Data (ID: ${data.id}) being put is a hologram, but could not parse its soul ${data.value.soul} for tracking.`);
                                }
                            } catch (trackingError) {
                                console.warn(`Error updating _holograms set for the target of the data being put (data ID: ${data.id}, soul: ${data.value.soul}):`, trackingError);
                            }
                        }
                        // --- End: Hologram Tracking Logic ---
                        
                        resolve(true);
                    }
                });
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Retrieves a specific gun node from the specified holon and lens.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holon - The holon identifier.
 * @param {string} lens - The lens identifier.
 * @param {string} key - The specific key to retrieve.
 * @returns {Promise<any>} - The retrieved node or null if not found.
 */
export async function getNode(holoInstance, holon, lens, key) {
    if (!holon || !lens || !key) {
        throw new Error('getNode: Missing required parameters');
    }

    return new Promise((resolve, reject) => {
        try {
            holoInstance.gun.get(holoInstance.appname)
                .get(holon)
                .get(lens)
                .get(key)
                .once((data) => {
                    if (!data) {
                        resolve(null);
                        return;
                    }
                    resolve(data);  // Return the data directly
                });
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Retrieves a Gun node reference using its soul path
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} soul - The soul path of the node
 * @returns {Gun.ChainReference} - The Gun node reference
 */
export function getNodeRef(holoInstance, soul) {
    if (typeof soul !== 'string' || !soul) {
        throw new Error('getNodeRef: Invalid soul parameter');
    }

    const parts = soul.split('/').filter(part => {
        if (!part.trim() || /[<>:"/\\|?*]/.test(part)) { // Escaped backslash for regex
            throw new Error('getNodeRef: Invalid path segment');
        }
        return part.trim();
    });

    if (parts.length === 0) {
        throw new Error('getNodeRef: Invalid soul format');
    }

    let ref = holoInstance.gun.get(holoInstance.appname);
    parts.forEach(part => {
        ref = ref.get(part);
    });
    return ref;
}

/**
 * Retrieves a node directly using its soul path
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} soul - The soul path of the node
 * @returns {Promise<any>} - The retrieved node or null if not found.
 */
export async function getNodeBySoul(holoInstance, soul) {
    if (!soul) {
        throw new Error('getNodeBySoul: Missing soul parameter');
    }

    console.log(`getNodeBySoul: Accessing soul ${soul}`);

    return new Promise((resolve, reject) => {
        try {
            const ref = getNodeRef(holoInstance, soul); // Use the exported getNodeRef
            ref.once((data) => {
                console.log(`getNodeBySoul: Retrieved data:`, data);
                if (!data) {
                    resolve(null);
                    return;
                }
                resolve(data);  // Return the data directly
            });
        } catch (error) {
            console.error(`getNodeBySoul error:`, error);
            reject(error);
        }
    });
}

/**
 * Deletes a specific gun node from a given holon and lens.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holon - The holon identifier.
 * @param {string} lens - The lens identifier.
 * @param {string} key - The key of the node to delete.
 * @returns {Promise<boolean>} - Returns true if successful
 */
export async function deleteNode(holoInstance, holon, lens, key) {
    if (!holon || !lens || !key) {
        throw new Error('deleteNode: Missing required parameters');
    }

    try {
        const dataPath = holoInstance.gun.get(holoInstance.appname).get(holon).get(lens).get(key);

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
            console.warn("[deleteNode] Could not JSON parse data for deletion check:", rawDataToDelete, e);
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
                    // putNode stores at the 'value' key, not at the data.id key
                    const deletedHologramSoul = `${holoInstance.appname}/${holon}/${lens}/value`;

                    // Create a promise that resolves when the hologram is removed from the list
                    trackingRemovalPromise = new Promise((resolveTrack) => { // No reject needed, just warn on error
                        targetNodeRef.get('_holograms').get(deletedHologramSoul).put(null, (ack) => { // Remove the hologram entry completely
                            if (ack.err) {
                                console.warn(`[deleteNode] Error removing hologram ${deletedHologramSoul} from target ${targetSoul}:`, ack.err);
                                                    }
                        resolveTrack(); // Resolve regardless of ack error to not block main delete
                        });
                    });
                } else {
                    console.warn(`Could not parse target soul ${targetSoul} for hologram tracking removal during deleteNode.`);
                }
            } catch (trackingError) {
                console.warn(`Error initiating hologram reference removal from target ${dataToDelete.soul} during deleteNode:`, trackingError);
                // Ensure trackingRemovalPromise remains resolved if setup fails
                trackingRemovalPromise = Promise.resolve(); 
            }
        }
        // --- End: Hologram Tracking Removal ---

        // 3. Wait for the tracking removal attempt to be acknowledged
        await trackingRemovalPromise;

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
        console.error('Error in deleteNode:', error);
        throw error;
    }
} 

// Export all node operations as default
export default {
    putNode,
    getNode,
    getNodeRef,
    getNodeBySoul,
    deleteNode
}; 