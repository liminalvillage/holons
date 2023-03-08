<template>
  <div>
    <HolonContainer :holon-nav="$route.params.holon" />
  </div>
</template>

<script>
// @ is an alias to /src
import HolonContainer from "@/components/HolonContainer.vue";

export default {
  name: "web3form",
  components: {
    HolonContainer,
  },
};
</script>
