<script lang="ts">
	import Map from '../../../components/Map.svelte';
</script>

<div class="h-full w-full">
	<Map />
</div>

<style>
	/* Ensure the container takes full height */
	div {
		height: calc(100vh - 64px); /* Adjust this value based on your TopBar height */
	}
</style>
