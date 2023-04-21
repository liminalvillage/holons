<template>
  <div
    class="circle row-2 c-1"
    :class="{
      'border border-blue-900 rounded-full': showAddField,
    }"
  >
    <div
      class="c-inner text-white text-2xl  cursor-pointer overflow-hidden "
      :class="{
        'circleXL bg-white border border-blue-700': showAddField,
      }"
    >
      <form v-show="showAddField" class="w-full max-w-sm">
        <div
          v-if="addingMember"
          class="flex items-center border-b border-b-2 border-blue-700 py-2 mb-8"
        >
          <input
            class="appearance-none bg-transparent border-none w-full text-black mr-3 py-1 px-5 leading-tight placeholder-blue-700 focus:outline-none"
            type="text"
            placeholder="address"
            v-model="address"
            aria-label="Full name"
          />
        </div>
        <div class="flex items-center border-b border-b-2 border-blue-700 py-2">
          <input
            class="appearance-none bg-transparent border-none w-full text-black mr-3 py-1 px-5 leading-tight placeholder-blue-700 focus:outline-none"
            type="text"
            v-model="name"
            placeholder="name"
            aria-label="Full name"
          />
          <button
            class="flex-shrink-0 border-transparent border-4 text-blue-700 hover:text-blue-800 text-sm py-1 px-2 rounded"
            type="button"
            @click="debounceClose"
          >
            Cancel
          </button>
          <button
            class="flex-shrink-0 bg-blue-500 hover:bg-blue-700 border-blue-500 hover:border-blue-700 text-sm border-4 text-white py-1 px-2 rounded"
            type="button"
            @click="debounceAdd"
          >
            <span v-if="addingMember"> add member</span>
            <span v-else>add holon</span>
          </button>
        </div>
      </form>

      <button
        v-show="!showAddField"
        @click="$emit('visible', true)"
        class=" p-1 hover:bg-blue-600  text-white w-full h-full "
      >
        holon
      </button>
      <font-awesome-icon icon="plus" class="text-3xl absolute" />
      <button
        class="p-1 hover:bg-blue-600 ease-in-out text-white w-full h-full "
        v-show="!showAddField"
        @click="addingMemberDebounce"
      >
        member
      </button>
    </div>
  </div>
</template>

<script>
import _ from "lodash";
export default {
  name: "AddMember",
  props: {
    showAddField: {
      required: true,
      default: false,
    },
  },
  data() {
    return {
      name: null,
      address: null,
      addingMember: false,
    };
  },
  methods: {
    resetInput() {
      this.address = null;
      this.name = null;
      this.addingMember = false;
    },
    addingMemberDebounce: _.debounce(function() {
      this.addingMember = true;
      this.$emit("visible", true);
    }, 200),
    debounceClose: _.debounce(function() {
      this.$emit("visible", false);
      this.resetInput();
    }, 200),
    debounceAdd: _.debounce(function() {
      if (this.addingMember) {
        this.$emit("addMember", this.address, this.name);
      } else {
        this.$emit("addHolon", this.name);
      }

      this.resetInput();
    }, 200),
  },
};
</script>
