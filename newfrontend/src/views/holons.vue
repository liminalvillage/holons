<template>
  <z-view label="Holon">
    Holon <br/> {{ id }}
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
      lense: 'holons',
      description: "Holon",
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
      var table = await hs.get(this.id, 'quests')
      var tableid = id.split('.')[0]
      var lense = id.split('.')[1]
      var itemid = id.split('.')[2]
      this.holons = [
        { 'id': id + '.quests', 'label': 'Tasks', 'lense': 'tasks' },
        { 'id': id + '.users', 'label': 'People', 'lense': 'users' },
        { 'id': id + '.shopping', 'label': 'Shopping', 'lense': 'shopping' },
        { 'id': id + '.tags', 'label': 'Tags', 'lense': 'tags' },
        { 'id': id + '.expenses', 'label': 'Expenses', 'lense': 'expenses' },
        { 'id': id + '.projects', 'label': 'Projects', 'lense': 'projects' },
        { 'id': id + '.settings', 'label': 'Settings', 'lense': 'settings' },
      ]
      return
    }
  }
}
</script>
