// Description: This file contains the DB class which is used to interact with the database.
import {HoloSphere} from 'holosphere';
import { getRelays } from './relay-config.js';
import { getOrCreateKey } from './utils/key-storage.js';
import { generateSecretKey } from 'nostr-tools';

// Helper to generate hex private key
function generatePrivateKey() {
    const secretKey = generateSecretKey();
    return Buffer.from(secretKey).toString('hex');
}

class DB {
    constructor(dbName) {
        this.gun = null;
        this.dbName = dbName;
        this.preloadedDB = {};

        // IMPORTANT: Use persistent private key so the same identity is maintained across restarts
        // This allows the bot to access its previous data from Nostr relays
        // Priority: 1) .env HOLOSPHERE_PRIVATE_KEY, 2) stored key, 3) generate new key
        const appName = process.env.APPNAME || 'Holons';
        const privateKey = process.env.HOLOSPHERE_PRIVATE_KEY || getOrCreateKey(appName, generatePrivateKey);

        this.holosphere = new HoloSphere({
            appName: appName,
            privateKey: privateKey,  // Use persistent key
            logLevel: 'INFO',
            relays: getRelays('production') // Use Nostr relays for distributed sync
        });
        this.db = 'nostr'; // Using Nostr relays for distributed storage

        // Performance: Default timeout for database operations (5 seconds)
        // This prevents slow relay responses from blocking the bot
        // Increased from 1000ms to 5000ms to handle slower Nostr relay responses
        this.defaultTimeout = 5000;

        // Track pending writes to prevent duplicate Nostr writes
        this.pendingWrites = new Map();
    }

    async init() {
        try {
            // HoloSphere is now initialized with Nostr relays
            // Caching is handled internally by holosphere2's nostr-client
            console.log(`DB "${this.dbName}" initialized with ${this.holosphere.config.relays.length} Nostr relays`);
        } catch (error) {
            console.error("Error initializing database:", error);
        }
    }

