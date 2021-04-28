<template>
  <div>
    <router-link  class="holon-link mr-2" :to="`/${homeHolon}`">
      <font-awesome-icon :icon="['far', 'circle']" class="-mr-2" />
      <font-awesome-icon :icon="['far', 'circle']" />
    </router-link>
    <router-link
      v-for="(holon, index) in holonList"
      class="holon-link"
      :to="`/${holon.address}`"
      :key="`holonlink-${index}`"
    >
      <font-awesome-icon :icon="['far', 'circle']" class="-mr-2" />
      <font-awesome-icon :icon="['far', 'circle']" />

      <span>{{ holon.name }}</span>
    </router-link>

    <div class="h-24 block min-w-full m-0">
      <h1 id="v-step-0" v-if="holonName" class="text-5xl text-white">{{ holonName }}</h1>
      <h3>{{ holonaddress }}</h3>
    </div>
    <div class="m-grid-outer -mt-20">
      <div class="m-grid-container" name="gridmove-move">
        <div class="circle row-4 c-3 c-search-outer" key="fixed-position">
          <div class="c-inner text-white text-2xl">
            {{ holonName }}
            <button
              
              class="v-step-2 bg-blue-500 hover:bg-blue-700 text-white rounded-full px-3 py-1 text-sm font-semibold m-2"
              @click="openAddAppreciationModal(holonaddress, true)"
            >Send funds to holon</button>
          </div>
        </div>
        <div
          v-for="(member, index) in holonMembers"
          class="circle v-step-4"
          :class="getCircleClass(index)"
          :key="`${member.name}-${index}`"
        >
          <div class="c-inner profile-card, inline-block my-4 rounded-full bg-cover bg-blue-900 h-32 w-32"
            :style="{ 'background-image': 'url(' + member.img + ')'}">
            <div class="px-6 py-4">
              <router-link :to="`/${member.address}`">
                <h2 class="font-bold text-xl text-white" :title="member.address">{{ member.name }}</h2>
              </router-link>
            </div>
            <div>
              <holon-stats
                :expanded="false"
                :appreciation="member.appreciation"
                :remaining="member.remainingappreciation"
                :recieved="member.rewards"
                :casted="castedappreciation"
                :totalrewards="totalrewards"
              />
              <button
                v-if="member.address !== defaultAccount"
                class="v-step-1 bg-blue-500 hover:bg-blue-700 text-white rounded-full px-3 py-1 text-sm font-semibold m-2"
                @click="openAddAppreciationModal(index)"
              >send ❤️</button>
            </div>
          </div>
        </div>
        <holon-add
          class="v-step-3"
          :showAddField="showAddField"
          :key="'add-member'"
          @addMember="addMember"
          @addHolon="newHolon"
          @visible="toggleAddField"
        ></holon-add>
      </div>
    </div>
    <div v-if="holonMembers.length > 0">
      <h2 class="text-2xl text-white">Full member list</h2>
      <div class="flex mb-4 justify-center flex-wrap">
        <div
          v-for="(member, index) in holonMembers"
          :key="`member-${index}`"
          class="p-4 text-white text-center max-w-md border border-blue-900 rounded-md m-3"
        >
          <span
            class="inline-block my-4 rounded-full bg-cover bg-blue-900 h-32 w-32"
            :style="{ 'background-image': 'url(' + member.img + ')' }"
          ></span>
          <router-link :to="`/${member.address}`">
            <div class="px-6 py-4 truncate max-w-xs">
              <h2 class="font-bold text-xl mb-2">{{ member.name }}</h2>
              <small>{{ member.address }}</small>
            </div>
          </router-link>

          <div class="max-w-xs">
            <holon-stats
              :expanded="true"
              :appreciation="member.appreciation"
              :remaining="member.remainingappreciation"
              :rewards="member.rewards"
              :casted="castedappreciation"
              :totalrewards="totalrewards"
            />

            <button
              class="bg-blue-500 hover:bg-blue-700 text-white rounded-full px-3 py-1 text-sm font-semibold m-2"
              @click="openAddAppreciationModal(index)"
            >send ❤️</button>
          </div>
        </div>
      </div>
    </div>
    <modal
      v-if="showAddAppreciationModal"
      @close="closeAddAppreciationModal"
      :header="`Send to ${addAppreciationModal.header}`"
    >
      <div slot="body">
        <span class="text-blue-600 font-extrabold text-3xl">
          {{
          addAppreciationModal.amount
          }}
        </span>
        <span
          v-if="addAppreciationModal.holon"
          class="text-gray-600 italic text-3xl pl-2"
        >/ {{ addAppreciationModal.maxAmount }} ETH</span>
        <span
          v-else
          class="text-gray-600 italic text-3xl pl-2"
        >/ {{ addAppreciationModal.maxAmount - addAppreciationModal.amount }} ❤️</span>
        <div class="slidecontainer">
          <input
            type="range"
            :min="minAmount"
            :step="stepSize"
            :max="addAppreciationModal.maxAmount"
            v-model="addAppreciationModal.amount"
            class="slider"
          />
        </div>
      </div>
      <template slot="footer">
        <button
          v-if="addAppreciationModal.holon"
          class="bg-blue-500 hover:bg-blue-700 text-white rounded-full px-3 py-1 text-sm font-semibold m-2"
          @click="sendFunds(addAppreciationModal.target, addAppreciationModal.amount)"
        >send ❤️</button>
        <button
          v-else
          class="bg-blue-500 hover:bg-blue-700 text-white rounded-full px-3 py-1 text-sm font-semibold m-2"
          @click="sendAppreciation(addAppreciationModal.target, addAppreciationModal.amount)"
        >send ❤️</button>
      </template>
    </modal>
  </div>
