<script lang="ts">
  // DNA Editor route page
  // Feature: 001-holon-dna-editor

  import { getContext } from 'svelte';
  import { page } from '$app/stores';
  import type HoloSphere from 'holosphere';
  import DNAEditor from '../../../components/DNAEditor.svelte';

  const holosphere = getContext<HoloSphere>('holosphere');
  const holonId = $derived($page.params.id);
</script>

<svelte:head>
  <title>DNA Editor - {holonId}</title>
</svelte:head>

<div class="page-container">
  {#if holosphere && holonId}
    <DNAEditor {holosphere} {holonId} />
  {:else}
    <div class="error-state">
      <svg class="w-16 h-16 text-gray-400 dark:text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
        Unable to load DNA Editor
      </h2>
      <p class="text-sm text-gray-600 dark:text-gray-400">
        {#if !holosphere}
          Holosphere context not found
        {:else if !holonId}
          No holon ID provided
        {:else}
          Unknown error
        {/if}
      </p>
    </div>
  {/if}
</div>

<style>
  .page-container {
    @apply w-full h-screen;
  }

  .error-state {
    @apply flex flex-col items-center justify-center h-full;
    @apply text-center p-8;
  }
</style>