    /**
     * Wrapper to add timeout to any promise-based operation
     * @private
     */
    async withTimeout(promise, timeoutMs = this.defaultTimeout) {
        return Promise.race([
            promise,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
            )
        ]);
    }



    async del(table, key) {
        try {
            return this.deleteGunDB(table, key);
        } catch (error) {
            console.error("Error deleting data:", error);
            throw error;
        }
    }

    async drop(table) {
        try {
            let [hex, lens] = table.split('/')
            if (lens === undefined)
                this.holosphere.deleteAllGlobal(table);
            else
                this.holosphere.deleteAll(hex, lens);
        } catch (error) {
            console.error("Error dropping table:", error);
            throw error;
        }
    }

    /**
     * Clear cache entries for a specific chatID (delegates to holosphere2)
     * @param {string} chatID - Chat ID to clear cache for
     */
    clearCacheForChatID(chatID) {
        // Delegate to holosphere2's cache clearing
        this.holosphere.clearCache(chatID);
        console.log(`DB.clearCacheForChatID: Cleared cache for chatID ${chatID}`);
    }

    async put(table, data) {
        try {
            const key = data.id;
            if (!key) return data;

            const cacheKey = `${table}/${key}`;

            // Check if a write is already pending for this key
            if (this.pendingWrites.has(cacheKey)) {
                // Wait for pending write to complete
                await this.pendingWrites.get(cacheKey);
                return data;
            }

            // Mark write as pending
            const writePromise = this.addGunDB(table, data);
            this.pendingWrites.set(cacheKey, writePromise);

            try {
                await writePromise;
            } finally {
                this.pendingWrites.delete(cacheKey);
            }

            return data;
        } catch (error) {
            console.error(`DB.put error: ${table}/${data.id}:`, error.message);
            throw error;
        }
    }

    async get(table, key) {
        try {
            // holosphere2 handles caching internally via nostr-client
            return await this.withTimeout(this.getGunDB(table, key));
        } catch (error) {
            console.error(`DB.get error: ${table}/${key}:`, error.message);
            throw error;
        }
    }

    async getAll(table) {
        try {
            // holosphere2 handles caching internally via nostr-client
            return await this.withTimeout(this.getAllGunDB(table));
        } catch (error) {
            console.error(`DB.getAll error for ${table}:`, error.message);
            throw error;
        }
    }

    // ===========================      Gun Functions

    async addGunDB(table, data) {
        let [hex, lens] = table.split('/')
        try {
            if (lens === undefined) {
                // For global tables, extract the key from data.id
                const key = data.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                return await this.holosphere.putGlobal(table, key, data);
            } else {
                return await this.holosphere.put(hex, lens, data);
            }
        } catch (error) {
            console.error(`DB.addGunDB: FAILED to write ${table}/${data.id}:`, error.message);
            throw error;
        }
    }

    async getGunDB(table, key) {
        let [hex, lens] = table.split('/')
        if (lens === undefined) {
            return await this.holosphere.getGlobal(table, key);
        } else {
            return await this.holosphere.get(hex, lens, key);
        }
    }

    async getAllGunDB(table) {
        let [hex, lens] = table.split('/')
        if (lens === undefined)
            return await this.holosphere.getAllGlobal(table);
        else
            return await this.holosphere.getAll(hex, lens);
    }
    
    deleteGunDB(table, key) {
        let [hex, lens] = table.split('/')
        console.log('deleteGunDB:', hex, lens, key);

        if (lens === undefined) // TODO: this is a hack to get the lens and key from the key. Refactor from scheduler
            [lens,key] = key.split('_')
        return this.holosphere.delete(hex, lens, key);
    }

    // ===========================      Federation Operations

    /**
     * Get federation data (caching handled by holosphere2)
     * @param {string} holonId - Holon ID to get federation for
     * @returns {Promise<Object|null>} Federation data or null
     */
    async getFederation(holonId) {
        return await this.withTimeout(this.holosphere.getFederation(holonId));
    }

    /**
     * Unfederate holons
     * @param {string} sourceHolon - Source holon ID
     * @param {string} targetHolon - Target holon ID
     * @returns {Promise<boolean>} Success indicator
     */
    async unfederateHolon(sourceHolon, targetHolon) {
        return await this.holosphere.unfederateHolon(sourceHolon, targetHolon);
    }

    /**
     * Federate holons
     * @param {string} sourceHolon - Source holon ID
     * @param {string} targetHolon - Target holon ID
     * @param {Object} options - Federation options
     * @returns {Promise<boolean>} Success indicator
     */
    async federateHolon(sourceHolon, targetHolon, options = {}) {
        return await this.holosphere.federateHolon(sourceHolon, targetHolon, options);
    }

    /**
     * Get federated config
     * @param {string} sourceHolon - Source holon ID
     * @param {string} targetHolon - Target holon ID
     * @returns {Promise<Object|null>} Lens config or null
     */
    async getFederatedConfig(sourceHolon, targetHolon) {
        const fedData = await this.getFederation(sourceHolon);
        if (!fedData || !fedData.lensConfig) {
            return null;
        }
        return fedData.lensConfig[targetHolon] || null;
    }

    // ===========================      Hologram Operations

    /**
     * Propagate data to federated holons using holosphere2's propagateData
     * This creates holograms (lightweight references) or copies data depending on mode
     * @param {Object} data - Data to propagate
     * @param {string} sourceHolon - Source holon ID
     * @param {string} targetHolon - Target holon ID
     * @param {string} lensName - Lens name
     * @param {string} mode - 'reference' (creates hologram) or 'copy' (copies data)
     * @returns {Promise<boolean>} Success indicator
     */
    async propagateData(data, sourceHolon, targetHolon, lensName, mode = 'reference') {
        return await this.holosphere.propagateData(data, sourceHolon, targetHolon, lensName, { mode });
    }

    /**
     * Delete a hologram and clean up activeHolograms on the source
     * @param {string} holonId - Holon where the hologram lives
     * @param {string} lensName - Lens name
     * @param {string} dataId - Data ID of the hologram
     * @returns {Promise<Object>} Result with deletion info
     */
    async deleteHologram(holonId, lensName, dataId) {
        return await this.holosphere.deleteHologram(holonId, lensName, dataId);
    }

    /**
     * Create a hologram (lightweight reference) for federation
     * @param {string} sourceHolon - Source holon ID where the original data lives
     * @param {string} lensName - Lens name (e.g., 'quests')
     * @param {Object} data - Data object (must have an 'id' property)
     * @param {string} [targetHolon] - Optional target holon ID (defaults to sourceHolon)
     * @returns {Object} Hologram object ready to be written to a holon
     */
    createHologram(sourceHolon, lensName, data, targetHolon = null) {
        // Create hologram object manually matching holosphere's expected structure
        const dataId = data.id;
        const appName = this.holosphere.config?.appName || process.env.APPNAME || 'Holons';
        const target = targetHolon || sourceHolon;

        return {
            id: dataId,
            hologram: true,
            soul: `${appName}/${sourceHolon}/${lensName}/${dataId}`,
            target: {
                appname: appName,
                holonId: sourceHolon,
                lensName: lensName,
                dataId: dataId
            },
            _meta: {
                created: Date.now(),
                sourceHolon: sourceHolon,
                source: sourceHolon
            }
        };
    }

    /**
     * Resolve a hologram to its actual data, merging local overrides
     * @param {Object} hologram - Hologram object to resolve
     * @returns {Promise<Object|null>} Resolved data or null
     */
    async resolveHologram(hologram) {
        // If the holosphere library's resolveHologram works with (nostrClient, hologram), try it
        // Otherwise, implement basic resolution logic
        if (!hologram || !hologram.hologram || !hologram.target) {
            return hologram; // Not a hologram, return as-is
        }

        try {
            // Try to fetch the actual data from the source
            const { holonId, lensName, dataId } = hologram.target;
            const sourceData = await this.get(`${holonId}/${lensName}`, dataId);

            if (!sourceData) {
                return null;
            }

            // Merge local overrides from hologram with source data
            const localOverrides = {};
            const reservedKeys = ['hologram', 'soul', 'target', '_meta', 'id', 'capability', 'crossHolosphere'];
            for (const key of Object.keys(hologram)) {
                if (!reservedKeys.includes(key)) {
                    localOverrides[key] = hologram[key];
                }
            }

            return {
                ...sourceData,
                ...localOverrides,
                _hologram: {
                    isHologram: true,
                    soul: hologram.soul,
                    sourceHolon: hologram.target.holonId,
                    localOverrides: Object.keys(localOverrides)
                }
            };
        } catch (error) {
            console.error('Error resolving hologram:', error);
            return null;
        }
    }

    /**
     * Check if data is a hologram (unresolved reference)
     * @param {Object} data - Data to check
     * @returns {boolean} True if data is a hologram
     */
    isHologram(data) {
        // Simple check - a hologram has hologram: true flag
        return data && data.hologram === true;
    }
}

export default DB;