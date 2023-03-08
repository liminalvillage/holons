<template>
  <section>
    <div class="container">
      <div class="m-grid-outer">
        <transition-group
          class="m-grid-container"
          :class="{ 'grid-gap': this.layout == 3, 'row-4 c-3': this.hidden }"
          name="gridmove-move"
        >
          <div
            v-for="(message, index) in options"
            class="circle circle-blue"
            :class="
              index <= sliderValue ? layoutActive[index] : 'row-4 c-3 c-home'
            "
            :key="index"
          >
            <div class=" c-inner"></div>
          </div>
        </transition-group>
        <div class="slider z-10 absolute ">
          <circle-slider
            class="slider-inner"
            v-model="sliderValue"
            :side="200"
            :min="0"
            :max="6"
            :circleColor="'rgba(255,255,255,0.0)'"
            :progressColor="'rgba(255,255,255,0.0)'"
            :knobColor="'#FEFCD7'"
            :step-size="1"
            :circle-width="10"
            :circle-width-rel="10"
            :progressWidth="2"
            :knob-radius="10"
          ></circle-slider>
        </div>
        <img class="absolute arrow" src="@/assets/arrow.svg" />
      </div>
      <img class="absolute img-full" src="@/assets/metamoon.svg" />
    </div>
  </section>
</template>

<script>
import _ from "lodash";
import { wrapGrid } from "animate-css-grid";
export default {
  name: "MetaSllide",
  data() {
    return {
      sliderValue: -1,
      layout: 1,
      options: [
        { message: "Foo" },
        { message: "Bar" },
        { message: "Foo" },
        { message: "Bar" },
        { message: "Foo" },
        { message: "Bar" }
      ],
      class1: [
        "row-7 c-3 ",
        "row-6 c-1 ",
        "row-2 c-1 ",
        "row-1 c-3 ",
        "row-2 c-5 ",
        "row-6 c-5 "
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
        "row-7 c-3"
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
        "row-4 c-5"
      ],
      class4: [
        "row-6 c-3",
        "row-7 c-3 c-light",
        "row-5 c-2",
        "row-6 c-1 c-light",
        "row-3 c-2",
        "row-2 c-1 c-light",
        "row-2 c-3",
        "row-1 c-3 c-light",
        "row-3 c-4",
        "row-2 c-5 c-light",
        "row-5 c-4",
        "row-6 c-5 c-light"
      ],

      name: "",
      selected: null
    };
  },
  computed: {
    hidden() {
      if (this.options.length == 0) {
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
    optionsActive() {
      return _.takeRight(this.options, this.sliderValue + 1);
    }
  },
  mounted() {
    const grid = document.querySelector(".m-grid-container");
    wrapGrid(grid, {
      // stagger: 200,
      // int: default is 250 ms
      duration: 250,
      // string: default is 'easeInOut'
      easing: "easeOut"

      // function: called with list of elements about to animate
    });
  }
};
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped lang="scss">
.m-grid-container {
  transform: scale(0.6);
}
.z-10 {
  z-index: 10;
}

.absolute {
  position: absolute;
  top: 0;
  left: 50%;
  color: white;
  font-size: 2rem;
  z-index: 100;
  transform: translate(-50%, 0);
  text-align: center;
}
.slider {
  width: 36vw;
  text-align: center;
  margin-top: 1.5vw;
  .slider-inner {
    svg {
      width: 100% !important;
      height: 100% !important;
    }
  }
}
.img-full {
  margin-top: 2vw;
  height: auto;
  width: 30vw;

  z-index: 2;
  filter: drop-shadow(3px 4px 8px rgba(0, 0, 0, 0.25));
}
.arrow {
  z-index: 20;
  bottom: 22%;
  top: auto;
  width: 4vw;
  transform-origin: left center;
  animation: fade-turn 1.5s 2s ease-out;
  opacity: 0;
  transform: translate(-5rem, -1rem) rotate(10deg);
  animation-iteration-count: 3;
}
@keyframes fade-turn {
  0% {
    opacity: 1;
    transform: translate(-1rem, 0rem);
  }
  100% {
    opacity: 0;
    transform: translate0(-5rem, -1rem) rotate(10deg);
  }
}
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
