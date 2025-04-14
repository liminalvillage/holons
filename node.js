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
            holoInstance.gun.get(holoInstance.appname)
                .get(holon)
                .get(lens)
                .get('value')  // Store at 'value' key
                .put(data.value, ack => {  // Store the value directly
                    if (ack.err) {
                        reject(new Error(ack.err));
                    } else {
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
    return new Promise((resolve, reject) => {
        holoInstance.gun.get(holoInstance.appname)
            .get(holon)
            .get(lens)
            .get(key)
            .put(null, ack => {
                if (ack.err) {
                    reject(new Error(ack.err));
                } else {
                    resolve(true);
                }
            });
    });
} 