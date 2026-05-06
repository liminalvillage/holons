<script lang="ts">
    import HolonNavigator from '../../components/Navigator.svelte';

    import { goto } from '$app/navigation';

    function handleHolonSelect(event) {
        const { key, holon } = event.detail;
        // Handle holon selection, e.g. navigate to holon page
        console.log('Selected holon:', key, holon);
        
        // Navigate to the holon dashboard
        if (key) {
            goto(`/${key}/dashboard`);
        }
    }
</script>

<svelte:head>
    <title>Holon Navigator</title>
    <meta name="description" content="Navigate and explore the holonic network structure" />
</svelte:head>

<div class="p-6">
    <h1 class="text-2xl font-bold text-white mb-6">Holon Navigator</h1>
    <HolonNavigator on:holonSelect={handleHolonSelect} />
</div> 