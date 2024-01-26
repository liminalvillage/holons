// Description: This file contains the DB class which is used to interact with the database.
import {
    create
} from 'ipfs';
import OrbitDB from 'orbit-db';
import GUN from 'gun';

class DB {
    constructor(dbName) {
        this.orbitdb = null;
        this.gun = null;
        this.dbName = dbName;
        this.preloadedDB = {};
        this.db = 'orbit';
    }

    async init() {
        //if (this.db === 'orbit') {
            this.ipfs = await create({
                address: "127.0.0.1",
                port: 5001,
                source: 'js-ipfs',
                repo: 'orbitdb'
            })

            this.orbitdb = await OrbitDB.createInstance(this.ipfs)

            const options = {
                // Setup write access
                accessController: {
                    write: [
                        // Give access to ourselves
                        this.orbitdb.identity.id,
                        // Give access to the second peer
                        //'042c07044e7e51a489c02854db5e09f0191690dc59db0afd95328c9db614a2976e088cab7c86d7e48183191258fc59dc699653508ce25bf0369d67f33d5d77839',
                    ]
                }
            }
        //} else if (this.db === 'gun') {
            // Initialize a GUN instance
            this.gun = GUN({
                peers: ['https://59.src.eco/gun']
            });
       // }
    }

    async delete(table, key) {
        if (this.db === 'gun')
            return this.deleteGunDB(table, key)
        if (this.db === 'orbit')
            return this.deleteOrbitDB(table, key)
    }

    async docs(table, options = {}) {
        //if (this.orbitdb) {
           return await this.orbitdb.docs(table, {
            indexBy: 'id',
            ...options
        })
        //}
        return this.gun.get(table)
    }

    async preload(table) {
        if (this.db === 'gun')
            return this.gun.get(this.dbName).get(table)
        if (this.db === 'orbit') {
            this.preloadedDB[table] = await this.orbitdb.docs(this.dbName + '.' + table, {
                indexBy: 'id'
            })
            await this.preloadedDB[table].load()
        }
        return this.preloadedDB[table]
    }


    async put(table, data) {
        if (this.db === 'gun')
            return this.addGunDB(table, data);
        if (this.db === 'orbit')
            return this.addOrbitDB(table, data);
    }

    async get(table, key) {
        try {
            if (this.db === 'gun')
                return this.getGunDB(table, key);
            if (this.db === 'orbit')
                return this.getOrbitDB(table, key);
        } catch (error) {
            throw error;
        }
    }

    async getAll(table) {
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
        if (this.preloadedDB[table]!==undefined){
            db = this.preloadedDB[table]
        }
        else {
            db = await this.orbitdb.docstore(this.dbName + '.' + table, { indexBy: 'id' });
            await db.load();
        }
        const id = await db.put(data);
        return id;
    }

    async getOrbitDB(table, key) {
        var db
        if (this.preloadedDB[table]!== undefined){
            db = this.preloadedDB[table]
        }
        else {
            db = await this.orbitdb.docstore(this.dbName + '.' + table, { indexBy: 'id' });
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
            db = await this.orbitdb.docstore(table, { indexBy: 'id' });
            await db.load();
        }
        const result = await db.get('');
        return result;
    }

    deleteOrbitDB(table, key) {
        return new Promise((resolve, reject) => {
            this.db.del(key, ack => {
                if (ack.err) {
                    reject(ack.err);
                } else {
                    resolve(ack.ok);
                }
            });
        });
    }

    // Gun Functions

    async addGunDB(table, data) {
        console.log('addGunDB:', table, data)
        this.gun.get(this.dbName).get(table).put(JSON.stringify(data)) //todo store entire object

    }

    async getGunDB(table, key) {
        console.log('getGunDB:', table)
        this.gun.get(this.dbName).get(table).get(key).once((data, key) => {
            if (!data) {
                reject(new Error(`No data found for key: ${key}`));
            } else {
                console.log('getGunDB - data:', data)
                return JSON.parse(data);
            }
        })

    }



    async getAllGunDB(table) {
        console.log('getAllGunDB:', table)
        return this.gun.get(this.dbName).get(table).once((data, key) => {
            if (!data) {
                reject(new Error(`No data found for key: ${key}`));
            } else {
                console.log('getAllGunDB - data:', data)
                return JSON.parse(data);
            }
        })
    }

    deleteGunDB(table, key) {
        return new Promise((resolve, reject) => {
            this.gun.get(table).get(key).put(null, ack => {
                if (ack.err) {
                    reject(ack.err);
                } else {
                    resolve(ack.ok);
                }
            });
        });
    }




}

export default DB;