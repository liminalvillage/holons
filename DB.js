const IPFS = require('ipfs');
const OrbitDB = require('orbit-db');
const GUN = require('gun');

class DB {
    constructor(dbName) {
        this.dbName = dbName;
        this.orbitdb = null;
        this.gun = null;
    }

    async init() {
        const ipfsOptions = {
            EXPERIMENTAL: {
                pubsub: true,
            },
        };

        const ipfs = await IPFS.create(ipfsOptions);
        this.orbitdb = await OrbitDB.createInstance(ipfs);

        // Create / Open a OrbitDB doc store
        this.orbitDoc = await this.orbitdb.docstore(this.dbName);

        // Initialize a GUN instance
        this.gun = GUN();
    }

    async addOrbitDB(data) {
        const id = await this.orbitDoc.put(data);
        return id;
    }

    async getOrbitDB(_id) {
        const result = await this.orbitDoc.get(_id);
        return result;
    }

    addGunDB(key, data) {
        return new Promise((resolve, reject) => {
            this.gun.get(this.dbName).get(key).put(data, ack => {
                if (ack.err) {
                    reject(ack.err);
                } else {
                    resolve(ack.ok);
                }
            });
        });
    }

    getGunDB(key) {
        return new Promise((resolve, reject) => {
            this.gun.get(this.dbName).get(key).val((data, key) => {
                if (!data) {
                    reject(new Error(`No data found for key: ${key}`));
                } else {
                    resolve(data);
                }
            });
        });
    }

    async add(data) {
        await this.addOrbitDB(data);
        await this.addGunDB(data._id, data);
    }

    async get(_id) {
        try {
            const dataOrbit = await this.getOrbitDB(_id);
            const dataGun = await this.getGunDB(_id);
            // You might want to handle any conflicts or differences between the data here
            return dataOrbit || dataGun;
        } catch (error) {
            throw error;
        }
    }
}

module.exports = DB;