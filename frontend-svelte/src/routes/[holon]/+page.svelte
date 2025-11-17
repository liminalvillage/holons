<script lang="ts">
	import HolonContainer from '$lib/components/HolonContainer.svelte';
	import { page } from '$app/stores';

	const holonAddress = $derived($page.params.holon);
</script>

<div>
	<HolonContainer holonNav={holonAddress} />
</div>
