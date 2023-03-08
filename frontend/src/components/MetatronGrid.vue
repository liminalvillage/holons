<template>
  <section>
    <div class="container">
      <div class="control">
        <label class="radio">
          <input type="radio" name="layout" v-bind:value="1" v-model="layout" />
          relation
        </label>
        <!-- <label class="radio">
          <input type="radio" name="layout" v-bind:value="2" v-model="layout" />
          circles
        </label> -->
        <label class="radio">
          <input type="radio" name="layout" v-bind:value="3" v-model="layout" />
          grid
        </label>
      </div>
      <div class="m-grid-outer">
        <transition-group
          class="m-grid-container"
          :class="{ 'grid-gap': this.layout == 3, 'row-4 c-3': this.hidden }"
          name="gridmove-move"
        >
          <div class="circle row-4 c-3 c-search-outer" key="fixed-possition">
            <div class="c-inner c-search">
              <input
                class="input"
                type="text"
                placeholder="What are you looking for?"
                v-on:input="debounceInput"
                v-model="searchInput"
              />
              <span
                v-if="
                  this.searchInput.length > 0 && filteredDataArray.length > 0
                "
              >
                {{ this.searchInput }}
              </span>

              <span v-else> eg.coffee, car, help </span>
            </div>
          </div>
          <div
            v-for="(user, index) in filteredDataArray"
            class="circle"
            :class="!hidden ? layoutActive[index] : 'row-4 c-3 c-home'"
            :key="user.id"
          >
            <div class="c-inner">
              <svg
                class="frame"
                xmlns:svg="http://www.w3.org/2000/svg"
                xmlns="http://www.w3.org/2000/svg"
                preserveAspectRatio="xMidYMid meet"
                viewBox="1 1 36 40"
                id="svg"
              >
                <g id="shapes">
                  <path
                    class="path-hex"
                    d="M 19,5 L 33,13 L 33,29 L 19,37 L 5,29 L 5,13 L 19,5 z "
                    id="octagon"
                  />
                  <path
                    class="path-hex"
                    d="M 19,5 L 5,29 L 33,29 L 19,5 z "
                    id="triange-up"
                  />
                  <path
                    class="path-hex"
                    d="M 5,13 L 19,37 L 33,13 L 5,13 z "
                    id="triange-down"
                  />
                  <path
                    class="path-hex inner"
                    d="M 19,13 L 12,17 L 12,25 L 19,29 L 26,25 L 26,17 L 19,13 z "
                    id="octagon-inner"
                  />
                  <path
                    class="path-hex"
                    d="M 12,25 L 19,5 L 26,25 L 12,25 z "
                    id="path2894"
                  />
                  <path
                    class="path-hex"
                    d="M 19,37 L 12,17 L 26,17 L 19,37 z "
                    id="path2896"
                  />
                  <path class="path-hex" d="M 5,13 L 33,29" id="line-6-3" />
                  <path class="path-hex" d="M 5,29 L 33,13" id="line-6-2" />
                  <path class="path-hex" d="M 19,5 L 19,37" id="line=-1-3" />
                  <path
                    class="path-hex"
                    d="M 5,29 L 19,13 L 26,25 L 5,29 z "
                    id="path2904"
                  />
                  <path
                    class="path-hex"
                    d="M 33,29 L 19,13 L 12,25 L 33,29 z "
                    id="path2906"
                  />
                  <path
                    class="path-hex"
                    d="M 33,13 L 12,17 L 19,29 L 33,13 z "
                    id="path2908"
                  />
                  <path
                    class="path-hex"
                    d="M 5,13 L 19,29 L 26,17 L 5,13 z "
                    id="path2910"
                  />
                </g>
              </svg>
              <p class="is-uppercase has-text-white-bis has-text-weight-bold">
                {{ user.first_name }}
              </p>
            </div>
          </div>
        </transition-group>
      </div>
    </div>
  </section>
</template>

<script>
import _ from "lodash";
import { wrapGrid } from "animate-css-grid";

export default {
  name: "MetatronGrid",
  data() {
    return {
      layout: 1,
      checkedNames: "",
      searchInput: "",
      search: "",
      data: [],
      class1: [
        "row-2 c-3",
        "row-3 c-4",
        "row-5 c-4",
        "row-6 c-3",
        "row-5 c-2",
        "row-3 c-2",

        "row-1 c-3",
        "row-2 c-5",
        "row-6 c-5",
        "row-7 c-3",
        "row-6 c-1",
        "row-2 c-1",
      ],
      class2: [
        "row-1 c-3",
        "row-2 c-1",
        "row-2 c-3",
        "row-2 c-5",
        "row-3 c-2",
        "row-3 c-4",

        "row-5 c-2",
        "row-5 c-4",
        "row-6 c-1",
        "row-6 c-3",
        "row-6 c-5",
        "row-7 c-3",
      ],
      class3: [
        "row-1 c-1",
        "row-1 c-2",
        "row-1 c-3",
        "row-1 c-4",
        "row-1 c-5",
        "row-2 c-1",
        "row-2 c-2",
        "row-2 c-3",
        "row-2 c-4",
        "row-2 c-5",
        "row-4 c-1",
        "row-4 c-2",
        "row-4 c-3",
        "row-4 c-4",
        "row-4 c-5",
      ],

      name: "",
      selected: null,
    };
  },

  methods: {
    debounceInput: _.debounce(function () {
      this.search =
        this.searchInput.length > 0
          ? this.searchInput.toLowerCase().split(" ")
          : [];
    }, 500),
  },
  computed: {
    filteredDataArray() {
      if (this.search.length !== 0) {
        return this.data
          .filter((user) => {
            return (
              user.first_name.toLowerCase().includes(this.search) ||
              user.resources.some((item) => {
                return item.toLowerCase().includes(this.search);
              })
            );
          })
          .splice(0, 12);
      } else {
        return this.data;
      }
    },

    hidden() {
      if (this.search.length == 0) {
        return true;
      }
      return false;
    },
    layoutActive() {
      if (this.layout == 1) {
        return this.class1;
      }
      if (this.layout == 2) {
        return this.class2;
      }
      if (this.layout == 3) {
        return this.class3;
      } else {
        return [];
      }
    },
  },
  mounted() {
    const grid = document.querySelector(".m-grid-container");
    wrapGrid(grid, {
      // stagger: 200,
      // int: default is 250 ms
      duration: 500,
      // string: default is 'easeInOut'
      easing: "easeOut",

      // function: called with list of elements about to animate
    });
  },
};
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped lang="scss">
h3 {
  margin: 40px 0 0;
}
ul {
  list-style-type: none;
  padding: 0;
}
li {
  display: inline-block;
  margin: 0 10px;
}
a {
  color: #42b983;
}
</style>
