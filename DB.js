const IPFS = require('ipfs');
const OrbitDB = require('orbit-db');
const GUN = require('gun');

export default class DB {
    constructor(dbName) {
        this.dbName = dbName;
        this.orbitdb = null;
        this.gun = null;

    }

    async init() {
        let ipfs = await create({ address: "127.0.0.1", port: 5001, source: 'js-ipfs', repo: 'orbitdb' })
        this.orbitdb = await OrbitDB.createInstance(ipfs)

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