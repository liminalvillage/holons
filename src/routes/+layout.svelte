<script lang="ts">
	import { setContext, onDestroy, onMount } from 'svelte';
	import { HoloSphere } from "holosphere"
	import Layout from '../dashboard/Layout.svelte';
	import TelegramSplash from '../components/TelegramSplash.svelte';
	import { nostrStore, nostrPrivateKey } from '$lib/stores/nostr';

	// Track if user has passed the splash screen
	let showSplash = true;
	let splashComplete = false;
	let holosphere: any = null;

	let environmentName: string =
		import.meta.env.VITE_LOCAL_MODE === "development" ? "HolonsDebug" : "Holons";

	console.log(import.meta.env.VITE_LOCAL_MODE)
	console.log("Environment:", environmentName)

	// GC interval reference
	let gcInterval: ReturnType<typeof setInterval>;

	// Initialize HoloSphere with the given private key
	function initHoloSphere(privateKey: string) {
		if (holosphere) {
			console.log('HoloSphere already initialized');
			return;
		}

		console.log('Initializing HoloSphere with user key...');

		holosphere = new HoloSphere({
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
		}

		// Set the context for child components
		setContext('holosphere', holosphere);

		// Periodically check for garbage collection opportunities
		gcInterval = setInterval(() => {
			try {
				const largeArray = new Array(10 * 1024 * 1024).fill(0);
				setTimeout(() => {
					largeArray.length = 0;
				}, 50);
			} catch (e) {
				// Ignore any errors
			}
		}, 60 * 1000);
	}

	// Clean up on destroy
	onDestroy(() => {
		if (gcInterval) {
			clearInterval(gcInterval);
		}
	});

	// Handle splash screen completion
	function handleAuthenticated(event: CustomEvent) {
		console.log('User authenticated with public key:', event.detail.publicKey);

		// Get the private key from the store
		const state = nostrStore.getState();
		if (state.privateKey) {
			initHoloSphere(state.privateKey);
		}

		// Small delay for smooth transition
		setTimeout(() => {
			showSplash = false;
			splashComplete = true;
		}, 500);
	}

	function handleSkip() {
		// Dev-only skip - use env key as fallback
		const fallbackKey = import.meta.env.VITE_HOLOSPHERE_PRIVATE_KEY;
		if (fallbackKey) {
			initHoloSphere(fallbackKey);
		}
		showSplash = false;
		splashComplete = true;
	}

	// Set context placeholder immediately for SSR
	setContext('holosphere', null);
</script>

<svelte:head>
	<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
</svelte:head>

<!-- Show splash screen for identity setup -->
{#if showSplash}
	<TelegramSplash on:authenticated={handleAuthenticated} on:skip={handleSkip} />
{/if}

<!-- Main app content (hidden while splash is showing) -->
{#if !showSplash && holosphere}
	<Layout>
		<slot />
	</Layout>
{/if}
