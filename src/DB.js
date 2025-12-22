/**
 * @fileoverview Database abstraction layer for HolonsBot using HoloSphere.
 * @module src/DB
 * @deprecated Use createHoloSphere from './createHoloSphere.js' instead.
 * This class is kept for backward compatibility but all new code should
 * use HoloSphere directly:
 *
 * @example
 * // Old approach (deprecated):
 * import DB from './DB.js';
 * const db = new DB('myApp');
 * await db.put(holonId, 'quests', data);
 *
 * // New approach:
 * import createHoloSphere from './createHoloSphere.js';
 * const holosphere = createHoloSphere('myApp');
 * await holosphere.put(holonId, 'quests', data);
 */
import {HoloSphere, createHologram as hsCreateHologram} from 'holosphere';
import { getOrCreateKey } from '../utils/key-storage.js';
import { generateSecretKey } from 'nostr-tools';

/**
 * Generates a hex-encoded private key for Nostr.
 * @private
 * @returns {string} Hex-encoded private key
 */
function generatePrivateKey() {
    const secretKey = generateSecretKey();
    return Buffer.from(secretKey).toString('hex');
}

/**
 * Database class providing an abstraction layer over HoloSphere for decentralized data storage.
 *
 * @class DB
 * @description Manages all database operations using HoloSphere as the underlying decentralized
 * database. Supports Nostr relays for distributed sync, federation operations, and hologram
 * (reference) management.
 *
 * @property {Object|null} gun - Legacy Gun.js reference (deprecated)
 * @property {string} dbName - Name of the database instance
 * @property {Object} preloadedDB - Cache for preloaded data
 * @property {HoloSphere} holosphere - The HoloSphere instance for data operations
 * @property {string} db - Backend type identifier ('nostr' or 'gun')
 * @property {number} defaultTimeout - Default timeout for database operations in ms
 * @property {Map<string, Promise>} pendingWrites - Tracks pending write operations
 *
 * @example
 * const db = new DB('myDatabase');
 * await db.init();
 * await db.put('users/data', { id: '123', name: 'John' });
 * const user = await db.get('users/data', '123');
 */
class DB {
    /**
     * Creates a new DB instance with HoloSphere backend.
     * @constructor
     * @param {string} dbName - Name for the database instance
     */
    constructor(dbName) {
        this.gun = null;
        this.dbName = dbName;
        this.preloadedDB = {};

        // IMPORTANT: Use persistent private key so the same identity is maintained across restarts
        // This allows the bot to access its previous data from Nostr relays
        // Priority: 1) .env HOLOSPHERE_PRIVATE_KEY, 2) stored key, 3) generate new key
        const appName = process.env.APPNAME || 'Holons';
        const privateKey = process.env.HOLOSPHERE_PRIVATE_KEY || getOrCreateKey(appName, generatePrivateKey);
        // -=-=-=-=- use NOSTR
        this.holosphere = new HoloSphere({
            backend:'nostr',
            appName: appName,
            privateKey: privateKey,  // Use persistent key
            logLevel: 'INFO',
            relays: ['wss://relay.holons.io/'] // Use Nostr relays for distributed sync
        });
        this.db = 'nostr'

        // -=-=-=-=- use GUN
        // this.holosphere = new HoloSphere({ 
        //     backend: 'gundb',
		// 	appName: appName,
		// 	privateKey: privateKey,
		// 	logLevel: 'DEBUG',
		// 	gundb: {
		// 		peers: ['https://gun.holons.io/gun'],  // Gun relay server
		// 		radisk: true,
		// 		localStorage: false
		// 	}
		// })
        // this.db = 'gun'; // Using Nostr relays for distributed storage

        // Performance: Default timeout for database operations (5 seconds)
        // This prevents slow relay responses from blocking the bot
        // Increased from 1000ms to 5000ms to handle slower Nostr relay responses
        this.defaultTimeout = 50000;

        // Track pending writes to prevent duplicate Nostr writes
        this.pendingWrites = new Map();
    }

