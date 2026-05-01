<script lang="ts">
  import Calendar from '../../components/Calendar.svelte';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { ID } from '../../dashboard/store';

  $: if ($page.params.id && $page.params.id !== $ID) {
    ID.set($page.params.id);
  }

  onMount(() => {
    const holonId = $page.params.id;
    if (!holonId || holonId === 'undefined' || holonId === 'null' || holonId.trim() === '') {
      if (typeof window !== 'undefined' && window.location.pathname !== '/') {
        goto('/');
      }
      return;
    }
    ID.set(holonId);
  });
</script>

<svelte:head>
  <title>Schedule</title>
</svelte:head>

<div class="p-0">
  <Calendar />
</div>
