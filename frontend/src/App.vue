<template>
  <div id="app" class="container mx-auto pt-8">
    <router-view :key="$route.name + ($route.params.holon || '')" />

    <v-tour name="myTour" :steps="steps"></v-tour>
    <button
      @click="startTour"
      class="fixed right-0 bottom-0 border border-gray-600 text-gray-600 hover:border-gray-100 hover:text-gray-100 p-4 rounded-full w-16 h-16 mr-12 mb-12"
      title="start a tour"
    >
      <font-awesome-icon :icon="['fas', 'info']" size="xl" />
    </button>
  </div>
</template>
<script>
export default {
  name: "stats",
  data() {
    return {
      steps: [
        {
          target: "#v-step-0",
          header: {
            title: "Get Started"
          },
          content: `Welcome to <strong> Holons </strong> the new way of sharing rewards using appreciation!`
        },
        {
          target: ".v-step-1",
          content: "Each member can send appreciation to other members, but not to themselves!",
          params: {
            placement: "bottom",
            enableScrolling: false
          }
        },
        {
          target: ".v-step-2",
          content: "Any transaction sent to the holon will be split to its members according to the received appreciation ",
          params: {
            placement: "bottom",
            enableScrolling: false
          }
        },
        {
          target: ".v-step-3",
          content: "Click here to create your holon or add members to it",
          params: {
            placement: "left",
            enableScrolling: false
          }
        },
        {
          target: ".v-step-4",
          content: "Other holons can also be members, so holons (and rewards) are stackable! Click on an holon to navigate into it.",
          params: {
            placement: "left",
            enableScrolling: false
          }
        }
      ]
    };
  },
  methods: {
    startTour() {
      this.$tours["myTour"].start();
    }
  }
};
</script>
<style lang="scss">
#app {
  font-family: "Avenir", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
}

#nav {
  padding: 30px;
}
</style>

  