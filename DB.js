// Description: This file contains the DB class which is used to interact with the database.
import {
    create
} from 'ipfs';
import OrbitDB from 'orbit-db';
import HoloSphere from 'holosphere';

class DB {
    constructor(dbName) {
        this.orbitdb = null;
        this.gun = null;
        this.dbName = dbName;
        this.preloadedDB = {};
        this.holosphere = new HoloSphere(dbName);
       
        
        this.db = 'gun'; // 'orbit' or 'gun' or 'both' (writing to both, reading from gub)
    }

    async init() {
        try {

            this.gun = this.holosphere.gun;
            
            if (this.db === 'orbit') {
                this.ipfs = await create({
                    address: "127.0.0.1",
                    port: 5001,
                    source: 'js-ipfs',
                    repo: 'orbit'
                });

                this.orbitdb = await OrbitDB.createInstance(this.ipfs);
            }
        } catch (error) {
            console.error("Error initializing database:", error);
        }
    }

    async open(table) {
        try {
            if (!this.preloadedDB[table]) {
                if (this.db === 'gun') {
                    //this.preloadedDB[table] = this.gun.get(this.dbName + '/' + table); //store table reference
                } else if (this.db === 'orbit') {
                    this.preloadedDB[table] = await this.orbitdb.docs(this.dbName + '/' + table, {
                        indexBy: 'id'
                    });
                    await this.preloadedDB[table].load();
                    console.log('preloaded ', table);
                }
            }
            return this.preloadedDB[table];
        } catch (error) {
            console.error("Error opening table:", error);
        }
    }

    async del(table, key) {
        try {
            if (this.db === 'gun') {
                return this.deleteGunDB(table, key);
            } else if (this.db === 'orbit') {
                this.deleteGunDB(table, key);
                return this.deleteOrbitDB(table, key);
            }
        } catch (error) {
            console.error("Error deleting data:", error);
            throw error; // Rethrow to allow caller to handle
        }
    }

    async drop(table) {
        try {
            if (this.db === 'gun') {
                let [hex, lens] = table.split('/')
                if (lens === undefined)
                    this.holosphere.deleteAllGlobal(table);
                else
                    this.holosphere.deleteAll(hex, lens);
                this.preloadedDB[table] = null;
            } else if (this.db === 'orbit' && this.preloadedDB[table] !== undefined) {
                console.log('Dropping ', table);
                await this.preloadedDB[table].drop();
                delete this.preloadedDB[table]; // Remove reference after dropping
            }
        } catch (error) {
            console.error("Error dropping table:", error);
            throw error; // Rethrow to allow caller to handle
        }
    }

    async put(table, data) {
        try {
            await this.open(table);
            if (this.db === 'gun') {
                return this.addGunDB(table, data);
            } else if (this.db === 'orbit') {
                return this.addOrbitDB(table, data);
                
            }
        } catch (error) {
            console.error("Error putting data:", error);
            throw error; // Rethrow to allow caller to handle
        }
    }

    async get(table, key) {    
        try {
            await this.open(table);
            if (this.db === 'gun') {
                return await this.getGunDB(table, key);
            } else if (this.db === 'orbit') {
                return this.getOrbitDB(table, key);
            }
        } catch (error) {
            console.error("Error getting data:", error);
            throw error; // Rethrow to allow caller to handle
        }
    }

    async getAll(table) {
        await this.open(table)
        try {
            if (this.db === 'gun')
                return this.getAllGunDB(table);
            if (this.db === 'orbit')
                return this.getAllOrbitDB(table);
        } catch (error) {
            throw error;
        }
    }

    async addOrbitDB(table, data) {
        var db
        if (this.preloadedDB[table] !== undefined) {
            db = this.preloadedDB[table]
        }
        else {
            db = await this.orbitdb.docstore(this.dbName + '/' + table, { indexBy: 'id' });
            await db.load();
        }
        const id = await db.put(data);
        return id;
    }

    async getOrbitDB(table, key) {
        var db
        if (this.preloadedDB[table] !== undefined) {
            db = this.preloadedDB[table]
        }
        else {
            db = await this.orbitdb.docstore(this.dbName + '/' + table, { indexBy: 'id' });
            await db.load();
        }
        const result = await db.get(key)[0];
        return result;
    }

