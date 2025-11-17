<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { initWeb3 } from '$lib/libs/web3';

	let { children } = $props();

	onMount(async () => {
		try {
			await initWeb3();
		} catch (error) {
			console.error('Failed to initialize Web3:', error);
		}
	});
</script>

<svelte:head>
	<title>Holons - Share rewards using appreciation</title>
	<link rel="icon" href="/logo.png" />
</svelte:head>

<div id="app" class="container mx-auto pt-8">
	{@render children()}
</div>

<style>
	#app {
		font-family: "Avenir", Helvetica, Arial, sans-serif;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		text-align: center;
		color: #2c3e50;
	}
</style>
