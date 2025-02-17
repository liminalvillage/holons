import * as h3 from 'h3-js';
import OpenAI from 'openai';
import Gun from 'gun'
import 'gun/sea' // Import SEA module
import Ajv2019 from 'ajv/dist/2019.js'


class HoloSphere {
    /**
     * Initializes a new instance of the HoloSphere class.
     * @param {string} appname - The name of the application.
     * @param {boolean} strict - Whether to enforce strict schema validation.
     * @param {string|null} openaikey - The OpenAI API key.
     * @param {Gun|null} gunInstance - The Gun instance to use.
     */
    constructor(appname, strict = false, openaikey = null, gunInstance = null) {
        this.appname = appname
        this.strict = strict;
        this.validator = new Ajv2019({
            allErrors: true,
            strict: false,  // Keep this false to avoid Ajv strict mode issues
            validateSchema: true // Always validate schemas
        });
        
        // Use provided Gun instance or create new one
        this.gun = gunInstance || Gun({
            peers: ['https://gun.holons.io/gun', 'https://59.src.eco/gun'],
            axe: false,
            // uuid: (content) => { // generate a unique id for each node
            //     console.log('uuid', content);
            //     return content;}
        });

        // Initialize SEA
        this.sea = Gun.SEA;

        if (openaikey != null) {
            this.openai = new OpenAI({
                apiKey: openaikey,
            });
        }

        // Add currentSpace property to track logged in space
        this.currentSpace = null;
    }

    // ================================ SCHEMA FUNCTIONS ================================

