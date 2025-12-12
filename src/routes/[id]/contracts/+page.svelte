<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { ID } from '../../../dashboard/store';
  import ContractDeploy from '../../../components/ContractDeploy.svelte';

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
  <title>Contracts - Holon {holonId}</title>
  <meta name="description" content="Deploy and manage smart contracts for Holon {holonId}" />
</svelte:head>

<ContractDeploy holonId={holonId} />