    /**
     * Initializes the database connection.
     * @async
     * @returns {Promise<void>}
     */
    async init() {
        try {
            console.log(`DB "${this.dbName}" initialized with ${this.db.config.relays.length} Nostr relays`);
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



    /**
     * Deletes a record from the database.
     * @async
     * @param {string} table - Table name (format: 'holonId/lens' or 'globalTable')
     * @param {string} key - Record key to delete
     * @returns {Promise<*>} Deletion result
     * @throws {Error} If deletion fails
     */
    async del(table, key) {
        try {
            return this.deleteGunDB(table, key);
        } catch (error) {
            console.error("Error deleting data:", error);
            throw error;
        }
    }

    /**
     * Drops all data from a table.
     * @async
     * @param {string} table - Table name (format: 'holonId/lens' or 'globalTable')
     * @returns {Promise<void>}
     * @throws {Error} If drop operation fails
     */
    async drop(table) {
        try {
            let [hex, lens] = table.split('/')
            if (lens === undefined)
                await this.db.deleteAllGlobal(table);
            else
                await this.db.deleteAll(hex, lens);
        } catch (error) {
            console.error("Error dropping table:", error);
            throw error;
        }
    }

    /**
     * Stores data in the database.
     * @async
     * @param {string} table - Table name (format: 'holonId/lens' or 'globalTable')
     * @param {Object} data - Data object to store (must have an 'id' property)
     * @param {Object} [options={}] - Storage options
     * @returns {Promise<Object>} The stored data object
     * @throws {Error} If storage fails
     */
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

    /**
     * Retrieves a single record from the database.
     * @async
     * @param {string} table - Table name (format: 'holonId/lens' or 'globalTable')
     * @param {string} key - Record key to retrieve
     * @returns {Promise<Object|null>} The retrieved data or null if not found
     * @throws {Error} If retrieval fails
     */
    async get(table, key) {
        try {
            return await this.withTimeout(this.getGunDB(table, key));
        } catch (error) {
            console.error(`DB.get error: ${table}/${key}:`, error.message);
            throw error;
        }
    }

    /**
     * Retrieves all records from a table.
     * @async
     * @param {string} table - Table name (format: 'holonId/lens' or 'globalTable')
     * @returns {Promise<Array>} Array of all records in the table
     * @throws {Error} If retrieval fails
     */
    async getAll(table) {
        try {
            return await this.withTimeout(this.getAllGunDB(table));
        } catch (error) {
            console.error(`DB.getAll error for ${table}:`, error.message);
            throw error;
        }
    }

    // ===========================      Gun Functions

    /**
     * Low-level method to add data to the database backend.
     * @async
     * @private
     * @param {string} table - Table name (format: 'holonId/lens' or 'globalTable')
     * @param {Object} data - Data to store
     * @param {Object} [options={}] - Storage options
     * @returns {Promise<*>} Storage result
     * @throws {Error} If storage fails
     */
    async addGunDB(table, data, options = {}) {
        let [hex, lens] = table.split('/')
        try {
            if (lens === undefined) {
                // For global tables, ensure data has an id property
                if (!data.id) {
                    data.id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                }
                return await this.db.putGlobal(table, data);
            } else {
                return await this.db.put(hex, lens, data, options);
            }
        } catch (error) {
            console.error(`DB.addGunDB: FAILED to write ${table}/${data.id}:`, error.message);
            throw error;
        }
    }

    /**
     * Low-level method to get data from the database backend.
     * @async
     * @private
     * @param {string} table - Table name (format: 'holonId/lens' or 'globalTable')
     * @param {string} key - Record key
     * @returns {Promise<Object|null>} Retrieved data or null
     */
    async getGunDB(table, key) {
        let [hex, lens] = table.split('/')
        if (lens === undefined) {
            return await this.db.getGlobal(table, key);
        } else {
            return await this.db.get(hex, lens, key);
        }
    }

    /**
     * Low-level method to get all data from a table in the database backend.
     * @async
     * @private
     * @param {string} table - Table name (format: 'holonId/lens' or 'globalTable')
     * @returns {Promise<Array>} Array of all records
     */
    async getAllGunDB(table) {
        let [hex, lens] = table.split('/')
        if (lens === undefined)
            return await this.db.getAllGlobal(table);
        else
            return await this.db.getAll(hex, lens);
    }

    /**
     * Low-level method to delete data from the database backend.
     * @private
     * @param {string} table - Table name (format: 'holonId/lens' or 'globalTable')
     * @param {string} key - Record key to delete
     * @returns {Promise<*>} Deletion result
     */
    deleteGunDB(table, key) {
        let [hex, lens] = table.split('/')
        console.log('deleteGunDB:', hex, lens, key);

        if (lens === undefined)
            [lens,key] = key.split('_')
        return this.db.delete(hex, lens, key);
    }

    // ===========================      Federation Operations

    /**
     * Get federation data (caching handled by holosphere2)
     * @param {string} holonId - Holon ID to get federation for
     * @returns {Promise<Object|null>} Federation data or null
     */
    async getFederation(holonId) {
        return await this.withTimeout(this.db.getFederation(holonId));
    }

    /**
     * Unfederate holons
     * @param {string} sourceHolon - Source holon ID
     * @param {string} targetHolon - Target holon ID
     * @returns {Promise<boolean>} Success indicator
     */
    async unfederateHolon(sourceHolon, targetHolon) {
        return await this.db.unfederateHolon(sourceHolon, targetHolon);
    }

    /**
     * Federate holons
     * @param {string} sourceHolon - Source holon ID
     * @param {string} targetHolon - Target holon ID
     * @param {Object} options - Federation options
     * @returns {Promise<boolean>} Success indicator
     */
    async federateHolon(sourceHolon, targetHolon, options = {}) {
        return await this.db.federateHolon(sourceHolon, targetHolon, options);
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
        return await this.db.deleteHologram(holonId, lensName, dataId);
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
        const appName = this.db.config?.appName || process.env.APPNAME || 'Holons';

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
            return await this.db.propagate(sourceHolon, lensName, data, options);
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
            return await this.db.propagateData(data, sourceHolon, targetHolon, lensName, options);
        } catch (error) {
            console.error('Error in propagateData:', error);
            return false;
        }
    }
}

export default DB;