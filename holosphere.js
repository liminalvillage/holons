import * as h3 from 'h3-js';
import OpenAI from 'openai';
import Gun from 'gun'
import 'gun/sea';
import Ajv2019 from 'ajv/dist/2019.js'

class HoloSphere {
    /**
     * Initializes a new instance of the HoloSphere class.
     * @param {string} appName - The name of the application.
     * @param {string|null} openAiKey - The OpenAI API key.
     */
    constructor(appName, openAiKey = null) {
        this.validator = new Ajv2019({ allErrors: false, strict: false });
        this.gunDb = Gun({
            peers: ['http://gun.holons.io/gun'],
            axe: false
            // uuid: (content) => { // generate a unique id for each node
            //     console.log('uuid', content);
            //     return content;}
        });

        this.gunDb = this.gunDb.get(appName)
        this.userRegistry = {}; // Initialize users
        this.hexVotes = {}; // Initialize hexVotes

        if (openAiKey != null) {
            this.aiClient = new OpenAI({
                apiKey: openAiKey,
            });
        }

        this.sea = Gun.SEA;
        this.user = this.gunDb.user();
        this.authenticatedUser = null;  // Track current authenticated user
    }

    /**
     * Creates a new user account
     * @param {string} username - The username
     * @param {string} password - The password
     * @returns {Promise<object>} - The created user object or error
     */
    async createUser(username, password) {
        return new Promise((resolve, reject) => {
            this.user.create(username, password, (ack) => {
                if (ack.err) {
                    reject(new Error(ack.err));
                } else {
                    resolve(ack);
                }
            });
        });
    }

    /**
     * Authenticates a user
     * @param {string} username - The username
     * @param {string} password - The password
     * @returns {Promise<object>} - The authenticated user object or error
     */
    async login(username, password) {
        return new Promise((resolve, reject) => {
            this.user.auth(username, password, (ack) => {
                if (ack.err) {
                    reject(new Error(ack.err));
                } else {
                    this.authenticatedUser = ack.sea;  // Store authenticated user data
                    resolve(ack);
                }
            });
        });
    }

    /**
     * Logs out the current user
     */
    async logout() {
        this.authenticatedUser = null;
        this.user.leave();
    }

    /**
     * Encrypts data using SEA
     * @param {any} data - Data to encrypt
     * @param {string} secret - Secret key for encryption
     * @returns {Promise<string>} - Encrypted data
     */
    async encrypt(data, secret) {
        return await this.sea.encrypt(data, secret);
    }

    /**
     * Decrypts data using SEA
     * @param {string} encryptedData - Data to decrypt
     * @param {string} secret - Secret key for decryption
     * @returns {Promise<any>} - Decrypted data
     */
    async decrypt(encryptedData, secret) {
        return await this.sea.decrypt(encryptedData, secret);
    }

