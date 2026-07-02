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

    const isHologram = data.value && holoInstance.isHologram(data.value);
    const payload = typeof data.value === 'string' ? data.value : JSON.stringify(data.value);

    const result = await holoInstance._backend.put(holon, lens, 'value', payload);
    if (!result.ok) {
        throw new Error('putNode: Backend write failed');
    }

    if (isHologram) {
        try {
            const storedDataSoulInfo = holoInstance.parseSoulPath(data.value.soul);
            if (storedDataSoulInfo) {
                const targetNodeRef = holoInstance._backend.getNodeRef(data.value.soul);
                const storedHologramInstanceSoul = `${holoInstance.appname}/${holon}/${lens}/value`;
                targetNodeRef.get('_holograms').get(storedHologramInstanceSoul).put(true);
            } else {
                console.warn(`Data (ID: ${data.id}) being put is a hologram, but could not parse its soul ${data.value.soul} for tracking.`);
            }
        } catch (trackingError) {
            console.warn(`Error updating _holograms set for the target of the data being put (data ID: ${data.id}, soul: ${data.value.soul}):`, trackingError);
        }
    }

    return true;
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

    return holoInstance._backend.get(holon, lens, key);
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
        if (!part.trim() || /[<>:"/\\|?*]/.test(part)) {
            throw new Error('getNodeRef: Invalid path segment');
        }
        return part.trim();
    });

    if (parts.length === 0) {
        throw new Error('getNodeRef: Invalid soul format');
    }

    return holoInstance._backend.getNodeRef(soul);
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
        const rawDataToDelete = await holoInstance._backend.get(holon, lens, key);
        let dataToDelete = null;
        try {
            if (typeof rawDataToDelete === 'string') {
                dataToDelete = JSON.parse(rawDataToDelete);
            } else {
                dataToDelete = rawDataToDelete;
            }
        } catch(e) {
            console.warn("[deleteNode] Could not JSON parse data for deletion check:", rawDataToDelete, e);
        }

        const isDataHologram = dataToDelete && holoInstance.isHologram(dataToDelete);
        if (isDataHologram) {
            try {
                const targetSoul = dataToDelete.soul;
                const targetSoulInfo = holoInstance.parseSoulPath(targetSoul);
                if (targetSoulInfo) {
                    const targetNodeRef = holoInstance._backend.getNodeRef(targetSoul);
                    const deletedHologramSoul = `${holoInstance.appname}/${holon}/${lens}/value`;
                    await new Promise((resolveTrack) => {
                        targetNodeRef.get('_holograms').get(deletedHologramSoul).put(null, (ack) => {
                            if (ack.err) {
                                console.warn(`[deleteNode] Error removing hologram ${deletedHologramSoul} from target ${targetSoul}:`, ack.err);
                            }
                            resolveTrack();
                        });
                    });
                }
            } catch (trackingError) {
                console.warn(`Error removing hologram tracking during deleteNode:`, trackingError);
            }
        }

        return holoInstance._backend.delete(holon, lens, key);
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