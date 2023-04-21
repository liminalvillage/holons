<template>
  <z-view>
    {{retrieveAddress}}
     <section slot="extension">
      <!-- status monitor -->
       <z-list
      :items="members"
      :per-page="10"> 
      <z-spot
          style="background-color: var(--background-color); border-width: 4px; border-color: var(--text-accent-color);"
          :knob="editing ? true : false"
          :qty.sync="knobValue[props.index + ($zircle.getCurrentPageIndex() * 10)]"
          :distance="140"
          slot-scope="props"
          :index="props.index + ($zircle.getCurrentPageIndex() * 10)"
          :label="truncate(props.memberAddress)"
          :to-view= "editing ? '' : {name:'holon', params: {address: props.memberAddress}}"
          label-pos="bottom"
          @click.native= "normalize(props.index)"
          size = "m"
          >
          
      </z-spot>
      <!-- members-->
      <!--<z-spot v-for="(member,index) in members" :key="member.memberAddress"  :angle="index" :label="member.memberAddress"> <i class="fas fa-user"></i></z-spot> -->
      </z-list>
      <!-- dialog -->
      <z-spot
        button
        :angle="45"
        :distance="50"
        size="s"
        label="Add Member"
        @click.native="openDialog = true">
          <i class="fas fa-plus"></i>
      </z-spot>

      <!-- Edit signals -->
      <z-spot
        button
        :angle="90"
        :distance="50"
        size="s"
        :label="editing ? 'Save' : 'Edit'"
        @click.native="editing ? editing = false : editing = true">
        <i v-if="editing" class="fas fa-save"></i>
        <i v-else class="fas fa-edit"></i>
      </z-spot>
      
      <z-dialog v-if="openDialog" self-close v-on:done="openDialog = false">
      Add a new member?
      <div slot=extension>
        <z-spot
        class="success"
        button
        :angle="45"
        size="s"
        :distance="120"
        @click.native="openDialog = false">
          <i class="fas fa-check"></i>
        </z-spot>
        <z-spot
        class="danger"
        button
        :angle="135"
        size="s"
        :distance="120"
        @click.native="openDialog = false">
          <i class="fas fa-times"></i>
        </z-spot>
      </div>
    </z-dialog>
    </section>
  </z-view>
</template>


<script>
import gql from 'graphql-tag'
//import Identicon from "identicon"

// const membersQuery = gql`
//   query {
//     moloch(id:"0x0372f3696fa7dc99801f435fd6737e57818239f2") {
//       members {
//         memberAddress
//       }
//     }
//   }`

export default {

  props: ['address'],
  name:'Holon',
  mounted(){
   
  },
  apollo: {
  // Query with parameters
  members: {
    query: gql`query GetMembers($address: String!) {
       moloch(id:$address) {
              members: members {
                memberAddress
              }
            }
    }`,
    update (data) {
      if (data.moloch)
        return data.moloch.members
      else
        return []
    },
    // Reactive parameters
    variables () {
      // Use vue reactive properties here
      return {
          address: this.$zircle.getParams().address,
      }
    },
  },
},
  // apollo: {
  //    members: { 
  //       query: gql`
  //          {query members($addresso : String!){
  //             moloch(id:$addresso) {
  //             members: members {
  //               memberAddress
  //             }
  //           }
  //           }
  //         }`,

  //       // Reactive parameters
  //       variables() {
  //         return {
  //         // Use vue reactive properties here
  //           addresso: this.$zircle.getParams().address
  //         }
          
  //       },
  //     update (data) {
  //     console.log(data)
  //     return data.moloch.members
  //   },
  //    },
  // },
 data: () => ({
    // You can initialize the 'posts' data here
    editing: false,
    members: [],
    loading: 0,
    openDialog: false,
    knobValue: [],
   // previousKnobValue:[100,0,0,0,0,0,0,0,0,0]
  }),
  methods:{
    getImage(address){
      fetch(
        "https://ipfs.3box.io/profile?address=" + address
      )
        .then(response => response.json())
        .then(data => {
          if (data.status === "error") {
            // Create and set identicon as profile picture
           // var image = new Identicon(address.toString(), 420).toString();
            //ALTERNATIVE: Robohash
           var image = "https://robohash.org/"+address+".png?set=set4"
         
           return "data:image/png;base64," + image ;
              
          }
          return data.image;
        });
    },
    truncate( text){
      return text.substring(0, 6) + "..";
    },
    normalize(idx){
      var index = idx + (this.$zircle.getCurrentPageIndex() * 10)
       var qty =  this.knobValue[index]
       var total = this.knobValue.reduce((total, num)=> total + num )
       if (total > 100)
       {
          var diff = total - 100  //qty - this.previousKnobValue[index]

          var delta
          //  if (total == 0) {//all sliders are 0 except changed, distribute change equally
          //    delta = this.knobValue.map(() => { return - (1/(this.knobValue.length-1)) * diff})
          
          //  }
          //  else { // 
              delta = this.knobValue.map((x) => { return -x/(total - qty)* diff})
          //  }

          var normal = this.knobValue.map((x,idx) => { return Math.floor(x + delta[idx]);} )
          normal[index]= qty //copy correct value for current slider
          this.knobValue = Object.assign([],this.knobValue,normal);
          //this.previousKnobValue = Object.assign([],this.knobValue,this.knobValue);
          console.log(this.knobValue.reduce((total, num)=> total + num ))
       }//return this.knobValue.map((x) => { return (x *100) /this.knobValue.reduce((total, num)=> total + num);} );
    }
  },
  watch: {
    members: function () {
      console.log('called! '+ this.members.length)
      var oldlength =  this.knobValue.length
      this.knobValue.length= this.members.length
      this.knobValue.fill(0, oldlength, this.knobValue.length)
    },
    // series: function (values) {
    //   this.chart.invalidateData();
    //   //this.series.data = values;
    // },
     deep: true,
  },
  computed: {
  
    retrieveAddress ()  {
      if (this.$zircle.getParams() !== undefined) {
        return this.$zircle.getParams().address
      }
      else
        return 'DAO address not provided'
    }
  }
}
</script>