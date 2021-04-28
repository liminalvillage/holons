<template>
  <div >
    <div
      class="inline-block flex-initial text-xs text-green-500 font-semibold"
      :class="{ 'text-base block p-1 ': expanded }"
      title="appreciation received"
    >
      

      <font-awesome-icon :icon="['fas', 'arrow-right']" size="xs" />
      <font-awesome-icon :icon="['far', 'heart']" />
      {{ appreciation }} ({{ precentage }}%)
      <small v-if="expanded"> Recived</small>
    </div>
    <div v-if="expanded"
      class="inline-block flex-1 text-xs text-red-500 font-semibold mr-1"
      :class="{ 'text-base block p-1': expanded }"
      title="appreciation left to sent"
    >
      <font-awesome-icon :icon="['far', 'heart']" />
       <font-awesome-icon :icon="['fas', 'arrow-right']" size="xs" />
      {{ 100 - remaining }}%
       <small v-if="expanded"> Sent</small>
    </div>
    <br />
    <span
      v-if="rewards"
      class="inline-block flex-initial text-xs text-white font-semibold"
      :class="{ 'text-base block': expanded }"
      title="fund balance"
    >
      
      Ξ {{ rewards.slice(0, 5) }} /
      {{ totalrewards.slice(0, 5) }}
      <small v-if="expanded"> Recived</small>
    </span>
  </div>
</template>

<script>
export default {
  name: "stats",
  props: [
    "appreciation",
    "remaining",
    "rewards",
    "balance",
    "casted",
    "totalrewards",
    "expanded"
  ],
  data() {
    return {};
  },
  computed: {
    precentage() {
      if (this.appreciation && this.casted) {
        return Math.floor((this.appreciation / this.casted) * 100);
      } else {
        return 0;
      }
    }
  }
};
</script>
