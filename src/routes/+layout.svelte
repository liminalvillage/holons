<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { HoloSphere } from "holosphere"
	import Layout from '../dashboard/Layout.svelte';
	import TelegramSplash from '../components/TelegramSplash.svelte';
	import HolosphereProvider from '../components/HolosphereProvider.svelte';
	import { nostrStore, nostrPrivateKey } from '$lib/stores/nostr';
	import { holosphereStore } from '$lib/stores/holosphere';
	import { ID } from '../dashboard/store';

	// Track if user has passed the splash screen
	let showSplash = true;
	let splashComplete = false;
	let holosphere: any = null;

	// Subscribe to holosphere store for reactive updates
	$: holosphere = $holosphereStore;

	let environmentName: string =
		import.meta.env.VITE_LOCAL_MODE === "development" ? "HolonsDebug" : "Holons";

	console.log(import.meta.env.VITE_LOCAL_MODE)
	console.log("Environment:", environmentName)

	// GC interval reference
	let gcInterval: ReturnType<typeof setInterval>;

	// Initialize user's personal holon with their public key as ID
	async function initializeUserHolon() {
		if (!holosphere || !holosphere.client?.publicKey) return;

		const userPublicKey = holosphere.client.publicKey;
		console.log('Initializing user holon with ID:', userPublicKey);

		try {
			// Check if holon settings already exist with retry logic
			// Relay data may take time to sync on first connection
			let existingSettings = null;
			const maxRetries = 3;
			const retryDelay = 500; // ms

			for (let attempt = 0; attempt < maxRetries; attempt++) {
				existingSettings = await holosphere.get(userPublicKey, 'settings');
				if (existingSettings && existingSettings.name) {
					console.log('Existing holon found on attempt', attempt + 1, ':', existingSettings.name);
					break;
				}
				if (attempt < maxRetries - 1) {
					console.log('Settings not found, retrying in', retryDelay, 'ms (attempt', attempt + 1, ')');
					await new Promise(resolve => setTimeout(resolve, retryDelay));
				}
			}

			if (!existingSettings || !existingSettings.name) {
				// First time login - create the holon with default settings
				console.log('First time user - creating personal holon');
				await holosphere.write(userPublicKey, 'settings', {
					id: userPublicKey,
					name: 'My Holon',
					purpose: 'Personal holon',
					createdAt: Date.now(),
					createdBy: userPublicKey
				});
			}

			// Set the ID store to the user's public key (their personal holon)
			ID.set(userPublicKey);
			console.log('User holon initialized and ID set to:', userPublicKey);

			// Only navigate to dashboard if not already on a holon-specific route
			const currentPath = $page.url.pathname;
			const hasHolonInPath = currentPath.split('/').filter(Boolean).length > 0 &&
				currentPath !== '/' &&
				!currentPath.startsWith('/federated') &&
				!currentPath.startsWith('/navigator') &&
				!currentPath.startsWith('/sdgs') &&
				!currentPath.startsWith('/qr');

			if (!hasHolonInPath) {
				goto(`/${userPublicKey}/dashboard`);
			}
		} catch (error) {
			console.error('Failed to initialize user holon:', error);
			// Still set the ID even if settings fail
			ID.set(userPublicKey);

			// Only navigate if not already on a holon-specific route
			const currentPath = $page.url.pathname;
			if (currentPath === '/' || currentPath === '') {
				goto(`/${userPublicKey}/dashboard`);
			}
		}
	}

	// Grant capability token to the holosphere service key for federation
	async function grantFederationCapability(privateKey: string) {
		if (!holosphere) return;

		const holospherePrivateKey = import.meta.env.VITE_HOLOSPHERE_PRIVATE_KEY;
		if (!holospherePrivateKey) {
			console.log('No holosphere service key configured, skipping federation capability grant');
			return;
		}

		try {
			// Get the holosphere service public key
			const holospherePublicKey = await holosphere.getPublicKey(holospherePrivateKey);
			const userPublicKey = holosphere.client.publicKey;

			console.log('Granting federation capability to service key:', holospherePublicKey);

			// Store the holosphere service public key in global table
			await holosphere.writeGlobal('federation_keys', {
				id: 'holosphere_service',
				publicKey: holospherePublicKey,
				description: 'Main holosphere service key for federated community access',
				updatedAt: Date.now()
			});

			// Issue capability token with full permissions for all holons/lenses
			const capabilityToken = await holosphere.issueCapability(
				['read', 'write', 'delete'],
				{ holonId: '*', lensName: '*' },
				holospherePublicKey,
				{ issuerKey: privateKey, expiresIn: 365 * 24 * 60 * 60 * 1000 }
			);

			// Store the capability token in federation_capabilities global table
			await holosphere.writeGlobal('federation_capabilities', {
				id: userPublicKey,
				grantorPublicKey: userPublicKey,
				recipientPublicKey: holospherePublicKey,
				token: capabilityToken,
				permissions: ['read', 'write', 'delete'],
				scope: { holonId: '*', lensName: '*' },
				grantedAt: Date.now(),
				expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000
			});

			console.log('Federation capability granted and stored successfully');
		} catch (error) {
			console.error('Failed to grant federation capability:', error);
		}
	}

	// Initialize HoloSphere with the given private key
	async function initHoloSphere(privateKey: string) {
		if (holosphere) {
			console.log('HoloSphere already initialized');
			return;
		}

		console.log('Initializing HoloSphere with user key...');

		holosphere = new HoloSphere({
			appName: environmentName,
			privateKey: privateKey,
			backend: 'nostr',
			nostr: {
				relays: ['wss://relay.holons.io'],  // Nostr relay server
				persistence: true
			}
		});

		// Wait for Nostr backend to be ready (async initialization)
		await holosphere.ready();

		// Log the public key for verification
		if (holosphere.client) {
			console.log("HoloSphere Public Key:", holosphere.client.publicKey);
		}

		// Update the global store (this can be called from async callbacks)
		holosphereStore.set(holosphere);

		// Initialize the user's personal holon with their public key as ID
		initializeUserHolon();

		// Grant capability token to the holosphere service key for federation
		grantFederationCapability(privateKey);

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
	async function handleAuthenticated(event: CustomEvent) {
		console.log('User authenticated with public key:', event.detail.publicKey, 'mode:', event.detail.mode);

		// Determine which private key to use
		let privateKey: string | null = null;

		if (event.detail.mode === 'public') {
			// Public space mode - use the holosphere key from .env
			privateKey = import.meta.env.VITE_HOLOSPHERE_PRIVATE_KEY;
			console.log('Using holosphere env key for public space');
		} else {
			// Private mode - get the private key from the store
			const state = nostrStore.getState();
			privateKey = state.privateKey;
		}

		if (privateKey) {
			await initHoloSphere(privateKey);
		} else {
			console.error('No private key available for initialization');
		}

		// Small delay for smooth transition
		setTimeout(() => {
			showSplash = false;
			splashComplete = true;
		}, 500);
	}

	async function handleSkip() {
		// Dev-only skip - use env key as fallback
		const fallbackKey = import.meta.env.VITE_HOLOSPHERE_PRIVATE_KEY;
		if (fallbackKey) {
			await initHoloSphere(fallbackKey);
		}
		showSplash = false;
		splashComplete = true;
	}
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
	<HolosphereProvider>
		<Layout>
			<slot />
		</Layout>
	</HolosphereProvider>
{/if}
