/**
 * GunDB-based registry for HoloSphere v1.3
 * Provides capability storage for federation handshakes
 */

export const registry = {
    /**
     * Store an inbound capability for a holon
     * @param {object} client - The HoloSphere instance
     * @param {string} appName - Application name
     * @param {string} holonId - Holon identifier
     * @param {object} capability - Capability data to store
     * @returns {Promise<{ success: boolean }>}
     */
    async storeInboundCapability(client, appName, holonId, capability) {
        try {
            const gun = client.gun || client;
            const id = (capability.token || 'cap') + '_' + Date.now();
            const payload = JSON.stringify({ ...capability, id, storedAt: Date.now() });

            return new Promise((resolve) => {
                gun.get(appName).get('_capabilities').get(holonId).get(id).put(payload, (ack) => {
                    if (ack.err) {
                        console.warn('[registry] Failed to store capability:', ack.err);
                        resolve({ success: false, error: ack.err });
                    } else {
                        resolve({ success: true, id });
                    }
                });
            });
        } catch (error) {
            console.error('[registry] Error storing capability:', error);
            return { success: false, error: error.message };
        }
    },

    /**
     * Get inbound capabilities for a holon
     * @param {object} client - The HoloSphere instance
     * @param {string} appName - Application name
     * @param {string} holonId - Holon identifier
     * @returns {Promise<Array<object>>}
     */
    async getInboundCapabilities(client, appName, holonId) {
        try {
            const gun = client.gun || client;
            return new Promise((resolve) => {
                const caps = [];
                const capPath = gun.get(appName).get('_capabilities').get(holonId);

                capPath.once((data) => {
                    if (!data) {
                        resolve([]);
                        return;
                    }

                    const keys = Object.keys(data).filter(k => k !== '_');
                    if (keys.length === 0) {
                        resolve([]);
                        return;
                    }

                    let received = 0;
                    capPath.map().once((itemData, key) => {
                        received++;
                        if (itemData && key !== '_') {
                            try {
                                const parsed = typeof itemData === 'string' ? JSON.parse(itemData) : itemData;
                                caps.push(parsed);
                            } catch (e) {
                                // skip unparseable
                            }
                        }
                        if (received >= keys.length) {
                            resolve(caps);
                        }
                    });
                });
            });
        } catch (error) {
            console.error('[registry] Error getting capabilities:', error);
            return [];
        }
    },

    /**
     * Remove an inbound capability
     * @param {object} client - The HoloSphere instance
     * @param {string} appName - Application name
     * @param {string} holonId - Holon identifier
     * @param {string} capabilityId - Capability ID to remove
     * @returns {Promise<boolean>}
     */
    async removeInboundCapability(client, appName, holonId, capabilityId) {
        try {
            const gun = client.gun || client;
            return new Promise((resolve) => {
                gun.get(appName).get('_capabilities').get(holonId).get(capabilityId).put(null, (ack) => {
                    resolve(!ack.err);
                });
            });
        } catch (error) {
            console.error('[registry] Error removing capability:', error);
            return false;
        }
    }
};

export default registry;
