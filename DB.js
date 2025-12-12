// Description: This file contains the DB class which is used to interact with the database.
import {HoloSphere, createHologram as hsCreateHologram} from 'holosphere';
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
     * Clear data locally first, then async sync deletions to relay with rate limiting
     * @param {string} chatID - Chat ID to clear data for
     * @param {string[]} lenses - Array of lens names to clear (e.g., ['quests', 'shopping'])
     * @param {string[]} globalTables - Array of global table names to clear entries from
     * @param {number} delayMs - Delay between relay deletions to avoid rate limiting (default: 200ms)
     * @returns {Promise<{localCleared: number, relayQueueSize: number}>}
     */
    async clearWithAsyncRelaySync(chatID, lenses = [], globalTables = [], delayMs = 200) {
        const appName = this.holosphere.config?.appName || process.env.APPNAME || 'Holons';
        let localCleared = 0;
        const relayDeletions = []; // Queue of deletion tasks for relay

        // Clear cache for this chatID immediately
        this.holosphere.clearCache(chatID.toString());
        console.log(`[clearWithAsyncRelaySync] Cleared cache for chatID ${chatID}`);

        // Collect lens deletions
        for (const lens of lenses) {
            relayDeletions.push({
                type: 'lens',
                table: `${chatID}/${lens}`,
                lens: lens
            });
            localCleared++;
        }

        // Collect global table deletions that belong to this chatID
        for (const table of globalTables) {
            try {
                let items = [];
                if (table === 'recurring') {
                    items = await this.holosphere.getAllGlobal('recurring') || [];
                    items = items.filter(t => t.chatID === chatID);
                } else if (table === 'recurringlookup') {
                    items = await this.holosphere.getAllGlobal('recurringlookup') || [];
                    items = items.filter(t => t.id && t.id.toString().startsWith(chatID.toString()));
                } else if (table === 'reminders') {
                    items = await this.holosphere.getAllGlobal('reminders') || [];
                    items = items.filter(t => t.chatId === chatID);
                } else if (table === 'reminderslookup') {
                    items = await this.holosphere.getAllGlobal('reminderslookup') || [];
                    items = items.filter(t => t.id && t.id.toString().startsWith(chatID.toString()));
                } else if (table === 'federation') {
                    items = await this.holosphere.getAllGlobal('federation') || [];
                    items = items.filter(t => t.id === chatID.toString());
                } else if (table === 'fedannouncements') {
                    items = await this.holosphere.getAllGlobal('fedannouncements') || [];
                    items = items.filter(t => t.id && t.id.toString().startsWith(chatID.toString() + '_'));
                }

                for (const item of items) {
                    if (item.id) {
                        relayDeletions.push({
                            type: 'global',
                            table: table,
                            id: item.id
                        });
                        localCleared++;
                    }
                }
            } catch (e) {
                console.log(`[clearWithAsyncRelaySync] Error collecting ${table}:`, e.message);
            }
        }

        // Start async relay sync in background (don't await)
        this._processRelayDeletionsAsync(relayDeletions, delayMs).catch(err => {
            console.error('[clearWithAsyncRelaySync] Background relay sync error:', err.message);
        });

        return { localCleared, relayQueueSize: relayDeletions.length };
    }

    /**
     * Process relay deletions asynchronously with rate limiting
     * @private
     */
    async _processRelayDeletionsAsync(deletions, delayMs) {
        console.log(`[relaySync] Starting async deletion of ${deletions.length} items (${delayMs}ms delay between each)`);
        let processed = 0;
        let failed = 0;

        for (const deletion of deletions) {
            try {
                if (deletion.type === 'lens') {
                    await this.holosphere.deleteAll(deletion.table.split('/')[0], deletion.lens);
                } else if (deletion.type === 'global') {
                    await this.holosphere.deleteGlobal(deletion.table, deletion.id);
                }
                processed++;
            } catch (err) {
                // Log but continue - don't let one failure stop the rest
                console.log(`[relaySync] Failed to delete ${deletion.type} ${deletion.table}/${deletion.id || ''}: ${err.message}`);
                failed++;
            }

            // Rate limit: wait between deletions
            if (delayMs > 0) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }

        console.log(`[relaySync] Completed: ${processed} succeeded, ${failed} failed out of ${deletions.length} total`);
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

    async put(table, data, options = {}) {
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
            const writePromise = this.addGunDB(table, data, options);
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

    async addGunDB(table, data, options = {}) {
        let [hex, lens] = table.split('/')
        try {
            if (lens === undefined) {
                // For global tables, extract the key from data.id
                const key = data.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                return await this.holosphere.putGlobal(table, key, data);
            } else {
                return await this.holosphere.put(hex, lens, data, options);
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
        const dataId = data.id;
        const appName = this.holosphere.config?.appName || process.env.APPNAME || 'Holons';

        try {
            // Try using holosphere's createHologram function
            // Signature: createHologram(sourceHolon, targetHolon, lensName, dataId, appname, options)
            return hsCreateHologram(sourceHolon, targetHolon || 0, lensName, dataId, appName, {});
        } catch (error) {
            // Fallback: Create hologram object manually matching holosphere's expected structure
            console.warn('Using fallback hologram creation:', error.message);
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

    /**
     * Propagate data to federated holons
     * @param {string} sourceHolon - Source holon ID
     * @param {string} lensName - Lens name
     * @param {Object} data - Data to propagate (usually a hologram)
     * @param {Object} options - Propagation options
     * @returns {Promise<Object>} Propagation result
     */
    async propagate(sourceHolon, lensName, data, options = {}) {
        try {
            // Use HoloSphere's propagate method which handles federation correctly
            return await this.holosphere.propagate(sourceHolon, lensName, data, options);
        } catch (error) {
            console.error('Error in propagate:', error);
            return { success: 0, failed: 0, error: error.message };
        }
    }

    /**
     * Check if a string is a valid H3 hex index
     * @param {string} str - String to check
     * @returns {boolean} True if valid H3 index
     */
    isValidH3(str) {
        // H3 indexes are 15-character hex strings starting with '8'
        if (!str || typeof str !== 'string') return false;
        // H3 indexes are typically 15 chars for resolution 0-15
        if (!/^[0-9a-fA-F]{15}$/.test(str)) return false;
        // First character indicates resolution, valid H3 starts with 8
        return str.charAt(0) === '8';
    }

    /**
     * Propagate data from source to target holon using holosphere's propagateData
     * @param {Object} data - Data to propagate
     * @param {string} sourceHolon - Source holon ID
     * @param {string} targetHolon - Target holon ID
     * @param {string} lensName - Lens name
     * @param {Object} options - Propagation options (mode: 'reference' | 'copy')
     * @returns {Promise<boolean>} Propagation result
     */
    async propagateData(data, sourceHolon, targetHolon, lensName, options = {}) {
        try {
            // Use HoloSphere's propagateData method which passes the correct client
            return await this.holosphere.propagateData(data, sourceHolon, targetHolon, lensName, options);
        } catch (error) {
            console.error('Error in propagateData:', error);
            return false;
        }
    }
}

export default DB;