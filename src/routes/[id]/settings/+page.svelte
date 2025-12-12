<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { ID } from '../../../dashboard/store';
  import Settings from '../../../components/Settings.svelte';

  // Reactive holonId that updates when URL changes
  $: holonId = $page.params.id;

  // Synchronize the ID store with URL params
  $: if ($page.params.id && $page.params.id !== $ID) {
    ID.set($page.params.id);
  }

  onMount(() => {
    // Ensure ID is set on initial mount
    if ($page.params.id) {
      ID.set($page.params.id);
    }
  });
</script>

<svelte:head>
  <title>Settings - Holon {holonId}</title>
  <meta name="description" content="Configure settings for Holon {holonId}" />
</svelte:head>

<Settings holonId={holonId} /> 