<template>

   <z-view
      >
    <div slot="default" style="width:85%;margin:5%;">
      <h1>{{name}}</h1>
      <small v-if="type == 'ETHEREUM'">{{this.id}}</small>
      <br/>
      <button v-if="type == 'ETHEREUM'" @click="sendFunds(this.id)">Send Funds</button> <br/>
      <!-- <button v-if="type == 'ETHEREUM'" @click="sendFunds(this.id)">Purchase Product</button> -->
      <!-- <i v-if="quote">"{{quote}}"</i>
      <br/>
      <br/>
      <i><b>{{quoteauthor}}</b></i> -->
    </div>
    <div slot="default" style="width:85%;margin:5%;"> <vue-markdown :source="this.description"></vue-markdown></div>
    <div slot="extension">
      <z-dialog
        :title="name"
        :width="600"
        :height="600"
        :content="description"
        :open="dialog"
        @close="dialog = false"
        v-if="dialog"
        >
          <z-spot
            button
            slot="extension"
            :angle=45
            size='small'
            @click.native='dialog = false'>
            Close
          </z-spot>
          <!-- default slot-->
          Not implemented (yet!)
          Please copy an holon.json file from existing holons and save it in your own location (e.g. github)

        </z-dialog>
      <z-spot v-if="type == 'PROJECT'"
       label="Contributors"
       :distance="100"
       :angle="100"
       label-pos="bottom"
      >
      </z-spot>
      <z-spot v-if="type == 'PROJECT'"
       label="Dependencies"
       :distance="100"
       label-pos="bottom"
       :angle="200"
      >
      </z-spot>
      <z-spot v-for="(holon,index) in holons" :key="holon.id"
      :knob="editing ? true : false"
      @click.native= "holonsvalues[index]? normalize(index) : ''"
      :qty.sync="holonsvalues[index]"
      :label="holonslabels[index]"
      :progress="parseInt(holon.value)"
      :angle=" 200 - (index * (220./(holons.length >1 ? holons.length - 1 : 1)))"
      size="m"
      :distance="130"
      :label-pos="index>=holons.length/2?'right':'left'"
      :to-view="editing ? '': {name:'holon', params: {id: holon.id}}"
       >
       <!-- :style="[{backgroundImage:`url(${holonsimages[index]})`},{backgroundSize: `100% 100%`},{backgroundRepeat: `no-repeat`},{backgroundPosition: `center`},{borderWidth:'$(holonsvalues[index])px'}]"
      -->
      <img v-if=holonsimages[index] :src="`${holonsimages[index]}`" style="width: 100%; opacity:0.4;" onerror="this.style.display='none'"/>
       <!-- :imagePath = "holonsimages[index]?'./images/'+ holonsimages[index]:''" -->
      </z-spot>
      <!-- settings-->
      <!-- <z-spot
        :angle="270"
        :distance="140"
        size="s"
        label="Settings"
        to-view="settings">
        <i class="fas fa-sliders-h"></i>
      </z-spot> -->
      <!-- Edit signals -->
       <z-spot
        button
        :angle ="270"
        :distance ="125"
        size ="s"
        :label ="editing ? 'Save' : 'Edit'"
        label-pos = 'top'
        @click.native="editing ? editing = false : editing = true">
        <i v-if="editing" class="fas fa-save"></i>
        <i v-else class="fas fa-edit"></i>
      </z-spot>
      <z-spot v-if="url"
        button
        :angle ="250"
        :distance ="125"
        size ="s"
        label ="Website"
        label-pos = 'top'
        @click.native ="goToSite(url)"
        >
        <i class="fab fa-github"> </i>
      </z-spot>
      <z-spot
        button
        :angle="290"
        :distance="125"
        size="s"
        label-pos = 'top'
        label="Comms"
         @click.native ="openComms">
        <i class="fas fa-video"> </i>
      </z-spot>
      <!-- ------------------------- Add Button ------------------------- -->
      <z-spot
        button
        :angle="90"
        :distance="100"
        size="s"
        label-pos = 'top'
        label="Add"
        @click.native="add()">
        <i class="fas fa-plus"> </i>
      </z-spot>
    </div>

  </z-view>
</template>

<script>

