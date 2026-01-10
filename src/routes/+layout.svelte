<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { HoloSphere } from "holosphere"
	import Layout from '../dashboard/Layout.svelte';
	import TelegramSplash from '../components/TelegramSplash.svelte';
	import HolosphereProvider from '../components/HolosphereProvider.svelte';
	import { nostrStore, nostrPrivateKey } from '$lib/stores/nostr';
	import { holosphereStore } from '$lib/stores/holosphere';
	import { ID } from '../dashboard/store';
	import { addVisitedHolon } from '../utils/localStorage';
	import { createFederationService, setFederationService } from '../services/FederationService';

	// Import global design system styles
	import '../styles/index.css';

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

	// Store holon name from onboarding (if provided)
	let pendingHolonName: string | null = null;
	let pendingTelegramUserId: number | null = null;

	// Track if this is a telegram-mapped session (user without local key)
	let isTelegramMappedSession = false;
	let telegramMappedPublicKey: string | null = null;

	// Initialize user's personal holon with their public key as ID
	async function initializeUserHolon() {
		if (!holosphere || !holosphere.myHolon) return;

		// For telegram-mapped sessions, use the mapped public key instead of service key
		// Note: holosphere.myHolon is the agent's public key (1:1 agent-holon mapping)
		const userPublicKey = isTelegramMappedSession && telegramMappedPublicKey
			? telegramMappedPublicKey
			: holosphere.myHolon;
		console.log('Initializing user holon with ID:', userPublicKey, 'telegram-mapped:', isTelegramMappedSession);

		try {
			// Check if holon settings already exist with retry logic
			// Relay data may take time to sync on first connection
			let existingSettings = null;
			const maxRetries = 3;
			const retryDelay = 500; // ms

			for (let attempt = 0; attempt < maxRetries; attempt++) {
				// Pass userPublicKey as the key to fetch the specific settings record
				existingSettings = await holosphere.get(userPublicKey, 'settings', userPublicKey);
				if (existingSettings && existingSettings.name) {
					console.log('Existing holon found on attempt', attempt + 1, ':', existingSettings.name);
					break;
				}
				if (attempt < maxRetries - 1) {
					console.log('Settings not found, retrying in', retryDelay, 'ms (attempt', attempt + 1, ')');
					await new Promise(resolve => setTimeout(resolve, retryDelay));
				}
			}

			// Determine the holon name (from pending or existing settings or default)
			const holonName = pendingHolonName || existingSettings?.name || 'My Holon';

			// Skip write operations in telegram-mapped mode (read-only access with service key)
			if (!isTelegramMappedSession) {
				if (!existingSettings || !existingSettings.name) {
					// First time login - create the holon with custom or default name
					console.log('First time user - creating personal holon:', holonName);
					await holosphere.put(userPublicKey, 'settings', {
						id: userPublicKey,
						name: holonName,
						purpose: 'Personal holon',
						createdAt: Date.now(),
						createdBy: userPublicKey
					});
				}

				// Always register/update holon in global registry for discovery
				try {
					await holosphere.putGlobal('holons_registry', {
						id: userPublicKey,
						name: holonName,
						purpose: existingSettings?.purpose || 'Personal holon',
						createdAt: existingSettings?.createdAt || Date.now(),
						lastSeen: Date.now(),
						type: 'personal'
					});
					console.log('Registered holon in global registry:', holonName);
				} catch (error) {
					console.warn('Failed to register holon in global registry:', error);
				}

				// Store/update Telegram mapping if this came from Telegram
				// Always update to handle cases where user creates new identity or restores different key
				if (pendingTelegramUserId) {
					try {
						await holosphere.putGlobal('telegram_mappings', {
							id: String(pendingTelegramUserId),
							publicKey: userPublicKey,
							holonName: holonName,
							createdAt: Date.now(),
							updatedAt: Date.now()
						});
						console.log('Telegram mapping stored/updated for user:', pendingTelegramUserId, '-> publicKey:', userPublicKey);
					} catch (err) {
						console.error('Failed to store Telegram mapping:', err);
					}
				}
			} else {
				console.log('Telegram-mapped session: skipping write operations (read-only mode)');
			}

			// Add the holon to visited list so it appears in TopBar
			if (browser) {
				addVisitedHolon(null, userPublicKey, holonName, 'personal');
				// Dispatch event to refresh TopBar holon list
				window.dispatchEvent(new CustomEvent('holonCreated', {
					detail: { holonId: userPublicKey, holonName }
				}));
			}

			// Check if there's already a holon ID in the URL path
			const currentPath = $page.url.pathname;
			const pathParts = currentPath.split('/').filter(Boolean);
			const holonIdInUrl = pathParts.length > 0 &&
				!['federated', 'navigator', 'global', 'sdgs', 'qr', 'demo', 'badges-demo'].includes(pathParts[0])
				? pathParts[0]
				: null;

			// Only set ID to user's public key if no holon ID in URL
			if (holonIdInUrl) {
				// Respect the holon ID in the URL
				ID.set(holonIdInUrl);
				console.log('Using holon ID from URL:', holonIdInUrl);
			} else {
				// No holon in URL, set to user's personal holon
				ID.set(userPublicKey);
				console.log('User holon initialized and ID set to:', userPublicKey);
				// Navigate to user's dashboard only if at root
				if (currentPath === '/' || currentPath === '') {
					goto(`/${userPublicKey}/dashboard`);
				}
			}
		} catch (error) {
			console.error('Failed to initialize user holon:', error);
			// Check if there's already a holon ID in the URL path
			const currentPath = $page.url.pathname;
			const pathParts = currentPath.split('/').filter(Boolean);
			const holonIdInUrl = pathParts.length > 0 &&
				!['federated', 'navigator', 'global', 'sdgs', 'qr', 'demo', 'badges-demo'].includes(pathParts[0])
				? pathParts[0]
				: null;

			// Only set ID to user's public key if no holon ID in URL
			if (holonIdInUrl) {
				ID.set(holonIdInUrl);
			} else {
				ID.set(userPublicKey);
				if (currentPath === '/' || currentPath === '') {
					goto(`/${userPublicKey}/dashboard`);
				}
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
			const userPublicKey = holosphere.myHolon;

			console.log('Granting federation capability to service key:', holospherePublicKey);

			// Store the holosphere service public key in global table
			await holosphere.putGlobal('federation_keys', {
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
			await holosphere.putGlobal('federation_capabilities', {
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
		// -=-=-=-=-=-=-=-=- USE GUN
		// holosphere = new HoloSphere({
		// 	appName: environmentName,
		// 	privateKey: privateKey,
		// 	backend: 'gundb',
		// 	gundb: {
		// 		peers: ['https://gun.holons.io/gun'],  // Gun relay server
		// 		radisk: true,
		// 		localStorage: true
		// 	}
		// });

		// -=-=-=-=-=-=-=-=- USE NOSTR
		holosphere = new HoloSphere({
			appName: environmentName,
			privateKey: privateKey,
			backend: 'nostr',
			relays: ['wss://relay.holons.io'],
		});

		// Wait for Nostr backend to be ready (async initialization)
		await holosphere.ready();

		// Log the public key for verification (using myHolon - the agent's holon ID)
		console.log("HoloSphere Public Key (myHolon):", holosphere.myHolon);

		// Update the global store (this can be called from async callbacks)
		holosphereStore.set(holosphere);

		// Initialize and set the FederationService singleton
		const federationService = createFederationService(holosphere);
		setFederationService(federationService);
		federationService.init().catch(err => {
			console.warn('FederationService init error (non-critical):', err);
		});

		// Initialize the user's personal holon with their public key as ID
		// But skip if on certain routes like /global
		// Also skip for telegram-mapped sessions (read-only)
		if (!isTelegramMappedSession) {
			if (browser) {
				const currentPath = window.location.pathname;
				console.log('Current path on init:', currentPath);
				if (!currentPath.startsWith('/global') &&
				    !currentPath.startsWith('/federated') &&
				    !currentPath.startsWith('/navigator') &&
				    !currentPath.startsWith('/sdgs')) {
					console.log('Calling initializeUserHolon...');
					initializeUserHolon();
				} else {
					console.log('Skipping initializeUserHolon for protected route:', currentPath);
				}
			} else {
				initializeUserHolon();
			}

			// Federation capability granting disabled - no automatic federation on load
			// grantFederationCapability(privateKey);
		} else {
			console.log('Telegram-mapped session: skipping auto-initialization');
		}

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
		const { publicKey, holonName, telegramUserId, mode } = event.detail;
		console.log('User authenticated with public key:', publicKey, 'mode:', mode, 'holonName:', holonName);

		// Store holon name and telegram user ID for use in initializeUserHolon
		if (holonName) {
			pendingHolonName = holonName;
		}
		if (telegramUserId) {
			pendingTelegramUserId = telegramUserId;
		}

		// Determine which private key to use
		let privateKey: string | null = null;

		if (mode === 'public') {
			// Public space mode - use the holosphere key from .env (now writable)
			privateKey = import.meta.env.VITE_HOLOSPHERE_PRIVATE_KEY;
			console.log('Using holosphere env key for public space');
		} else if (mode === 'telegram-mapped') {
			// Telegram Mini App user with existing mapping but no local key
			// Use holosphere service key for backend operations
			// But set the ID to the user's mapped public key
			privateKey = import.meta.env.VITE_HOLOSPHERE_PRIVATE_KEY;
			isTelegramMappedSession = true;
			telegramMappedPublicKey = publicKey;
			console.log('Telegram mapped session - using service key, navigating to user holon:', publicKey);
		} else {
			// Private mode - get the private key from the store
			const state = nostrStore.getState();
			privateKey = state.privateKey;
		}

		if (privateKey) {
			await initHoloSphere(privateKey);

			// For telegram-mapped sessions, override the ID to the user's public key
			if (isTelegramMappedSession && telegramMappedPublicKey) {
				ID.set(telegramMappedPublicKey);
				// Add the holon to visited list
				if (browser) {
					addVisitedHolon(null, telegramMappedPublicKey, holonName || 'My Holon', 'personal');
				}
				// Navigate directly to the user's holon
				goto(`/${telegramMappedPublicKey}/dashboard`);
			}
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
