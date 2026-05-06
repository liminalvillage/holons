<script lang="ts">
    import Calendar from '../../../components/Calendar.svelte';
    import { page } from '$app/stores';
    import { ID } from '../../../dashboard/store';
    import { onMount } from 'svelte';

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

    function handleDateSelect(event) {
        const { date, events } = event.detail;
        console.log('Selected date:', date);
        console.log('Events:', events);
    }
</script>

<svelte:head>
    <title>Schedule</title>
</svelte:head>

<div class="p-0">
    <Calendar on:dateSelect={handleDateSelect} />
</div> 