<script lang="ts">
	import { setContext } from 'svelte';
	import { holosphereStore } from '$lib/stores/holosphere';

	// Get the current holosphere value from the store
	// This component is only rendered when holosphere is already initialized
	const holosphere = $holosphereStore;

	// Set context synchronously during component initialization
	// Child components can use getContext('holosphere') to access it
	//
	// Note: Federation-aware reads are handled inside holosphere2 itself.
	// When storeInboundCapability() is called, it registers the holon -> owner mapping,
	// so read() automatically resolves federated holons to their owner's data.
	setContext('holosphere', holosphere);
</script>

<slot />
