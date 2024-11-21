<template>
  <z-view label="Users">
    {{ description }}
    <div slot="extension">
      <z-spot v-for="(holon, index) in holons" :key="holon.id" :knob="editing ? true : false"
        :index= index
        :label="holon.label"
        :angle="200 - (index * (220. / (holons.length > 1 ? holons.length - 1 : 1)))" size="m" :distance="130"
        :label-pos="index >= holons.length / 2 ? 'right' : 'left'"
        :to-view=" { name: holon.lense ? holon.lense : 'holon', params: { id: holon.id } }">
        <!-- :style="[{backgroundImage:`url(${holonsimages[index]})`},{backgroundSize: `100% 100%`},{backgroundRepeat: `no-repeat`},{backgroundPosition: `center`},{borderWidth:'$(holonsvalues[index])px'}]"
      -->
       
        <!-- :imagePath = "holonsimages[index]?'./images/'+ holonsimages[index]:''" -->
      </z-spot>
      <!-- <z-spot v-for="(el, index) in this.holons" button size="xs" :distance="120" :label="el.label"
         :key="index" @click.native="" /> -->
    </div>
  </z-view>
</template>
<script>

import HoloSphere from 'holosphere'

let hs = new HoloSphere("Holons")

export default {
  watch: {
    // id: function () {
    //   console.log('called! ' + this.id)
    //   this.fetchInfo()
    // },
    // holons: function () {
    //   console.log('called! ' + this.holons.length)
    // },
    // holons: function () {
    //   console.log('called! ' + this.holons.length)
    // },
    deep: true,

    $route(to, from) {
      console.log(to)
      console.log(from)
    }
  },
  data() {
    return {
      id: '',
      name: '',
      lense: 'users',
      description: "Users",
      holons: []
    }
  },
  async mounted() {
    await this.fetchInfo()
  },
  methods: {
   
    async fetchInfo() {
      if (this.$zircle.getParams()) {
        this.id = this.$zircle.getParams().id
        this.lense = this.$zircle.getParams().lense
      }
      let id = this.id
      var table = await hs.get(this.id, 'users')
     
      // if (itemid){ // if leaf node
      //   console.log("item", table)
      //   holon.name = table.name || table.title || table.description
      //   let itemtype = lense.slice(0, -1) 
      //   holon.id = table.id
      //   return holon
      // }


      // holon.name = id
      // holon.description = id
      // holon.holons = []

      //let members = await users.get(id,"users")
      //remove last letter of type

      let items = []
      table.forEach(item => {
        if (item.status !== 'completed' && item.type == "task")  // task
          items.push({ 'id': id + '.' + item.id, 'label': item.title || item.name || item.description, 'lense': this.lense })
        else
          if (item.currency) // Expense
            items.push({ 'id': id + '.' + item.id, 'label': item.description, 'lense': this.lense, 'payload': item })
        if (item.username) // User
          items.push({ 'id': id + '.' + item.id, 'label': item.username, 'lense': 'user', 'payload': item })
      })
       this.holons = items
       //this.description = table.name || table.title || table.description
    }
  }
}
</script>
