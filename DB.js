import config from "./config.json" assert { type: "json" };

import { create } from 'ipfs';
import OrbitDB from 'orbit-db';
import GUN from 'gun';

class DB {
    constructor(dbName) {
        this.orbitdb = null;
        this.gun = null;
        this.dbName = dbName;
        this.db = 'orbit';
    }

    async init() {
        if (this.db === 'orbit') {
            this.ipfs = await create({ address: "127.0.0.1", port: 5001, source: 'js-ipfs', repo: 'orbitdb' })
            
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
        }
        else if (this.db === 'gun') {
            // Initialize a GUN instance
            this.gun = GUN({ peers: ['https://59.src.eco/gun'] });
        }
    }

    async delete(table, key) {
        if (this.db === 'gun')
            return this.deleteGunDB(table, key)
        if (this.db === 'orbit')
            return this.deleteOrbitDB(table, key)
    }

    async docs(table, options = {}) {
        //if (this.orbitdb) {
        //    return await this.orbitdb.docs(table, options)
       // }
        // return this.gun.get(table)
         return await this.orbitdb.docs(table, options)
    }


    async put(data) {
        let table = this.dbName + '.settings'
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

    async addOrbitDB(table, data) {
        var db = await this.orbitdb.docstore(table);
        await db.load();
        const id = await db.put(data);
        return id;
    }

    async getOrbitDB(table, key) {
        var db = await this.orbitdb.docstore(table);
        await db.load();
        const result = await this.db.get(key);
        return result;
    }

    // Gun Functions

    async addGunDB(table, data) {
        console.log('addGunDB:', table, data)
        this.gun.get(table).get(data._id).put(data) //todo store entire object

    }

    getGunDB(table) {
        console.log('getGunDB:', table)
        return new Promise((resolve, reject) => {
            this.gun.get(table).map((data, key) => {
                if (!data) {
                    reject(new Error(`No data found for key: ${key}`));
                } else {
                    console.log('getGunDB - data:', data)
                    resolve(data);
                }
            });
        });
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


}

export default DB;