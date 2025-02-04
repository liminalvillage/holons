<template>
  <z-canvas :views='$options.components'></z-canvas>
  <!-- <vue-final-modal @opencomms="onOpenComms"
    v-model="showModal"
    :hide-overlay="true"
    content-class="modal-container"
    attach="false"
    :fit-parent="false"
    :drag="true"
   >
      <button class="modal__close" @click="showModal = false">
        X
      </button>
      <span class="modal__title">Hello, vue-final-modal</span>
      <div class="modal__content">
        <p v-for="i in 3" :key="i">
          Vue Final Modal is a renderless, stackable, detachable and lightweight modal component.
        </p>
      </div>
      <div class="modal__action">
        <button highlight @click="showConfirmModal = true">confirm</button>
        <button @click="showModal = false">cancel</button>
      </div>
    </vue-final-modal>
    <vue-final-modal v-model="showConfirmModal" classes="modal-container" content-class="modal-content">
      <button class="modal__close" @click="showConfirmModal = false">
        X
      </button>
      <span class="modal__title">Confirm</span>
      <div class="modal__content">Confirm to submit.</div>
      <div class="modal__action">
        <v-button @click="confirm">confirm</v-button>
        <v-button @click="showConfirmModal = false">cancel</v-button>
      </div>
    </vue-final-modal> -->
</template>
<script>
// TO SET UP VUE-ROUTER UNCOMMENT THE FOLLOWING LINES
// import Vue from 'vue'
// import Router from 'vue-router'
// Vue.use(Router)
// const router = new Router()
export default {
  components: {
    holon: () => import('./views/holon'),
    tasks: () => import('./views/tasks'),
    holons: () => import('./views/holons'),
    users: () => import('./views/users'),
    projects: () => import('./views/projects'),
    settings: () => import('./views/settings')
  },
  methods: {
    onOpenComms (id) {
      console.log('opening ' + id) // someValue
    }
  },
  mounted () {
    this.$zircle.config({
      usePercentSizes:  true,
      mode: 'full',
      style: {
        theme: 'black',
        mode: 'dark'
      },
      debug: false
    })
    this.$zircle.toView('holon')
    //
    //   to: 'holon',
    //   params: { id: 'home' } // Optional
    // })
  }
}
</script>
<style>
a {
  color:  var( --primary);
  font-style: bold
}
@import url('https://fonts.googleapis.com/css?family=Source+Sans+Pro:400,700');
@import url('https://use.fontawesome.com/releases/v5.1.0/css/all.css');
</style>
