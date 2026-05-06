<script lang="ts">
  import Calendar from '../../../components/Calendar.svelte';
  import { page } from '$app/stores';
  import { ID } from '../../../dashboard/store';
  import { onMount } from 'svelte';

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
  <title>Schedule</title>
</svelte:head>

<div class="p-0">
  <Calendar />
</div>
