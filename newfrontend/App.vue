<template>
  <z-canvas :views='$options.components'></z-canvas>
</template>
<script>
// TO SET UP VUE-ROUTER UNCOMMENT THE FOLLOWING LINES
import Vue from 'vue'
import Router from 'vue-router'
Vue.use(Router)
const router = new Router()
export default {
  components: {
    orbit: () => import('./views/orbit'),
    holon: () => import('./views/holon'),
    settings: () => import('./views/settings')
  },
  mounted () {
    this.$zircle.config({
      router: router,
      mode: 'full',
      style: {
        theme: 'black',
        mode: 'dark'
      },
      debug: true
    })
    this.$zircle.setView('holon')
  }
}
</script>
<style>
@import url('https://fonts.googleapis.com/css?family=Source+Sans+Pro:400,700');
@import url('https://use.fontawesome.com/releases/v5.1.0/css/all.css');
</style>
