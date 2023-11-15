import { create } from 'ipfs';
import OrbitDB from 'orbit-db';

// IPFS options for enabling pubsub and setting up a discovery mechanism
const ipfsOptions = {
  relay: { enabled: true, hop: { enabled: true, active: true } },
  config: {
    Addresses: {
      Swarm: [
        // // Use these to connect to the default IPFS network if you're not connecting to a local daemon
        // '/dns4/wrtc-star1.par.dwebops.pub/tcp/443/wss/p2p-webrtc-star',
        // '/dns4/wrtc-star2.sjc.dwebops.pub/tcp/443/wss/p2p-webrtc-star',
        
        //'/ip4/134.122.63.89/tcp/4002/p2p/12D3KooWGP6mfNK6JhvDye7ofAGwNPiAR6Fg9xXupKYdNZ9wnfcK'
        // // You can add additional multiaddresses here to connect directly to known nodes
      ],
    },
  },
  EXPERIMENTAL: {
    pubsub: true,
  },
};

async function main() {
  try {
    // Create IPFS instance with the specified config
    const ipfs = await create(ipfsOptions);

    // Create OrbitDB instance
    const orbitDB = await OrbitDB.createInstance(ipfs);

    // The address of the remote OrbitDB instance you want to connect to
    const remoteDbAddress = '/orbitdb/12D3KooWGP6mfNK6JhvDye7ofAGwNPiAR6Fg9xXupKYdNZ9wnfcK/WeQuest.-1001949585888.users';

    // Open the remote database with write access
    const db = await orbitDB.open(remoteDbAddress, {
      // Options for the docstore
      indexBy: '_id',
      type: 'docstore',
      create: true,
      sync: true,
    });

    // Load the database
    await db.load();

    // Fetch all documents from the docstore
    for(let i = 0; i < 100; i++) {
      await db.put({
        _id: i.toString(),
        name: 'Alice',
        address: 'Main St. 1',
      });
    }
    const allDocs = await db.get('');
    console.log(allDocs);
  } catch (error) {
    console.error('An error occurred:', error);
  }
}

main();