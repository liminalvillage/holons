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
        const privateKey = getOrCreateKey(dbName, generatePrivateKey);

        this.holosphere = new HoloSphere({
            appName: dbName,
            privateKey: privateKey,  // Use persistent key
            logLevel: 'WARN',
            relays: getRelays('production') // Use Nostr relays for distributed sync
        });
        this.db = 'nostr'; // Using Nostr relays for distributed storage

        // Performance: Default timeout for database operations (5 seconds)
        // This prevents slow relay responses from blocking the bot
        // Increased from 1000ms to 5000ms to handle slower Nostr relay responses
        this.defaultTimeout = 5000;

        // Short-lived write cache for performance (handles race conditions)
        // Nostr relays are the primary storage, cache just prevents immediate re-reads
        // Format: { 'table/key': { data, timestamp } }
        this.writeCache = new Map();
        this.writeCacheTTL = 60000; // Cache for 60 seconds for performance
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

    async put(table, data) {
        try {
            const key = data.id;

            // Write to Nostr first (this is the primary storage)
            await this.addGunDB(table, data);
            console.log(`DB.put: Stored in Nostr: ${table}/${key}`);

            // Cache for 60 seconds to prevent immediate re-reads
            if (key) {
                const cacheKey = `${table}/${key}`;
                const cacheEntry = {
                    data: JSON.parse(JSON.stringify(data)),
                    timestamp: Date.now()
                };
                this.writeCache.set(cacheKey, cacheEntry);
                console.log(`DB.put: Cached for performance: ${cacheKey}`);

                // Auto-expire after TTL
                setTimeout(() => {
                    const cached = this.writeCache.get(cacheKey);
                    if (cached && Date.now() - cached.timestamp >= this.writeCacheTTL) {
                        this.writeCache.delete(cacheKey);
                        console.log(`DB.put: Cache expired: ${cacheKey}`);
                    }
                }, this.writeCacheTTL);
            }

            return data;
        } catch (error) {
            console.error("Error putting data:", error);
            throw error;
        }
    }

    async get(table, key) {
        try {
            console.log(`DB.get attempting to fetch: table=${table}, key=${key}`);

            // Check cache first for recently written data (performance optimization)
            const cacheKey = `${table}/${key}`;
            const cached = this.writeCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.writeCacheTTL) {
                console.log(`DB.get: Found in cache: ${cacheKey}`);
                // Return a deep clone to prevent mutations
                return JSON.parse(JSON.stringify(cached.data));
            }

            // Fetch from Nostr (primary storage)
            console.log(`DB.get: Fetching from Nostr: ${cacheKey}`);
            const result = await this.withTimeout(this.getGunDB(table, key));

            if (result) {
                console.log(`DB.get: Found in Nostr: ${cacheKey}`);
                // Cache the result for performance
                this.writeCache.set(cacheKey, {
                    data: result,
                    timestamp: Date.now()
                });
            } else {
                console.log(`DB.get: Not found in Nostr: ${cacheKey}`);
            }

            return result;
        } catch (error) {
            console.error(`DB.get error: table=${table}, key=${key}, error:`, error.message);
            throw error;
        }
    }

    async getAll(table) {
        try {
            // Get all items from Nostr relays
            const items = await this.withTimeout(this.getAllGunDB(table));

            // Cache all items for performance
            if (items && Array.isArray(items)) {
                items.forEach(item => {
                    if (item && item.id) {
                        const cacheKey = `${table}/${item.id}`;
                        this.writeCache.set(cacheKey, {
                            data: item,
                            timestamp: Date.now()
                        });
                        console.log(`DB.getAll: Cached item: ${cacheKey}`);
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
        console.log(`DB.addGunDB: hex=${hex}, lens=${lens}, data.id=${data.id}`);
        try {
            if (lens === undefined) {
                // For global tables, extract the key from data.id
                const key = data.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                console.log(`DB.addGunDB (global): key=${key}`);
                const result = await this.holosphere.putGlobal(table, key, data);
                console.log(`DB.addGunDB (global): write completed for ${table}/${key}`);
                return result;
            } else {
                console.log(`DB.addGunDB (scoped): storing with data.id=${data.id}`);
                const result = await this.holosphere.put(hex, lens, data);
                console.log(`DB.addGunDB (scoped): write completed for ${hex}/${lens}/${data.id}`);
                return result;
            }
        } catch (error) {
            console.error(`DB.addGunDB: FAILED to write ${table}/${data.id}:`, error);
            throw error;
        }
    }

    async getGunDB(table, key) {
        let [hex, lens] = table.split('/')
        console.log(`DB.getGunDB: hex=${hex}, lens=${lens}, key=${key}`);
        if (lens === undefined) {
            const result = await this.holosphere.getGlobal(table, key);
            console.log(`DB.getGunDB (global): result=${result ? 'found' : 'null'}`);
            return result;
        } else {
            const result = await this.holosphere.get(hex, lens, key);
            console.log(`DB.getGunDB (scoped): result=${result ? 'found' : 'null'}`);
            return result;
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