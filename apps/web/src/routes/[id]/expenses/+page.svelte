<script lang="ts">
    import Expenses from "../../../components/Expenses.svelte";
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
</script>

<Expenses /> 