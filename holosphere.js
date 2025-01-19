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
     */
    constructor(appname, strict = false, openaikey = null) {
        this.appname = appname
        this.strict = strict;
        this.validator = new Ajv2019({
            allErrors: true,
            strict: false,  // Keep this false to avoid Ajv strict mode issues
            validateSchema: true // Always validate schemas
        });
        this.gun = Gun({
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
            console.error('setSchema: Missing required parameters');
            return false;
        }

        // Basic schema validation - check for required fields
        if (!schema.type || typeof schema.type !== 'string') {
            console.error('setSchema: Schema must have a type field');
            return false;
        }

        if (this.strict) {
            try {
                // Validate schema against JSON Schema meta-schema
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
                    console.error('setSchema: Invalid schema structure:', this.validator.errors);
                    return false;
                }

                // Additional strict mode checks
                if (!schema.properties || typeof schema.properties !== 'object') {
                    console.error('setSchema: Schema must have properties in strict mode');
                    return false;
                }

                if (!schema.required || !Array.isArray(schema.required) || schema.required.length === 0) {
                    console.error('setSchema: Schema must have required fields in strict mode');
                    return false;
                }
            } catch (error) {
                console.error('setSchema: Schema validation error:', error);
                return false;
            }
        }

        return new Promise((resolve) => {
            try {
                const schemaString = JSON.stringify(schema);
                this.gun.get(this.appname)
                    .get(lens)
                    .get('schema')
                    .put(schemaString, ack => {
                        if (ack.err) {
                            console.error('Failed to add schema:', ack.err);
                            resolve(false);
                        } else {
                            console.log('Schema added successfully for lens:', lens);
                            resolve(true);
                        }
                    });
            } catch (error) {
                console.error('setSchema: Error stringifying schema:', error);
                resolve(false);
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
            console.error('getSchema: Missing lens parameter');
            return null;
        }

        return new Promise((resolve) => {
            this.gun.get(this.appname)
                .get(lens)
                .get('schema')
                .once(data => {
                    if (!data) {
                        resolve(null);
                        return;
                    }

                    try {
                        // If data is already a string, parse it
                        if (typeof data === 'string') {
                            resolve(JSON.parse(data));
                        }
                        // If data is an object with a string value (GunDB format)
                        else if (typeof data === 'object' && data !== null) {
                            const schemaStr = Object.values(data).find(v =>
                                typeof v === 'string' && v.includes('"type":'));
                            if (schemaStr) {
                                resolve(JSON.parse(schemaStr));
                            } else {
                                resolve(null);
                            }
                        } else {
                            resolve(null);
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
        if (!holon || !lens || !data) {
            console.error('put: Missing required parameters:', { holon, lens, data });
            return false;
        }

        if (!data.id) {
            console.error('put: Data must have an id field');
            return false;
        }

        // Strict validation of schema and data
        const schema = await this.getSchema(lens);
        if (schema) {
            try {
                const valid = this.validator.validate(schema, data);
                if (!valid) {
                    const errors = this.validator.errors;
                    console.error('put: Schema validation failed:', errors);
                    return false;
                }
            } catch (error) {
                console.error('put: Schema validation error:', error);
                return false;
            }
        } else if (this.strict) {
            console.error('put: Schema required in strict mode for lens:', lens);
            return false;
        }

        return new Promise((resolve) => {
            try {
                const payload = JSON.stringify(data);

                this.gun.get(this.appname)
                    .get(holon)
                    .get(lens)
                    .get(data.id)
                    .put(payload, ack => {
                        if (ack.err) {
                            console.error("Error adding data to GunDB:", ack.err);
                            resolve(false);
                        } else {
                            resolve(true);
                        }
                    });
            } catch (error) {
                console.error('Error in put operation:', error);
                resolve(false);
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
            console.error('getAll: Missing required parameters:', { holon, lens });
            return [];
        }

        const schema = await this.getSchema(lens);
        if (!schema && this.strict) {
            console.error('getAll: Schema required in strict mode for lens:', lens);
            return [];
        }

        return new Promise((resolve) => {
            let output = [];
            let counter = 0;

            this.gun.get(this.appname).get(holon).get(lens).once((data, key) => {
                if (!data) {
                    resolve(output);
                    return;
                }

                const mapLength = Object.keys(data).length - 1;

                this.gun.get(this.appname).get(holon).get(lens).map().once(async (itemdata, key) => {
                    counter += 1;
                    if (itemdata) {
                        try {
                            const parsed = await this.parse(itemdata);
                            if (schema && this.strict) {
                                const valid = this.validator.validate(schema, parsed);
                                if (valid) {
                                    output.push(parsed);
                                } else if (this.strict) {
                                    console.warn('Invalid data removed:', key, this.validator.errors);
                                    await this.delete(holon, lens, key);
                                } else {
                                    console.warn('Invalid data found:', key, this.validator.errors);
                                    output.push(parsed);
                                }
                            } else {
                                output.push(parsed);
                            }
                        } catch (error) {
                            console.error('Error parsing data:', error);
                            if (this.strict) {
                                await this.delete(holon, lens, key);
                            }
                        }
                    }

                    if (counter === mapLength) {
                        resolve(output);
                    }
                });
            });
        });
    }

    /**
   * Parses data from GunDB, handling various data formats and references.
   * @param {*} data - The data to parse, could be a string, object, or GunDB reference.
   * @returns {Promise<object>} - The parsed data.
   */
    async parse(rawData) {
        let parsedData = {};
        if (rawData.soul) {
            console.log('Parsing link:', rawData.soul);
            this.getNodeRef(rawData.soul).once (data => {return JSON.parse(data)});
        }

        if (typeof rawData === 'object' && rawData !== null) {
            if (rawData._ && rawData._["#"]) {
                console.log('Parsing object reference:', rawData._['#']);
                // If the data is a reference, fetch the actual content
                let pathParts = rawData._['#'].split('/');
                let hexId = pathParts[1];
                let lensId = pathParts[2];
                let dataKey = pathParts[3];
                parsedData = await this.get(hexId, lensId, dataKey);
            } else if (rawData._ && rawData._['>']) {
                console.log('Parsing objectnode:', rawData._['>']);
                // This might be a GunDB node, try to get its value
                const nodeValue = Object.values(rawData).find(v => typeof v !== 'object' && v !== '_');
                if (nodeValue) {
                    try {
                        parsedData = JSON.parse(nodeValue);
                    } catch (e) {
                        console.log('Invalid JSON in node value:', nodeValue);
                        parsedData = nodeValue; // return the raw data
                    }
                } else {
                    console.log('Unable to parse GunDB node:', rawData);
                    parsedData = rawData; // return the original data
                }
            } else {
                // Treat it as object data
                console.log('Parsing object data:', rawData);
                parsedData = rawData;
            }
        } else {
            // If it's not an object, try parsing it as JSON
            try {
                parsedData = JSON.parse(rawData);
                //if the data has a soul, return the soul node
                if (parsedData.soul) {
                    console.log('Parsing link:', parsedData.soul);
                    parsedData = await this.get(parsedData.soul.split('/')[1], parsedData.soul.split('/')[2], parsedData.soul.split('/')[3]);
                }
            } catch (e) {
                console.log('Failed to parse, returning raw data', e);
                parsedData = rawData; // return the raw data
            }
        }

        return parsedData;
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
            }, 5000); // 5 second timeout

            this.gun.get(this.appname)
                .get(holon)
                .get(lens)
                .get(key)
                .once((data,key) => {
                    clearTimeout(timeout);
                   
                    if (!data) {
                        resolve(null);
                        return;
                    }

                    try {
                        const parsed = this.parse(data);

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
        return new Promise((resolve, reject) => {
            this.gun.get(this.appname).get(holon).get(lens).get(key).put(null, ack => {
                if (ack.err) {
                    resolve(ack.err);
                } else {
                    resolve(ack.ok);
                }
            });
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
     * @param {object} node - The node to store.
     */
    async putNode(holon, lens, node) {
        return new Promise((resolve) => {
            this.gun.get(this.appname).get(holon).get(lens).put(node, ack => {
                if (ack.err) {
                    console.error("Error adding data to GunDB:", ack.err);
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });
    }

    /**
   * Retrieves a specific gun node from the specified holon and lens.
   * @param {string} holon - The holon identifier.
   * @param {string} lens - The lens identifier.
   * @param {string} key - The specific key to retrieve.
   * @returns {Promise<object|null>} - The retrieved node or null if not found.
   */
    getNode(holon, lens, key) {
        if (!holon || !lens || !key) {
            console.error('getNode: Missing required parameters');
            return null;
        }

        return this.gun.get(this.appname)
            .get(holon)
            .get(lens)
            .get(key)

    }

    getNodeRef(soul) {
        const parts = soul.split('/');
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
            console.error('deleteNode: Missing required parameters');
            return false;
        }

        return new Promise((resolve) => {
            this.gun.get(this.appname)
                .get(holon)
                .get(lens)
                .get(key)
                .put(null, ack => {
                    if (ack.err) {
                        console.error('deleteNode: Error deleting node:', ack.err);
                        resolve(false);
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
            if (!tableName || !data) {
                reject(new Error('Table name and data are required'));
                return;
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
    // async getAllGlobal(tableName) {
    //     return new Promise(async (resolve, reject) => {
    //         let output = []
    //         let counter = 0
    //         this.gun.get(this.appname).get(tableName.toString()).once((data, key) => {
    //             if (data) {
    //                 const maplenght = Object.keys(data).length - 1
    //                 this.gun.get(this.appname).get(tableName.toString()).map().once(async (itemdata, key) => {
                     
    //                     counter += 1
    //                     if (itemdata) {
    //                         let parsed = await this.parse(itemdata)
    //                         output.push(parsed);
    //                         console.log('getAllGlobal: parsed: ', parsed)
    //                     }

    //                     if (counter == maplenght) {
    //                         resolve(output);
                            
    //                     }
    //                 }
    //                 );
    //             } else resolve(output)
    //         })
    //     }
    //     )
    // }
    async getAllGlobal(lens) {
        if ( !lens) {
            console.error('getAll: Missing required parameters:', { lens });
            return [];
        }

        const schema = await this.getSchema(lens);
        if (!schema && this.strict) {
            console.error('getAll: Schema required in strict mode for lens:', lens);
            return [];
        }

        return new Promise((resolve) => {
            let output = [];
            let counter = 0;

            this.gun.get(this.appname).get(lens).once((data, key) => {
                if (!data) {
                    resolve(output);
                    return;
                }

                const mapLength = Object.keys(data).length - 1;

                this.gun.get(this.appname).get(lens).map().once(async (itemdata, key) => {
                    counter += 1;
                    if (itemdata) {
                        try {
                            const parsed = await this.parse(itemdata);
                            if (schema) {
                                const valid = this.validator.validate(schema, parsed);
                                if (valid) {
                                    output.push(parsed);
                                } else if (this.strict) {
                                    console.warn('Invalid data removed:', key, this.validator.errors);
                                    await this.delete(holon, lens, key);
                                } else {
                                    console.warn('Invalid data found:', key, this.validator.errors);
                                    output.push(parsed);
                                }
                            } else {
                                output.push(parsed);
                            }
                        } catch (error) {
                            console.error('Error parsing data:', error);
                            if (this.strict) {
                                await this.delete(holon, lens, key);
                            }
                        }
                    }

                    if (counter === mapLength) {
                        resolve(output);
                    }
                });
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
        await this.gun.get(this.appname).get(tableName).get(key).put(null)
    }

    /**
     * Deletes an entire global table.
     * @param {string} tableName - The table name to delete.
     * @returns {Promise<void>}
     */
    async deleteAllGlobal(tableName) {
       // return new Promise((resolve) => {
            this.gun.get(this.appname).get(tableName).map().once( (data, key)=> {
                this.gun.get(this.appname).get(tableName).get(key).put(null)
            })
            this.gun.get(this.appname).get(tableName).put(null, ack => {
                console.log('deleteAllGlobal: ack: ', ack)
            })
            //    resolve();
            //});
        // });
    }

    // ================================ COMPUTE FUNCTIONS ================================
    /**
     * Computes summaries based on the content within a holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens to compute.
     * @param {string} operation - The operation to perform.
     */
    async compute(holon, lens, operation) {

        let res = h3.getResolution(holon);
        if (res < 1 || res > 15) return;
        console.log(res)
        let parent = h3.cellToParent(holon, res - 1);
        let siblings = h3.cellToChildren(parent, res);
        console.log(holon, parent, siblings, res)

        let content = [];
        let promises = [];

        for (let i = 0; i < siblings.length; i++) {
            promises.push(new Promise((resolve) => {
                let timeout = setTimeout(() => {
                    console.log(`Timeout for sibling ${i}`);
                    resolve(); // Resolve the promise to prevent it from hanging
                }, 1000); // Timeout of 5 seconds

                this.gun.get(this.appname).get(siblings[i]).get(lens).map().once((data, key) => {
                    clearTimeout(timeout); // Clear the timeout if data is received
                    if (data) {
                        content.push(data.content);
                    }
                    resolve(); // Resolve after processing data
                });
            }));
        }

        await Promise.all(promises);
        console.log('Content:', content);
        let computed = await this.summarize(content.join('\n'))
        console.log('Computed:', computed)
        let node = await this.gun.get(this.appname).get(parent + '_summary').put({ id: parent + '_summary', content: computed })

        this.put(parent, lens, node);
        this.compute(parent, lens, operation)
    }

    /**
     * Clears all entities under a specific holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens to clear.
     */
    async clearlens(holon, lens) {
        let entities = {};

        // Get list out of Gun
        this.gun.get(this.appname).get(holon).get(lens).map().once((data, key) => {
            //entities = data;
            //const id = Object.keys(entities)[0] // since this would be in object form, you can manipulate it as you would like. 
            this.gun.get(this.appname).get(holon).get(lens).put({ [key]: null })
        })
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
        this.gun.get(this.appname).get(holon).get(lens).map().on(async (data, key) => {
            if (data)
            callback( await this.parse(data), key)
        })
    }
}

export default HoloSphere;