</template>
<script>
import web3 from "../libs/web3.js";
import Identicon from "identicon.js";
import holondata from "../data/Holon.json";
import factorydata from "../data/HolonFactory.json";
export default {
  name: "HolonContainer",
  props: ["holonNav"],
  data() {
    return {
      showAddAppreciationModal: false,
      showAddField: false,
      addAppreciationModal: {
        holonda: false,
        header: null,
        target: null,
        amount: 0,
        maxAmount: 100
      },
      defaultAccount: null,
      contract: null,
      factory: null,
      holonList: [],
      holonName: "",
      holonMembers: [],
      holon: null,
      user: null,
      holonabi: holondata.abi,
      factoryabi: factorydata.abi,
      homeHolon: "0xB393F06145278F3B69B6E23dD403Fc3985f329D4",
      factoryaddress: factorydata.address,
      holonaddress: null,
      castedappreciation: 0,
      totalappreciation: 0,
      totalrewards: 0,
      circleClass: [
        "row-3 c-2",
        "row-2 c-3",
        "row-3 c-4",
        "row-5 c-4",
        "row-6 c-3",
        "row-5 c-2",

        "row-1 c-3",
        "row-2 c-5",
        "row-6 c-5",
        "row-7 c-3",
        "row-6 c-1",
        "row-2 c-1"
      ]
    };
  },
  computed: {
    minAmount() {
      return this.addAppreciationModal.holon ? "0" : "1";
    },
    stepSize() {
      return this.addAppreciationModal.holon ? "0.0001" : "1";
    }
  },
  methods: {
    connectWeb3()  { 
      web3.eth.getAccounts().then((result,error) =>{
        if (error) {
          console.log("Error! "+error);
        } else {
          web3.defaultAccount = result[0];
          this.defaultAccount = result[0];
          console.log(web3.defaultAccount);
           if (this.defaultAccount >0)
          {
            this.makeHolonList();

            this.getTeam();
          }
        }
      })
      this.holon = new web3.eth.Contract(this.holonabi, this.holonaddress);
      this.factory = new web3.eth.Contract(
        this.factoryabi,
        this.factoryaddress
      );
     
    },
    makeHolonList() {
      this.factory.methods
        .listHolonsOf(this.defaultAccount)
        .call( )
        .then(data => {
          if (data) {
            for (var i = 0; i < data.length; i++) {
              this.holonList[i] = {
                address: data[i],
                name: ""
              };
              this.getHolonName(data[i], i);
            }
          }
        });
    },
    getHolonName(address, index) {
      this.factory.methods
        .toName(address)
        .call()
        .then(data => {
          this.holonList[index].name = data;
          this.$forceUpdate();
        });
    },
    getTeam() {
      // this.factory.methods
      //   .toName
      //   .call()
      //   .then(data => {
      //     this.holonName = data;
      //   });

      // this.holon.methods
      //   .totalappreciation()
      //   .call()
      //   .then(data => {
      //     this.totalappreciation = data;
      //   });

      // this.holon.methods
      //   .appreciation()
      //   .call()
      //   .then(data => {
      //     this.castedappreciation = data;
      //   });

      this.holon.methods
        .listMembers()
        .call()
        .then(data => {
          this.makeTeam(data);
        });
    },

    makeTeam(members) {
      for (var i = 0; i < members.length; i++) {
        this.holonMembers.push({
          address: members[i],
          name: "",
          appreciation: "",
          remainingappreciation: "",
          rewards: "",
          profile: "",
          img: ""
        });
        this.getName(i);
        this.getAppreciation(i);
       //  this.getRewards(i);
        this.getRemainingAppreciation(i);
        this.findMe();
        this.get3boxData(i);
      }
    },
    get3boxData(index) {
      fetch(
        "https://ipfs.3box.io/profile?address=" +
          this.holonMembers[index].address
      )
        .then(response => response.json())
        .then(data => {
          if (data.status === "error") {
            // Create and set identicon as profile picture
            var image = new Identicon(this.holonMembers[index].address.toString(), 420).toString();
            this.holonMembers[index].img="data:image/png;base64," + image ;
            //ALTERNATIVE: Robohash
           //this.holonMembers[index].img = "https://robohash.org/"+this.holonMembers[index].address+".png?set=set4"
            return;
          }
          this.setImage(index, data.image);
        });
    },
    setImage(index, image) {
      this.holonMembers[index].img =
        "https://ipfs.io/ipfs/" + image[0].contentUrl["/"];
        
    },
    getName(index) {
      this.holon.methods.toName(this.holonMembers[index].address)
        .call()
        .then(data => {
          this.holonMembers[index].name = data;
        });
    },
    
    getRemainingAppreciation(index) {
      this.holon.methods
        .remainingappreciation(this.holonMembers[index].address)
        .call()
        .then(data => {
          this.holonMembers[index].remainingappreciation = data;
        });
    },
    // getRewards(index) {
    //   this.holon.methods
    //     .rewards(this.holonMembers[index].address)
    //     .call()
    //     .then(data => {
    //       this.holonMembers[index].rewards = web3.utils.fromWei(data, "ether");
    //     });
    // },
    getAppreciation(index) {
      this.holon.methods
        .appreciation(this.holonMembers[index].address)
        .call()
        .then(data => {
          this.holonMembers[index].appreciation = data;
        });
    },
    findMe() {
      this.user = this.holonMembers.findIndex(
        x => x.address === web3.defaultAccount
      );
    },
    sendAppreciation(address, amount) {
      this.holon.methods
        .appreciate(address, amount)
        .send({ from: web3.defaultAccount })
        .then(() => {
          this.getRemainingAppreciation(this.user);
        });
      this.closeAddAppreciationModal();
    },
    sendFunds(address, amount) {
      console.log(address);
      console.log(amount);
      web3.eth.sendTransaction({from:web3.defaultAccount ,to:address, value:web3.utils.toWei(amount, "ether")})
      this.closeAddAppreciationModal();
    },
    sendERC20(tokenaddress ,address, amount) {
      console.log(address);
      console.log(amount);
      web3.eth.sendTransaction({from:web3.defaultAccount ,to:address, value:web3.utils.toWei(amount, "ether")})
      this.closeAddAppreciationModal();
    },
    addMember(address, name) {
      this.holon.methods
        .addMember(address, name)
        .send({ from: web3.defaultAccount })
        .then(data => {
          console.log("success" + data);
        });
      this.showAddField = false;
    },
    newHolon(name) {
      this.factory.methods
        .newHolon(name)
        .send({ from: web3.defaultAccount })
        .then(data => {
          console.log(data);
        });
      this.showAddField = false;
    },
    openAddAppreciationModal(index, holon) {
      if (holon) {
        this.addAppreciationModal.holon = true;
        this.addAppreciationModal.target = this.holonaddress;
        this.addAppreciationModal.header = this.holonName;
        new web3.eth.getBalance(web3.defaultAccount).then(bal => {
          var balance = web3.utils.fromWei(bal, "ether");
          this.addAppreciationModal.maxAmount = balance;
        });
      } else {
        this.addAppreciationModal.holon = false;
        this.addAppreciationModal.target = this.holonMembers[index].address;
        this.addAppreciationModal.header = this.holonMembers[index].name;
        this.addAppreciationModal.maxAmount = this.holonMembers[this.user].remainingappreciation;
      }

      this.showAddAppreciationModal = true;
    },
    closeAddAppreciationModal() {
      this.addAppreciationModal.holon = false;
      this.addAppreciationModal.target = "";
      this.addAppreciationModal.header = "";
      this.addAppreciationModal.amount = 0;
      this.addAppreciationModal.maxAmount = 100;
      this.showAddAppreciationModal = false;
    },
    toggleAddField(e) {
      this.showAddField = e;
      this.addingMember = false;
    },
    getCircleClass(index) {
      return this.circleClass[index];
    }
  },
  mounted() {
    if (this.holonNav) {
      let isEth = /^0x[a-fA-F0-9]{40}$/.test(this.holonNav);
      if (isEth) {
        this.holonaddress = this.holonNav;
        this.connectWeb3();
      } else {
        this.holonaddress = this.homeHolon;
        this.connectWeb3();
      }
    } else {
      this.holonaddress = this.homeHolon;
      this.connectWeb3();
    }
  }
};
</script>
