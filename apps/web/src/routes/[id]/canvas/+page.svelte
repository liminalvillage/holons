<script lang="ts">
    import CanvasView from '../../../components/CanvasView.svelte';
    import { page } from '$app/stores';
    import { goto } from '$app/navigation';
    import { ID } from '../../../dashboard/store';
    import { onMount } from 'svelte';

    // Synchronize the ID store with URL params (mirrors the other holon routes).
    $: if ($page.params.id && $page.params.id !== $ID) {
        ID.set($page.params.id);
    }

    onMount(() => {
        if ($page.params.id) {
            ID.set($page.params.id);
        }
    });

    $: holonId = $page.params.id;

    function handleCanvasEscape() {
        goto(`/${holonId}/tasks`);
    }
</script>

<svelte:head>
    <title>Canvas</title>
</svelte:head>

<div class="w-full h-[calc(100vh-4rem)] p-2">
    {#if holonId}
        <CanvasView
            holonID={holonId}
            canvasId={holonId}
            mode="standalone"
            on:escape={handleCanvasEscape}
        />
    {/if}
</div>
