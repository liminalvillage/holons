// Description: fetches holon info from different sources
import Home from '../home.json'

async function fetchContributors (id) {
    // fetch(id, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'text/plain',
    //     'Accept': 'application/vnd.github.v3+json'
    //   }
    // })
    //   .then(response => response.json()) // Converting the response to a JSON object
    //   .then(data => document.body.append())
    //   .catch(error => console.error(error))

    var r = await fetch(id, {
      method: 'GET',
      headers: {
        'Content-Type': 'text/plain',
        'Accept': 'application/vnd.github.v3+json'
      }
    })
    console.log('Found contributors: ' + r.json())
    return r.json()
  }

  async function fetchProjectInfo (address) {
    // parse project.json file
    var dependencies
    var json = {}
    json.holons = dependencies.map((dep, index) => {
      // var name = holon.methods.toName(dep).call()
      return { 'id': dep, 'label': name }
    })
    json.id = address
    // check ens
  // assemble info from package / npm
  // https://opencollective.com/opencollective-oss/members/all.json
  // https://api.github.com/repos/Ad4m/Ad4m/contributors
  }

  async function fetchNpmInfo (address) {}

  async function fetchGithubInfo (address) {}

  let ipfs
  let orbitdb

  async function fetchOrbitInfo (address) {
    // load orbitdb
    var holon = {}

      // Create / Open a OrbitDB doc store
    //let users = await db.docstore("WeQuest." + address + ".users");
    if (!ipfs){
      const ipfsOptions = {
        repo: './ipfs',
        EXPERIMENTAL: {
          pubsub: true,
        },
        start: true,
        create: true,
        config: {
          Addresses: {
            Swarm: [
              // Use IPFS dev webrtc signal server
              //'/dns4/ws-star.discovery.libp2p.io/tcp/443/wss/p2p-websocket-star'
              // '/dns4/wrtc-star1.par.dwebops.pub/tcp/443/wss/p2p-webrtc-star/',
              // '/dns4/wrtc-star2.sjc.dwebops.pub/tcp/443/wss/p2p-webrtc-star/',
              // '/dns4/webrtc-star.discovery.libp2p.io/tcp/443/wss/p2p-webrtc-star/',
            ],
          },
        },
      }
      ipfs = await window.Ipfs.create(ipfsOptions)
      orbitdb = await window.OrbitDB.createInstance(ipfs)
    }
   
    console.log('Loading: ' + address)
    let users = await orbitdb.open('orbitdb/12D3KooWGP6mfNK6JhvDye7ofAGwNPiAR6Fg9xXupKYdNZ9wnfcK/'+address)
    //let users = await orbitdb.docs(address);
    console.log('Loaded: ' + address)
    await users.load();

    holon.id = address
    holon.name = address
    holon.description = address
    let members = await users.get('')
    console.log(members)
    holon.holons = members.map((member, index) => {
      //var name = holon.methods.toName(member).call()
      label = member.username
      return { 'id': member, 'label': name }
    })
    return holon

  }

  async function fetchEthInfo (address) { // compiles a compatible JSON from blockchain information at address
    var json = {}
    let web3 = new Web3(new Web3.providers.WebsocketProvider('wss://ropsten.infura.io/ws/v3/966b62ed84c84715bc5970a1afecad29'))
    // check if it is an holon
    const code = await web3.eth.getCode(address)
    if (code === '0x') {
      console.log(address + 'is NOT an holon')
      json.id = address
      json.name = address // check ens
      json.description = address
      // json.image = 'https://ipfs.3box.io/profile?address=' + address // check 3box
    } else {
      let holon = new web3.eth.Contract(contractdata.abi, address)
      // const totalappreciation = await holon.methods.totalappreciation().call()
      // console.log(totalappreciation)
      // var name = holon.methods.toName(address).call()
      // console.log(name)
      json.id = address
      json.name = await holon.methods.name().call()
      var members = await holon.methods.listMembers().call()
      if (members) {
        json.holons = members.map((member, index) => {
          var name = holon.methods.toName(member).call()
          return { 'id': member, 'label': name }
        })
      }
    }
    return json
    // check if it is a holon from ethereum
    // check if it is a dao from the graph
    // compile jsos
  } 

 export  async function fetchInfo (address) { // returns json containing info of the holon passedd in
    console.log('Requesting: ' + address)
    var type = 'N/A'
    var json = { 'id': address, 'url': address, 'name': 'n/a', 'image': 'notfound.jpg' }
    var base = ''
    var file = 'holon.json'
    var url = address
    var pathArray
    var fetchaddress

    // =================== ADDRESS IS EMPTY
    if (address === ''|| address === 'home '|| address === undefined || address === null) {
        json = Home
        return { json, type }
      }
    // ===================================
    if (address.includes('github.com')) { // GITHUB ADDRESS
      type = 'GITHUB'
      url = new URL(address)
      pathArray = url.pathname.split('/')
      base = 'https://raw.githubusercontent.com/' + pathArray[1] + '/' + pathArray[2] + '/master/'
      file = url.pathname.slice(url.pathname.indexOf(pathArray[2]) + pathArray[2].length + 1)
      fetchaddress = base + file
    } else if (address.includes('githubusercontent')) { // GITHUB ADDRESS
      type = 'GITHUB CONTENT'
      fetchaddress = address
    } else if (address.includes('gitlab')) { // GITLAB ADDRESS
      type = 'GITLAB'
      url = new URL(address)
      pathArray = url.pathname.split('/')
      base = 'https://gitlab.com/' + pathArray[1] + '/' + pathArray[2] + '/-/raw/master/'
      file = url.pathname.slice(url.pathname.indexOf(pathArray[2]) + pathArray[2].length + 1)
      fetchaddress = base + file
    } else if (address.startsWith('http')) { // WEB ADDRESS
      type = 'WEB'
      // if (!address.endsWith('.json')) address += '/murmurations.json'
      fetchaddress = 'https://api.allorigins.win/get?url=' + address
    } else if (address.startsWith('0x')) { // ETHEREUM ADDRESS
      type = 'ETHEREUM'
      json = await fetchEthInfo(address)
      return { json, type }
      // var contract = new web3.eth.Contract(abi, '0x6B175474E89094C44Da98b954EedeAC495271d0F')
      // contract.methods.balanceOf('0x96bB7B429cF97131E624Fa32d27B45595d59b5B8').call().then(console.log)
      // (query ethereum and the graph)
    } else if (address.match(/[0-9A-Fa-f]{47}/g)) { //  IPFS ADDRESS
      type = 'IPFS'
      fetchaddress = 'https://ipfs.io/ipfs/' + address
    // } else if (address.match(/[0-9A-Za-z]{3,}/g)) { // NPM NAME
    //   type = 'NPM'
    //   fetchaddress = 'https://registry.npmjs.org/' + address
    }else  if (address.match(/^[0-9]+$/)|| address.startsWith('WeQuest.') || address.startsWith('Holons.')) { // ORBITDB ADDRESS
      type = 'ORBITDB'
      fetchaddress = address
      json = await  fetchOrbitInfo(address)
      return { json, type }
    } else if (address.startsWith('./') || address.startsWith('/') || address.match(/[0-9A-Za-z]/)) { // RELATIVE ADDRESS
    type = 'RELATIVE'
    //pathArray = this.$route.path.split('/') // source absolute path info from route
    //base = 'https://raw.githubusercontent.com/' + pathArray[1] + '/' + pathArray[2] + '/master/'
    //file = this.$route.path.slice(this.$route.path.indexOf(pathArray[2]) + pathArray[2].length + 1)
    //console.log(this.$route.path)
    fetchaddress = base + file.slice(0, file.lastIndexOf('/') + 1) + address
    } else { // not know what to do, assume fetched from github
      type = 'NONE'
      //base = 'https://raw.githubusercontent.com/' + this.$route.params.org + '/' + this.$route.params.repo + '/master/'
      //file = this.$route.params.file
      fetchaddress = base + file
    }
    if (!fetchaddress) return { json, type }
    if (fetchaddress.endsWith('/')) { fetchaddress += 'holon.json' }
    if (!fetchaddress.endsWith('.json')) { fetchaddress += '.json' }
    
    console.log('Fetching: ' + fetchaddress + ' - ' + type)
   
    var r = await fetch(fetchaddress)
    if (r.ok) {
      json = await r.json().catch(() => {
        console.log(fetchaddress + ' is not in a valid JSON format')
        return { json, type }
      })
      if (type === 'WEB' && json.contents.startsWith('{')) {
        // parse returned web value (from cors proxy)
        json = JSON.parse(json.contents)
      }
      json.url = fetchaddress
      return { json, type }
    } else {
      // try again with package.json
      // if (!fetchaddress.endsWith('package.json')) {
      //   return this.fetchInfo(fetchaddress.slice(0, fetchaddress.lastIndexOf('/')) + 'package.json')
      // } else {
      type = 'N/A'
      console.log(address + ' not found')
      return { json, type }
      // }
    }
  }