    async getAllOrbitDB(table) {
        var db
        if (this.preloadedDB[table])
            db = this.preloadedDB[table]
        else {
            db = await this.orbitdb.docstore(this.dbName + '/' + table, { indexBy: 'id' });
            await db.load();
        }
        const result = await db.get('');
        return result;
    }

    async deleteOrbitDB(table, key) {
        var db
        if (this.preloadedDB[table])
            db = this.preloadedDB[table]
        else {
            db = await this.orbitdb.docstore(this.dbName + '/' + table, { indexBy: 'id' });
            await db.load();
        }
        const result = await db.del(key);
        return result
    }

    // ===========================      Gun Functions

    async addGunDB(table, data) {
        let [hex, lens] = table.split('/')
        if (lens === undefined)
            return this.holosphere.putGlobal(table, data);
        else
            return this.holosphere.put(hex, lens, data);
        return new Promise((resolve) => {
            this.gun.get(this.dbName + '/' + table).get(data.id).put(JSON.stringify(data), ack => {
                if (ack.err) {
                    console.error("Error adding data to GunDB:", ack.err);
                    resolve(null);
                } else {
                    resolve(ack.ok);
                }
            })
        })    
    }

    async getGunDB(table, key) {
        let [hex, lens] = table.split('/')
        if (lens === undefined)
            return this.holosphere.getGlobal(table, key);
        else
            return this.holosphere.get(hex, lens, key);
        return new Promise((resolve) => {
            // Use Gun to get the data
            this.gun.get(this.dbName + '/' + table).get(key).once((data, key) => {
                if (data) {
                    resolve(JSON.parse(data)); // Resolve the promise with the data if data is found
                } else {
                    resolve(null); // Reject the promise if no data is found
                }
            });
        });

    }


    async getAllGunDB( table) {
        let [hex, lens] = table.split('/')
        if (lens === undefined)
            return await this.holosphere.getAllGlobal(table);
        else
            return await this.holosphere.getAll(hex, lens);
        return new Promise(async (resolve, reject) => {
            let output = []
            let counter = 0
            this.gun.get(this.dbName + '/' + table).once((data, key) => {
                if (data) {
                    const maplenght = Object.keys(data).length - 1
                    this.gun.get(this.dbName + '/' + table).map().once(async (itemdata, key) => {
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

    // async getAllGunDB(table) {
    //     console.log('getAllGunDB:', table);
    //     return new Promise((resolve, reject) => {
    //         let allData = [];
    //         let dataStream = this.gun.get(this.dbName + '/' + table).map();
    //         let hasData = false;
    
    //         dataStream.once((data, key) => {
    //             if (data) {
    //                 hasData = true;
    //                 console.log(data)
    //                 try {
    //                     // Assuming the stored data is an object and not a string that needs JSON.parse()
    //                     if (data.payload)
    //                     allData.push(JSON.parse(data.payload));
    //                 } catch (parseError) {
    //                     console.error("Error parsing data:", parseError);
    //                     reject(parseError);
    //                 }
    //             }
    //         });
    
    //         setTimeout(() => {
    //             if (hasData) {
    //                 resolve(allData);
    //             } else {
    //                 // Handle the case where no data is found or the stream ends without data
    //                 console.log("No data found or end of data stream.");
    //                 resolve(allData); // Resolve with empty array if no data
    //             }
    //         }, 1000); // Adjust timeout as necessary based on application needs
    //     });
    // }

    // deleteAllGunDB(table) {
    //     return new Promise((resolve, reject) => {
    //             this.gun.get(this.dbName + '/'+ table).map().once((data, key) => {
    //                 //entities = data;
    //                 //const id = Object.keys(entities)[0] // since this would be in object form, you can manipulate it as you would like. 
    //                 this.gun.get(this.dbName + '/'+ table).put({ [key]: null })
    //             }).then(() => {
    //                 resolve(true)
    //             }
    //             ).catch((error) => {
    //                 console.log('Error deleting all data:', error)
    //                 resolve(false)
    //             } 
    //     );
    // }
    // )}
    
    deleteGunDB(table, key) {
        let [hex, lens] = table.split('/')
        console.log('deleteGunDB:', hex, lens, key);
        return this.holosphere.delete(hex, lens, key);
        return new Promise((resolve, reject) => {
            this.gun.get(this.dbName + '/' + table).get(key).put(null, ack => {
                if (ack.err) {
                    resolve(ack.err);
                } else {
                    resolve(ack.ok);
                }
            });
        });
    }
}

export default DB;