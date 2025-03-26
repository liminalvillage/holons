import * as h3 from 'h3-js';
import OpenAI from 'openai';
import Gun from 'gun'
import SEA from 'gun/sea.js'
import Ajv2019 from 'ajv/dist/2019.js'
import * as Federation from './federation.js';

export { federateMessage, getFederatedMessages, updateFederatedMessages, removeNotify } from './federation.js';

class HoloSphere {
    /**
     * Initializes a new instance of the HoloSphere class.
     * @param {string} appname - The name of the application.
     * @param {boolean} strict - Whether to enforce strict schema validation.
     * @param {string|null} openaikey - The OpenAI API key.
     * @param {Gun|null} gunInstance - The Gun instance to use.
     */
    constructor(appname, strict = false, openaikey = null, gunInstance = null) {
        console.log('HoloSphere v1.1.6'); 
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
            timestamp: Date.now()
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
     * @param {string} [password] - Optional password for private holon.
     * @param {object} [options] - Additional options
     * @param {boolean} [options.autoPropagate=true] - Whether to automatically propagate to federated holons (default: true)
     * @param {object} [options.propagationOptions] - Options to pass to propagate
     * @param {boolean} [options.propagationOptions.useReferences=true] - Whether to use references instead of duplicating data
     * @returns {Promise<boolean>} - Returns true if successful, false if there was an error
     */
    async put(holon, lens, data, password = null, options = {}) {
        if (!holon || !lens || !data) {
            throw new Error('put: Missing required parameters:',  holon, lens, data );
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
                        user.auth(this.userName(holon), password, (ack) => {
                            if (ack.err) reject(new Error(ack.err));
                            else resolve();
                        });
                    });
                } catch (loginError) {
                    // If authentication fails, try to create user and then authenticate
                    try {
                        await new Promise((resolve, reject) => {
                            user.create(this.userName(holon), password, (ack) => {
                                if (ack.err) {
                                    // Don't reject if the user is already being created or already exists
                                    if (ack.err.includes('already being created') || 
                                        ack.err.includes('already created')) {
                                        console.warn(`User creation note: ${ack.err}, continuing...`);
                                        // Try to authenticate again
                                        user.auth(this.userName(holon), password, (authAck) => {
                                            if (authAck.err) {
                                                if (authAck.err.includes('already being created') || 
                                                    authAck.err.includes('already created')) {
                                                    console.warn(`Auth note: ${authAck.err}, continuing...`);
                                                    resolve(); // Continue anyway
                                                } else {
                                                    reject(new Error(authAck.err));
                                                }
                                            } else {
                                                resolve();
                                            }
                                        });
                                    } else {
                                        reject(new Error(ack.err));
                                    }
                                } else {
                                    user.auth(this.userName(holon), password, (authAck) => {
                                        if (authAck.err) reject(new Error(authAck.err));
                                        else resolve();
                                    });
                                }
                            });
                        });
                    } catch (createError) {
                        // Try one last authentication
                        try {
                            await new Promise((resolve, reject) => {
                                setTimeout(() => {
                                    user.auth(this.userName(holon), password, (ack) => {
                                        if (ack.err) {
                                            // Continue even if auth fails at this point
                                            console.warn(`Final auth attempt note: ${ack.err}, continuing with limited functionality`);
                                            resolve();
                                        } else {
                                            resolve();
                                        }
                                    });
                                }, 100); // Short delay before retry
                            });
                        } catch (finalAuthError) {
                            console.warn('All authentication attempts failed, continuing with limited functionality');
                        }
                    }
                }
            }

            return new Promise((resolve, reject) => {
                try {
                    const payload = JSON.stringify(data);
                    
                    const putCallback = async (ack) => {
                        if (ack.err) {
                            reject(new Error(ack.err));
                        } else {
                            this.notifySubscribers({
                                holon,
                                lens,
                                ...data
                            });
                            
                            // Auto-propagate to federation by default
                            const shouldPropagate = options.autoPropagate !== false;
                            let propagationResult = null;
                            
                            if (shouldPropagate) {
                                try {
                                    // Default to using references
                                    const propagationOptions = {
                                        useReferences: true,
                                        ...options.propagationOptions
                                    };
                                    
                                    propagationResult = await this.propagate(
                                        holon, 
                                        lens, 
                                        data, 
                                        propagationOptions
                                    );
                                    
                                    // Still resolve with true even if propagation had errors
                                    if (propagationResult.errors > 0) {
                                        console.warn('Auto-propagation had errors:', propagationResult);
                                    }
                                } catch (propError) {
                                    console.warn('Error in auto-propagation:', propError);
                                }
                            }
                            
                            resolve({
                                success: true,
                                propagationResult
                            });
                        }
                    };
                    
                    if (password) {
                        // For private data, use the authenticated user's holon
                        user.get('private').get(lens).get(data.id).put(payload, putCallback);
                    } else {
                        // For public data, use the regular path
                        this.gun.get(this.appname).get(holon).get(lens).get(data.id).put(payload, putCallback);
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
     * @param {string} [password] - Optional password for private holon.
     * @param {object} [options] - Additional options
     * @param {boolean} [options.resolveReferences=true] - Whether to automatically resolve federation references
     * @returns {Promise<object|null>} - The retrieved content or null if not found.
     */
    async get(holon, lens, key, password = null, options = {}) {
        if (!holon || !lens || !key) {
            console.error('get: Missing required parameters:', { holon, lens, key });
            return null;
        }

        const { resolveReferences = true } = options;

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
                        user.auth(this.userName(holon), password, (ack) => {
                            if (ack.err) reject(new Error(ack.err));
                            else resolve();
                        });
                    });
                } catch (loginError) {
                    // If authentication fails, try to create user and then authenticate
                    await new Promise((resolve, reject) => {
                        user.create(this.userName(holon), password, (ack) => {
                            if (ack.err) reject(new Error(ack.err));
                            else {
                                user.auth(this.userName(holon), password, (authAck) => {
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

                        if (!parsed) {
                            resolve(null);
                            return;
                        }

                        // Check if this is a reference that needs to be resolved
                        if (resolveReferences !== false && parsed) {
                            // Check if this is a simple reference (id + soul)
                            if (parsed.soul) {
                                console.log(`Resolving simple reference with soul: ${parsed.soul}`);
                                try {
                                    // For direct soul resolution, we need to parse the soul to get the right path
                                    const soulParts = parsed.soul.split('/');
                                    if (soulParts.length >= 4) {  // Expected format: appname/holon/lens/key
                                        const originHolon = soulParts[1];
                                        const originLens = soulParts[2];
                                        const originKey = soulParts[3];
                                        
                                        console.log(`Extracting from soul - holon: ${originHolon}, lens: ${originLens}, key: ${originKey}`);
                                        
                                        // Get original data using the extracted path components
                                        const originalData = await this.get(
                                            originHolon,
                                            originLens,
                                            originKey,
                                            null,
                                            { resolveReferences: false } // Prevent infinite recursion
                                        );
                                        
                                        if (originalData) {
                                            console.log(`Original data found through soul path resolution:`, originalData);
                                            resolve({
                                                ...originalData,
                                                _federation: {
                                                    isReference: true,
                                                    resolved: true,
                                                    soul: parsed.soul,
                                                    timestamp: Date.now()
                                                }
                                            });
                                            return;
                                        } else {
                                            console.warn(`Could not resolve reference: original data not found at extracted path`);
                                        }
                                    } else {
                                        console.warn(`Soul doesn't match expected format: ${parsed.soul}`);
                                    }
                                } catch (error) {
                                    console.warn(`Error resolving reference by soul: ${error.message}`);
                                }
                            }
                            // Legacy federation reference
                            else if (parsed._federation && parsed._federation.isReference) {
                                console.log(`Resolving legacy federation reference from ${parsed._federation.origin}`);
                                try {
                                    const reference = parsed._federation;
                                    const originalData = await this.get(
                                        reference.origin,
                                        reference.lens,
                                        key,
                                        null,
                                        { resolveReferences: false } // Prevent infinite recursion
                                    );
                                    
                                    if (originalData) {
                                        return {
                                            ...originalData,
                                            _federation: {
                                                ...reference,
                                                resolved: true,
                                                timestamp: Date.now()
                                            }
                                        };
                                    } else {
                                        console.warn(`Could not resolve legacy reference: original data not found`);
                                        return parsed; // Return the reference if we can't resolve it
                                    }
                                } catch (error) {
                                    console.warn(`Error resolving legacy reference: ${error.message}`);
                                    return parsed;
                                }
                            }
                        }

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
                    // For private data, use the authenticated user's holon
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
     * Retrieves a node directly using its soul path
     * @param {string} soul - The soul path of the node
     * @returns {Promise<any>} - The retrieved node or null if not found.
     */
    async getNodeBySoul(soul) {
        if (!soul) {
            throw new Error('getNodeBySoul: Missing soul parameter');
        }

        console.log(`getNodeBySoul: Accessing soul ${soul}`);

        return new Promise((resolve) => {
            try {
                const ref = this.getNodeRef(soul);
                ref.once((data) => {
                    console.log(`getNodeBySoul: Retrieved data:`, data);
                    if (!data) {
                        resolve(null);
                        return;
                    }
                    resolve(data);  // Return the data directly
                });
            } catch (error) {
                console.error(`getNodeBySoul error:`, error);
                resolve(null);
            }
        });
    }

    /**
     * Propagates data to federated holons
     * @param {string} holon - The holon identifier
     * @param {string} lens - The lens identifier
     * @param {object} data - The data to propagate
     * @param {object} [options] - Propagation options
     * @returns {Promise<object>} - Result with success count and errors
     */
    async propagate(holon, lens, data, options = {}) {
        return Federation.propagate(this, holon, lens, data, options);
    }

    /**
     * Retrieves all content from the specified holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens from which to retrieve content.
     * @param {string} [password] - Optional password for private holon.
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
                    // For private data, use the authenticated user's holon
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
     * @param {string} [password] - Optional password for private holon.
     * @returns {Promise<boolean>} - Returns true if successful
     */
    async delete(holon, lens, key, password = null) {
        if (!holon || !lens || !key) {
            throw new Error('delete: Missing required parameters');
        }

        try {
            // Get the appropriate holon
            const user = this.gun.user();

            // Delete data from holon
            return new Promise((resolve, reject) => {
                if (password) {
                    // For private data, use the authenticated user's holon
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
     * @param {string} [password] - Optional password for private holon.
     * @returns {Promise<boolean>} - Returns true if successful
     */
    async deleteAll(holon, lens, password = null) {
        if (!holon || !lens) {
            console.error('deleteAll: Missing holon or lens parameter');
            return false;
        }

        try {
            // Get the appropriate holon
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
     * @param {string} [password] - Optional password for private holon.
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
                    // Try to authenticate first
                    await new Promise((resolve, reject) => {
                        user.auth(this.userName(tableName), password, (ack) => {
                            if (ack.err) {
                                // Handle wrong username/password gracefully
                                if (ack.err.includes('Wrong user or password') || 
                                    ack.err.includes('No user')) {
                                    console.warn(`Authentication failed for ${tableName}: ${ack.err}`);
                                    // Will try to create user next
                                    reject(new Error(ack.err));
                                } else {
                                    reject(new Error(ack.err));
                                }
                            } else {
                                resolve();
                            }
                        });
                    });
                } catch (authError) {
                    // If authentication fails, try to create user
                    try {
                        await new Promise((resolve, reject) => {
                            user.create(this.userName(tableName), password, (ack) => {
                                // Handle "User already created!" error gracefully
                                if (ack.err && !ack.err.includes('already created')) {
                                    reject(new Error(ack.err));
                                } else {
                                    // Whether user was created or already existed, try to authenticate
                                    user.auth(this.userName(tableName), password, (authAck) => {
                                        if (authAck.err) {
                                            console.warn(`Authentication failed after creation for ${tableName}: ${authAck.err}`);
                                            reject(new Error(authAck.err));
                                        } else {
                                            resolve();
                                        }
                                    });
                                }
                            });
                        });
                    } catch (createError) {
                        // If both auth and create fail, try one last auth attempt
                        await new Promise((resolve, reject) => {
                            user.auth(this.userName(tableName), password, (ack) => {
                                if (ack.err) {
                                    console.warn(`Final authentication attempt failed for ${tableName}: ${ack.err}`);
                                    // Continue with operation even if auth fails
                                    resolve();
                                } else {
                                    resolve();
                                }
                            });
                        });
                    }
                }
            }

            return new Promise((resolve, reject) => {
                const payload = JSON.stringify(data);
                
                if (password) {
                    // For private data, use the authenticated user's holon
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
     * @param {string} [password] - Optional password for private holon.
     * @returns {Promise<object|null>} - The parsed data for the key or null if not found.
     */
    async getGlobal(tableName, key, password = null) {
        try {
            const user = this.gun.user();
            
            if (password) {
                try {
                    await new Promise((resolve, reject) => {
                        user.auth(this.userName(tableName), password, (ack) => {
                            if (ack.err) {
                                // Handle wrong username/password gracefully
                                if (ack.err.includes('Wrong user or password') || 
                                    ack.err.includes('No user')) {
                                    console.warn(`Authentication failed for ${tableName}: ${ack.err}`);
                                    // Will try to create user next
                                    reject(new Error(ack.err));
                                } else {
                                    reject(new Error(ack.err));
                                }
                            } else {
                                resolve();
                            }
                        });
                    });
                } catch (loginError) {
                    // If authentication fails, try to create user and then authenticate
                    await new Promise((resolve, reject) => {
                        user.create(this.userName(tableName), password, (ack) => {
                            // Handle "User already created!" error gracefully
                            if (ack.err && !ack.err.includes('already created')) {
                                reject(new Error(ack.err));
                            } else {
                                user.auth(this.userName(tableName), password, (authAck) => {
                                    if (authAck.err) {
                                        console.warn(`Authentication failed after creation for ${tableName}: ${authAck.err}`);
                                        // Continue with operation even if auth fails
                                        resolve();
                                    } else {
                                        resolve();
                                    }
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
                    // For private data, use the authenticated user's holon
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
     * @param {string} [password] - Optional password for private holon.
     * @returns {Promise<Array<object>>} - The parsed data from the table as an array.
     */
    async getAllGlobal(tableName, password = null) {
        if (!tableName) {
            throw new Error('getAllGlobal: Missing table name parameter');
        }

        try {
            // Get the appropriate holon
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
                    // For private data, use the authenticated user's holon
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
     * @param {string} [password] - Optional password for private holon.
     * @returns {Promise<boolean>}
     */
    async deleteGlobal(tableName, key, password = null) {
        if (!tableName || !key) {
            throw new Error('deleteGlobal: Missing required parameters');
        }

        try {
            // Get the appropriate holon
            const user = this.gun.user();

            return new Promise((resolve, reject) => {
                if (password) {
                    // For private data, use the authenticated user's holon
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
     * @param {string} [password] - Optional password for private holon.
     * @returns {Promise<boolean>}
     */
    async deleteAllGlobal(tableName, password = null) {
        if (!tableName) {
            throw new Error('deleteAllGlobal: Missing table name parameter');
        }

        try {
            // Get the appropriate holon
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
     * Computes operations across multiple layers up the hierarchy
     * @param {string} holon - Starting holon identifier
     * @param {string} lens - The lens to compute
     * @param {object} options - Computation options
     * @param {number} [maxLevels=15] - Maximum levels to compute up
     * @param {string} [password] - Optional password for private holons
     */
    async computeHierarchy(holon, lens, options, maxLevels = 15, password = null) {
        let currentHolon = holon;
        let currentRes = h3.getResolution(currentHolon);
        const results = [];

        while (currentRes > 0 && maxLevels > 0) {
            try {
                const result = await this.compute(currentHolon, lens, options, password);
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

    /**
     * Computes operations on content within a holon and lens for one layer up.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens to compute.
     * @param {object} options - Computation options
     * @param {string} options.operation - The operation to perform ('summarize', 'aggregate', 'concatenate')
     * @param {string[]} [options.fields] - Fields to perform operation on
     * @param {string} [options.targetField] - Field to store the result in
     * @param {string} [password] - Optional password for private holons
     * @throws {Error} If parameters are invalid or missing
     */
    async compute(holon, lens, options, password = null) {
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
            siblings.map(sibling => this.getAll(sibling, lens, password))
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

                    await this.put(parent, lens, result, password);
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
     * Upcasts content to parent holonagons recursively using federation and soul references.
     * This is the modern implementation that uses federation references instead of duplicating data.
     * @param {string} holon - The current holon identifier.
     * @param {string} lens - The lens under which to upcast.
     * @param {object} content - The content to upcast.
     * @param {number} [maxLevels=15] - Maximum levels to upcast.
     * @returns {Promise<object>} - The original content.
     */
    async upcast(holon, lens, content, maxLevels = 15) {
        // Store the actual content at the original resolution
        await this.put(holon, lens, content);
        
        let res = h3.getResolution(holon);
        
        // If already at the highest level (res 0) or reached max levels, we're done
        if (res === 0 || maxLevels <= 0) {
            return content;
        }
        
        // Get the parent cell
        let parent = h3.cellToParent(holon, res - 1);
        
        // Create federation relationship if it doesn't exist
        await this.federate(holon, parent);
        
        // Create a soul reference to store in the parent
        const soul = `${this.appname}/${holon}/${lens}/${content.id}`;
        const reference = {
            id: content.id,
            soul: soul
        };
        
        // Store the reference in the parent cell
        // We use { autoPropagate: false } to prevent circular propagation
        await this.put(parent, lens, reference, null, { 
            autoPropagate: false 
        });
        
        // Continue upcasting with the parent
        if (res > 1 && maxLevels > 1) {
            return this.upcast(parent, lens, reference, maxLevels - 1);
        }
        
        return content;
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
     * @returns {Promise<object>} - Subscription object with unsubscribe method
     */
    async subscribe(holon, lens, callback) {
        if (!holon || !lens || typeof callback !== 'function') {
            throw new Error('subscribe: Missing required parameters');
        }

        const subscriptionId = this.generateId();
        
        try {
            // Create the subscription
            const gunSubscription = this.gun.get(this.appname).get(holon).get(lens).map().on(async (data, key) => {
                if (data) {
                    try {
                        let parsed = await this.parse(data);
                        callback(parsed, key);
                    } catch (error) {
                        console.error('Error in subscribe:', error);
                    }
                }
            });
            
            // Store the subscription with its ID
            this.subscriptions[subscriptionId] = {
                id: subscriptionId,
                holon,
                lens,
                active: true,
                gunSubscription
            };
            
            // Return an object with unsubscribe method
            return {
                unsubscribe: () => {
                    try {
                        // Turn off the Gun subscription
                        this.gun.get(this.appname).get(holon).get(lens).map().off();
                        
                        // Mark as inactive and remove from subscriptions
                        if (this.subscriptions[subscriptionId]) {
                            this.subscriptions[subscriptionId].active = false;
                            delete this.subscriptions[subscriptionId];
                        }
                    } catch (error) {
                        console.error('Error in unsubscribe:', error);
                    }
                }
            };
        } catch (error) {
            console.error('Error creating subscription:', error);
            throw error;
        }
    }


    /**
     * Notifies subscribers about data changes
     * @param {object} data - The data to notify about
     * @private
     */
    notifySubscribers(data) {
        if (!data || !data.holon || !data.lens) {
            return;
        }
        
        try {
            Object.values(this.subscriptions).forEach(subscription => {
                if (subscription.active && 
                    subscription.holon === data.holon && 
                    subscription.lens === data.lens) {
                    try {
                        if (subscription.callback && typeof subscription.callback === 'function') {
                            subscription.callback(data);
                        }
                    } catch (error) {
                        console.warn('Error in subscription callback:', error);
                    }
                }
            });
        } catch (error) {
            console.warn('Error notifying subscribers:', error);
        }
    }

    // Add ID generation method
    generateId() {
        return Date.now().toString(10) + Math.random().toString(2);
    }

    // ================================ FEDERATION FUNCTIONS ================================

    /**
     * Creates a federation relationship between two holons
     * @param {string} holonId1 - The first holon ID
     * @param {string} holonId2 - The second holon ID
     * @param {string} password1 - Password for the first holon
     * @param {string} [password2] - Optional password for the second holon
     * @param {boolean} [bidirectional=true] - Whether to set up bidirectional notifications automatically
     * @returns {Promise<boolean>} - True if federation was created successfully
     */
    async federate(holonId1, holonId2, password1, password2 = null, bidirectional = true) {
        return Federation.federate(this, holonId1, holonId2, password1, password2, bidirectional);
    }

    /**
     * Subscribes to federation notifications for a holon
     * @param {string} holonId - The holon ID to subscribe to
     * @param {string} password - Password for the holon
     * @param {function} callback - The callback to execute on notifications
     * @param {object} [options] - Subscription options
     * @param {string[]} [options.lenses] - Specific lenses to subscribe to (default: all)
     * @param {number} [options.throttle] - Throttle notifications in ms (default: 0)
     * @returns {Promise<object>} - Subscription object with unsubscribe() method
     */
    async subscribeFederation(holonId, password, callback, options = {}) {
        return Federation.subscribeFederation(this, holonId, password, callback, options);
    }

    /**
     * Gets federation info for a holon
     * @param {string} holonId - The holon ID
     * @param {string} [password] - Optional password for the holon
     * @returns {Promise<object|null>} - Federation info or null if not found
     */
    async getFederation(holonId, password = null) {
        return Federation.getFederation(this, holonId, password);
    }

    /**
     * Removes a federation relationship between holons
     * @param {string} holonId1 - The first holon ID
     * @param {string} holonId2 - The second holon ID
     * @param {string} password1 - Password for the first holon
     * @param {string} [password2] - Optional password for the second holon
     * @returns {Promise<boolean>} - True if federation was removed successfully
     */
    async unfederate(holonId1, holonId2, password1, password2 = null) {
        return await Federation.unfederate(this, holonId1, holonId2, password1, password2);
    }

    /**
     * Removes a notification relationship between two spaces
     * This removes spaceId2 from the notify list of spaceId1
     * 
     * @param {string} holonId1 - The space to modify (remove from its notify list)
     * @param {string} holonId2 - The space to be removed from notifications
     * @param {string} [password1] - Optional password for the first space
     * @returns {Promise<boolean>} - True if notification was removed successfully
     */
    async removeNotify(holonId1, holonId2, password1 = null) {
        console.log(`HoloSphere.removeNotify called: ${holonId1}, ${holonId2}`);
        try {
            const result = await Federation.removeNotify(this, holonId1, holonId2, password1);
            console.log(`HoloSphere.removeNotify completed successfully: ${result}`);
            return result;
        } catch (error) {
            console.error(`HoloSphere.removeNotify failed:`, error);
            throw error;
        }
    }

    /**
     * Get and aggregate data from federated holons
     * @param {string} holon The holon name
     * @param {string} lens The lens name
     * @param {Object} options Options for retrieval and aggregation
     * @returns {Promise<Array>} Combined array of local and federated data
     */
    async getFederated(holon, lens, options = {}) {
        return Federation.getFederated(this, holon, lens, options);
    }

    /**
     * Tracks a federated message across different chats
     * @param {string} originalChatId - The ID of the original chat
     * @param {string} messageId - The ID of the original message
     * @param {string} federatedChatId - The ID of the federated chat
     * @param {string} federatedMessageId - The ID of the message in the federated chat
     * @param {string} type - The type of message (e.g., 'quest', 'announcement')
     * @returns {Promise<void>}
     */
    async federateMessage(originalChatId, messageId, federatedChatId, federatedMessageId, type = 'generic') {
        return Federation.federateMessage(this, originalChatId, messageId, federatedChatId, federatedMessageId, type);
    }

    /**
     * Gets all federated messages for a given original message
     * @param {string} originalChatId - The ID of the original chat
     * @param {string} messageId - The ID of the original message
     * @returns {Promise<Object|null>} The tracking information for the message
     */
    async getFederatedMessages(originalChatId, messageId) {
        return Federation.getFederatedMessages(this, originalChatId, messageId);
    }

    /**
     * Updates a federated message across all federated chats
     * @param {string} originalChatId - The ID of the original chat
     * @param {string} messageId - The ID of the original message
     * @param {Function} updateCallback - Function to update the message in each chat
     * @returns {Promise<void>}
     */
    async updateFederatedMessages(originalChatId, messageId, updateCallback) {
        return Federation.updateFederatedMessages(this, originalChatId, messageId, updateCallback);
    }

    /**
     * Resets the federation settings for a holon
     * @param {string} holonId - The holon ID
     * @param {string} [password] - Optional password for the holon
     * @returns {Promise<boolean>} - True if federation was reset successfully
     */
    async resetFederation(holonId, password = null) {
        return Federation.resetFederation(this, holonId, password);
    }

    // ================================ END FEDERATION FUNCTIONS ================================
    /**
     * Closes the HoloSphere instance and cleans up resources.
     * @returns {Promise<void>}
     */
    async close() {
        try {
            if (this.gun) {
                // Unsubscribe from all subscriptions
                const subscriptionIds = Object.keys(this.subscriptions);
                for (const id of subscriptionIds) {
                    try {
                        const subscription = this.subscriptions[id];
                        if (subscription && subscription.active) {
                            // Turn off the Gun subscription
                            this.gun.get(this.appname)
                                .get(subscription.holon)
                                .get(subscription.lens)
                                .map().off();
                            
                            // Mark as inactive
                            subscription.active = false;
                        }
                    } catch (error) {
                        console.warn(`Error cleaning up subscription ${id}:`, error);
                    }
                }

                // Clear subscriptions
                this.subscriptions = {};

                // Close Gun connections
                if (this.gun.back) {
                    try {
                        const mesh = this.gun.back('opt.mesh');
                        if (mesh && mesh.hear) {
                            try {
                                // Safely clear mesh.hear without modifying function properties
                                const hearKeys = Object.keys(mesh.hear);
                                for (const key of hearKeys) {
                                    // Check if it's an array before trying to clear it
                                    if (Array.isArray(mesh.hear[key])) {
                                        mesh.hear[key] = [];
                                    }
                                }
                                
                                // Create a new empty object for mesh.hear
                                // Only if mesh.hear is not a function
                                if (typeof mesh.hear !== 'function') {
                                    mesh.hear = {};
                                }
                            } catch (meshError) {
                                console.warn('Error cleaning up Gun mesh hear:', meshError);
                            }
                        }
                    } catch (error) {
                        console.warn('Error accessing Gun mesh:', error);
                    }
                }

                // Clear all Gun instance listeners
                try {
                    this.gun.off();
                } catch (error) {
                    console.warn('Error turning off Gun listeners:', error);
                }
                
                // Wait a moment for cleanup to complete
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            console.log('HoloSphere instance closed successfully');
        } catch (error) {
            console.error('Error closing HoloSphere instance:', error);
        }
    }

    /**
     * Creates a namespaced username for Gun authentication
     * @private
     * @param {string} holonId - The holon ID
     * @returns {string} - Namespaced username
     */
    userName(holonId) {
        if (!holonId) return null;
        return `${this.appname}:${holonId}`;
    }
}

export default HoloSphere;
