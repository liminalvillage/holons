<template>
  <transition name="modal">
    <div class="modal-mask">
      <div class="modal-wrapper">
        <div class="modal-container relative">
          <button
            class="absolute top-0 right-0 text-blue-600 m-2"
            @click="$emit('close')"
          >
            <font-awesome-icon icon="times-circle" />
          </button>
          <div class="modal-header ">
            <h3 v-if="header" class="font-bold text-xl mb-2">{{ header }}</h3>
            <slot name="header"> </slot>
          </div>

          <div class="modal-body">
            <slot name="body"> </slot>
          </div>

          <div class="modal-footer text-right ">
            <button
              class="bg-gray-300 hover:bg-gray-400 rounded-full px-3 py-1 text-sm font-semibold m-2"
              @click="$emit('close')"
            >
              cancel
            </button>
            <slot name="footer"> </slot>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script>
export default {
  name: "Modal",
  props: {
    header: {
      required: false,
    },
  },
};
</script>
