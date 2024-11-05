import * as h3 from 'h3-js';
import OpenAI from 'openai';
import Gun from 'gun'
import Ajv2019 from 'ajv/dist/2019.js'

class HoloSphere {
    /**
     * Initializes a new instance of the HoloSphere class.
     * @param {string} appname - The name of the application.
     * @param {string|null} openaikey - The OpenAI API key.
     */
    constructor(appname, openaikey = null) {
        this.validator = new Ajv2019({ allErrors: false, strict: false });
        this.gun = Gun({
            peers: ['https://59.src.eco/gun'],
            axe: false,
            // uuid: (content) => { // generate a unique id for each node
            //     console.log('uuid', content);
            //     return content;}
        });

        this.gun = this.gun.get(appname)
        this.users = {}; // Initialize users
        this.hexagonVotes = {}; // Initialize hexagonVotes

        if (openaikey != null) {
            this.openai = new OpenAI({
                apiKey: openaikey,
            });
        }
    }

    /**
     * Sets the JSON schema for a specific lens.
     * @param {string} lens - The lens identifier.
     * @param {object} schema - The JSON schema to set.
     * @returns {Promise} - Resolves when the schema is set.
     */
    async setSchema(lens, schema) {
        return new Promise((resolve, reject) => {
            this.gun.get(lens).get('schema').put(JSON.stringify(schema), ack => {
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
            this.gun.get(lens).get('schema').once(data => {
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
    async delete(id, tag) {
        await this.gun.get(id).get(tag).put(null)
    }

    /**
     * Stores content in the specified hex and lens.
     * @param {string} hex - The hex identifier.
     * @param {string} lens - The lens under which to store the content.
     * @param {object} content - The content to store.
     */
    async put(hex, lens, content) {
        if (!hex || !lens || !content) return;
        console.error('Error in put:', hex, lens, content);
        // Retrieve the schema for the lens
        let schema = await this.getSchema(lens)
        if (schema) {
            // Validate the content against the schema
            const valid = this.validator.validate(schema, content);
            if (!valid) {
                console.error('Not committing invalid content:', this.validator.errors);
                return null;
            }
        }

        // Create a node for the content
        const payload = JSON.stringify(content);

        let noderef;

        if (content.id) { //use the user-defined id. Important to be able to send updates using put
            noderef = this.gun.get(lens).get(content.id).put(payload)
            this.gun.get(hex.toString()).get(lens).get(content.id).put(payload)
        } else { // create a content-addressable reference like IPFS. Note: no updates possible using put
            const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(byte => byte.toString(16).padStart(2, "0")).join("");
            noderef = this.gun.get(lens).get(hashHex).put(payload)
            this.gun.get(hex.toString()).get(lens).get(hashHex).put(payload)
        }

    }

    async putNode(hex, lens, node) {
        this.gun.get(hex).get(lens).set(node)
    }

    async parse(data) {
        let parsed = {};

        if (typeof data === 'object' && data !== null) {
            if (data._ && data._["#"]) {
                // If the data is a reference, fetch the actual content
                let query = data._['#'].split('/');
                let hex = query[1];
                let lens = query[2];
                let key = query[3];
                parsed = await this.getKey(hex, lens, key);
            } else if (data._ && data._['>']) {
                // This might be a GunDB node, try to get its value
                const nodeValue = Object.values(data).find(v => typeof v !== 'object' && v !== '_');
                if (nodeValue) {
                    try {
                        parsed = JSON.parse(nodeValue);
                    } catch (e) {
                        console.log('Invalid JSON in node value:', nodeValue);
                        parsed = nodeValue; // return the raw data
                    }
                } else {
                    console.log('Unable to parse GunDB node:', data);
                    parsed = data; // return the original data
                }
            } else {
                // Treat it as regular data
                parsed = data;
            }
        } else {
            // If it's not an object, try parsing it as JSON
            try {
                parsed = JSON.parse(data);
            } catch (e) {
                console.log('Invalid JSON:', data);
                parsed = data; // return the raw data
            }
        }

        return parsed;
    }

    /**
     * Retrieves content from the specified hex and lens.
     * @param {string} hex - The hex identifier.
     * @param {string} lens - The lens from which to retrieve content.
     * @returns {Promise<Array<object>>} - The retrieved content.
     */
    async get(hex, lens) {
        if (!hex || !lens) {
            console.log('Wrong get:', hex, lens)
            return;
        }
        // Wrap the GunDB operation in a promise
        //retrieve lens schema
        const schema = await this.getSchema(lens);

        if (!schema) {
            console.log('The schema for "' + lens + '" is not defined');
            // return null; // No schema found, return null if strict about it 
        }

        return new Promise(async (resolve, reject) => {
            let output = []
            let counter = 0
            this.gun.get(hex.toString()).get(lens).once((data, key) => {
                if (data) {
                    const maplenght = Object.keys(data).length - 1
                    console.log('Map length:', maplenght)
                    this.gun.get(hex.toString()).get(lens).map().once(async (itemdata, key) => {
                        counter += 1
                        if (itemdata) {
                            let parsed = await this.parse (itemdata)
                          

                            if (schema) {
                                let valid = this.validator.validate(schema, parsed);
                                if (!valid || parsed == null || parsed == undefined) {
                                    console.log('Removing Invalid content:', this.validator.errors);
                                    this.gun.get(hex).get(lens).get(key).put(null);

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
       async getKey(hex, lens, key) {
        return new Promise((resolve) => {
            // Use Gun to get the data
            this.gun.get(hex).get(lens).get(key).once((data, key) => {
                if (data) {
                    console.log('Data getting parsed:', data)
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
     getNode(hex, lens, key) {
        // Use Gun to get the data
        return this.gun.get(hex).get(lens).get(key)
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

                this.gun.get(siblings[i]).get(lens).map().once((data, key) => {
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
        let node = await this.gun.get(parent + '_summary').put({ id: parent + '_summary', content: computed })

        this.put(parent, lens, node);
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
        this.gun.get(hex).get(lens).map().once((data, key) => {
            //entities = data;
            //const id = Object.keys(entities)[0] // since this would be in object form, you can manipulate it as you would like. 
            this.gun.get(hex).get(lens).put({ [key]: null })
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
     * Upcasts content to parent hexagons recursively.
     * @param {string} hex - The current hex identifier.
     * @param {string} lens - The lens under which to upcast.
     * @param {object} content - The content to upcast.
     * @returns {Promise<object>} - The upcasted content.
     */
    async upcast(hex, lens, content) {
        let res = h3.getResolution(hex)
        if (res == 0) {
            await this.putNode(hex, lens, content)
            return content
        }
        else {
            console.log('Upcasting ', hex, lens, content, res)
            await this.putNode(hex, lens, content)
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
        this.gun.get(hex).get(lens).map().on((data, key) => {
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
        if (this.users[userId]) { // Added this.users
            if (visited.has(userId)) {
                return null; // Avoid circular delegations
            }
            visited.add(userId);

            const delegation = this.users[userId].delegations[topic];
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
        if (!this.hexagonVotes[hexId] || !this.hexagonVotes[hexId][topic]) {
            return {}; // Handle undefined votes
        }
        const votes = this.hexagonVotes[hexId][topic];
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




}

export default HoloSphere;
