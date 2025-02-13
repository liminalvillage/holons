import * as h3 from 'h3-js';
import OpenAI from 'openai';
import Gun from 'gun'
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

        // Check authentication for schema operations
        if (!this.currentSpace) {
            throw new Error('Unauthorized to modify schema');
        }
        this._checkSession();

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
                    owner: this.currentSpace.alias
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
            if (existing && existing.owner && existing.owner !== this.currentSpace.alias) {
                throw new Error('Unauthorized to modify this data');
            }
        }

        // Add owner information to data
        const dataWithOwner = {
            ...data,
            owner: this.currentSpace.alias
        };

        if (!holon || !lens || !dataWithOwner) {
            throw new Error('put: Missing required parameters');
        }

        if (!dataWithOwner.id) {
            dataWithOwner.id = this.generateId();
        }

        // Get and validate schema first
        const schema = await this.getSchema(lens);
        if (schema) {
            // Deep clone data to avoid modifying the original
            const dataToValidate = JSON.parse(JSON.stringify(dataWithOwner));
            const valid = this.validator.validate(schema, dataToValidate);
            
            if (!valid) {
                const errorMsg = `Schema validation failed: ${JSON.stringify(this.validator.errors)}`;
                // Always throw on schema validation failure, regardless of strict mode
                throw new Error(errorMsg);
            }
        } else if (this.strict) {
            throw new Error('Schema required in strict mode');
        }

        // Only proceed with put if validation passes
        return new Promise((resolve, reject) => {
            try {
                const payload = JSON.stringify(dataWithOwner);
                this.gun.get(this.appname)
                    .get(holon)
                    .get(lens)
                    .get(dataWithOwner.id)
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

        return new Promise((resolve, reject) => {
            const output = new Map(); // Use Map to ensure unique by ID
            let isResolved = false;
            let listener = null;
            
            // Set a hard timeout
            const hardTimeout = setTimeout(() => {
                if (!isResolved) {
                    cleanup();
                    resolve(Array.from(output.values()));
                }
            }, 5000); // 5 second hard timeout

            const cleanup = () => {
                if (listener) {
                    listener.off();
                }
                clearTimeout(hardTimeout);
                isResolved = true;
            };

            const processData = async (data, key) => {
                if (!data || key === '_') return; // Skip Gun metadata

                try {
                    const parsed = await this.parse(data);
                    if (!parsed || !parsed.id) return; // Skip invalid data

                    if (schema) {
                        const valid = this.validator.validate(schema, parsed);
                        if (valid || !this.strict) {
                            output.set(parsed.id, parsed); // Use ID as key to prevent duplicates
                        } else if (this.strict) {
                            await this.delete(holon, lens, key);
                        }
                    } else {
                        output.set(parsed.id, parsed);
                    }
                } catch (error) {
                    console.error('Error processing data:', error);
                    if (this.strict) {
                        await this.delete(holon, lens, key);
                    }
                }
            };

            // Get initial data snapshot
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
                        
                        // Set up listener for changes
                        listener = this.gun.get(this.appname)
                            .get(holon)
                            .get(lens)
                            .map()
                            .on(async (data, key) => {
                                await processData(data, key);
                            });

                        // Give some time for potential updates
                        setTimeout(() => {
                            if (!isResolved) {
                                cleanup();
                                resolve(Array.from(output.values()));
                            }
                        }, 1000);

                    } catch (error) {
                        cleanup();
                        reject(error);
                    }
                });
        });
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

        return new Promise((resolve) => {
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
                        if (parsed.owner && 
                            this.currentSpace?.alias !== parsed.owner &&
                            (!parsed.shared || !parsed.shared.includes(this.currentSpace?.alias))) {
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

        // Check authentication
        if (!this.currentSpace) {
            throw new Error('Unauthorized to delete this data');
        }
        this._checkSession();

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

        // Check authentication
        if (!this.currentSpace) {
            throw new Error('Unauthorized to delete this data');
        }
        this._checkSession();

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
     * Updates the parent holonagon with a new report.
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
                await callback(parsed, key);
            } catch (error) {
                console.warn('Subscription handler error:', error);
            }
        };

        // Subscribe using Gun's map() and on()
        const chain = ref.map();
        const off = chain.on(handler);

        return {
            off: async () => {
                if (chain && handler) {
                    chain.off(handler);
                }
            }
        };
    }

    // Add ID generation method
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
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

        // Create space record
        const space = {
            alias: spacename,
            // Store hashed password in a real implementation
            password: password,
            created: Date.now()
        };

        await this.putGlobal('spaces', {
            ...space,
            id: spacename
        });

        return true;
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

        // Get space record
        const space = await this.getGlobal('spaces', spacename);
        if (!space || space.password !== password) {
            throw new Error('Invalid spacename or password');
        }

        // Set current space with expiration
        this.currentSpace = {
            ...space,
            exp: Date.now() + (24 * 60 * 60 * 1000) // 24 hour expiration
        };

        return true;
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
}

export default HoloSphere;
