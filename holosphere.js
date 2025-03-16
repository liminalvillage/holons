import * as h3 from 'h3-js';
import OpenAI from 'openai';
import Gun from 'gun'
import SEA from 'gun/sea.js'
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
        console.log('HoloSphere v1.1.5'); 
        this.appname = appname
        this.strict = strict;
        this.validator = new Ajv2019({
            allErrors: true,
            strict: false,  // Keep this false to avoid Ajv strict mode issues
            validateSchema: true // Always validate schemas
        });

        // Handle different ways of providing Gun instance or options
        if (gunInstance && gunInstance.opt) {
            // If an object with 'opt' property is passed, create a new Gun instance with those options
            this.gun = Gun(gunInstance.opt);
        } else {
            // Use provided Gun instance or create new one with default options
            this.gun = gunInstance || Gun({
                peers: ['https://gun.holons.io/gun'],
                axe: false,
            });
        }

        // Initialize SEA
        this.sea = SEA;

        if (openaikey != null) {
            this.openai = new OpenAI({
                apiKey: openaikey,
            });
        }

        // Initialize spaces cache
        this.spaces = {};

        // Initialize subscriptions
        this.subscriptions = {};
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
        
        // Store schema in global table with lens as key
        await this.putGlobal('schemas', {
            id: lens,
            schema: schema,
            timestamp: Date.now(),
            owner: this.currentSpace?.alias
        });

        return true;
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

        const schemaData = await this.getGlobal('schemas', lens);
        if (!schemaData || !schemaData.schema) {
            return null;
        }

        return schemaData.schema;
    }

    // ================================ CONTENT FUNCTIONS ================================

    /**
     * Stores content in the specified holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens under which to store the content.
     * @param {object} data - The data to store.
     * @param {string} [password] - Optional password for private space.
     * @returns {Promise<boolean>} - Returns true if successful, false if there was an error
     */
    async put(holon, lens, data, password = null) {
        if (!holon || !lens || !data) {
            throw new Error('put: Missing required parameters');
        }

        if (!data.id) {
            data.id = this.generateId();
        }

        // Get and validate schema only in strict mode
        if (this.strict) {
            const schema = await this.getSchema(lens);
            if (!schema) {
                throw new Error('Schema required in strict mode');
            }
            const dataToValidate = JSON.parse(JSON.stringify(data));
            const valid = this.validator.validate(schema, dataToValidate);

            if (!valid) {
                const errorMsg = `Schema validation failed: ${JSON.stringify(this.validator.errors)}`;
                throw new Error(errorMsg);
            }
        }

        try {
            const user = this.gun.user();
            
            if (password) {
                try {
                    await new Promise((resolve, reject) => {
                        user.auth(holon, password, (ack) => {
                            if (ack.err) reject(new Error(ack.err));
                            else resolve();
                        });
                    });
                } catch (loginError) {
                    // If authentication fails, try to create user and then authenticate
                    await new Promise((resolve, reject) => {
                        user.create(holon, password, (ack) => {
                            if (ack.err) reject(new Error(ack.err));
                            else {
                                user.auth(holon, password, (authAck) => {
                                    if (authAck.err) reject(new Error(authAck.err));
                                    else resolve();
                                });
                            }
                        });
                    });
                }
            }

            return new Promise((resolve, reject) => {
                try {
                    const payload = JSON.stringify(data);
                    
                    if (password) {
                        // For private data, use the authenticated user's space
                        user.get('private').get(lens).get(data.id).put(payload, ack => {
                            if (ack.err) {
                                reject(new Error(ack.err));
                            } else {
                                this.notifySubscribers({
                                    holon,
                                    lens,
                                    ...data
                                });
                                resolve(true);
                            }
                        });
                    } else {
                        // For public data, use the regular path
                        this.gun.get(this.appname).get(holon).get(lens).get(data.id).put(payload, ack => {
                            if (ack.err) {
                                reject(new Error(ack.err));
                            } else {
                                this.notifySubscribers({
                                    holon,
                                    lens,
                                    ...data
                                });
                                resolve(true);
                            }
                        });
                    }
                } catch (error) {
                    reject(error);
                }
            });
        } catch (error) {
            console.error('Error in put:', error);
            throw error;
        }
    }

    /**
     * Retrieves content from the specified holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens from which to retrieve content.
     * @param {string} key - The specific key to retrieve.
     * @param {string} [password] - Optional password for private space.
     * @returns {Promise<object|null>} - The retrieved content or null if not found.
     */
    async get(holon, lens, key, password = null) {
        if (!holon || !lens || !key) {
            console.error('get: Missing required parameters:', { holon, lens, key });
            return null;
        }

        // Only check schema in strict mode
        let schema;
        if (this.strict) {
            schema = await this.getSchema(lens);
            if (!schema) {
                throw new Error('Schema required in strict mode');
            }
        }

        try {
            const user = this.gun.user();
            
            if (password) {
                try {
                    await new Promise((resolve, reject) => {
                        user.auth(holon, password, (ack) => {
                            if (ack.err) reject(new Error(ack.err));
                            else resolve();
                        });
                    });
                } catch (loginError) {
                    // If authentication fails, try to create user and then authenticate
                    await new Promise((resolve, reject) => {
                        user.create(holon, password, (ack) => {
                            if (ack.err) reject(new Error(ack.err));
                            else {
                                user.auth(holon, password, (authAck) => {
                                    if (authAck.err) reject(new Error(authAck.err));
                                    else resolve();
                                });
                            }
                        });
                    });
                }
            }

            return new Promise((resolve) => {
                const handleData = async (data) => {
                    if (!data) {
                        resolve(null);
                        return;
                    }

                    try {
                        const parsed = await this.parse(data);

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

                        resolve(parsed);
                    } catch (error) {
                        console.error('Error parsing data:', error);
                        resolve(null);
                    }
                };

                if (password) {
                    // For private data, use the authenticated user's space
                    user.get('private').get(lens).get(key).once(handleData);
                } else {
                    // For public data, use the regular path
                    this.gun.get(this.appname).get(holon).get(lens).get(key).once(handleData);
                }
            });
        } catch (error) {
            console.error('Error in get:', error);
            return null;
        }
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
     * Retrieves all content from the specified holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens from which to retrieve content.
     * @param {string} [password] - Optional password for private space.
     * @returns {Promise<Array<object>>} - The retrieved content.
     */
    async getAll(holon, lens, password = null) {
        if (!holon || !lens) {
            throw new Error('getAll: Missing required parameters');
        }

        const schema = await this.getSchema(lens);
        if (!schema && this.strict) {
            throw new Error('getAll: Schema required in strict mode');
        }

        try {
            const user = this.gun.user();

            return new Promise((resolve) => {
                const output = new Map();

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

                const handleData = async (data) => {
                    if (!data) {
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
                        resolve(Array.from(output.values()));
                    } catch (error) {
                        console.error('Error in getAll:', error);
                        resolve([]);
                    }
                };

                if (password) {
                    // For private data, use the authenticated user's space
                    user.get('private').get(lens).once(handleData);
                } else {
                    // For public data, use the regular path
                    this.gun.get(this.appname).get(holon).get(lens).once(handleData);
                }
            });
        } catch (error) {
            console.error('Error in getAll:', error);
            return [];
        }
    }

    /**
   * Parses data from GunDB, handling various data formats and references.
   * @param {*} data - The data to parse, could be a string, object, or GunDB reference.
   * @returns {Promise<object>} - The parsed data.
   */
    async parse(rawData) {
        let parsedData = {};

        if (!rawData) {
            throw new Error('parse: No data provided');
        }

        try {

            if (typeof rawData === 'string') {
                parsedData = await JSON.parse(rawData);
            }


            if (rawData.soul) {
                const data = await this.getNodeRef(rawData.soul).once();
                if (!data) {
                    throw new Error('Referenced data not found');
                }
                return JSON.parse(data);
            }

       
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
            }

            return parsedData;

        } catch (error) {
            console.log("Parsing not a JSON, returning raw data", rawData);
            return rawData;
            //throw new Error(`Parse error: ${error.message}`);
        }
    }

    /**
     * Deletes a specific key from a given holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens from which to delete the key.
     * @param {string} key - The specific key to delete.
     * @param {string} [password] - Optional password for private space.
     * @returns {Promise<boolean>} - Returns true if successful
     */
    async delete(holon, lens, key, password = null) {
        if (!holon || !lens || !key) {
            throw new Error('delete: Missing required parameters');
        }

        try {
            // Get the appropriate space
            const user = this.gun.user();

            // Delete data from space
            return new Promise((resolve, reject) => {
                if (password) {
                    // For private data, use the authenticated user's space
                    user.get('private').get(lens).get(key).put(null, ack => {
                        if (ack.err) {
                            reject(new Error(ack.err));
                        } else {
                            resolve(true);
                        }
                    });
                } else {
                    // For public data, use the regular path
                    this.gun.get(this.appname).get(holon).get(lens).get(key).put(null, ack => {
                        if (ack.err) {
                            reject(new Error(ack.err));
                        } else {
                            resolve(true);
                        }
                    });
                }
            });
        } catch (error) {
            console.error('Error in delete:', error);
            throw error;
        }
    }

    /**
     * Deletes all keys from a given holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens from which to delete all keys.
     * @param {string} [password] - Optional password for private space.
     * @returns {Promise<boolean>} - Returns true if successful
     */
    async deleteAll(holon, lens, password = null) {
        if (!holon || !lens) {
            console.error('deleteAll: Missing holon or lens parameter');
            return false;
        }

        try {
            // Get the appropriate space
            const user = this.gun.user();

            return new Promise((resolve) => {
                let deletionPromises = [];
                
                const dataPath = password ? 
                    user.get('private').get(lens) :
                    this.gun.get(this.appname).get(holon).get(lens);

                // First get all the data to find keys to delete
                dataPath.once((data) => {
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
                                const deletePath = password ? 
                                    user.get('private').get(lens).get(key) :
                                    this.gun.get(this.appname).get(holon).get(lens).get(key);

                                deletePath.put(null, ack => {
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
        } catch (error) {
            console.error('Error in deleteAll:', error);
            return false;
        }
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
     * @param {string} [password] - Optional password for private space.
     * @returns {Promise<void>}
     */
    async putGlobal(tableName, data, password = null) {
        try {
            if (!tableName || !data) {
                throw new Error('Table name and data are required');
            }

            const user = this.gun.user();
            
            if (password) {
                try {
                    await new Promise((resolve, reject) => {
                        user.auth(tableName, password, (ack) => {
                            if (ack.err) reject(new Error(ack.err));
                            else resolve();
                        });
                    });
                } catch (loginError) {
                    // If authentication fails, try to create user and then authenticate
                    await new Promise((resolve, reject) => {
                        user.create(tableName, password, (ack) => {
                            if (ack.err) reject(new Error(ack.err));
                            else {
                                user.auth(tableName, password, (authAck) => {
                                    if (authAck.err) reject(new Error(authAck.err));
                                    else resolve();
                                });
                            }
                        });
                    });
                }
            }

            return new Promise((resolve, reject) => {
                const payload = JSON.stringify(data);
                
                if (password) {
                    // For private data, use the authenticated user's space
                    const path = user.get('private').get(tableName);
                    
                    if (data.id) {
                        path.get(data.id).put(payload, ack => {
                            if (ack.err) {
                                reject(new Error(ack.err));
                            } else {
                                resolve();
                            }
                        });
                    } else {
                        path.put(payload, ack => {
                            if (ack.err) {
                                reject(new Error(ack.err));
                            } else {
                                resolve();
                            }
                        });
                    }
                } else {
                    // For public data, use the regular path
                    const path = this.gun.get(this.appname).get(tableName);
                    
                    if (data.id) {
                        path.get(data.id).put(payload, ack => {
                            if (ack.err) {
                                reject(new Error(ack.err));
                            } else {
                                resolve();
                            }
                        });
                    } else {
                        path.put(payload, ack => {
                            if (ack.err) {
                                reject(new Error(ack.err));
                            } else {
                                resolve();
                            }
                        });
                    }
                }
            });
        } catch (error) {
            console.error('Error in putGlobal:', error);
            throw error;
        }
    }

    /**
     * Retrieves a specific key from a global table.
     * @param {string} tableName - The table name to retrieve from.
     * @param {string} key - The key to retrieve.
     * @param {string} [password] - Optional password for private space.
     * @returns {Promise<object|null>} - The parsed data for the key or null if not found.
     */
    async getGlobal(tableName, key, password = null) {
        try {
            const user = this.gun.user();
            
            if (password) {
                try {
                    await new Promise((resolve, reject) => {
                        user.auth(tableName, password, (ack) => {
                            if (ack.err) reject(new Error(ack.err));
                            else resolve();
                        });
                    });
                } catch (loginError) {
                    // If authentication fails, try to create user and then authenticate
                    await new Promise((resolve, reject) => {
                        user.create(tableName, password, (ack) => {
                            if (ack.err) reject(new Error(ack.err));
                            else {
                                user.auth(tableName, password, (authAck) => {
                                    if (authAck.err) reject(new Error(authAck.err));
                                    else resolve();
                                });
                            }
                        });
                    });
                }
            }

            return new Promise((resolve) => {
                const handleData = (data) => {
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
                };
                
                if (password) {
                    // For private data, use the authenticated user's space
                    user.get('private').get(tableName).get(key).once(handleData);
                } else {
                    // For public data, use the regular path
                    this.gun.get(this.appname).get(tableName).get(key).once(handleData);
                }
            });
        } catch (error) {
            console.error('Error in getGlobal:', error);
            return null;
        }
    }

    /**
     * Retrieves all data from a global table.
     * @param {string} tableName - The table name to retrieve data from.
     * @param {string} [password] - Optional password for private space.
     * @returns {Promise<Array<object>>} - The parsed data from the table as an array.
     */
    async getAllGlobal(tableName, password = null) {
        if (!tableName) {
            throw new Error('getAllGlobal: Missing table name parameter');
        }

        try {
            // Get the appropriate space
            const user = this.gun.user();

            return new Promise((resolve) => {
                let output = [];
                let isResolved = false;
                let timeout = setTimeout(() => {
                    if (!isResolved) {
                        isResolved = true;
                        resolve(output);
                    }
                }, 5000);

                const handleData = async (data) => {
                    if (!data) {
                        clearTimeout(timeout);
                        isResolved = true;
                        resolve([]);
                        return;
                    }

                    const keys = Object.keys(data).filter(key => key !== '_');
                    const promises = keys.map(key =>
                        new Promise(async (resolveItem) => {
                            const itemPath = password ? 
                                user.get('private').get(tableName).get(key) :
                                this.gun.get(this.appname).get(tableName).get(key);

                            const itemData = await new Promise(resolveData => {
                                itemPath.once(resolveData);
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
                };

                if (password) {
                    // For private data, use the authenticated user's space
                    user.get('private').get(tableName).once(handleData);
                } else {
                    // For public data, use the regular path
                    this.gun.get(this.appname).get(tableName).once(handleData);
                }
            });
        } catch (error) {
            console.error('Error in getAllGlobal:', error);
            return [];
        }
    }

    /**
     * Deletes a specific key from a global table.
     * @param {string} tableName - The table name to delete from.
     * @param {string} key - The key to delete.
     * @param {string} [password] - Optional password for private space.
     * @returns {Promise<boolean>}
     */
    async deleteGlobal(tableName, key, password = null) {
        if (!tableName || !key) {
            throw new Error('deleteGlobal: Missing required parameters');
        }

        try {
            // Get the appropriate space
            const user = this.gun.user();

            return new Promise((resolve, reject) => {
                if (password) {
                    // For private data, use the authenticated user's space
                    user.get('private').get(tableName).get(key).put(null, ack => {
                        if (ack.err) {
                            reject(new Error(ack.err));
                        } else {
                            resolve(true);
                        }
                    });
                } else {
                    // For public data, use the regular path
                    this.gun.get(this.appname).get(tableName).get(key).put(null, ack => {
                        if (ack.err) {
                            reject(new Error(ack.err));
                        } else {
                            resolve(true);
                        }
                    });
                }
            });
        } catch (error) {
            console.error('Error in deleteGlobal:', error);
            throw error;
        }
    }

    /**
     * Deletes an entire global table.
     * @param {string} tableName - The table name to delete.
     * @param {string} [password] - Optional password for private space.
     * @returns {Promise<boolean>}
     */
    async deleteAllGlobal(tableName, password = null) {
        if (!tableName) {
            throw new Error('deleteAllGlobal: Missing table name parameter');
        }

        try {
            // Get the appropriate space
            const user = this.gun.user();

            return new Promise((resolve, reject) => {
                try {
                    const deletions = new Set();
                    let timeout = setTimeout(() => {
                        if (deletions.size === 0) {
                            resolve(true); // No data to delete
                        }
                    }, 5000);

                    const dataPath = password ? 
                        user.get('private').get(tableName) :
                        this.gun.get(this.appname).get(tableName);

                    dataPath.once(async (data) => {
                        if (!data) {
                            clearTimeout(timeout);
                            resolve(true);
                            return;
                        }

                        const keys = Object.keys(data).filter(key => key !== '_');
                        const promises = keys.map(key =>
                            new Promise((resolveDelete) => {
                                const deletePath = password ? 
                                    user.get('private').get(tableName).get(key) :
                                    this.gun.get(this.appname).get(tableName).get(key);

                                deletePath.put(null, ack => {
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
                            dataPath.put(null);
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
        } catch (error) {
            console.error('Error in deleteAllGlobal:', error);
            throw error;
        }
    }

    // ================================ COMPUTE FUNCTIONS ================================
    /**
   
   /**
 * Computes operations across multiple layers up the hierarchy
 * @param {string} holon - Starting holon identifier
 * @param {string} lens - The lens to compute
 * @param {object} options - Computation options
 * @param {number} [maxLevels=15] - Maximum levels to compute up
 */
    async computeHierarchy(holon, lens, options, maxLevels = 15) {
        let currentHolon = holon;
        let currentRes = h3.getResolution(currentHolon);
        const results = [];

        while (currentRes > 0 && maxLevels > 0) {
            try {
                const result = await this.compute(currentHolon, lens, options);
                if (result) {
                    results.push(result);
                }
                currentHolon = h3.cellToParent(currentHolon, currentRes - 1);
                currentRes--;
                maxLevels--;
            } catch (error) {
                console.error('Error in compute hierarchy:', error);
                break;
            }
        }

        return results;
    }

    /* Computes operations on content within a holon and lens for one layer up.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens to compute.
     * @param {object} options - Computation options
     * @param {string} options.operation - The operation to perform ('summarize', 'aggregate', 'concatenate')
     * @param {string[]} [options.fields] - Fields to perform operation on
     * @param {string} [options.targetField] - Field to store the result in
     * @throws {Error} If parameters are invalid or missing
     */
    async compute(holon, lens, options) {
        // Validate required parameters
        if (!holon || !lens) {
            throw new Error('compute: Missing required parameters');
        }

        // Convert string operation to options object
        if (typeof options === 'string') {
            options = { operation: options };
        }

        if (!options?.operation) {
            throw new Error('compute: Missing required parameters');
        }

        // Validate holon format and resolution first
        let res;
        try {
            res = h3.getResolution(holon);
        } catch (error) {
            throw new Error('compute: Invalid holon format');
        }

        if (res < 1 || res > 15) {
            throw new Error('compute: Invalid holon resolution (must be between 1 and 15)');
        }

        const {
            operation,
            fields = [],
            targetField,
            depth,
            maxDepth
        } = options;

        // Validate depth parameters if provided
        if (depth !== undefined && depth < 0) {
            throw new Error('compute: Invalid depth parameter');
        }

        if (maxDepth !== undefined && (maxDepth < 1 || maxDepth > 15)) {
            throw new Error('compute: Invalid maxDepth parameter (must be between 1 and 15)');
        }

        // Validate operation
        const validOperations = ['summarize', 'aggregate', 'concatenate'];
        if (!validOperations.includes(operation)) {
            throw new Error(`compute: Invalid operation (must be one of ${validOperations.join(', ')})`);
        }

        const parent = h3.cellToParent(holon, res - 1);
        const siblings = h3.cellToChildren(parent, res);

        // Collect all content from siblings
        const contents = await Promise.all(
            siblings.map(sibling => this.getAll(sibling, lens))
        );

        const flatContents = contents.flat().filter(Boolean);

        if (flatContents.length > 0) {
            try {
                let computed;
                switch (operation) {
                    case 'summarize':
                        // For summarize, concatenate specified fields or use entire content
                        const textToSummarize = fields.length > 0
                            ? flatContents.map(item => fields.map(field => item[field]).filter(Boolean).join('\n')).join('\n')
                            : JSON.stringify(flatContents);
                        computed = await this.summarize(textToSummarize);
                        break;

                    case 'aggregate':
                        // For aggregate, sum numeric fields
                        computed = fields.reduce((acc, field) => {
                            acc[field] = flatContents.reduce((sum, item) => {
                                return sum + (Number(item[field]) || 0);
                            }, 0);
                            return acc;
                        }, {});
                        break;

                    case 'concatenate':
                        // For concatenate, combine arrays or strings
                        computed = fields.reduce((acc, field) => {
                            acc[field] = flatContents.reduce((combined, item) => {
                                const value = item[field];
                                if (Array.isArray(value)) {
                                    return [...combined, ...value];
                                } else if (value) {
                                    return [...combined, value];
                                }
                                return combined;
                            }, []);
                            // Remove duplicates if array
                            acc[field] = Array.from(new Set(acc[field]));
                            return acc;
                        }, {});
                        break;
                }

                if (computed) {
                    const resultId = `${parent}_${operation}`;
                    const result = {
                        id: resultId,
                        timestamp: Date.now()
                    };

                    // Store result in targetField if specified, otherwise at root level
                    if (targetField) {
                        result[targetField] = computed;
                    } else if (typeof computed === 'object') {
                        Object.assign(result, computed);
                    } else {
                        result.value = computed;
                    }

                    await this.put(parent, lens, result);
                    return result;
                }
            } catch (error) {
                console.warn('Error in compute operation:', error);
                throw error;
            }
        }

        return null;
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

        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-4",
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful assistant that summarizes text concisely while preserving key information. Keep summaries clear and focused."
                    },
                    {
                        role: "user",
                        content: history
                    }
                ],
                temperature: 0.7,
                max_tokens: 500
            });

            return response.choices[0].message.content.trim();
        } catch (error) {
            console.error('Error in summarize:', error);
            throw new Error('Failed to generate summary');
        }
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
        const subscriptionId = this.generateId();
        this.subscriptions[subscriptionId] =
            this.gun.get(this.appname).get(holon).get(lens).map().on( async (data, key) => {
                if (data) {
                    try {
                        let parsed = await this.parse(data)
                        callback(parsed, key)
                    } catch (error) {
                        console.error('Error in subscribe:', error);
                    }
                }
            })
        return {
            unsubscribe: () => {
                this.gun.get(this.appname).get(holon).get(lens).map().off()
                delete this.subscriptions[subscriptionId];
            }
        }
    }


    notifySubscribers(data) {
        Object.values(this.subscriptions).forEach(subscription => {
            if (subscription.active && this.matchesQuery(data, subscription.query)) {
                subscription.callback(data);
            }
        });
    }

    // Add ID generation method
    generateId() {
        return Date.now().toString(10) + Math.random().toString(2);
    }

    matchesQuery(data, query) {
        return data && query &&
            data.holon === query.holon &&
            data.lens === query.lens;
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