    /**
     * Sets the JSON schema for a specific lens.
     * @param {string} lens - The lens identifier.
     * @param {object} schema - The JSON schema to set.
     * @returns {Promise} - Resolves when the schema is set.
     */
    async setSchema(lens, schema) {
        if (!lens || !schema) {
            throw new Error('setSchema: Missing required parameters');
        }

        // Basic schema validation
        if (!schema.type || typeof schema.type !== 'string') {
            throw new Error('setSchema: Schema must have a type field');
        }

        if (this.strict) {
            const metaSchema = {
                type: 'object',
                required: ['type', 'properties'],
                properties: {
                    type: { type: 'string' },
                    properties: {
                        type: 'object',
                        additionalProperties: {
                            type: 'object',
                            required: ['type'],
                            properties: {
                                type: { type: 'string' }
                            }
                        }
                    },
                    required: {
                        type: 'array',
                        items: { type: 'string' }
                    }
                }
            };

            const valid = this.validator.validate(metaSchema, schema);
            if (!valid) {
                throw new Error(`Invalid schema structure: ${JSON.stringify(this.validator.errors)}`);
            }

            if (!schema.properties || typeof schema.properties !== 'object') {
                throw new Error('Schema must have properties in strict mode');
            }

            if (!schema.required || !Array.isArray(schema.required) || schema.required.length === 0) {
                throw new Error('Schema must have required fields in strict mode');
            }
        }

        return new Promise((resolve, reject) => {
            try {
                const schemaString = JSON.stringify(schema);
                const schemaData = {
                    schema: schemaString,
                    timestamp: Date.now(),
                    // Only set owner if there's an authenticated space
                    ...(this.currentSpace && { owner: this.currentSpace.alias })
                };
                
                this.gun.get(this.appname)
                    .get(lens)
                    .get('schema')
                    .put(schemaData, ack => {
                        if (ack.err) {
                            reject(new Error(ack.err));
                        } else {
                            // Add small delay to ensure data is written
                            setTimeout(() => resolve(true), 50);
                        }
                    });
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Retrieves the JSON schema for a specific lens.
     * @param {string} lens - The lens identifier.
     * @returns {Promise<object|null>} - The retrieved schema or null if not found.
     */
    async getSchema(lens) {
        if (!lens) {
            throw new Error('getSchema: Missing lens parameter');
        }

        return new Promise((resolve) => {
            let timeout = setTimeout(() => {
                console.warn('getSchema: Operation timed out');
                resolve(null);
            }, 5000);

            this.gun.get(this.appname)
                .get(lens)
                .get('schema')
                .once(data => {
                    clearTimeout(timeout);
                    if (!data) {
                        resolve(null);
                        return;
                    }

                    try {
                        // Handle both new format and legacy format
                        if (data.schema) {
                            // New format with timestamp
                            resolve(JSON.parse(data.schema));
                        } else {
                            // Legacy format or direct string
                            const schemaStr = typeof data === 'string' ? data : 
                                Object.values(data).find(v => typeof v === 'string' && v.includes('"type":'));
                            resolve(schemaStr ? JSON.parse(schemaStr) : null);
                        }
                    } catch (error) {
                        console.error('getSchema: Error parsing schema:', error);
                        resolve(null);
                    }
                });
        });
    }

    // ================================ CONTENT FUNCTIONS ================================

    /**
     * Stores content in the specified holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens under which to store the content.
     * @param {object} data - The data to store.
     * @returns {Promise<boolean>} - Returns true if successful, false if there was an error
     */
    async put(holon, lens, data) {
        // Check authentication for data operations
        if (!this.currentSpace) {
            throw new Error('Unauthorized to modify this data');
        }
        this._checkSession();

        // If updating existing data, check ownership
        if (data.id) {
            const existing = await this.get(holon, lens, data.id);
            if (existing && existing.owner && 
                existing.owner !== this.currentSpace.alias && 
                !existing.federation) { // Skip ownership check for federated data
                throw new Error('Unauthorized to modify this data');
            }
        }

        // Add owner and federation information to data
        const dataWithMeta = {
            ...data,
            owner: this.currentSpace.alias,
            federation: {
                origin: this.currentSpace.alias,
                timestamp: Date.now()
            }
        };

        if (!holon || !lens || !dataWithMeta) {
            throw new Error('put: Missing required parameters');
        }

        if (!dataWithMeta.id) {
            dataWithMeta.id = this.generateId();
        }

        // Get and validate schema first
        const schema = await this.getSchema(lens);
        if (schema) {
            // Deep clone data to avoid modifying the original
            const dataToValidate = JSON.parse(JSON.stringify(dataWithMeta));
            const valid = this.validator.validate(schema, dataToValidate);
            
            if (!valid) {
                const errorMsg = `Schema validation failed: ${JSON.stringify(this.validator.errors)}`;
                // Always throw on schema validation failure, regardless of strict mode
                throw new Error(errorMsg);
            }
        } else if (this.strict) {
            throw new Error('Schema required in strict mode');
        }

        // Store data in current space
        const putResult = await new Promise((resolve, reject) => {
            try {
                const payload = JSON.stringify(dataWithMeta);
                this.gun.get(this.appname)
                    .get(holon)
                    .get(lens)
                    .get(dataWithMeta.id)
                    .put(payload, ack => {
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

        // If successful, propagate to federated spaces
        if (putResult) {
            await this._propagateToFederation(holon, lens, dataWithMeta);
        }

        return putResult;
    }

    /**
     * Propagates data to federated spaces
     * @private
     * @param {string} holon - The holon identifier
     * @param {string} lens - The lens identifier
     * @param {object} data - The data to propagate
     */
    async _propagateToFederation(holon, lens, data) {
        try {
            // Get federation info for current space
            const fedInfo = await this.getFederation(this.currentSpace.alias);
            if (!fedInfo || !fedInfo.notify || fedInfo.notify.length === 0) {
                return; // No federation to propagate to
            }

            // Propagate to each federated space
            const propagationPromises = fedInfo.notify.map(spaceId => 
                new Promise((resolve) => {
                    // Store data in the federated space's lens
                    this.gun.get(this.appname)
                        .get(spaceId)
                        .get(lens)
                        .get(data.id)
                        .put(JSON.stringify({
                            ...data,
                            federation: {
                                ...data.federation,
                                notified: Date.now()
                            }
                        }), ack => {
                            if (ack.err) {
                                console.warn(`Failed to propagate to space ${spaceId}:`, ack.err);
                            }
                            resolve();
                        });

                    // Also store in federation lens for notifications
                    this.gun.get(this.appname)
                        .get(spaceId)
                        .get('federation')
                        .get(data.id)
                        .put(JSON.stringify({
                            ...data,
                            federation: {
                                ...data.federation,
                                notified: Date.now()
                            }
                        }));
                })
            );

            await Promise.all(propagationPromises);
        } catch (error) {
            console.warn('Federation propagation error:', error);
            // Don't throw here to avoid failing the original put
        }
    }

    /**
     * Retrieves content from the specified holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens from which to retrieve content.
     * @returns {Promise<Array<object>>} - The retrieved content.
     */
    async getAll(holon, lens) {
        if (!holon || !lens) {
            throw new Error('getAll: Missing required parameters');
        }

        const schema = await this.getSchema(lens);
        if (!schema && this.strict) {
            throw new Error('getAll: Schema required in strict mode');
        }

        // Get local data
        const localData = await this._getAllLocal(holon, lens, schema);
        
        // If authenticated, get federated data
        let federatedData = [];
        if (this.currentSpace) {
            federatedData = await this._getAllFederated(holon, lens, schema);
        }

        // Combine and deduplicate data based on ID
        const combined = new Map();
        
        // Add local data first
        localData.forEach(item => {
            if (item.id) {
                combined.set(item.id, item);
            }
        });

        // Add federated data, potentially overwriting local data if newer
        federatedData.forEach(item => {
            if (item.id) {
                const existing = combined.get(item.id);
                if (!existing || 
                    (item.federation?.timestamp > (existing.federation?.timestamp || 0))) {
                    combined.set(item.id, item);
                }
            }
        });

        return Array.from(combined.values());
    }

    /**
     * Gets data from federated spaces
     * @private
     * @param {string} holon - The holon identifier
     * @param {string} lens - The lens identifier
     * @param {string} key - The key to get
     * @returns {Promise<object|null>} - The federated data or null if not found
     */
    async _getFederatedData(holon, lens, key) {
        try {
            const fedInfo = await this.getFederation(this.currentSpace.alias);
            if (!fedInfo || !fedInfo.federation || fedInfo.federation.length === 0) {
                return null;
            }

            // Try each federated space
            for (const spaceId of fedInfo.federation) {
                const result = await new Promise((resolve) => {
                    this.gun.get(this.appname)
                        .get(spaceId)
                        .get(lens)
                        .get(key)
                        .once(async (data) => {
                            if (!data) {
                                resolve(null);
                                return;
                            }
                            try {
                                const parsed = await this.parse(data);
                                resolve(parsed);
                            } catch (error) {
                                console.warn(`Error parsing federated data from ${spaceId}:`, error);
                                resolve(null);
                            }
                        });
                });

                if (result) {
                    return result;
                }
            }
        } catch (error) {
            console.warn('Federation get error:', error);
        }
        return null;
    }

    /**
     * Gets all data from local space
     * @private
     * @param {string} holon - The holon identifier
     * @param {string} lens - The lens identifier
     * @param {object} schema - The schema to validate against
     * @returns {Promise<Array>} - Array of local data
     */
    async _getAllLocal(holon, lens, schema) {
        return new Promise((resolve) => {
            const output = new Map();
            let isResolved = false;
            let listener = null;
            
            const hardTimeout = setTimeout(() => {
                cleanup();
                resolve(Array.from(output.values()));
            }, 5000);

            const cleanup = () => {
                if (listener) {
                    listener.off();
                }
                clearTimeout(hardTimeout);
                isResolved = true;
            };

            const processData = async (data, key) => {
                if (!data || key === '_') return;

                try {
                    const parsed = await this.parse(data);
                    if (!parsed || !parsed.id) return;

                    if (schema) {
                        const valid = this.validator.validate(schema, parsed);
                        if (valid || !this.strict) {
                            output.set(parsed.id, parsed);
                        }
                    } else {
                        output.set(parsed.id, parsed);
                    }
                } catch (error) {
                    console.error('Error processing data:', error);
                }
            };

            this.gun.get(this.appname)
                .get(holon)
                .get(lens)
                .once(async (data) => {
                    if (!data) {
                        cleanup();
                        resolve([]);
                        return;
                    }

                    const initialPromises = [];
                    Object.keys(data)
                        .filter(key => key !== '_')
                        .forEach(key => {
                            initialPromises.push(processData(data[key], key));
                        });

                    try {
                        await Promise.all(initialPromises);
                        cleanup();
                        resolve(Array.from(output.values()));
                    } catch (error) {
                        cleanup();
                        resolve([]);
                    }
                });
        });
    }

    /**
     * Gets all data from federated spaces
     * @private
     * @param {string} holon - The holon identifier
     * @param {string} lens - The lens identifier
     * @param {object} schema - The schema to validate against
     * @returns {Promise<Array>} - Array of federated data
     */
    async _getAllFederated(holon, lens, schema) {
        try {
            const fedInfo = await this.getFederation(this.currentSpace.alias);
            if (!fedInfo || !fedInfo.federation || fedInfo.federation.length === 0) {
                return [];
            }

            const federatedData = new Map();
            
            // Get data from each federated space
            const fedPromises = fedInfo.federation.map(spaceId =>
                new Promise((resolve) => {
                    this.gun.get(this.appname)
                        .get(spaceId)
                        .get(lens)
                        .once(async (data) => {
                            if (!data) {
                                resolve();
                                return;
                            }

                            const processPromises = Object.keys(data)
                                .filter(key => key !== '_')
                                .map(async key => {
                                    try {
                                        const parsed = await this.parse(data[key]);
                                        if (parsed && parsed.id) {
                                            if (schema) {
                                                const valid = this.validator.validate(schema, parsed);
                                                if (valid || !this.strict) {
                                                    federatedData.set(parsed.id, parsed);
                                                }
                                            } else {
                                                federatedData.set(parsed.id, parsed);
                                            }
                                        }
                                    } catch (error) {
                                        console.warn(`Error processing federated data from ${spaceId}:`, error);
                                    }
                                });

                            await Promise.all(processPromises);
                            resolve();
                        });
                })
            );

            await Promise.all(fedPromises);
            return Array.from(federatedData.values());
        } catch (error) {
            console.warn('Federation getAll error:', error);
            return [];
        }
    }

    /**
   * Parses data from GunDB, handling various data formats and references.
   * @param {*} data - The data to parse, could be a string, object, or GunDB reference.
   * @returns {Promise<object>} - The parsed data.
   */
    async parse(rawData) {
        if (!rawData) {
            throw new Error('parse: No data provided');
        }

        try {
            if (rawData.soul) {
                const data = await this.getNodeRef(rawData.soul).once();
                if (!data) {
                    throw new Error('Referenced data not found');
                }
                return JSON.parse(data);
            }

            let parsedData = {};
            if (typeof rawData === 'object' && rawData !== null) {
                if (rawData._ && rawData._["#"]) {
                    const pathParts = rawData._['#'].split('/');
                    if (pathParts.length < 4) {
                        throw new Error('Invalid reference format');
                    }
                    parsedData = await this.get(pathParts[1], pathParts[2], pathParts[3]);
                    if (!parsedData) {
                        throw new Error('Referenced data not found');
                    }
                } else if (rawData._ && rawData._['>']) {
                    const nodeValue = Object.values(rawData).find(v => typeof v !== 'object' && v !== '_');
                    if (!nodeValue) {
                        throw new Error('Invalid node data');
                    }
                    parsedData = JSON.parse(nodeValue);
                } else {
                    parsedData = rawData;
                }
            } else {
                parsedData = JSON.parse(rawData);
            }

            return parsedData;
        } catch (error) {
            console.log("Parsing not a JSON, returning raw data", rawData);
            return rawData;
            //throw new Error(`Parse error: ${error.message}`);
        }
    }

    /**
     * Retrieves a specific key from the specified holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens from which to retrieve the key.
     * @param {string} key - The specific key to retrieve.
     * @returns {Promise<object|null>} - The retrieved content or null if not found.
     */
    async get(holon, lens, key) {
        if (!holon || !lens || !key) {
            console.error('get: Missing required parameters:', { holon, lens, key });
            return null;
        }

        // Get schema for validation
        const schema = await this.getSchema(lens);

        // First try to get from current space
        const localResult = await new Promise((resolve) => {
            let timeout = setTimeout(() => {
                console.warn('get: Operation timed out');
                resolve(null);
            }, 5000);

            this.gun.get(this.appname)
                .get(holon)
                .get(lens)
                .get(key)
                .once(async (data) => {
                    clearTimeout(timeout);
                   
                    if (!data) {
                        resolve(null);
                        return;
                    }

                    try {
                        const parsed = await this.parse(data);

                        // Validate against schema if one exists
                        if (schema) {
                            const valid = this.validator.validate(schema, parsed);
                            if (!valid) {
                                console.error('get: Invalid data according to schema:', this.validator.errors);
                                if (this.strict) {
                                    resolve(null);
                                    return;
                                }
                            }
                        }

                        // Check if user has access - only allow if:
                        // 1. No owner (public data)
                        // 2. User is the owner
                        // 3. User is in shared list
                        // 4. Data is from federation
                        if (parsed.owner && 
                            this.currentSpace?.alias !== parsed.owner &&
                            (!parsed.shared || !parsed.shared.includes(this.currentSpace?.alias)) &&
                            (!parsed.federation || !parsed.federation.origin)) {
                            resolve(null);
                            return;
                        }

                        resolve(parsed);
                    } catch (error) {
                        console.error('Error parsing data:', error);
                        resolve(null);
                    }
                });
        });

        // If found locally, return it
        if (localResult) {
            return localResult;
        }

        // If not found locally and we're authenticated, try federated spaces
        if (this.currentSpace) {
            const fedResult = await this._getFederatedData(holon, lens, key);
            if (fedResult) {
                return fedResult;
            }
        }

        return null;
    }

    /**
     * Deletes a specific key from a given holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens from which to delete the key.
     * @param {string} key - The specific key to delete.
     */
    async delete(holon, lens, key) {
        if (!holon || !lens || !key) {
            throw new Error('delete: Missing required parameters');
        }

        if (!this.currentSpace) {
            throw new Error('Unauthorized to delete this data');
        }
        this._checkSession();

        // Check ownership before delete
        const data = await this.get(holon, lens, key);
        if (!data) {
            return true; // Nothing to delete
        }
        
        if (data.owner && data.owner !== this.currentSpace.alias) {
            throw new Error('Unauthorized to delete this data');
        }

        return new Promise((resolve, reject) => {
            try {
                this.gun.get(this.appname)
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
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Deletes all keys from a given holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens from which to delete all keys.
     * @returns {Promise<boolean>} - Returns true if successful, false if there was an error
     */
    async deleteAll(holon, lens) {
        if (!holon || !lens) {
            console.error('deleteAll: Missing holon or lens parameter');
            return false;
        }

        return new Promise((resolve) => {
            let deletionPromises = [];

            // First get all the data to find keys to delete
            this.gun.get(this.appname).get(holon).get(lens).once((data) => {
                if (!data) {
                    resolve(true); // Nothing to delete
                    return;
                }

                // Get all keys except Gun's metadata key '_'
                const keys = Object.keys(data).filter(key => key !== '_');

                // Create deletion promises for each key
                keys.forEach(key => {
                    deletionPromises.push(
                        new Promise((resolveDelete) => {
                            this.gun.get(this.appname).get(holon).get(lens).get(key).put(null, ack => {
                                resolveDelete(!!ack.ok); // Convert to boolean
                            });
                        })
                    );
                });

                // Wait for all deletions to complete
                Promise.all(deletionPromises)
                    .then(results => {
                        const allSuccessful = results.every(result => result === true);
                        resolve(allSuccessful);
                    })
                    .catch(error => {
                        console.error('Error in deleteAll:', error);
                        resolve(false);
                });
            });
        });
    }

    // ================================ NODE FUNCTIONS ================================


    /**
     * Stores a specific gun node in a given holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens under which to store the node.
     * @param {object} data - The node to store.
     */
    async putNode(holon, lens, data) {
        if (!holon || !lens || !data) {
            throw new Error('putNode: Missing required parameters');
        }

        return new Promise((resolve, reject) => {
            try {
                this.gun.get(this.appname)
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
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens identifier.
     * @param {string} key - The specific key to retrieve.
     * @returns {Promise<any>} - The retrieved node or null if not found.
     */
    async getNode(holon, lens, key) {
        if (!holon || !lens || !key) {
            throw new Error('getNode: Missing required parameters');
        }

        return new Promise((resolve) => {
            this.gun.get(this.appname)
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
        });
    }

    getNodeRef(soul) {
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

        let ref = this.gun.get(this.appname);
        parts.forEach(part => {
            ref = ref.get(part);
        });
        return ref;
    }

    /**
     * Deletes a specific gun node from a given holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens identifier.
     * @param {string} key - The key of the node to delete.
     * @returns {Promise<boolean>} - Returns true if successful
     */
    async deleteNode(holon, lens, key) {
        if (!holon || !lens || !key) {
            throw new Error('deleteNode: Missing required parameters');
        }
        return new Promise((resolve, reject) => {
            this.gun.get(this.appname)
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

    // ================================ GLOBAL FUNCTIONS ================================
    /**
     * Stores data in a global (non-holon-specific) table.
     * @param {string} tableName - The table name to store data in.
     * @param {object} data - The data to store. If it has an 'id' field, it will be used as the key.
     * @returns {Promise<void>}
     */
    async putGlobal(tableName, data) {
        return new Promise((resolve, reject) => {
            try {
                if (!tableName || !data) {
                    throw new Error('Table name and data are required');
                }

                if (data.id) {
                    this.gun.get(this.appname).get(tableName).get(data.id).put(JSON.stringify(data), ack => {
                        if (ack.err) {
                            reject(new Error(ack.err));
                        } else {
                            resolve();
                        }
                    });
                } else {
                    this.gun.get(this.appname).get(tableName).put(JSON.stringify(data), ack => {
                        if (ack.err) {
                            reject(new Error(ack.err));
                        } else {
                            resolve();
                        }
                    });
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
    * Retrieves a specific key from a global table.
    * @param {string} tableName - The table name to retrieve from.
    * @param {string} key - The key to retrieve.
    * @returns {Promise<object|null>} - The parsed data for the key or null if not found.
    */
    async getGlobal(tableName, key) {
        return new Promise((resolve) => {
            this.gun.get(this.appname).get(tableName).get(key).once((data) => {
                if (!data) {
                    resolve(null);
                    return;
                }
                try {
                    const parsed = this.parse(data);
                    resolve(parsed);
                } catch (e) {
                    resolve(null);
                }
            });
        });
    }



    /**
     * Retrieves all data from a global table.
     * @param {string} tableName - The table name to retrieve data from.
     * @returns {Promise<object|null>} - The parsed data from the table or null if not found.
     */
    async getAllGlobal(tableName) {
        if (!tableName) {
            throw new Error('getAllGlobal: Missing table name parameter');
        }

        return new Promise((resolve) => {
            let output = [];
            let isResolved = false;
            let timeout = setTimeout(() => {
                if (!isResolved) {
                    isResolved = true;
                    resolve(output);
                }
            }, 5000);

            this.gun.get(this.appname).get(tableName).once(async (data) => {
                if (!data) {
                    clearTimeout(timeout);
                    isResolved = true;
                    resolve([]);
                    return;
                }

                const keys = Object.keys(data).filter(key => key !== '_');
                const promises = keys.map(key => 
                    new Promise(async (resolveItem) => {
                        const itemData = await new Promise(resolveData => {
                            this.gun.get(this.appname).get(tableName).get(key).once(resolveData);
                        });
                        
                        if (itemData) {
                            try {
                                const parsed = await this.parse(itemData);
                                if (parsed) output.push(parsed);
                            } catch (error) {
                                console.error('Error parsing data:', error);
                            }
                        }
                        resolveItem();
                    })
                );

                await Promise.all(promises);
                clearTimeout(timeout);
                if (!isResolved) {
                    isResolved = true;
                    resolve(output);
                }
            });
        });
    }
    /**
     * Deletes a specific key from a global table.
     * @param {string} tableName - The table name to delete from.
     * @param {string} key - The key to delete.
     * @returns {Promise<void>}
     */
    async deleteGlobal(tableName, key) {
        if (!tableName || !key) {
            throw new Error('deleteGlobal: Missing required parameters');
        }

        // Only check authentication for non-spaces tables
        if (tableName !== 'spaces' && !this.currentSpace) {
            throw new Error('Unauthorized to delete this data');
        }

        // Skip session check for spaces table
        if (tableName !== 'spaces') {
            this._checkSession();
        }

        return new Promise((resolve, reject) => {
            try {
                this.gun.get(this.appname)
                    .get(tableName)
                    .get(key)
                    .put(null, ack => {
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
     * Deletes an entire global table.
     * @param {string} tableName - The table name to delete.
     * @returns {Promise<void>}
     */
    async deleteAllGlobal(tableName) {
        if (!tableName) {
            throw new Error('deleteAllGlobal: Missing table name parameter');
        }

        // Only check authentication for non-spaces and non-federation tables
        if (!['spaces', 'federation'].includes(tableName) && !this.currentSpace) {
            throw new Error('Unauthorized to delete this data');
        }

        // Skip session check for spaces and federation tables
        if (!['spaces', 'federation'].includes(tableName)) {
            this._checkSession();
        }

        return new Promise((resolve, reject) => {
            try {
                const deletions = new Set();
                let timeout = setTimeout(() => {
                    if (deletions.size === 0) {
                        resolve(true); // No data to delete
                    }
                }, 5000);

                this.gun.get(this.appname).get(tableName).once(async (data) => {
                    if (!data) {
                        clearTimeout(timeout);
                        resolve(true);
                        return;
                    }

                    const keys = Object.keys(data).filter(key => key !== '_');
                    const promises = keys.map(key => 
                        new Promise((resolveDelete) => {
                            this.gun.get(this.appname)
                                .get(tableName)
                                .get(key)
                                .put(null, ack => {
                                    if (ack.err) {
                                        console.error(`Failed to delete ${key}:`, ack.err);
                                    }
                                    resolveDelete();
                                });
                        })
                    );

                    try {
                        await Promise.all(promises);
                        // Finally delete the table itself
                        this.gun.get(this.appname).get(tableName).put(null);
                        clearTimeout(timeout);
                        resolve(true);
                    } catch (error) {
                        reject(error);
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    // ================================ COMPUTE FUNCTIONS ================================
    /**
     * Computes summaries based on the content within a holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens to compute.
     * @param {string} operation - The operation to perform.
     * @param {number} [depth=0] - Current recursion depth.
     * @param {number} [maxDepth=15] - Maximum recursion depth.
     * @throws {Error} If parameters are invalid or missing
     */
    async compute(holon, lens, operation, depth = 0, maxDepth = 15) {
        // Validate required parameters
        if (!holon || !lens || !operation) {
            throw new Error('compute: Missing required parameters');
        }

        // Validate holon format and resolution
        let res;
        try {
            res = h3.getResolution(holon);
        } catch (error) {
            throw new Error('compute: Invalid holon format');
        }

        if (res < 1 || res > 15) {
            throw new Error('compute: Invalid holon resolution (must be between 1 and 15)');
        }

        // Validate depth parameters
        if (typeof depth !== 'number' || depth < 0) {
            throw new Error('compute: Invalid depth parameter');
        }

        if (typeof maxDepth !== 'number' || maxDepth < 1 || maxDepth > 15) {
            throw new Error('compute: Invalid maxDepth parameter (must be between 1 and 15)');
        }

        if (depth >= maxDepth) {
            return;
        }

        // Validate operation
        if (typeof operation !== 'string' || !['summarize'].includes(operation)) {
            throw new Error('compute: Invalid operation (must be "summarize")');
        }

        const parent = h3.cellToParent(holon, res - 1);
        const siblings = h3.cellToChildren(parent, res);

        const content = [];
        const promises = siblings.map(sibling => 
            new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    console.warn(`Timeout for sibling ${sibling}`);
                    resolve();
                }, 10000);

                this.gun.get(this.appname)
                    .get(sibling)
                    .get(lens)
                    .map()
                    .once((data) => {
                        clearTimeout(timeout);
                        if (!data) {
                            resolve();
                            return;
                        }

                        try {
                            // Parse the data if it's a string
                            const parsed = typeof data === 'string' ? JSON.parse(data) : data;
                            if (parsed && parsed.content) {
                                content.push(parsed.content);
                            }
                        } catch (error) {
                            console.warn('Error parsing data:', error);
                        }
                        resolve();
                    });
            })
        );

        await Promise.all(promises);

        if (content.length > 0) {
            try {
                const computed = await this.summarize(content.join('\n'));
                if (computed) {
                    const summaryId = `${parent}_summary`;
                    await this.put(parent, lens, { 
                        id: summaryId, 
                        content: computed,
                        timestamp: Date.now()
                    });

                    if (res > 1) { // Only recurse if not at top level
                        await this.compute(parent, lens, operation, depth + 1, maxDepth);
                    }
                }
            } catch (error) {
                console.warn('Error in compute operation:', error);
                // Don't throw here to maintain graceful handling of compute errors
            }
        }

        // Return successfully even if no content was found or processed
        return;
    }

    /**
     * Clears all entities under a specific holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens to clear.
     */
    async clearlens(holon, lens) {
        if (!holon || !lens) {
            throw new Error('clearlens: Missing required parameters');
        }

        return new Promise((resolve, reject) => {
            try {
                const deletions = new Set();
                const timeout = setTimeout(() => {
                    if (deletions.size === 0) {
                        resolve(); // No data to delete
                    }
                }, 1000);

                this.gun.get(this.appname)
                    .get(holon)
                    .get(lens)
                    .map()
                    .once((data, key) => {
                        if (data) {
                            const deletion = new Promise((resolveDelete) => {
                                this.gun.get(this.appname)
                                    .get(holon)
                                    .get(lens)
                                    .get(key)
                                    .put(null, ack => {
                                        if (ack.err) {
                                            console.error(`Failed to delete ${key}:`, ack.err);
                                        }
                                        resolveDelete();
                                    });
                            });
                            deletions.add(deletion);
                            deletion.finally(() => {
                                deletions.delete(deletion);
                                if (deletions.size === 0) {
                                    clearTimeout(timeout);
                                    resolve();
                                }
                            });
                        }
                    });
            } catch (error) {
                reject(error);
            }
        });
    }


    /**
     * Summarizes provided history text using OpenAI.
     * @param {string} history - The history text to summarize.
     * @returns {Promise<string>} - The summarized text.
     */
    async summarize(history) {
        if (!this.openai) {
            return 'OpenAI not initialized, please specify the API key in the constructor.'
        }
        //const run = await this.openai.beta.threads.runs.retrieve(thread.id,run.id)
        const assistant = await this.openai.beta.assistants.retrieve("asst_qhk79F8wV9BDNuwfOI80TqzC")
        const thread = await this.openai.beta.threads.create()
        const message = await this.openai.beta.threads.messages.create(thread.id, {
            role: "user",
            content: history
        })
        const run = await this.openai.beta.threads.runs.create(thread.id, {
            assistant_id: assistant.id //,
            //instructions: "What is the meaning of life?",
        });

        let runStatus = await this.openai.beta.threads.runs.retrieve(
            thread.id,
            run.id
        );
        // Polling mechanism to see if runStatus is completed
        // This should be made more robust.
        while (runStatus.status !== "completed") {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            runStatus = await this.openai.beta.threads.runs.retrieve(thread.id, run.id);
        }
        // Get the latest messages from the thread
        const messages = await this.openai.beta.threads.messages.list(thread.id)
        const summary = messages.data[0].content[0].text.value.replace(/\`\`\`json\n/, '').replace(/\`\`\`/, '').trim()
        return summary
    }

    /**
     * Upcasts content to parent holonagons recursively.
     * @param {string} holon - The current holon identifier.
     * @param {string} lens - The lens under which to upcast.
     * @param {object} content - The content to upcast.
     * @returns {Promise<object>} - The upcasted content.
     */
    async upcast(holon, lens, content) {
        let res = h3.getResolution(holon)
        if (res == 0) {
            await this.put(holon, lens, content)
            return content
        }
        else {
            console.log('Upcasting ', holon, lens, content, res)
            await this.put(holon, lens, content)
            let parent = h3.cellToParent(holon, res - 1)
            return this.upcast(parent, lens, content)
        }
    }


    /**
     * Updates the parent holon with a new report.
     * @param {string} id - The child holon identifier.
     * @param {string} report - The report to update.
     * @returns {Promise<object>} - The updated parent information.
     */
    async updateParent(id, report) {
        let cellinfo = await this.getCellInfo(id)
        let res = h3.getResolution(id)
        let parent = h3.cellToParent(id, res - 1)
        let parentInfo = await this.getCellInfo(parent)
        parentInfo.wisdom[id] = report
        //update summary
        let summary = await this.summarize(Object.values(parentInfo.wisdom).join('\n'))
        parentInfo.summary = summary

        await this.db.put('cell', parentInfo)
        return parentInfo
    }


    /**
     * Converts latitude and longitude to a holon identifier.
     * @param {number} lat - The latitude.
     * @param {number} lng - The longitude.
     * @param {number} resolution - The resolution level.
     * @returns {Promise<string>} - The resulting holon identifier.
     */
    async getHolon(lat, lng, resolution) {
        return h3.latLngToCell(lat, lng, resolution);
    }

    /**
     * Retrieves all containing holonagons at all scales for given coordinates.
     * @param {number} lat - The latitude.
     * @param {number} lng - The longitude.
     * @returns {Array<string>} - List of holon identifiers.
     */
    getScalespace(lat, lng) {
        let list = []
        let cell = h3.latLngToCell(lat, lng, 14);
        list.push(cell)
        for (let i = 13; i >= 0; i--) {
            list.push(h3.cellToParent(cell, i))
        }
        return list
    }

    /**
     * Retrieves all containing holonagons at all scales for a given holon.
     * @param {string} holon - The holon identifier.
     * @returns {Array<string>} - List of holon identifiers.
     */
    getHolonScalespace(holon) {
        let list = []
        let res = h3.getResolution(holon)
        for (let i = res; i >= 0; i--) {
            list.push(h3.cellToParent(holon, i))
        }
        return list
    }

    /**
     * Subscribes to changes in a specific holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens to subscribe to.
     * @param {function} callback - The callback to execute on changes.
     */
    async subscribe(holon, lens, callback) {
        if (!holon || !lens || !callback) {
            throw new Error('subscribe: Missing required parameters');
        }

        const ref = this.gun.get(this.appname)
            .get(holon)
            .get(lens);

        // Create a more robust handler
        const handler = async (data, key) => {
            if (!data || key === '_') return; // Skip empty data or Gun metadata

            try {
                const parsed = typeof data === 'string' ? await this.parse(data) : data;
                if (parsed) {
                    await callback(parsed);
                }
            } catch (error) {
                console.warn('Subscription handler error:', error);
            }
        };

        // Subscribe using Gun's map() and on()
        const chain = ref.map();
        chain.on(handler);

        // Return subscription object
        return {
            off: () => {
                if (chain) {
                    chain.off();
                }
            }
        };
    }

    // Add ID generation method
    generateId() {
        return Date.now().toString(10) + Math.random().toString(2);
    }

    /**
     * Creates a new space with the given credentials
     * @param {string} spacename - The space identifier/username
     * @param {string} password - The space password
     * @returns {Promise<boolean>} - True if space was created successfully
     */
    async createSpace(spacename, password) {
        if (!spacename || !password) {
            throw new Error('Invalid credentials format');
        }

        // Check if space already exists
        const existingSpace = await this.getGlobal('spaces', spacename);
        if (existingSpace) {
            throw new Error('Space already exists');
        }

        try {
            // Generate key pair
            const pair = await Gun.SEA.pair();
            
            // Create auth record with SEA
            const salt = await Gun.SEA.random(64).toString('base64');
            const hash = await Gun.SEA.work(password, salt);
            const auth = {
                salt: salt,
                hash: hash,
                pub: pair.pub
            };

            // Create space record with encrypted data
            const space = {
                alias: spacename,
                auth: auth,
                epub: pair.epub,
                pub: pair.pub,
                created: Date.now()
            };

            await this.putGlobal('spaces', {
                ...space,
                id: spacename
            });

            return true;
        } catch (error) {
            throw new Error(`Space creation failed: ${error.message}`);
        }
    }

    /**
     * Logs in to a space with the given credentials
     * @param {string} spacename - The space identifier/username
     * @param {string} password - The space password
     * @returns {Promise<boolean>} - True if login was successful
     */
    async login(spacename, password) {
        // Validate input
        if (!spacename || !password || 
            typeof spacename !== 'string' || 
            typeof password !== 'string') {
            throw new Error('Invalid credentials format');
        }

        try {
            // Get space record
            const space = await this.getGlobal('spaces', spacename);
            if (!space || !space.auth) {
                throw new Error('Invalid spacename or password');
            }

            // Verify password using SEA
            const hash = await Gun.SEA.work(password, space.auth.salt);
            if (hash !== space.auth.hash) {
                throw new Error('Invalid spacename or password');
            }

            // Set current space with expiration
            this.currentSpace = {
                ...space,
                exp: Date.now() + (24 * 60 * 60 * 1000) // 24 hour expiration
            };

            return true;
        } catch (error) {
            throw new Error('Authentication failed');
        }
    }

    /**
     * Logs out the current space
     * @returns {Promise<void>}
     */
    async logout() {
        this.currentSpace = null;
    }

    /**
     * Checks if the current session is valid
     * @private
     */
    _checkSession() {
        if (!this.currentSpace) {
            throw new Error('No active session');
        }
        if (this.currentSpace.exp < Date.now()) {
            this.currentSpace = null;
            throw new Error('Session expired');
        }
        return true;
    }

    /**
     * Creates a federation relationship between two spaces
     * @param {string} spaceId1 - The first space ID
     * @param {string} spaceId2 - The second space ID
     * @returns {Promise<boolean>} - True if federation was created successfully
     */
    async federate(spaceId1, spaceId2) {
        if (!spaceId1 || !spaceId2) {
            throw new Error('federate: Missing required parameters');
        }

        // Get existing federation info for both spaces
        let fedInfo1 = await this.getGlobal('federation', spaceId1);
        let fedInfo2 = await this.getGlobal('federation', spaceId2);

        // Check if federation already exists
        if (fedInfo1 && fedInfo1.federation && fedInfo1.federation.includes(spaceId2)) {
            throw new Error('Federation already exists');
        }

        // Create or update federation info for first space
        if (!fedInfo1) {
            fedInfo1 = {
                id: spaceId1,
                name: spaceId1,
                federation: [],
                notify: []
            };
        }
        if (!fedInfo1.federation) fedInfo1.federation = [];
        fedInfo1.federation.push(spaceId2);

        // Create or update federation info for second space
        if (!fedInfo2) {
            fedInfo2 = {
                id: spaceId2,
                name: spaceId2,
                federation: [],
                notify: []
            };
        }
        if (!fedInfo2.notify) fedInfo2.notify = [];
        fedInfo2.notify.push(spaceId1);

        // Save both federation records
        await this.putGlobal('federation', fedInfo1);
        await this.putGlobal('federation', fedInfo2);

        return true;
    }

    /**
     * Subscribes to federation notifications for a space
     * @param {string} spaceId - The space ID to subscribe to
     * @param {function} callback - The callback to execute on notifications
     * @returns {Promise<object>} - Subscription object with off() method
     */
    async subscribeFederation(spaceId, callback) {
        if (!spaceId || !callback) {
            throw new Error('subscribeFederation: Missing required parameters');
        }

        // Get federation info
        const fedInfo = await this.getGlobal('federation', spaceId);
        if (!fedInfo) {
            throw new Error('No federation info found for space');
        }

        // Create subscription for each federated space
        const subscriptions = [];
        if (fedInfo.federation && fedInfo.federation.length > 0) {
            for (const federatedSpace of fedInfo.federation) {
                // Subscribe to all lenses in the federated space
                const sub = await this.subscribe(federatedSpace, '*', async (data) => {
                    try {
                        // Only notify if the data has federation info and is from the federated space
                        if (data && data.federation && data.federation.origin === federatedSpace) {
                            await callback(data);
                        }
                    } catch (error) {
                        console.warn('Federation notification error:', error);
                    }
                });
                subscriptions.push(sub);
            }
        }

        // Return combined subscription object
        return {
            off: () => {
                subscriptions.forEach(sub => {
                    if (sub && typeof sub.off === 'function') {
                        sub.off();
                    }
                });
            }
        };
    }

    /**
     * Gets federation info for a space
     * @param {string} spaceId - The space ID
     * @returns {Promise<object|null>} - Federation info or null if not found
     */
    async getFederation(spaceId) {
        if (!spaceId) {
            throw new Error('getFederationInfo: Missing space ID');
        }
        return await this.getGlobal('federation', spaceId);
    }

    /**
     * Removes a federation relationship between spaces
     * @param {string} spaceId1 - The first space ID
     * @param {string} spaceId2 - The second space ID
     * @returns {Promise<boolean>} - True if federation was removed successfully
     */
    async unfederate(spaceId1, spaceId2) {
        if (!spaceId1 || !spaceId2) {
            throw new Error('unfederate: Missing required parameters');
        }

        // Get federation info for both spaces
        const fedInfo1 = await this.getGlobal('federation', spaceId1);
        const fedInfo2 = await this.getGlobal('federation', spaceId2);

        if (fedInfo1) {
            fedInfo1.federation = fedInfo1.federation.filter(id => id !== spaceId2);
            await this.putGlobal('federation', fedInfo1);
        }

        if (fedInfo2) {
            fedInfo2.notify = fedInfo2.notify.filter(id => id !== spaceId1);
            await this.putGlobal('federation', fedInfo2);
        }

        return true;
    }

    /**
     * Gets the name of a chat/space
     * @param {string} spaceId - The space ID
     * @returns {Promise<string>} - The space name or the ID if not found
     */
    async getChatName(spaceId) {
        const spaceInfo = await this.getGlobal('spaces', spaceId);
        return spaceInfo?.name || spaceId;
    }

    /**
     * Gets data from a holon and lens, including data from federated spaces with optional aggregation
     * @param {string} holon - The holon identifier
     * @param {string} lens - The lens identifier
     * @param {object} options - Options for data retrieval and aggregation
     * @param {boolean} options.aggregate - Whether to aggregate items with matching IDs (default: false)
     * @param {string} options.idField - Field to use as identifier for aggregation (default: 'id')
     * @param {string[]} options.sumFields - Numeric fields to sum during aggregation (e.g., ['received', 'sent'])
     * @param {string[]} options.concatArrays - Array fields to concatenate during aggregation (e.g., ['wants', 'offers'])
     * @param {boolean} options.removeDuplicates - Whether to remove duplicates when not aggregating (default: true)
     * @param {function} options.mergeStrategy - Custom function to merge items during aggregation
     * @returns {Promise<Array>} - Combined array of local and federated data
     */
    async getFederated(holon, lens, options = {}) {
        // Validate required parameters
        if (!holon || !lens) {
            throw new Error('getFederated: Missing required parameters');
        }

        const {
            aggregate = false,
            idField = 'id',
            sumFields = [],
            concatArrays = [],
            removeDuplicates = true,
            mergeStrategy = null
        } = options;

        // Get federation info for current space
        const fedInfo = await this.getFederation(this.currentSpace?.alias);
        
        // Get local data
        const localData = await this.getAll(holon, lens);
        
        // If no federation or not authenticated, return local data only
        if (!fedInfo || !fedInfo.federation || fedInfo.federation.length === 0) {
            return localData;
        }

        // Get data from each federated space
        const federatedData = await Promise.all(
            fedInfo.federation.map(async (federatedSpace) => {
                try {
                    const data = await this.getAll(federatedSpace, lens);
                    return data || [];
                } catch (error) {
                    console.warn(`Error getting data from federated space ${federatedSpace}:`, error);
                    return [];
                }
            })
        );

        // Combine all data
        const allData = [...localData, ...federatedData.flat()];

        // If aggregating, use enhanced aggregation logic
        if (aggregate) {
            const aggregated = new Map();

            for (const item of allData) {
                const itemId = item[idField];
                if (!itemId) continue;

                const existing = aggregated.get(itemId);
                if (!existing) {
                    aggregated.set(itemId, { ...item });
                } else {
                    // If custom merge strategy is provided, use it
                    if (mergeStrategy && typeof mergeStrategy === 'function') {
                        aggregated.set(itemId, mergeStrategy(existing, item));
                        continue;
                    }

                    // Enhanced default merge strategy
                    const merged = { ...existing };

                    // Sum numeric fields
                    for (const field of sumFields) {
                        if (typeof item[field] === 'number') {
                            merged[field] = (merged[field] || 0) + (item[field] || 0);
                        }
                    }

                    // Concatenate and deduplicate array fields
                    for (const field of concatArrays) {
                        if (Array.isArray(item[field])) {
                            const combinedArray = [
                                ...(merged[field] || []),
                                ...(item[field] || [])
                            ];
                            // Remove duplicates if elements are primitive
                            merged[field] = Array.from(new Set(combinedArray));
                        }
                    }

                    // Update federation metadata
                    merged.federation = {
                        ...merged.federation,
                        timestamp: Math.max(
                            merged.federation?.timestamp || 0,
                            item.federation?.timestamp || 0
                        ),
                        origins: Array.from(new Set([
                            ...(merged.federation?.origins || [merged.federation?.origin]),
                            ...(item.federation?.origins || [item.federation?.origin])
                        ]).filter(Boolean))
                    };

                    // Update the aggregated item
                    aggregated.set(itemId, merged);
                }
            }

            return Array.from(aggregated.values());
        }

        // If not aggregating, optionally remove duplicates based on idField
        if (!removeDuplicates) {
            return allData;
        }
        
        // Remove duplicates keeping the most recent version
        const uniqueMap = new Map();
        allData.forEach(item => {
            const id = item[idField];
            if (!id) return;
            
            const existing = uniqueMap.get(id);
            if (!existing || 
                (item.federation?.timestamp > (existing.federation?.timestamp || 0))) {
                uniqueMap.set(id, item);
            }
        });
        return Array.from(uniqueMap.values());
    }
}

export default HoloSphere;
