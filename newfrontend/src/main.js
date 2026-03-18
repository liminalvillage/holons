import Vue from 'vue'
import App from './App.vue'
import modal from 'vue-js-modal'
import zircle from 'zircle'
import 'zircle/dist/zircle.css'
import Vuex from 'vuex'
import Router from 'vue-router'

const routes = [
  { path: '/', component: App },
  { path: '/:holonId/:lense', component: App },
  { path: '/:holonId', component: App }
]
Vue.use(Router)
Vue.use(Vuex)

const store = new Vuex.Store({
  state: {
    language: 'en'
  },
  mutations: {
    setLanguage (state, language) {
      state.language = language
    }
  }
})
Vue.use(zircle)
Vue.config.productionTip = false

// Register Zircle views as global async components
// (Zircle's <component :is> needs resolved components, not raw async functions)
Vue.component('holon', function(resolve) { import('./views/holon').then(m => resolve(m.default)) })
Vue.component('tasks', function(resolve) { import('./views/tasks').then(m => resolve(m.default)) })
Vue.component('holons', function(resolve) { import('./views/holons').then(m => resolve(m.default)) })
Vue.component('users', function(resolve) { import('./views/users').then(m => resolve(m.default)) })
Vue.component('projects', function(resolve) { import('./views/projects').then(m => resolve(m.default)) })
Vue.component('settings', function(resolve) { import('./views/settings').then(m => resolve(m.default)) })

const router = new Router({ routes, mode: 'history' })

new Vue({
  store,
  modal,
  router,
  render: h => h(App)
}).$mount('#app')
