<script lang="ts">
  // The holon's DNA. The old editor that lived here is gone with the
  // old model; the read-only front page over @holons/core/dna genes comes
  // with WP9. Until then this page only says so.

  import { page } from '$app/stores';

  const holonId = $derived($page.params.id);
</script>

<svelte:head>
  <title>DNA - {holonId}</title>
</svelte:head>

<div class="placeholder">
  <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">DNA</h2>
  <p class="text-sm text-gray-600 dark:text-gray-400">
    This holon's purpose, values and agreements will show here soon.
  </p>
</div>

<style lang="postcss">
  .placeholder {
    @apply flex flex-col items-center justify-center w-full h-full text-center p-8;
  }
</style>
