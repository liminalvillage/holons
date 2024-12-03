// Description: This file contains the DB class which is used to interact with the database.
import {
    create
} from 'ipfs';
import OrbitDB from 'orbit-db';
import HoloSphere from 'holosphere';

class DB {
    constructor(dbName) {
        this.orbitdb = null;
        this.dbName = dbName;
        this.preloadedDB = {};
        this.holosphere = new HoloSphere(dbName);
        this.db = 'gun'; // 'orbit' or 'gun' or 'both' (writing to both, reading from gun)
    }

    async init() {
        try {
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
            if (!this.preloadedDB[table] && this.db === 'orbit') {
                this.preloadedDB[table] = await this.orbitdb.docs(this.dbName + '/' + table, {
                    indexBy: 'id'
                });
                await this.preloadedDB[table].load();
                console.log('preloaded ', table);
                return this.preloadedDB[table];
            }
        
        } catch (error) {
            console.error("Error opening table:", error);
        }
    }

    async del(table, key) {
        try {
            if (this.db === 'gun') {
                const [hex, lens] = table.split('/');
                if (hex && lens) {
                    return this.holosphere.delete(hex, lens, key)
                }else 
                    return this.holosphere.deleteGlobal(table, key);
            } else if (this.db === 'orbit') {
                return this.deleteOrbitDB(table, key);
            }
        } catch (error) {
            console.error("Error deleting data:", error);
            throw error;
        }
    }

    async drop(table) {
        console.log('Dropping ', table);
        try {
            if (this.db === 'gun') {
                const [hex, lens] = table.split('/');
                if (hex && lens)
                    await this.holosphere.deleteAll(hex, lens);
                else
                    await this.holosphere.deleteAllGlobal(table);
            } else if (this.db === 'orbit' && this.preloadedDB[table] !== undefined) {
                await this.preloadedDB[table].drop();
                delete this.preloadedDB[table];
            }
        } catch (error) {
            console.error("Error dropping table:", error);
            throw error;
        }
    }
    
    async put(table, data) {
        try {
            await this.open(table);
            if (this.db === 'gun') {
                const [hex, lens] = table.split('/');
                if (hex && lens)
                    return this.holosphere.put(hex, lens, data);
                else
                    return this.holosphere.putGlobal(table, data);
            } else if (this.db === 'orbit') {
                return this.addOrbitDB(table, data);
            }
        } catch (error) {
            console.error("Error putting data:", error);
            throw error;
        }
    }

    async get(table, key) {
        try {
            await this.open(table);
            if (this.db === 'gun') {
                const [hex, lens] = table.split('/');
                if (hex && lens)
                    return this.holosphere.get(hex, lens, key);
                else
                    return this.holosphere.getGlobal(table, key);
            } else if (this.db === 'orbit') {
                return this.getOrbitDB(table, key);
            }
        } catch (error) {
            console.error("Error getting data:", error);
            throw error;
        }
    }

    async getAll(table) {
        await this.open(table);
        try {
            if (this.db === 'gun') {
                if (table.includes('/')) {
                    const [hex, lens] = table.split('/');
                    return await this.holosphere.getAll(hex, lens);
                } else {
                    return await this.holosphere.getAllGlobal(table);
                }
            } else if (this.db === 'orbit') {
                return this.getAllOrbitDB(table);
            }
        } catch (error) {
            console.error("Error in getAll:", error);
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
}

export default DB;