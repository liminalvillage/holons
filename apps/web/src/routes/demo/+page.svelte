<script lang="ts">
	import { words } from '$lib/vocabulary';
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';

    onMount(() => {
        // Replace 'demo-holon-id' with your actual demo holon ID
        goto('/demo/dashboard');
    });
</script>

<div class="min-h-screen bg-gray-100 flex items-center justify-center">
    <p class="text-gray-600">Redirecting to demo {words.holon}...</p>
</div> 