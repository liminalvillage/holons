<script lang="ts">
	import { setContext, onDestroy, onMount } from 'svelte';
	import { HoloSphere } from "holosphere"
	import Layout from '../dashboard/Layout.svelte';
	import TelegramSplash from '../components/TelegramSplash.svelte';
	import { telegramStore, isAuthenticated } from '$lib/stores/telegram';
	// Removed debug components to avoid interference

	// Track if user has passed the splash screen
	let showSplash = true;
	let splashComplete = false;

    let environmentName: string =
        import.meta.env.VITE_LOCAL_MODE === "development" ? "HolonsDebug" : "Holons";

	console.log(import.meta.env.VITE_LOCAL_MODE)
    console.log("Environment:", environmentName)

	// Get the shared private key from environment (shared with HolonsBot)
	const privateKey = import.meta.env.VITE_HOLOSPHERE_PRIVATE_KEY;

	// Create holosphere instance with shared private key
	// This allows harvest to access the same data as HolonsBot
	const holosphere = new HoloSphere({
		appName: environmentName,
		privateKey: privateKey,
		relays: [
			'wss://relay.holons.io'     // Main Holons relay
		],
		enablePing: false  // Disable ping to prevent connection closure issues
	});

	// Log the public key for verification
	if (holosphere.client) {
		console.log("HoloSphere Public Key:", holosphere.client.publicKey);
		console.log("Expected:", "fe256f089d7c007806418bcabfa87f5a760931ee2528e44a0654d18097ccf00c");
	}

	// Configure GunDB for better peer discovery after initialization
	setTimeout(() => {
		if (holosphere && holosphere.gun) {


		}
	}, 1000); // Wait for HoloSphere to initialize

	// Periodically check for garbage collection opportunities
	const gcInterval = setInterval(() => {
		// Request browser to run garbage collection by forcing memory pressure
		try {
			// Create and quickly release a large array to hint the browser
			// that it might want to run GC
			const largeArray = new Array(10 * 1024 * 1024).fill(0);
			setTimeout(() => {
				// Release the reference immediately
				largeArray.length = 0;
			}, 50);
		} catch (e) {
			// Ignore any errors, this is just an optimization
		}
	}, 60 * 1000); // Run every minute
	
	// Set the context here, before any child components
	setContext('holosphere', holosphere);
	
	// Clean up on destroy
	onDestroy(() => {
		clearInterval(gcInterval);
	});

	// Handle splash screen completion
	function handleAuthenticated(event: CustomEvent) {
		console.log('User authenticated:', event.detail.user);
		// Small delay for smooth transition
		setTimeout(() => {
			showSplash = false;
			splashComplete = true;
		}, 500);
	}

	function handleSkip() {
		// Dev-only skip
		showSplash = false;
		splashComplete = true;
	}

	// Check if already authenticated on mount
	onMount(() => {
		const unsubscribe = telegramStore.subscribe((state) => {
			if (!state.isLoading && state.isAuthenticated && !splashComplete) {
				// Already authenticated, skip splash after brief display
				setTimeout(() => {
					showSplash = false;
					splashComplete = true;
				}, 800);
			}
		});

		return unsubscribe;
	});
</script>

<svelte:head>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
</svelte:head>

<!-- Show splash screen for Telegram authentication -->
{#if showSplash}
	<TelegramSplash on:authenticated={handleAuthenticated} on:skip={handleSkip} />
{/if}

<!-- Main app content (hidden while splash is showing) -->
{#if !showSplash}
	<Layout>
		<slot />
	</Layout>
{/if}

<!-- Debug components removed to avoid interference -->
