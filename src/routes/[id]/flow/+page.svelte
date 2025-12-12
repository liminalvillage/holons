<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { ID } from '../../../dashboard/store';
  import FlowManagement from '../../../components/FlowManagement.svelte';

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
  <title>Flow Management - Holon {holonId}</title>
  <meta name="description" content="Manage value flows and federation for Holon {holonId}" />
</svelte:head>

<FlowManagement holonId={holonId} />
