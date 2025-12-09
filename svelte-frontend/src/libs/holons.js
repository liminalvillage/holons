// Description: fetches holon info from different sources
import Home from '../home.json';

// HoloSphere integration - dynamic import to handle missing module gracefully
let hs = null;

async function initHoloSphere() {
  if (hs) return hs;
  try {
    const HoloSphere = await import('holosphere');
    hs = new HoloSphere.default("Holons");
  } catch (e) {
    console.warn('HoloSphere not available, using fallback');
    hs = {
      get: async () => []
    };
  }
  return hs;
}

export async function fetchHolon(id, lense) {
  await initHoloSphere();
  // Placeholder for holon fetching logic
  return null;
}

export async function fetchContributors(id) {
  try {
    const r = await fetch(id, {
      method: 'GET',
      headers: {
        'Content-Type': 'text/plain',
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    console.log('Found contributors: ' + r.json());
    return r.json();
  } catch (e) {
    console.error('Error fetching contributors:', e);
    return [];
  }
}

export async function fetchProjectInfo(address) {
  // parse project.json file
  let dependencies = [];
  let json = {};
  json.holons = dependencies.map((dep, index) => {
    return { 'id': dep, 'label': dep };
  });
  json.id = address;
  return json;
}

export async function fetchNpmInfo(address) {
  return {};
}

export async function fetchGithubInfo(address) {
  return {};
}

let ipfs = null;
let orbitdb = null;

export async function fetchOrbitInfo(address) {
  // load orbitdb
  let holon = {};

  if (!ipfs && typeof window !== 'undefined' && window.Ipfs) {
    const ipfsOptions = {
      repo: './ipfs',
      EXPERIMENTAL: {
        pubsub: true,
      },
      start: true,
      create: true,
      config: {
        Addresses: {
          Swarm: [],
        },
      },
    };
    ipfs = await window.Ipfs.create(ipfsOptions);
    orbitdb = await window.OrbitDB.createInstance(ipfs);
  }

  if (!orbitdb) {
    console.warn('OrbitDB not available');
    return { id: address, name: address, description: address, holons: [] };
  }

  console.log('Loading: ' + address);
  let users = await orbitdb.open('orbitdb/12D3KooWGP6mfNK6JhvDye7ofAGwNPiAR6Fg9xXupKYdNZ9wnfcK/' + address);
  console.log('Loaded: ' + address);
  await users.load();

  holon.id = address;
  holon.name = address;
  holon.description = address;
  let members = await users.get('');
  console.log(members);
  holon.holons = members.map((member, index) => {
    return { 'id': member, 'label': member.username || member.name || member.id };
  });
  return holon;
}

export async function fetchEthInfo(address) {
  // compiles a compatible JSON from blockchain information at address
  let json = {};

  try {
    // Dynamic import of web3
    const Web3Module = await import('web3');
    const Web3 = Web3Module.default || Web3Module;

    let web3 = new Web3(new Web3.providers.WebsocketProvider('wss://ropsten.infura.io/ws/v3/966b62ed84c84715bc5970a1afecad29'));

    // check if it is an holon
    const code = await web3.eth.getCode(address);
    if (code === '0x') {
      console.log(address + ' is NOT an holon');
      json.id = address;
      json.name = address; // check ens
      json.description = address;
    } else {
      // Note: contractdata.abi would need to be imported
      json.id = address;
      json.name = address;
      json.holons = [];
    }
  } catch (e) {
    console.error('Web3 error:', e);
    json.id = address;
    json.name = address;
    json.description = address;
  }

  return json;
}

export async function fetchInfo(address, lense) {
  // returns json containing info of the holon passed in
  console.log('Requesting: ' + address);
  let type = 'N/A';
  let json = { 'id': address, 'url': address, 'name': 'n/a', 'image': 'notfound.jpg' };
  let base = '';
  let file = 'holon.json';
  let url = address;
  let pathArray;
  let fetchaddress;

  // =================== ADDRESS IS EMPTY
  if (address === '' || address === 'home ' || address === undefined || address === null) {
    json = Home;
    return { json, type };
  }

  // Check if address is made of just numbers
  if (address.match(/[0-9]{9}/g) || address.match(/-[0-9]{13}/g)) {
    type = 'HOLON';
    json = await fetchHolon(address, lense);
    return { json, type };
  } else if (address.includes('github.com')) {
    // GITHUB ADDRESS
    type = 'GITHUB';
    url = new URL(address);
    pathArray = url.pathname.split('/');
    base = 'https://raw.githubusercontent.com/' + pathArray[1] + '/' + pathArray[2] + '/master/';
    file = url.pathname.slice(url.pathname.indexOf(pathArray[2]) + pathArray[2].length + 1);
    fetchaddress = base + file;
  } else if (address.includes('githubusercontent')) {
    // GITHUB CONTENT ADDRESS
    type = 'GITHUB CONTENT';
    fetchaddress = address;
  } else if (address.includes('gitlab')) {
    // GITLAB ADDRESS
    type = 'GITLAB';
    url = new URL(address);
    pathArray = url.pathname.split('/');
    base = 'https://gitlab.com/' + pathArray[1] + '/' + pathArray[2] + '/-/raw/master/';
    file = url.pathname.slice(url.pathname.indexOf(pathArray[2]) + pathArray[2].length + 1);
    fetchaddress = base + file;
  } else if (address.startsWith('http')) {
    // WEB ADDRESS
    type = 'WEB';
    fetchaddress = 'https://api.allorigins.win/get?url=' + address;
  } else if (address.startsWith('0x')) {
    // ETHEREUM ADDRESS
    type = 'ETHEREUM';
    json = await fetchEthInfo(address);
    return { json, type };
  } else if (address.match(/[0-9A-Fa-f]{47}/g)) {
    // IPFS ADDRESS
    type = 'IPFS';
    fetchaddress = 'https://ipfs.io/ipfs/' + address;
  } else if (address.match(/^[0-9]+$/) || address.startsWith('Holons.')) {
    // ORBITDB ADDRESS
    type = 'ORBITDB';
    fetchaddress = address;
    json = await fetchOrbitInfo(address);
    return { json, type };
  } else if (address.startsWith('./') || address.startsWith('/') || address.match(/[0-9A-Za-z]/)) {
    // RELATIVE ADDRESS
    type = 'RELATIVE';
    fetchaddress = base + file.slice(0, file.lastIndexOf('/') + 1) + address;
  } else {
    // not known what to do, assume fetched from github
    type = 'NONE';
    fetchaddress = base + file;
  }

  if (!fetchaddress) return { json, type };
  if (fetchaddress.endsWith('/')) {
    fetchaddress += 'holon.json';
  }
  if (!fetchaddress.endsWith('.json')) {
    fetchaddress += '.json';
  }

  console.log('Fetching: ' + fetchaddress + ' - ' + type);

  try {
    const r = await fetch(fetchaddress);
    if (r.ok) {
      json = await r.json().catch(() => {
        console.log(fetchaddress + ' is not in a valid JSON format');
        return { json, type };
      });
      if (type === 'WEB' && json.contents && json.contents.startsWith('{')) {
        // parse returned web value (from cors proxy)
        json = JSON.parse(json.contents);
      }
      json.url = fetchaddress;
      return { json, type };
    } else {
      type = 'N/A';
      console.log(address + ' not found');
      return { json, type };
    }
  } catch (e) {
    console.error('Fetch error:', e);
    return { json, type };
  }
}

// Get HoloSphere instance
export async function getHoloSphere() {
  return await initHoloSphere();
}
