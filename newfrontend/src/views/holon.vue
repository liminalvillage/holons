<template>
  <z-view>
    <div slot="default" style="width:85%;margin:5%;">
      <h1>{{ name }}</h1>
      <small v-if="type == 'ETHEREUM'">{{ this.id }}</small>
      <br />
      <button v-if="type == 'ETHEREUM'" @click="sendFunds(this.id)">Send Funds</button> <br />
      <button v-if="type == 'ETHEREUM'" @click="sendERC20('0x123', this.id)">Send ERC20</button> <br />
    </div>
    
    <div slot="default" style="width:85%;margin:5%;"> <vue-markdown :source="this.description"></vue-markdown></div>
    <div slot="extension">
      <z-dialog :title="name" :width="600" :height="600" :content="description" :open="dialog" @close="dialog = false"
        v-if="dialog">
        <z-spot button slot="extension" :angle=45 size='small' @click.native='dialog = false'>
          Close
        </z-spot>
        Please copy an holon.json file from existing holons, modify it and save it in your own location (e.g. github/ftp/ipfs)
        
      </z-dialog>
      
      <!-- <z-list 
      :items = holons
      :per-page = "10"> -->
      <z-spot v-for="(holon, index) in holons" :key="holon.id" :knob="editing ? true : false"
        @click.native="holonsvalues[index] ? normalize(index) : ''" :qty.sync="holonsvalues[index]"
        :index= index
        :label="holonslabels[index]" :progress="parseInt(holon.value)"
        :angle="200 - (index * (220. / (holons.length > 1 ? holons.length - 1 : 1)))" size="m" :distance="130"
        :label-pos="index >= holons.length / 2 ? 'right' : 'left'"
        :to-view="editing ? '' : { name: holon.lense ? holon.lense : 'holon', params: { id: holon.id } }">
        <!-- :style="[{backgroundImage:`url(${holonsimages[index]})`},{backgroundSize: `100% 100%`},{backgroundRepeat: `no-repeat`},{backgroundPosition: `center`},{borderWidth:'$(holonsvalues[index])px'}]"
      -->
        <img v-if=holonsimages[index] :src="`${holonsimages[index]}`" style="width: 100%; opacity:0.4;"
          onerror="this.style.display='none'" />
        <!-- :imagePath = "holonsimages[index]?'./images/'+ holonsimages[index]:''" -->
      </z-spot>
    <!-- </z-list> -->
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
      <z-spot button :angle="270" :distance="125" size="s" :label="editing ? 'Save' : 'Edit'" label-pos='top'
        @click.native="editing ? editing = false : editing = true">
        <i v-if="editing" class="fas fa-save"></i>
        <i v-else class="fas fa-edit"></i>
      </z-spot>
      <z-spot v-if="url" button :angle="250" :distance="125" size="s" label="Website" label-pos='top'
        @click.native="goToSite(url)">
        <i class="fab fa-github"> </i>
      </z-spot>
      <z-spot button :angle="290" :distance="125" size="s" label-pos='top' label="Comms" @click.native="openComms">
        <i class="fas fa-video"> </i>
      </z-spot>
      <!-- ------------------------- Add Button ------------------------- -->
      <z-spot button :angle="90" :distance="100" size="s" label-pos='top' label="Add" @click.native="add()">
        <i class="fas fa-plus"> </i>
      </z-spot>
    </div>

  </z-view>
</template>

<script>

import VueMarkdown from 'vue-markdown'

import { fetchInfo } from '../libs/holons.js'


// import { fstat } from 'fs'
export default {
  watch: {
    // holons: function () {
    //   console.log('called! ' + this.holons.length)
    // },
    deep: true,

    $route(to, from) {
      console.log(to)
      console.log(from)
    }
  },
  components: {
    VueMarkdown
  },
  methods: {
    openComms() {
      console.log('emitting ' + this.id)
      this.$emit('opencomms', this.id)
    },
    sendFunds(address, amount) {
      console.log(address)
      console.log(amount)
      // web3.eth.sendTransaction({from:web3.defaultAccount ,to:address, value:web3.utils.toWei(amount, "ether")})
      // this.closeAddAppreciationModal()
    },
    sendERC20(tokenaddress, address, amount) {
      console.log(address)
      console.log(amount)
      // web3.eth.sendTransaction({from:web3.defaultAccount ,to:address, value:web3.utils.toWei(amount, "ether")})
      // this.closeAddAppreciationModal()
    },
    confirm() {
      this.showConfirmModal = false
      this.showModal = false
    },
    add() {
      console.log('Add holon invoked' + this.showModal)
      this.showModal = true
      this.dialog = true
    },
    goToSite(address) {
      console.log('Go to Site:' + address)
      return window.open(address, '_blank')
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

    async holonInfo() { // retrieves and updates the information about this holon and its sub holons
      if (this.$zircle.getParams()) {
        this.id = this.$zircle.getParams().id
        this.lense = this.$zircle.getParams().lense
      }
    
      if (this.id && this.id.startsWith('http')) {
        var url = new URL(this.id)
        if (url) {
          var pathArray = url.pathname.split('/')
          var file = ''
          if (pathArray[3]) file = url.pathname.slice(url.pathname.indexOf(pathArray[2]) + pathArray[2].length)
          //this.$router.push({ path: `/${pathArray[1]}/${pathArray[2]}/${file}`, query: { id: this.id } })
          this.$router.push({ path: `/${this.id}`, query: { id: this.id } })
        }
      }
      // if (this.id && this.id.startsWith('Qm')) {
      //   this.$router.push({ path: `/ipfs/${this.id}` })
      // }
      // if (this.id && this.id.startsWith('0x')) {
      //   this.$router.push({ path: `/ethereum/${this.id}` })
      // }
      // if (this.id && this.id.startsWith('holon://')) {
      //   this.$router.push({ path: `/holon/${this.id}` })
      // }
        
        // check if relative, add the rest of the path
      console.log('ID: ' +this.id+ ' route:'+ this.$route.query.id)
      if (this.id.startsWith('./') || this.id.startsWith('/') || this.id.startsWith('..') || this.id.match(/^[a-zA-Z]+$/) )
        this.id = this.$route.query.id + '/' + this.id //this.id.slice(0, this.id.lastIndexOf('/') + 1)

      let r = await fetchInfo(this.id? this.id : this.$route.query.id, this.lense)
      
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
                let r = await fetchInfo(holon.id)
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
                let r = await fetchInfo(holon.id)
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
          //       let r = await fetchInfo(holon.id)
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
    truncate(text) {
      return text.substring(0, 6) + '..'
    },
    normalize(idx) {
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
  mounted() {
    this.holonInfo()
  },
  computed: {
    cssVars() {
      return {
        /* variables you want to pass to css */
        '--image': '' + this.image
      }
    }
  },
  data() {
    return {
      dialog: false,
      db: null,
      holon: null,
      editing: false,
      url: null,
      type: 'HOLONS',
      lense: null,
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
  background: radial-gradient(40% 40% at 50% 50%, hsla(0, 0%, 100%, .1) 0, rgba(0, 0, 0, .1) 100%)
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