    /**
     * Sets the JSON schema for a specific lens.
     * @param {string} lens - The lens identifier.
     * @param {object} schema - The JSON schema to set.
     * @returns {Promise} - Resolves when the schema is set.
     */
    async setLensSchema(lens, schema) {
        return new Promise((resolve, reject) => {
            this.gunDb.get(lens).get('schema').put(JSON.stringify(schema), ack => {
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
    async getLensSchema(lens) {
        return new Promise((resolve) => {
            this.gunDb.get(lens).get('schema').once(data => {
                if (data) {
                    let parsed;
                    try {
                        parsed = JSON.parse(data);
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
    /**
     * Deletes a specific tag from a given ID.
     * @param {string} id - The identifier from which to delete the tag.
     * @param {string} tag - The tag to delete.
     */
    async deleteNode(nodeId, tag) {
        await this.gunDb.get(nodeId).get(tag).put(null)
    }

    /**
     * Stores data in a global (non-hex-specific) table.
     * @param {string} table - The table name to store data in.
     * @param {object} data - The data to store. If it has an 'id' field, it will be used as the key.
     * @returns {Promise<void>}
     */
    async putGlobalData(tableName, data) {
        return new Promise((resolve, reject) => {
            if (!tableName || !data) {
                reject(new Error('Table name and data are required'));
                return;
            }

            if (data.id) {
                this.gunDb.get(tableName).get(data.id).put(JSON.stringify(data), ack => {
                    if (ack.err) {
                        reject(new Error(ack.err));
                    } else {
                        resolve();
                    }
                });
            } else {
                this.gunDb.get(tableName).put(JSON.stringify(data), ack => {
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
     * Retrieves all data from a global table.
     * @param {string} table - The table name to retrieve data from.
     * @returns {Promise<object|null>} - The parsed data from the table or null if not found.
     */
    async getGlobalData(tableName) {
        return new Promise((resolve) => {
            this.gunDb.get(tableName).once((data) => {
                if (!data) {
                    resolve(null);
                    return;
                }
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch (e) {
                    resolve(null);
                }
            });
        });
    }

    /**
     * Retrieves a specific key from a global table.
     * @param {string} table - The table name to retrieve from.
     * @param {string} key - The key to retrieve.
     * @returns {Promise<object|null>} - The parsed data for the key or null if not found.
     */
    async getGlobalDataKey(tableName, key) {
        return new Promise((resolve) => {
            this.gunDb.get(tableName).get(key).once((data) => {
                if (!data) {
                    resolve(null);
                    return;
                }
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch (e) {
                    resolve(null);
                }
            });
        });
    }

    /**
     * Deletes an entire global table.
     * @param {string} table - The table name to delete.
     * @returns {Promise<void>}
     */
    async deleteGlobalData(tableName) {
        return new Promise((resolve) => {
            this.gunDb.get(tableName).put(null, ack => {
                resolve();
            });
        });
    }

    /**
     * Stores content in the specified hex and lens.
     * @param {string} hex - The hex identifier.
     * @param {string} lens - The lens under which to store the content.
     * @param {object} content - The content to store.
     */
    async putHexData(hexId, lens, content, encrypt = false, secret = null) {
        if (!hexId || !lens || !content) { 
            console.error('Error in put:', hexId, lens, content);
            return;
        }

        // If encrypting, require authentication
        if (encrypt && !this.authenticatedUser) {
            throw new Error('Authentication required for encrypted data');
        }

        let schema = await this.getLensSchema(lens);
        if (schema) {
            const valid = this.validator.validate(schema, content);
            if (!valid) {
                console.error('Not committing invalid content:', this.validator.errors);
                return null;
            }
        }

        // Encrypt content if requested
        let payload;
        if (encrypt && secret) {
            const encryptedContent = await this.encrypt(content, secret);
            payload = JSON.stringify({ 
                encrypted: true, 
                data: encryptedContent,
                owner: this.authenticatedUser.pub  // Store owner's public key
            });
        } else {
            payload = JSON.stringify(content);
        }

        let noderef;
        if (content.id) {
            noderef = this.gunDb.get(lens).get(content.id).put(payload);
            this.gunDb.get(hexId.toString()).get(lens).get(content.id).put(payload);
        } else {
            const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(byte => byte.toString(16).padStart(2, "0")).join("");
            noderef = this.gunDb.get(lens).get(hashHex).put(payload);
            this.gunDb.get(hexId.toString()).get(lens).get(hashHex).put(payload);
        }
    }

    /**
     * Stores a raw GunDB node in the specified hex and lens.
     * @param {string} hex - The hex identifier.
     * @param {string} lens - The lens under which to store the node.
     * @param {object} node - The GunDB node to store.
     * @returns {Promise<void>}
     */
    async putHexNode(hexId, lens, node) {
        this.gunDb.get(hexId).get(lens).set(node)
    }

    /**
     * Parses data from GunDB, handling various data formats and references.
     * @param {*} data - The data to parse, could be a string, object, or GunDB reference.
     * @returns {Promise<object>} - The parsed data.
     */
    async parse(rawData) {
        let parsedData = {};

        if (typeof rawData === 'object' && rawData !== null) {
            if (rawData._ && rawData._["#"]) {
                // If the data is a reference, fetch the actual content
                let pathParts = rawData._['#'].split('/');
                let hexId = pathParts[1];
                let lensId = pathParts[2];
                let dataKey = pathParts[3];
                parsedData = await this.getHexKey(hexId, lensId, dataKey);
            } else if (rawData._ && rawData._['>']) {
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
                // Treat it as regular data
                parsedData = rawData;
            }
        } else {
            // If it's not an object, try parsing it as JSON
            try {
                parsedData = JSON.parse(rawData);
            } catch (e) {
                console.log('Invalid JSON:', rawData);
                parsedData = rawData; // return the raw data
            }
        }

        return parsedData;
    }

    /**
     * Retrieves content from the specified hex and lens.
     * @param {string} hex - The hex identifier.
     * @param {string} lens - The lens from which to retrieve content.
     * @returns {Promise<Array<object>>} - The retrieved content.
     */
    async getHexData(hexId, lens, secret = null) {
        if (!hexId || !lens) {
            console.log('Wrong get:', hexId, lens)
            return;
        }
        // Wrap the GunDB operation in a promise
        //retrieve lens schema
        const schema = await this.getLensSchema(lens);

        if (!schema) {
            console.log('The schema for "' + lens + '" is not defined');
            // return null; // No schema found, return null if strict about it 
        }

        return new Promise(async (resolve, reject) => {
            let output = []
            let counter = 0
            this.gunDb.get(hexId.toString()).get(lens).once((data, key) => {
                if (data) {
                    const maplenght = Object.keys(data).length - 1
                    console.log('Map length:', maplenght)
                    this.gunDb.get(hexId.toString()).get(lens).map().once(async (itemdata, key) => {
                        counter += 1
                        if (itemdata) {
                            let parsed = await this.parse (itemdata)
                            
                            // Handle encrypted data
                            if (parsed.encrypted && secret) {
                                try {
                                    parsed = await this.decrypt(parsed.data, secret);
                                } catch (e) {
                                    console.error('Decryption failed:', e);
                                    parsed = null;
                                }
                            }

                            if (schema) {
                                let valid = this.validator.validate(schema, parsed);
                                if (!valid || parsed == null || parsed == undefined) {
                                    console.log('Removing Invalid content:', this.validator.errors);
                                    this.gunDb.get(hexId).get(lens).get(key).put(null);

                                } else {
                                    output.push(parsed);
                                }
                            }
                            else {
                                output.push(parsed);
                            }
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
     * Retrieves a specific key from the specified hex and lens.
     * @param {string} hex - The hex identifier.
     * @param {string} lens - The lens from which to retrieve the key.
     * @param {string} key - The specific key to retrieve.
     * @returns {Promise<object|null>} - The retrieved content or null if not found.
     */
       async getHexKey(hexId, lens, key) {
        return new Promise((resolve) => {
            // Use Gun to get the data
            this.gunDb.get(hexId).get(lens).get(key).once((data, key) => {
                if (data) {
                    try {
                        let parsed = JSON.parse(data); // Resolve the promise with the data if data is found
                        resolve(parsed);
                    }
                    catch (e) {
                        resolve(data)
                    }
                   
                } else {
                    resolve(null); // Reject the promise if no data is found
                }
            });
        });

    }

    /**
   * Retrieves a specific gundb node from the specified hex and lens.
   * @param {string} hex - The hex identifier.
   * @param {string} lens - The lens from which to retrieve the key.
   * @param {string} key - The specific key to retrieve.
   * @returns {Promise<object|null>} - The retrieved content or null if not found.
   */
     async getHexNode(hexId, lens, key) {
        // Use Gun to get the data
        return this.gunDb.get(hexId).get(lens).get(key)
    }



    /**
     * Computes summaries based on the content within a hex and lens.
     * @param {string} hex - The hex identifier.
     * @param {string} lens - The lens to compute.
     * @param {string} operation - The operation to perform.
     */
    async compute(hex, lens, operation) {

        let res = h3.getResolution(hex);
        if (res < 1 || res > 15) return;
        console.log(res)
        let parent = h3.cellToParent(hex, res - 1);
        let siblings = h3.cellToChildren(parent, res);
        console.log(hex, parent, siblings, res)

        let content = [];
        let promises = [];

        for (let i = 0; i < siblings.length; i++) {
            promises.push(new Promise((resolve) => {
                let timeout = setTimeout(() => {
                    console.log(`Timeout for sibling ${i}`);
                    resolve(); // Resolve the promise to prevent it from hanging
                }, 1000); // Timeout of 5 seconds

                this.gunDb.get(siblings[i]).get(lens).map().once((data, key) => {
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
        let node = await this.gunDb.get(parent + '_summary').put({ id: parent + '_summary', content: computed })

        this.putHexData(parent, lens, node);
        this.compute(parent, lens, operation)
    }

    /**
     * Clears all entities under a specific hex and lens.
     * @param {string} hex - The hex identifier.
     * @param {string} lens - The lens to clear.
     */
    async clearlens(hex, lens) {
        let entities = {};

        // Get list out of Gun
        this.gunDb.get(hex).get(lens).map().once((data, key) => {
            //entities = data;
            //const id = Object.keys(entities)[0] // since this would be in object form, you can manipulate it as you would like. 
            this.gunDb.get(hex).get(lens).put({ [key]: null })
        })
    }


    /**
     * Summarizes provided history text using OpenAI.
     * @param {string} history - The history text to summarize.
     * @returns {Promise<string>} - The summarized text.
     */
    async summarize(history) {
        if (!this.aiClient) {
            return 'OpenAI not initialized, please specify the API key in the constructor.'
        }
        //const run = await this.openai.beta.threads.runs.retrieve(thread.id,run.id)
        const assistant = await this.aiClient.beta.assistants.retrieve("asst_qhk79F8wV9BDNuwfOI80TqzC")
        const thread = await this.aiClient.beta.threads.create()
        const message = await this.aiClient.beta.threads.messages.create(thread.id, {
            role: "user",
            content: history
        })
        const run = await this.aiClient.beta.threads.runs.create(thread.id, {
            assistant_id: assistant.id //,
            //instructions: "What is the meaning of life?",
        });

        let runStatus = await this.aiClient.beta.threads.runs.retrieve(
            thread.id,
            run.id
        );
        // Polling mechanism to see if runStatus is completed
        // This should be made more robust.
        while (runStatus.status !== "completed") {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            runStatus = await this.aiClient.beta.threads.runs.retrieve(thread.id, run.id);
        }
        // Get the latest messages from the thread
        const messages = await this.aiClient.beta.threads.messages.list(thread.id)
        const summary = messages.data[0].content[0].text.value.replace(/\`\`\`json\n/, '').replace(/\`\`\`/, '').trim()
        return summary
    }

    /**
     * Upcasts content to parent hexagons recursively.
     * @param {string} hex - The current hex identifier.
     * @param {string} lens - The lens under which to upcast.
     * @param {object} content - The content to upcast.
     * @returns {Promise<object>} - The upcasted content.
     */
    async upcast(hex, lens, content) {
        let res = h3.getResolution(hex)
        if (res == 0) {
            await this.putHexNode(hex, lens, content)
            return content
        }
        else {
            console.log('Upcasting ', hex, lens, content, res)
            await this.putHexNode(hex, lens, content)
            let parent = h3.cellToParent(hex, res - 1)
            return this.upcast(parent, lens, content)
        }
    }


    /**
     * Updates the parent hexagon with a new report.
     * @param {string} id - The child hex identifier.
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
     * Converts latitude and longitude to a hex identifier.
     * @param {number} lat - The latitude.
     * @param {number} lng - The longitude.
     * @param {number} resolution - The resolution level.
     * @returns {Promise<string>} - The resulting hex identifier.
     */
    async getHex(lat, lng, resolution) {
        return h3.latLngToCell(lat, lng, resolution);
    }

    /**
     * Retrieves all containing hexagons at all scales for given coordinates.
     * @param {number} lat - The latitude.
     * @param {number} lng - The longitude.
     * @returns {Array<string>} - List of hex identifiers.
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
     * Retrieves all containing hexagons at all scales for a given hex.
     * @param {string} hex - The hex identifier.
     * @returns {Array<string>} - List of hex identifiers.
     */
    getHexScalespace(hex) {
        let list = []
        let res = h3.getResolution(hex)
        for (let i = res; i >= 0; i--) {
            list.push(h3.cellToParent(hex, i))
        }
        return list
    }

    /**
     * Subscribes to changes in a specific hex and lens.
     * @param {string} hex - The hex identifier.
     * @param {string} lens - The lens to subscribe to.
     * @param {function} callback - The callback to execute on changes.
     */
    subscribe(hex, lens, callback) {
        this.gunDb.get(hex).get(lens).map().on((data, key) => {
            callback(data, key)
        })
    }

    /**
     * Retrieves the final vote for a user, considering delegations.
     * @param {string} userId - The user's identifier.
     * @param {string} topic - The voting topic.
     * @param {object} votes - The current votes.
     * @param {Set<string>} [visited=new Set()] - Set of visited users to prevent cycles.
     * @returns {string|null} - The final vote or null if not found.
     */
    getFinalVote(userId, topic, votes, visited = new Set()) {
        if (this.userRegistry[userId]) { // Added this.users
            if (visited.has(userId)) {
                return null; // Avoid circular delegations
            }
            visited.add(userId);

            const delegation = this.userRegistry[userId].delegations[topic];
            if (delegation && votes[delegation] === undefined) {
                return this.getFinalVote(delegation, topic, votes, visited); // Prefixed with this
            }

            return votes[userId] !== undefined ? votes[userId] : null;
        }
        return null;
    }

    /**
     * Aggregates votes for a specific hex and topic.
     * @param {string} hexId - The hex identifier.
     * @param {string} topic - The voting topic.
     * @returns {object} - Aggregated vote counts.
     */
    aggregateVotes(hexId, topic) {
        if (!this.hexVotes[hexId] || !this.hexVotes[hexId][topic]) {
            return {}; // Handle undefined votes
        }
        const votes = this.hexVotes[hexId][topic];
        const aggregatedVotes = {};

        Object.keys(votes).forEach(userId => {
            const finalVote = this.getFinalVote(userId, topic, votes); // Prefixed with this
            if (finalVote !== null) {
                aggregatedVotes[finalVote] = (aggregatedVotes[finalVote] || 0) + 1;
            }
        });

        return aggregatedVotes;
    }

    /**
     * Delegates a user's vote to another user.
     * @param {string} userId - The user's identifier.
     * @param {string} topic - The voting topic.
     * @param {string} delegateTo - The user to delegate the vote to.
     */
    async delegateVote(userId, topic, delegateTo) {
        const response = await fetch('/delegate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, topic, delegateTo })
        });
        alert(await response.text());
    }

    /**
     * Casts a vote for a user on a specific topic and hex.
     * @param {string} userId - The user's identifier.
     * @param {string} hexId - The hex identifier.
     * @param {string} topic - The voting topic.
     * @param {string} vote - The vote choice.
     */
    async vote(userId, hexId, topic, vote) {
        const response = await fetch('/vote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, hexId, topic, vote })
        });
        alert(await response.text());
    }

    /**
     * Retrieves all content from the specified hex and lens.
     * @param {string} hex - The hex identifier.
     * @param {string} lens - The lens from which to retrieve content.
     * @returns {Promise<Array<object>>} - Array of all items in the lens.
     */
    async getAllHexData(hexId, lens) {
    
        return new Promise(async (resolve, reject) => {
            let output = []
            let counter = 0
            
            this.gunDb.get(hexId.toString()).get(lens).once((data, key) => {
                if (data) {
                    const maplenght = Object.keys(data).length - 1
                    this.gunDb.get(hexId.toString()).get(lens).map().once(async (itemdata, key) => {
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
     * Drops (deletes) all content under a specific hex and lens.
     * @param {string} hex - The hex identifier.
     * @param {string} lens - The lens to drop.
     * @returns {Promise<void>}
     */
    async dropHexData(hexId, lens) {
        return new Promise((resolve) => {
            this.gunDb.get(hexId.toString()).get(lens).once((data, key) => {
                if (data) {
                    // Delete each item in the lens
                    Object.keys(data).forEach(itemKey => {
                        if (itemKey !== '_') {  // Skip Gun's internal keys
                            this.gunDb.get(hexId.toString()).get(lens).get(itemKey).put(null);
                        }
                    });
                    // Finally clear the lens reference
                    this.gunDb.get(hexId.toString()).get(lens).put(null);
                }
                resolve();
            });
        });
    }

    /**
     * Retrieves all content from a specific lens across all hexes.
     * @param {string} lens - The lens from which to retrieve content.
     * @returns {Promise<Array<object>>} - Array of all items in the lens from all hexes.
     */
    async getAllLensData(lens) {
        return new Promise((resolve) => {
            let output = [];
            let counter = 0;
            
            // First get all data from the lens directly
            this.gunDb.get(lens).once((data, key) => {
                if (data) {
                    const mapLength = Object.keys(data).length - 1;
                    this.gunDb.get(lens).map().once(async (itemdata, key) => {
                        counter += 1;
                        if (itemdata && key !== '_') {  // Skip Gun's internal keys
                            try {
                                let parsed = JSON.parse(itemdata);
                                if (parsed && typeof parsed === 'object') {
                                    output.push(parsed);
                                }
                            } catch (e) {
                                console.log('Invalid JSON:', itemdata);
                            }
                        }

                        if (counter === mapLength) {
                            resolve(output);
                        }
                    });
                } else {
                    resolve(output);
                }
            });

            // // Add a timeout to ensure we resolve
            // setTimeout(() => {
            //     resolve(output);
            // }, 3000);
        });
    }

    /**
     * Deletes content from a specific hex and lens.
     * @param {string} hex - The hex identifier.
     * @param {string} lens - The lens to delete content from.
     * @param {string} contentId - The ID of the content to delete.
     * @returns {Promise<void>}
     */
    async deleteHexData(hexId, lens, contentId) {
        if (!hexId || !lens || !contentId) {
            throw new Error('Invalid parameters for deletion');
        }

        // Get the content first
        const content = await this.getHexKey(hexId, lens, contentId);
        
        if (content && content.encrypted) {
            // Check if user is authenticated and is the owner
            if (!this.authenticatedUser) {
                throw new Error('Authentication required to delete encrypted content');
            }
            
            if (content.owner !== this.authenticatedUser.pub) {
                throw new Error('Only the owner can delete this encrypted content');
            }
        }

        // Proceed with deletion if authorized
        await this.gunDb.get(hexId).get(lens).get(contentId).put(null);
    }

}

export default HoloSphere;
