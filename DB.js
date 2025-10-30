// Description: This file contains the DB class which is used to interact with the database.
import {HoloSphere} from 'holosphere';

class DB {
    constructor(dbName) {
        this.gun = null;
        this.dbName = dbName;
        this.preloadedDB = {};
        this.holosphere = new HoloSphere({
            appName: dbName,
            logLevel: 'WARN'
        });
       
        
        this.db = 'gun'; // 'orbit' or 'gun' or 'both' (writing to both, reading from gub)
    }

    async init() {
        try {
            this.gun = this.holosphere.gun;
        } catch (error) {
            console.error("Error initializing database:", error);
        }
    }



    async del(table, key) {
        try {
            return this.deleteGunDB(table, key);
        } catch (error) {
            console.error("Error deleting data:", error);
            throw error; // Rethrow to allow caller to handle
        }
    }

    async drop(table) {
        try {
            let [hex, lens] = table.split('/')
            if (lens === undefined)
                this.holosphere.deleteAllGlobal(table);
            else
                this.holosphere.deleteAll(hex, lens);
        } catch (error) {
            console.error("Error dropping table:", error);
            throw error; // Rethrow to allow caller to handle
        }
    }

    async put(table, data) {
        try {
            return this.addGunDB(table, data);
        } catch (error) {
            console.error("Error putting data:", error);
            throw error; // Rethrow to allow caller to handle
        }
    }

    async get(table, key) {    
        try {
            return await this.getGunDB(table, key);
        } catch (error) {
            console.error("Error getting data:", error);
            throw error; // Rethrow to allow caller to handle
        }
    }

    async getAll(table) {
        try {
            return this.getAllGunDB(table);
        } catch (error) {
            throw error;
        }
    }

    // ===========================      Gun Functions

    async addGunDB(table, data) {
        let [hex, lens] = table.split('/')
        if (lens === undefined)
            return this.holosphere.putGlobal(table, data);
        else
            return this.holosphere.put(hex, lens, data);
    }

    async getGunDB(table, key) {
        let [hex, lens] = table.split('/')
        if (lens === undefined)
            return this.holosphere.getGlobal(table, key);
        else
            return this.holosphere.get(hex, lens, key);
    }

    async getAllGunDB(table) {
        let [hex, lens] = table.split('/')
        if (lens === undefined)
            return await this.holosphere.getAllGlobal(table);
        else
            return await this.holosphere.getAll(hex, lens);
    }
    
    deleteGunDB(table, key) {
        let [hex, lens] = table.split('/')
        console.log('deleteGunDB:', hex, lens, key);

        if (lens === undefined) // TODO: this is a hack to get the lens and key from the key. Refactor from scheduler
            [lens,key] = key.split('_')
        return this.holosphere.delete(hex, lens, key);
    }
}

export default DB;