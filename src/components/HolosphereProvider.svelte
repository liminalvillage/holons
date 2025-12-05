<script lang="ts">
	import { setContext } from 'svelte';
	import { holosphereStore } from '$lib/stores/holosphere';

	// Get the current holosphere value from the store
	// This component is only rendered when holosphere is already initialized
	const holosphere = $holosphereStore;

	// Set context synchronously during component initialization
	// Child components can use getContext('holosphere') to access it
	setContext('holosphere', holosphere);
</script>

<slot />
