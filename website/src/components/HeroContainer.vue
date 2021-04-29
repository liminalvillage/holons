<template>
  <div class="bg-primary-500 h-screen overflow-hidden img-bkg bg-cover bg-center" >
        <div class="relative z-10 h-screen px-4 flex justify-center items-center  hero-image">
      <slot />
    </div>
    <!-- <g-image
      v-if="bg"
      :src="setImage"
      class="w-full h-screen object-cover absolute z-10 top-0 hero-image opacity-50"
      alt="cell"
    /> -->

  </div>
</template>
<style lang="scss" scoped>

.hero-image {
  mix-blend-mode: luminosity;
}
.img-bkg {
  background-image: url(~@/assets/img/mineraltexture.jpg);
}
</style>

<script>
export default {
  props: {
    bg: {
      required: false
    }
  },
  computed: {
    setImage: function() {
      return require("@/assets/img/" + this.bg);
    }
  }
};
</script>