// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Capability registry for federation handshakes. Capabilities are stored
// locally under the reserved `_capabilities` holon (lens = the holon they
// belong to) and never published: they are this device's inbound tokens.

import { CAPABILITIES_HOLON } from './store/address.js';

const LOCAL = { local: true, autoPropagate: false, disableHologramRedirection: true };

export const registry = {
    /**
     * Store an inbound capability for a holon
     * @param {object} client - The HoloSphere instance
     * @param {string} appName - Application name (kept for API compatibility)
     * @param {string} holonId - Holon identifier
     * @param {object} capability - Capability data to store
     * @returns {Promise<{ success: boolean, id?: string, error?: string }>}
     */
    async storeInboundCapability(client, appName, holonId, capability) {
        try {
            const id = (capability.token || 'cap') + '_' + Date.now();
            await client.put(CAPABILITIES_HOLON, String(holonId), { ...capability, id, storedAt: Date.now() }, null, LOCAL);
            return { success: true, id };
        } catch (error) {
            console.error('[registry] Error storing capability:', error);
            return { success: false, error: error.message };
        }
    },

    /**
     * Get inbound capabilities for a holon
     * @returns {Promise<Array<object>>}
     */
    async getInboundCapabilities(client, appName, holonId) {
        try {
            return await client.getAll(CAPABILITIES_HOLON, String(holonId), null, {
                _skipAuthorize: true, _skipShadow: true, resolveHolograms: false,
            });
        } catch (error) {
            console.error('[registry] Error getting capabilities:', error);
            return [];
        }
    },

    /**
     * Remove an inbound capability
     * @returns {Promise<boolean>}
     */
    async removeInboundCapability(client, appName, holonId, capabilityId) {
        try {
            await client.delete(CAPABILITIES_HOLON, String(holonId), capabilityId, null, LOCAL);
            return true;
        } catch (error) {
            console.error('[registry] Error removing capability:', error);
            return false;
        }
    }
};

export default registry;
