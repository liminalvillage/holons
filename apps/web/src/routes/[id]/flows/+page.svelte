<script lang="ts">
  import Flows from '../../../components/flows/Flows.svelte';
  import { page } from '$app/stores';
  import { ID } from '../../../dashboard/store';
  import { onMount } from 'svelte';

  $: holonId = $page.params.id;

  // Synchronize the ID store with URL params
  $: if ($page.params.id && $page.params.id !== $ID) {
    ID.set($page.params.id);
  }

  onMount(() => {
    if ($page.params.id) {
      ID.set($page.params.id);
    }
  });
</script>

<svelte:head>
  <title>Value Flows - Holon {holonId}</title>
  <meta
    name="description"
    content="Value movement and resource allocation for Holon {holonId}"
  />
</svelte:head>

<Flows />
