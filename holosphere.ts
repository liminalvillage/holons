import * as h3 from 'h3-js';
import OpenAI from 'openai';
import Gun from 'gun';
import Ajv2019 from 'ajv/dist/2019.js';

interface GunAck {
    err: string | null;
    ok: boolean;
}

interface GunData {
    _: {
        '#'?: string;
        '>'?: Record<string, number>;
    };
    [key: string]: any;
}

class HoloSphere {
    private appname: string;
    private strict: boolean;
    private validator: Ajv2019;
    private gun: any;
    private openai?: OpenAI;

    /**
     * Initializes a new instance of the HoloSphere class.
     * @param {string} appname - The name of the application.
     * @param {boolean} strict - Whether to enforce strict schema validation.
     * @param {string|null} openaikey - The OpenAI API key.
     */
    constructor(appname: string, strict: boolean = false, openaikey: string | null = null) {
        this.appname = appname;
        this.strict = strict;
        this.validator = new Ajv2019({
            allErrors: true,
            strict: false,
            validateSchema: true
        });

        this.gun = Gun({
            peers: ['https://gun.holons.io', 'https://59.src.eco/gun'],
            axe: false
        });

        if (openaikey) {
            this.openai = new OpenAI({
                apiKey: openaikey,
            });
        }
    }

