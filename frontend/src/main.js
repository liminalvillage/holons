import Vue from "vue";

import "@/design/scss/index.scss";

import "./plugins/fontawesome";
import App from "./App.vue";
import "./registerServiceWorker";
import router from "./router";
import store from "./store";
import VueTour from 'vue-tour'

require('vue-tour/dist/vue-tour.css')

import VueRouter from 'vue-router'



Vue.use(VueRouter)
Vue.use(VueTour)

Vue.component("modal", () => import("./components/Modal.vue"));
Vue.component("holon-add", () => import("./components/HolonAddEntity.vue"));
Vue.component("holon-stats", () => import("./components/profile/Stats.vue"));
Vue.config.productionTip = false;

new Vue({
  router,
  store,
  render: (h) => h(App),
}).$mount("#app");