<script lang="ts">
    import HolonNavigator from '../../../components/Navigator.svelte';

    function handleHolonSelect(event) {
        const { key, holon } = event.detail;
        // Handle holon selection, e.g. navigate to holon page
        console.log('Selected holon:', key, holon);
    }
</script>

<div class="p-6">
    <h1 class="text-2xl font-bold text-white mb-6">Holon Navigator</h1>
    <HolonNavigator on:holonSelect={handleHolonSelect} />
</div> 