import VueMarkdown from 'vue-markdown'
import Home from '../home.json'
// import web3 from '../libs/web3.js'
import Web3 from 'web3'
// import abi from '../abi.json'
import * as contractdata from '../ContractData.json'
export default {
  watch: {
    // holons: function () {
    //   console.log('called! ' + this.holons.length)
    // },
    // deep: true,

    $route (to, from) {
      console.log(to)
      console.log(from)
    }
  },
  components: {
    VueMarkdown
  },
  methods: {
    openComms () {
      console.log('emitting ' + this.id)
      this.$emit('opencomms', this.id)
    },
    sendFunds (address, amount) {
      console.log(address)
      console.log(amount)
      // web3.eth.sendTransaction({from:web3.defaultAccount ,to:address, value:web3.utils.toWei(amount, "ether")})
      // this.closeAddAppreciationModal()
    },
    sendERC20 (tokenaddress, address, amount) {
      console.log(address)
      console.log(amount)
      // web3.eth.sendTransaction({from:web3.defaultAccount ,to:address, value:web3.utils.toWei(amount, "ether")})
      // this.closeAddAppreciationModal()
    },
    confirm () {
      this.showConfirmModal = false
      this.showModal = false
    },
    add () {
      console.log('Add holon invoked' + this.showModal)
      this.showModal = true
      this.dialog = true
    },
    goToSite (address) {
      console.log('Go to Site:' + address)
      return window.open(address, '_blank')
    },
    async initWeb3 () {
      this.web3 = new Web3(new Web3.providers.WebsocketProvider('wss://ropsten.infura.io/ws/v3/966b62ed84c84715bc5970a1afecad29'))
      // this.web3.eth.getAccounts(console.log)
    },
    // async getPerspectives () {
    //   const uri = 'ws://localhost:4000/graphql'
    //   const apolloClient = new ApolloClient({
    //     link: new WebSocketLink({
    //       uri,
    //       options: { reconnect: true }
    //     }),
    //     cache: new InMemoryCache({ resultCaching: false, addTypename: false }),
    //     defaultOptions: {
    //       watchQuery: { fetchPolicy: 'no-cache' },
    //       query: { fetchPolicy: 'no-cache' }
    //     }
    //   })
    //   var ad4mClient = new Ad4mClient(apolloClient)

    //   this.perspectives = await ad4mClient.perspective.all()
    //   await this.perspectives[0].add(new Link({ source: 'test', target: 'Qmd6AZzLjfGWNAqWLGTGy354JC1bK26XNf7rTEEsJfv7Fe://QmXA9hca9NKoJ8dZJR5dtHpPsWVm66qbE4jmZ6x6vyEQsL' }))
    //   console.log(this.perspectives[0].uuid)
    // },
    async fetchContributors (id) {
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
    },
    async fetchProjectInfo (address) {
    // assemble info from package / npm
    },
    async fetchEthInfo (address) { // compiles a compatible JSON from blockchain information at address
      var json = {}
      this.web3 = new Web3(new Web3.providers.WebsocketProvider('wss://ropsten.infura.io/ws/v3/966b62ed84c84715bc5970a1afecad29'))
      // check if it is an holon
      const code = await this.web3.eth.getCode(address)
      if (code === '0x') {
        console.log(address + 'is NOT an holon')
        json.id = address
        json.name = address // check ens
        json.description = address
        // json.image = 'https://ipfs.3box.io/profile?address=' + address // check 3box
      } else {
        let holon = new this.web3.eth.Contract(contractdata.abi, address)
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
    },
    async fetchInfo (address) { // returns json containing info of the holon passedd in
      console.log('Requesting: ' + address)
      var type = 'N/A'
      var json = { 'id': address, 'url': address, 'name': 'n/a', 'image': 'notfound.jpg' }
      var base = ''
      var file = 'holon.json'
      var url = address
      var pathArray
      var fetchaddress

      // =================== ADDRESS IS EMPTY
      if (address === '') {
        if (this.$route.params.address) {
          address = this.$route.params.address
        } else if (this.$route.params.repo) { // fetch github info from address bar if it exist
          base = 'https://raw.githubusercontent.com/' + this.$route.params.org + '/' + this.$route.params.repo + '/master/'
          file = (this.$route.params.file ? this.$route.params.file : file)
          address = base + file
        // } else if (this.$route.params.address) { // try with the info in the address bar
        //   return this.fetchInfo(this.$route.params.address)
        } else { // showcase home + instructions
          json = Home
          return { json, type }
        }
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
        json = await this.fetchEthInfo(address)
        return { json, type }
        // var contract = new web3.eth.Contract(abi, '0x6B175474E89094C44Da98b954EedeAC495271d0F')
        // contract.methods.balanceOf('0x96bB7B429cF97131E624Fa32d27B45595d59b5B8').call().then(console.log)
        // (query ethereum and the graph)
      } else if (address.match(/[0-9A-Fa-f]{47}/g)) { //  IPFS ADDRESS
        type = 'IPFS'
        fetchaddress = 'https://ipfs.io/ipfs/' + address
      } else if (address.startsWith('./') || address.startsWith('/') || address.match(/[0-9A-Za-z]/)) { // RELATIVE ADDRESS
        type = 'RELATIVE'
        pathArray = this.$route.path.split('/') // source absolute path info from route
        base = 'https://raw.githubusercontent.com/' + pathArray[1] + '/' + pathArray[2] + '/master/'
        file = this.$route.path.slice(this.$route.path.indexOf(pathArray[2]) + pathArray[2].length + 1)
        console.log(this.$route.path)
        fetchaddress = base + file.slice(0, file.lastIndexOf('/') + 1) + address
      // } else if (address) { // NPM NAME
      //   // fetchaddress = 'https://registry.npmjs.org/' + address
      //   fetchaddress = base + address // temporary
      } else { // not know what to do, assume fetched from github
        type = 'NONE'
        base = 'https://raw.githubusercontent.com/' + this.$route.params.org + '/' + this.$route.params.repo + '/master/'
        file = this.$route.params.file
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
    },
    async holonInfo () { // retrieves and updates the information about this holon and its sub holons
      if (this.$zircle.getParams()) {
        this.id = this.$zircle.getParams().id
      }

      if (this.id && this.id.startsWith('http')) {
        var url = new URL(this.id)
        if (url) {
          var pathArray = url.pathname.split('/')
          var file = ''
          if (pathArray[3]) file = url.pathname.slice(url.pathname.indexOf(pathArray[2]) + pathArray[2].length)
          this.$router.push({ path: `/${pathArray[1]}/${pathArray[2]}/${file}` })
        }
      }
      let r = await this.fetchInfo(this.id)
      console.log(r.type)
      this.type = r.type
      if (r.type === 'ETHEREUM') this.$router.push({ path: `/${this.id}` })
      var json = r.json
      if (json) {
        this.name = json.name
        this.description = json.description ? json.description : json.text
        this.url = json.url
        this.quote = json.quote
        this.image = json.image
        this.quoteauthor = json.quoteauthor
        this.holons = json.holons
        if (json.holons) {
          // fetch names of each sub-holon
          Promise.all(
            this.holons.map(async (holon, index) => {
              if (holon.label) {
                return holon.label
              } else {
                let r = await this.fetchInfo(holon.id)
                return r.json.name
              }
            })
          ).then((values) => {
            this.holonslabels = values
          })
          // fetch images of each sub-holon
          Promise.all(
            this.holons.map(async (holon, index) => {
              if (holon.image) {
                return holon.image
              } else {
                let r = await this.fetchInfo(holon.id)
                return r.json.image
              }
            })
          ).then((values) => {
            this.holonsimages = values
          })
          // fetch images of each sub-holon
          // Promise.all(
          //   this.holons.map(async (holon, index) => {
          //     if (holon.image) {
          //       return holon.image
          //     } else {
          //       let r = await this.fetchInfo(holon.id)
          //       return r.json.image
          //     }
          //   })
          // ).then((values) => {
          //   this.holonsimages = values
          // })
          // fetch subholon values if available
          for (let i = 0; i < this.holons.length; i++) {
            this.holonsvalues[i] = parseInt(this.holons[i].value)
          }
        }
      }
    },
    truncate (text) {
      return text.substring(0, 6) + '..'
    },
    normalize (idx) {
      var index = idx // idx + (this.$zircle.getCurrentPageIndex() * 10)
      var qty = this.holonsvalues[index]
      var total = this.holonsvalues.reduce((total, num) => total + num)
      if (total > 100) {
        var diff = total - 100 // qty - this.previousholonsvalues[index]

        var delta
        //  if (total == 0) {//all sliders are 0 except changed, distribute change equally
        //    delta = this.holonsvalues.map(() => { return - (1/(this.holonsvalues.length-1)) * diff})
        //  }
        //  else {
        delta = this.holonsvalues.map((x) => { return -x / (total - qty) * diff })
        //  }

        var normal = this.holonsvalues.map((x, idx) => {
          return Math.floor(x + delta[idx])
        })
        normal[index] = qty // copy correct value for current slider
        this.holonsvalues = Object.assign([], this.holonsvalues, normal)
        // this.previousholonsvalues = Object.assign([],this.holonsvalues,this.holonsvalues);
        console.log(this.holonsvalues.reduce((total, num) => total + num))
      }// return this.holonsvalues.map((x) => { return (x *100) /this.holonsvalues.reduce((total, num)=> total + num);} );
    }
  },
  mounted () {
    this.holonInfo()
    this.initWeb3()
    // this.holon = new Web3.eth.Contract(data.holonabi, data.holonaddress)
  },
  computed: {
    cssVars () {
      return {
        /* variables you want to pass to css */
        '--image': 'https://raw.githubusercontent.com/liminalvillage/bridgemedicine/master/public/images/' + this.image + '.png'
      }
    }
  },
  data () {
    return {
      dialog: false,
      web3: null,
      holon: null,
      editing: false,
      url: null,
      type: 'GITHUB',
      id: '',
      name: '',
      description: '',
      quote: '',
      quoteauthor: '',
      image: '',
      holons: [],
      holonslabels: [],
      holonsimages: [],
      holonsvalues: [],
      perspectives: []
    }
  }
}
</script>
<style >
#z-container {
  background-image: var(--image);
  background-size: cover;
  background-position: center;
}
.z-content {
  background: radial-gradient(40% 40% at 50% 50%,hsla(0,0%,100%,.1) 0,rgba(0,0,0,.1) 100%)
}

.modal-container {
  display: flex;
  justify-content: center;
  align-items: center;
}
.modal-content {
  position: relative;
  display: flex;
  flex-direction: column;
  max-height: 90%;
  margin: 0 1rem;
  padding: 1rem;
  border: 1px solid #e2e8f0;
  border-radius: 0.25rem;
  background: #fff;
}
.modal__title {
  margin: 0 2rem 0.5rem 0;
  font-size: 1.5rem;
  font-weight: 700;
}
.modal__content {
  flex-grow: 1;
  overflow-y: auto;
}
.modal__action {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
  padding: 1rem 0 0;
}
.modal__close {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
}
</style>
