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
        this.validator = new Ajv2019({ allErrors: false, strict: false });
        this.gun = Gun({
            peers: ['http://gun.holons.io', 'https://59.src.eco/gun'],
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
        return new Promise((resolve, reject) => {
            this.gun.get(this.appname).get(lens).get('schema').put(JSON.stringify(schema), ack => {
                if (ack.err) {
                    resolve(new Error('Failed to add schema: ' + ack.err));
                } else {
                    console.log('Schema added successfully under lens:', lens);
                    resolve(ack);
                }
            })
        })
    }

    /**
     * Retrieves the JSON schema for a specific lens.
     * @param {string} lens - The lens identifier.
     * @returns {Promise<object|null>} - The retrieved schema or null if not found.
     */
    async getSchema(lens) {
        return new Promise((resolve) => {
            this.gun.get(this.appname).get(lens).get('schema').once(data => {
                if (data) {
                    let parsed;
                    try {
                        parsed = this.parse(data);
                    }
                    catch (e) {
                        resolve(null)
                    }
                    resolve(parsed);
                } else {
                    resolve(null);
                }
            })
        })
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

    // /**
    //  * Stores content in the specified holon and lens.
    //  * @param {string} holon - The holon identifier.
    //  * @param {string} lens - The lens under which to store the content.
    //  * @param {object} content - The content to store.
    //  */
    // async put(holon, lens, content) {

    //     if (!holon || !lens || !content) {
    //         console.error('Error in put:', holon, lens, content);
    //         return;
    //     }
    //     // Retrieve the schema for the lens
    //     let schema = await this.getSchema(lens)
    //     if (schema) {
    //         // Validate the content against the schema
    //         const valid = this.validator.validate(schema, content);
    //         if (!valid) {
    //             console.error('Not committing invalid content:', this.validator.errors);
    //             return null;
    //         }
    //     }

    //     // Create a node for the content
    //     const payload = JSON.stringify(content);


    //     return new Promise(async (resolve) => {
    //         if (content.id) { //use the user-defined id. Important to be able to send updates using put
    //             this.gun.get(this.appname).get(holon).get(lens).get(content.id).put(payload, ack => {
    //                 if (ack.err) {
    //                     console.error("Error adding data to GunDB:", ack.err);
    //                     resolve(null);
    //                 } else {
    //                     resolve(ack.ok);
    //                 }
    //             })
    //         } else { // create a content-addressable reference like IPFS. Note: no updates possible using put
    //             console.log('Missing ID - Creating content-addressable reference:', payload)
    //             const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
    //             const hashArray = Array.from(new Uint8Array(hashBuffer));
    //             const hashholon = hashArray.map(byte => byte.toString(16).padStart(2, "0")).join("");
    //             this.gun.get(this.appname).get(holon).get(lens).get(hashholon).put(payload)
    //         }
    //     })

    //     }


    // async parse(data) {
    //     let parsed = {};
    //     if (typeof data === 'object' && data !== null) {
    //         if (data._ && data._["#"]) {
    //             // If the data is a reference, fetch the actual content
    //             let query = data._['#'].split('/');
    //             let holon = query[1];
    //             let lens = query[2];
    //             let key = query[3];
    //             parsed = await this.get(holon, lens, key);
    //         } else if (data._ && data._['>']) {
    //             // This might be a gun node, try to get its value
    //             const nodeValue = Object.values(data).find(v => typeof v !== 'object' && v !== '_');
    //             if (nodeValue) {
    //                 try {
    //                     parsed = JSON.parse(nodeValue);
    //                 } catch (e) {
    //                     console.log('Invalid JSON in node value:', nodeValue);
    //                     parsed = nodeValue; // return the raw data
    //                 }
    //             } else {
    //                 console.log('Unable to parse gun node:', data);
    //                 parsed = data; // return the original data
    //             }
    //         } else {
    //             // Treat it as regular data
    //             parsed = data;
    //         }
    //     } else {
    //         // If it's not an object, try parsing it as JSON
    //         try {
    //             parsed = JSON.parse(data);
    //         } catch (e) {
    //             console.log('Invalid JSON:', data);
    //             parsed = data; // return the raw data
    //         }
    //     }

    //     return parsed;
    // }

    // /**
    //  * Retrieves content from the specified holon and lens.
    //  * @param {string} holon - The holon identifier.
    //  * @param {string} lens - The lens from which to retrieve content.
    //  * @returns {Promise<Array<object>>} - The retrieved content.
    //  */
    // async getAll(holon, lens) {
    //     if (!holon || !lens) {
    //         console.log('Error in getAll:', holon, lens)
    //         return;
    //     }
    //     // Wrap the gun operation in a promise
    //     //retrieve lens schema
    //     const schema = await this.getSchema(lens);

    //     if (!schema && this.strict) {
    //         console.log('Aborting getAll: the schema for "' + lens + '" is not defined');
    //         return null; // No schema found, return null if strict about it 
    //     }

    //     return new Promise(async (resolve, reject) => {
    //         let output = []
    //         let counter = 0
    //         this.gun.get(holon.toString()).get(lens).once((data, key) => {
    //             if (data) {
    //                 const maplenght = Object.keys(data).length - 1
    //                 this.gun.get(holon.toString()).get(lens).map().once(async (itemdata, key) => {
    //                     counter += 1
    //                     if (itemdata) {
    //                         let parsed = await this.parse(itemdata)

    //                         if (schema && this.strict) {
    //                             let valid = this.validator.validate(schema, parsed);
    //                             if (!valid || parsed == null || parsed == undefined) {
    //                                 console.log('Removing Invalid content:', this.validator.errors);
    //                                 this.gun.get(this.appname).get(holon).get(lens).get(key).put(null);

    //                             } else {
    //                                 output.push(parsed);
    //                             }
    //                         }
    //                         else {
    //                             output.push(parsed);
    //                         }
    //                     }

    //                     if (counter == maplenght) {
    //                         resolve(output);
    //                     }
    //                 }
    //                 );
    //             } else resolve(output)
    //         })
    //     }
    //     );
    // }

    // /**
    //  * Retrieves a specific key from the specified holon and lens.
    //  * @param {string} holon - The holon identifier.
    //  * @param {string} lens - The lens from which to retrieve the key.
    //  * @param {string} key - The specific key to retrieve.
    //  * @returns {Promise<object|null>} - The retrieved content or null if not found.
    //  */
    // async get(holon, lens, key) {
    //     return new Promise((resolve) => {
    //         // Use Gun to get the data
    //         this.gun.get(this.appname).get(holon).get(lens).get(key).once((data, key) => {
    //             if (data) {
    //                 try {
    //                     let parsed = this.parse(data); // Resolve the promise with the data if data is found
    //                     resolve(parsed);
    //                 }
    //                 catch (e) {
    //                     resolve(data)
    //                 }

    //             } else {
    //                 resolve(null); // Reject the promise if no data is found
    //             }
    //         });
    //     });

   // }

    /**
     * Deletes a specific key from a given holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens from which to delete the key.
     * @param {string} key - The specific key to delete.
     */
    async delete (holon, lens, key) {
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


    async get(holon, lens, key) {
        if (!holon || !lens || !key) {
            console.error('get: Missing required parameters:', { holon, lens, key });
            return null;
        }

        return new Promise((resolve) => {
            let timeout = setTimeout(() => {
                console.warn('get: Operation timed out');
                resolve(null);
            }, 5000); // 5 second timeout

            this.gun.get(this.appname)
                .get(holon)
                .get(lens)
                .get(key)
                .once((data) => {
                    clearTimeout(timeout);
                    
                    if (!data) {
                        resolve(null);
                        return;
                    }

                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed);
                    } catch (error) {
                        console.error('Error parsing data:', error);
                        resolve(null);
                    }
                });
        });
    }



    async getAll(holon, lens) {

            return new Promise(async (resolve, reject) => {
                let output = []
                let counter = 0
                this.gun.get(this.appname).get(holon).get(lens).once((data, key) => {
                    if (data) {
                        const maplenght = Object.keys(data).length - 1
                        this.gun.get(this.appname).get(holon).get(lens).map().once(async (itemdata, key) => {
                            counter += 1
                            if (itemdata) {
                                var parsed = {}
                                try {
                                    parsed = JSON.parse(itemdata);
                                } catch (e) {
                                    console.log('Invalid JSON:', itemdata);
                                }
                                output.push(parsed);

                            }

                            if (counter == maplenght) {
                                resolve(output);
                            }
                        }
                        );
                    } else resolve(output)
                })
            }
            );
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
            this.gun.get(this.appname).get(holon).get(lens).put(node)
        }

    /**
   * Retrieves a specific gun node from the specified holon and lens.
   * @param {string} holon - The holon identifier.
   * @param {string} lens - The lens from which to retrieve the key.
   * @param {string} key - The specific key to retrieve.
   * @returns {Promise<object|null>} - The retrieved content or null if not found.
   */
    async getNode(holon, lens, key) {
            // Use Gun to get the data
            return this.gun.get(this.appname).get(holon).get(lens).get(key)
        }

    /**
     * Deletes a specific gun node from a given holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} key - The key of the node to delete.
     */
    async deleteNode(holon, lens, key) {
            await this.gun.get(this.appname).get(holon).get(lens).get(key).put(null)
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
    async getAllGlobal(tableName) {
            return new Promise(async (resolve, reject) => {
                let output = []
                let counter = 0
                this.gun.get(tableName.toString()).once((data, key) => {
                    if (data) {
                        const maplenght = Object.keys(data).length - 1
                        this.gun.get(tableName.toString()).map().once(async (itemdata, key) => {
                            counter += 1
                            if (itemdata) {
                                let parsed = await this.parse(itemdata)
                                output.push(parsed);
                            }

                            if (counter == maplenght) {
                                resolve(output);
                            }
                        }
                        );
                    } else resolve(output)
                })
            }
            )
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

            return new Promise((resolve) => {
                this.gun.get(this.appname).get(tableName).map().put(null).once(
                    (data, key) => this.gun.get(this.appname).get(tableName).get(key).put(null)
                )
                this.gun.get(this.appname).get(tableName).put({}, ack => {
                    resolve();
                });
            });
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
            if(res < 1 || res > 15) return;
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
            await this.putNode(holon, lens, content)
            return content
        }
        else {
            console.log('Upcasting ', holon, lens, content, res)
            await this.putNode(holon, lens, content)
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
    subscribe(holon, lens, callback) {
        this.gun.get(this.appname).get(holon).get(lens).map().on((data, key) => {
            callback(data, key)
        })
    }
}

export default HoloSphere;
