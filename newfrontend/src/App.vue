<template>
  <z-canvas :views='viewMap'></z-canvas>
</template>
<script>
export default {
  data () {
    return {
      viewMap: {
        holon: 'holon',
        tasks: 'tasks',
        holons: 'holons',
        users: 'users',
        projects: 'projects',
        settings: 'settings'
      }
    }
  },
  mounted () {
    this.$zircle.config({
      usePercentSizes: true,
      mode: 'full',
      style: {
        theme: 'black',
        mode: 'dark'
      },
      debug: false
    })

    var holonId = this.$route.params.holonId || ''
    var lense = this.$route.params.lense || null

    if (holonId && lense) {
      // URL like /regenerativa/quests → navigate to holon with dotted id
      this.$zircle.toView({
        to: 'holon',
        fromSpot: { position: { Xabs: 0, Yabs: 0, scale: 1 } },
        params: { id: holonId + '.' + lense }
      })
    } else if (holonId) {
      // URL like /regenerativa → navigate to that holon
      this.$zircle.toView({
        to: 'holon',
        fromSpot: { position: { Xabs: 0, Yabs: 0, scale: 1 } },
        params: { id: holonId }
      })
    } else {
      // Root URL → show home
      this.$zircle.toView('holon')
    }
  }
}
</script>
<style>
a {
  color: var(--primary);
  font-style: bold
}
@import url('https://fonts.googleapis.com/css?family=Source+Sans+Pro:400,700');
@import url('https://use.fontawesome.com/releases/v5.1.0/css/all.css');
</style>
