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

        // Short-lived write cache for performance (handles race conditions)
        // Nostr relays are the primary storage, cache just prevents immediate re-reads
        // Format: { 'table/key': { data, timestamp, hash } }
        this.writeCache = new Map();
        this.writeCacheTTL = 60000; // Cache for 60 seconds for performance

        // Track pending writes to prevent duplicate Nostr writes
        this.pendingWrites = new Map();
    }

    async init() {
        try {
            // HoloSphere is now initialized with Nostr relays
            console.log(`DB "${this.dbName}" initialized with ${this.holosphere.config.relays.length} Nostr relays`);

            // Preload cache from Nostr on startup (run in background)
            console.log(`DB "${this.dbName}" preloading data from Nostr relays...`);
            this.preloadCache().catch(err => {
                console.error("Error preloading cache:", err);
            });
        } catch (error) {
            console.error("Error initializing database:", error);
        }
    }

    async preloadCache() {
        // This runs in the background to populate the cache from Nostr
        // Preloading common tables that are frequently accessed
        const tablesToPreload = [
            // Format: chatId/lens - but we don't know chatIds at init
            // So we'll just rely on lazy loading
        ];

        // For now, just log that we're ready
        // Cache will be populated on-demand as data is accessed
        console.log(`DB "${this.dbName}" cache ready. Data will be loaded on-demand.`);
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
            // Remove from cache if present
            const cacheKey = `${table}/${key}`;
            if (this.writeCache.has(cacheKey)) {
                this.writeCache.delete(cacheKey);
                console.log(`DB.del: Removed from cache: ${cacheKey}`);
            }

            return this.deleteGunDB(table, key);
        } catch (error) {
            console.error("Error deleting data:", error);
            throw error; // Rethrow to allow caller to handle
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
            throw error; // Rethrow to allow caller to handle
        }
    }

    // Simple hash function for dirty checking
    _hashData(data) {
        return JSON.stringify(data);
    }

    async put(table, data) {
        try {
            const key = data.id;
            if (!key) return data;

            const cacheKey = `${table}/${key}`;
            const dataHash = this._hashData(data);

            // Check if data has changed (dirty checking)
            const cached = this.writeCache.get(cacheKey);
            if (cached && cached.hash === dataHash) {
                // Data unchanged, skip Nostr write
                return data;
            }

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

            // Update cache with new data and hash
            const cacheEntry = {
                data: JSON.parse(JSON.stringify(data)),
                timestamp: Date.now(),
                hash: dataHash
            };
            this.writeCache.set(cacheKey, cacheEntry);

            // Auto-expire after TTL
            setTimeout(() => {
                const cached = this.writeCache.get(cacheKey);
                if (cached && Date.now() - cached.timestamp >= this.writeCacheTTL) {
                    this.writeCache.delete(cacheKey);
                }
            }, this.writeCacheTTL);

            return data;
        } catch (error) {
            console.error(`DB.put error: ${table}/${data.id}:`, error.message);
            throw error;
        }
    }

    async get(table, key) {
        try {
            // Check cache first for recently written data (performance optimization)
            const cacheKey = `${table}/${key}`;
            const cached = this.writeCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.writeCacheTTL) {
                // Return a deep clone to prevent mutations
                return JSON.parse(JSON.stringify(cached.data));
            }

            // Fetch from Nostr (primary storage)
            const result = await this.withTimeout(this.getGunDB(table, key));

            if (result) {
                // Cache the result for performance (with hash for dirty checking)
                this.writeCache.set(cacheKey, {
                    data: result,
                    timestamp: Date.now(),
                    hash: this._hashData(result)
                });
            }

            return result;
        } catch (error) {
            console.error(`DB.get error: ${table}/${key}:`, error.message);
            throw error;
        }
    }

    async getAll(table) {
        try {
            // Get all items from Nostr relays
            const items = await this.withTimeout(this.getAllGunDB(table));

            // Cache all items for performance (with hash for dirty checking)
            if (items && Array.isArray(items)) {
                items.forEach(item => {
                    if (item && item.id) {
                        const cacheKey = `${table}/${item.id}`;
                        this.writeCache.set(cacheKey, {
                            data: item,
                            timestamp: Date.now(),
                            hash: this._hashData(item)
                        });
                    }
                });
            }

            return items;
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
}

export default DB;