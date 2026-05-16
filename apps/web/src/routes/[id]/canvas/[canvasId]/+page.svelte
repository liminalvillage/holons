<script lang="ts">
    import CanvasView from '../../../../components/CanvasView.svelte';
    import { page } from '$app/stores';
    import { goto } from '$app/navigation';
    import { ID } from '../../../../dashboard/store';
    import { onMount } from 'svelte';

    $: if ($page.params.id && $page.params.id !== $ID) {
        ID.set($page.params.id);
    }

    onMount(() => {
        if ($page.params.id) {
            ID.set($page.params.id);
        }
    });

    $: holonId = $page.params.id;
    $: canvasId = $page.params.canvasId;

    // Task canvases are keyed as `task_<questId>_canvas`. When the user
    // hits Escape with nothing selected, navigate back to the Tasks view
    // with ?task=<questId> so Tasks.svelte re-opens the same TaskModal.
    function questIdFromCanvasId(cid: string | undefined): string | null {
        if (!cid) return null;
        const m = cid.match(/^task_(.+)_canvas$/);
        return m ? m[1] : null;
    }

    function handleCanvasEscape() {
        const questId = questIdFromCanvasId(canvasId);
        if (questId) {
            goto(`/${holonId}/tasks?task=${encodeURIComponent(questId)}`);
        } else {
            goto(`/${holonId}/tasks`);
        }
    }
</script>

<svelte:head>
    <title>Canvas</title>
</svelte:head>

<div class="w-full h-[calc(100vh-4rem)] p-2">
    {#if holonId && canvasId}
        <CanvasView
            holonID={holonId}
            {canvasId}
            mode="standalone"
            on:escape={handleCanvasEscape}
        />
    {/if}
</div>
