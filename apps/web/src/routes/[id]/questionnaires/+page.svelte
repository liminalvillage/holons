<script lang="ts">
  import Questionnaires from '../../../components/Questionnaires.svelte';
  import { page } from '$app/stores';
  import { ID } from '../../../dashboard/store';
  import { onMount } from 'svelte';

  // Keep the global ID store in sync with the route parameter
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
  <title>Questionnaires</title>
</svelte:head>

<Questionnaires /> 