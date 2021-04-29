// This is the main.js file. Import global CSS and scripts here.
// The Client API can be used here. Learn more: gridsome.org/docs/client-api

import '~/assets/css/main.scss'

import DefaultLayout from '~/layouts/Default.vue'
import HeroLayout from '~/layouts/Hero.vue'
import NavBar from '~/components/NavBar.vue'
import Footer from '~/components/Footer.vue'
import HeroContainer from '~/components/HeroContainer.vue'
import Card from '~/components/Card.vue'
import VueScrollTo from 'vue-scrollto'


export default function (Vue, {
  router,
  head,
  isClient
}) {
  // Set default layout as a global component
  Vue.component('LayoutDefault', DefaultLayout)
  Vue.component('LayoutHero', HeroLayout)

  //add page parts as default components
  Vue.component('nav-bar', NavBar)
  Vue.component('hero-container', HeroContainer)
  Vue.component('g-footer', Footer)

  //cards
  Vue.component('card', Card)

  //initilize other plugins
  Vue.use(VueScrollTo)
}