    // Schema Operations
    async setSchema(lens: string, schema: object): Promise<boolean> {
        if (!lens || !schema) {
            console.error('setSchema: Missing required parameters');
            return false;
        }

        // Type assertion for schema validation
        const schemaObj = schema as {
            type: string;
            properties?: Record<string, any>;
            required?: string[];
        };

        if (!schemaObj.type || typeof schemaObj.type !== 'string') {
            console.error('setSchema: Schema must have a type field');
            return false;
        }

        if (this.strict) {
            try {
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

                if (!schemaObj.properties || typeof schemaObj.properties !== 'object') {
                    console.error('setSchema: Schema must have properties in strict mode');
                    return false;
                }

                if (!schemaObj.required || !Array.isArray(schemaObj.required) || schemaObj.required.length === 0) {
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
                    .put(schemaString, (ack: GunAck) => {
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

    async getSchema(lens: string): Promise<object | null> {
        if (!lens) {
            console.error('getSchema: Missing lens parameter');
            return null;
        }

        return new Promise((resolve) => {
            this.gun.get(this.appname)
                .get(lens)
                .get('schema')
                .once((data: any) => {
                    if (!data) {
                        resolve(null);
                        return;
                    }

                    try {
                        if (typeof data === 'string') {
                            resolve(JSON.parse(data));
                        } else if (typeof data === 'object' && data !== null) {
                            const schemaStr:any = Object.values(data).find(v =>
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

    // Data Operations
    async put(holon: string, lens: string, data: object): Promise<boolean> {
        if (!holon || !lens || !data) {
            console.error('put: Missing required parameters:', { holon, lens, data });
            return false;
        }

        const typedData = data as { id: string };
        if (!typedData.id) {
            console.error('put: Data must have an id field');
            return false;
        }

        const schema = await this.getSchema(lens);
        if (schema) {
            try {
                const valid = this.validator.validate(schema, data);
                if (!valid) {
                    console.error('put: Schema validation failed:', this.validator.errors);
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
                    .get(typedData.id)
                    .put(payload, (ack: GunAck) => {
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

    async get(holon: string, lens: string, key: string): Promise<any | null> {
        if (!holon || !lens || !key) {
            console.error('get: Missing required parameters:', { holon, lens, key });
            return null;
        }

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
                .once((data: any) => {
                    clearTimeout(timeout);
                    
                    if (!data) {
                        resolve(null);
                        return;
                    }

                    try {
                        const parsed = this.parse(data);
                        if (schema) {
                            const valid = this.validator.validate(schema, parsed);
                            if (!valid && this.strict) {
                                console.error('get: Invalid data according to schema:', this.validator.errors);
                                resolve(null);
                                return;
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

    async getAll(holon: string, lens: string): Promise<Array<any>> {
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
            const output: any[] = [];
            let counter = 0;

            this.gun.get(this.appname).get(holon).get(lens).once((data: GunData) => {
                if (!data) {
                    resolve(output);
                    return;
                }

                const mapLength = Object.keys(data).length - 1;

                this.gun.get(this.appname).get(holon).get(lens).map().once(async (itemdata: any, key: string) => {
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

    async delete(holon: string, lens: string, key: string): Promise<void> {
        return new Promise((resolve) => {
            this.gun.get(this.appname)
                .get(holon)
                .get(lens)
                .get(key)
                .put(null, (ack: GunAck) => {
                    if (ack.err) {
                        console.error('delete: Error deleting data:', ack.err);
                    }
                    resolve();
                });
        });
    }

    async deleteAll(holon: string, lens: string): Promise<boolean> {
        if (!holon || !lens) {
            console.error('deleteAll: Missing holon or lens parameter');
            return false;
        }

        return new Promise((resolve) => {
            const deletionPromises: Promise<boolean>[] = [];

            this.gun.get(this.appname).get(holon).get(lens).once((data: GunData) => {
                if (!data) {
                    resolve(true);
                    return;
                }

                const keys = Object.keys(data).filter(key => key !== '_');

                keys.forEach(key => {
                    deletionPromises.push(
                        new Promise((resolveDelete) => {
                            this.gun.get(this.appname)
                                .get(holon)
                                .get(lens)
                                .get(key)
                                .put(null, (ack: GunAck) => {
                                    resolveDelete(!!ack.ok);
                                });
                        })
                    );
                });

                Promise.all(deletionPromises)
                    .then(results => {
                        resolve(results.every(result => result === true));
                    })
                    .catch(error => {
                        console.error('Error in deleteAll:', error);
                        resolve(false);
                    });
            });
        });
    }

    // Node Operations
    async putNode(holon: string, lens: string, node: object): Promise<boolean> {
        return new Promise((resolve) => {
            this.gun.get(this.appname).get(holon).get(lens).put(node, (ack: GunAck) => {
                if (ack.err) {
                    console.error("Error adding data to GunDB:", ack.err);
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });
    }

    async getNode(holon: string, lens: string, key: string): Promise<any | null> {
        if (!holon || !lens || !key) {
            console.error('getNode: Missing required parameters');
            return null;
        }

        return new Promise((resolve) => {
            let timeout = setTimeout(() => {
                console.warn('getNode: Operation timed out');
                resolve(null);
            }, 5000);

            this.gun.get(this.appname)
                .get(holon)
                .get(lens)
                .get(key)
                .once((data: any) => {
                    clearTimeout(timeout);
                    resolve(data || null);
                });
        });
    }

    async deleteNode(holon: string, lens: string, key: string): Promise<boolean> {
        if (!holon || !lens || !key) {
            console.error('deleteNode: Missing required parameters');
            return false;
        }

        return new Promise((resolve) => {
            this.gun.get(this.appname)
                .get(holon)
                .get(lens)
                .get(key)
                .put(null, (ack: GunAck) => {
                    if (ack.err) {
                        console.error('deleteNode: Error deleting node:', ack.err);
                        resolve(false);
                    } else {
                        resolve(true);
                    }
                });
        });
    }

    // Global Operations
    async putGlobal(tableName: string, data: object): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!tableName || !data) {
                reject(new Error('Table name and data are required'));
                return;
            }

            const typedData = data as { id?: string };
            if (typedData.id) {
                this.gun.get(this.appname)
                    .get(tableName)
                    .get(typedData.id)
                    .put(JSON.stringify(data), (ack: GunAck) => {
                        if (ack.err) reject(new Error(ack.err));
                        else resolve();
                    });
            } else {
                this.gun.get(this.appname)
                    .get(tableName)
                    .put(JSON.stringify(data), (ack: GunAck) => {
                        if (ack.err) reject(new Error(ack.err));
                        else resolve();
                    });
            }
        });
    }

    async getGlobal(tableName: string, key: string): Promise<object | null> {
        return new Promise((resolve) => {
            this.gun.get(this.appname)
                .get(tableName)
                .get(key)
                .once((data: any) => {
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

    async getAllGlobal(tableName: string): Promise<object | null> {
        return new Promise((resolve) => {
            const output: any[] = [];
            let counter = 0;

            this.gun.get(tableName.toString()).once((data: GunData) => {
                if (data) {
                    const mapLength = Object.keys(data).length - 1;
                    this.gun.get(tableName.toString()).map().once(async (itemdata: any) => {
                        counter += 1;
                        if (itemdata) {
                            const parsed = await this.parse(itemdata);
                            output.push(parsed);
                        }

                        if (counter === mapLength) {
                            resolve(output);
                        }
                    });
                } else resolve(output);
            });
        });
    }

    async deleteGlobal(tableName: string, key: string): Promise<void> {
        await this.gun.get(this.appname).get(tableName).get(key).put(null);
    }

    async deleteAllGlobal(tableName: string): Promise<void> {
        return new Promise((resolve) => {
            this.gun.get(this.appname)
                .get(tableName)
                .map()
                .put(null)
                .once((data: GunData, key: string) => 
                    this.gun.get(this.appname).get(tableName).get(key).put(null)
                );
            
            this.gun.get(this.appname).get(tableName).put({}, () => {
                resolve();
            });
        });
    }

    // Geospatial Operations
    async getHolon(lat: number, lng: number, resolution: number): Promise<string> {
        return h3.latLngToCell(lat, lng, resolution);
    }

    getScalespace(lat: number, lng: number): string[] {
        const list: string[] = [];
        const cell = h3.latLngToCell(lat, lng, 14);
        list.push(cell);
        for (let i = 13; i >= 0; i--) {
            list.push(h3.cellToParent(cell, i));
        }
        return list;
    }

    getHolonScalespace(holon: string): string[] {
        const list: string[] = [];
        const res = h3.getResolution(holon);
        for (let i = res; i >= 0; i--) {
            list.push(h3.cellToParent(holon, i));
        }
        return list;
    }

    // Compute Operations
    async compute(holon: string, lens: string, operation: string): Promise<void> {
        const res = h3.getResolution(holon);
        if (res < 1 || res > 15) return;

        const parent = h3.cellToParent(holon, res - 1);
        const siblings = h3.cellToChildren(parent, res);
        const content: string[] = [];

        const promises = siblings.map((sibling) => 
            new Promise<void>((resolve) => {
                const timeout = setTimeout(() => {
                    console.log(`Timeout for sibling ${sibling}`);
                    resolve();
                }, 1000);

                this.gun.get(this.appname)
                    .get(sibling)
                    .get(lens)
                    .map()
                    .once((data: any) => {
                        clearTimeout(timeout);
                        if (data?.content) {
                            content.push(data.content);
                        }
                        resolve();
                    });
            })
        );

        await Promise.all(promises);
        
        if (content.length > 0) {
            const computed = await this.summarize(content.join('\n'));
            const node = { id: `${parent}_summary`, content: computed };
            await this.put(parent, lens, node);
            await this.compute(parent, lens, operation);
        }
    }

    // Helper Methods
    private async parse(rawData: any): Promise<any> {
        let parsedData: any = {};

        if (typeof rawData === 'object' && rawData !== null) {
            if (rawData._ && rawData._["#"]) {
                const pathParts = rawData._['#'].split('/');
                const hexId = pathParts[1];
                const lensId = pathParts[2];
                const dataKey = pathParts[3];
                parsedData = await this.get(hexId, lensId, dataKey);
            } else if (rawData._ && rawData._['>']) {
                const nodeValue = Object.values(rawData).find(v => 
                    typeof v !== 'object' && v !== '_'
                );
                if (nodeValue) {
                    try {
                        parsedData = JSON.parse(nodeValue as string);
                    } catch (e) {
                        parsedData = nodeValue;
                    }
                } else {
                    parsedData = rawData;
                }
            } else {
                parsedData = rawData;
            }
        } else {
            try {
                parsedData = JSON.parse(rawData);
            } catch (e) {
                parsedData = rawData;
            }
        }

        return parsedData;
    }

    // Subscription Methods
    subscribe(holon: string, lens: string, callback: (data: any, key: string) => void): void {
        this.gun.get(this.appname)
            .get(holon)
            .get(lens)
            .map()
            .on((data: any, key: string) => {
                callback(data, key);
            });
    }

    subscribeGlobal(tableName: string, callback: (data: any, key: string) => void): void {
        this.gun.get(this.appname)
            .get(tableName)
            .map()
            .on((data: any, key: string) => {
                callback(data, key);
            });
    }

    /**
     * Summarizes provided history text using OpenAI.
     * @param {string} history - The history text to summarize.
     * @returns {Promise<string>} - The summarized text.
     */
    private async summarize(history: string): Promise<string> {
        if (!this.openai) {
            return 'OpenAI not initialized, please specify the API key in the constructor.';
        }

        try {
            const assistant = await this.openai.beta.assistants.retrieve("asst_qhk79F8wV9BDNuwfOI80TqzC");
            const thread = await this.openai.beta.threads.create();
            
            await this.openai.beta.threads.messages.create(thread.id, {
                role: "user",
                content: history
            });

            const run = await this.openai.beta.threads.runs.create(thread.id, {
                assistant_id: assistant.id
            });

            let runStatus = await this.openai.beta.threads.runs.retrieve(
                thread.id,
                run.id
            );

            // Poll for completion
            while (runStatus.status !== "completed") {
                await new Promise((resolve) => setTimeout(resolve, 2000));
                runStatus = await this.openai.beta.threads.runs.retrieve(thread.id, run.id);
                
                // Handle potential errors or timeouts
                if (runStatus.status === "failed" || runStatus.status === "cancelled") {
                    throw new Error(`Run ${runStatus.status}: ${runStatus.last_error?.message || 'Unknown error'}`);
                }
            }

            // Get the latest messages
            const messages = await this.openai.beta.threads.messages.list(thread.id);
            
            if (!messages.data[0]?.content[0]?.text?.value) {
                throw new Error('No summary generated');
            }

            const summary = messages.data[0].content[0].text.value
                .replace(/```json\n/, '')
                .replace(/```/, '')
                .trim();

            return summary;

        } catch (error) {
            console.error('Error in summarize:', error);
            return `Error generating summary: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }
}

export default HoloSphere;
