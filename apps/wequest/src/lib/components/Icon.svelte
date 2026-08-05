<script lang="ts">
  import { ICON_PATHS, type IconName } from "$lib/icons";

  export let name: IconName;
  export let size = 22;
</script>

<svg
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width="2.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  style="display:block;flex:none"
>
  {#each ICON_PATHS[name].split("|") as d (d)}
    <path {d} />
  {/each}
</svg>
