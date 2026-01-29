<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { HoloSphere, handshake } from "holosphere"
	import { hexToBytes } from '@noble/hashes/utils';
	import Layout from '../dashboard/Layout.svelte';
	import Splash from '../components/Splash.svelte';
	import HolosphereProvider from '../components/HolosphereProvider.svelte';
	import { nostrStore } from '$lib/stores/nostr';
	import { holosphereStore } from '$lib/stores/holosphere';
	import { ID } from '../dashboard/store';
	import { addVisitedHolon } from '../utils/localStorage';
	import { registerName as hnsRegister } from '$lib/hns';
	import { isValidHolonName } from '../utils/holonNames';

	// Import global design system styles
	import '../styles/index.css';

	// Accept data from layout load function (includes URL private key parameter)
	export let data: { urlPrivateKey: string | null };

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

	// Federation DM subscription
	let dmUnsubscribe: (() => void) | null = null;

	// Store holon name from onboarding (if provided)
	// These are set by handleAuthenticated or read from localStorage in initializeUserHolon
	let pendingHolonName: string | null = null;
	let pendingTelegramUserId: number | null = null;

	// Track if this is a telegram-mapped session (user without local key)
	let isTelegramMappedSession = false;
	let telegramMappedPublicKey: string | null = null;

	// Initialize user's personal holon with their public key as ID
	async function initializeUserHolon(privateKey: string) {
		if (!holosphere || !holosphere.client?.publicKey) return;

		// For telegram-mapped sessions, use the mapped public key instead of service key
		const userPublicKey = isTelegramMappedSession && telegramMappedPublicKey
			? telegramMappedPublicKey
			: holosphere.client.publicKey;
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

			// Check for pending holon name from localStorage (set by BrowserPanel identity creation)
			// We read this INSIDE initializeUserHolon to ensure fresh data after navigation/reload
			let pendingHolonId: string | null = null;
			let pendingHolonNameFromStorage: string | null = null;
			if (browser) {
				pendingHolonNameFromStorage = localStorage.getItem('pending_holon_name');
				pendingHolonId = localStorage.getItem('pending_holon_id');
			}

			// Determine the holon name (from pending or existing settings or default)
			// Only use pending name if pendingHolonId matches this user's public key
			const existingName = existingSettings?.name;
			const existingNameValid = isValidHolonName(existingName);
			// Use pending name from localStorage OR from handleAuthenticated callback
			const pendingNameForThisUser = (pendingHolonId === userPublicKey)
				? pendingHolonNameFromStorage
				: pendingHolonName; // pendingHolonName is set by handleAuthenticated for splash-based creation
			const holonName = pendingNameForThisUser || (existingNameValid ? existingName : null) || 'My Holon';

			// Clear pending holon data from localStorage ONLY if we used the pending name
			if (browser && pendingHolonId && pendingHolonId === userPublicKey) {
				localStorage.removeItem('pending_holon_name');
				localStorage.removeItem('pending_holon_id');
				console.log('Cleared pending holon data from localStorage after using name:', pendingHolonNameFromStorage);
			}

			// Log name resolution
			if (pendingNameForThisUser) {
				console.log('Using pending holon name for new identity:', pendingNameForThisUser);
			} else if (existingName && !existingNameValid) {
				console.log('Existing name invalid, using fallback:', existingName, '->', holonName);
			}

			// Track if this is a first-time user (for navigation decisions later)
			// Also treat users with invalid names as first-time (they need settings corrected)
			const isFirstTimeUser = !existingSettings || !existingNameValid;

			// Skip write operations in telegram-mapped mode (read-only access with service key)
			if (!isTelegramMappedSession) {
				if (isFirstTimeUser) {
					// First time login - create the holon with custom or default name
					console.log('First time user - creating personal holon:', holonName);
					await holosphere.write(userPublicKey, 'settings', {
						id: userPublicKey,
						name: holonName,
						purpose: 'Personal holon',
						createdAt: Date.now(),
						createdBy: userPublicKey
					});
				}

				// Register name in HNS (Holon Name Service) - signed public registry
				// Only register if first-time user OR name is changing
				// Note: we use holonName comparison since pendingNameForThisUser was already applied
				const nameIsChanging = holonName !== existingName;
				if (isFirstTimeUser || nameIsChanging) {
					try {
						await hnsRegister(holosphere, userPublicKey, holonName, privateKey);
						console.log('Registered holon name in HNS:', holonName);
					} catch (error) {
						console.warn('Failed to register holon name in HNS:', error);
					}
				} else {
					console.log('Returning user with existing name, skipping HNS registration');
				}

				// Store/update Telegram mapping if this came from Telegram
				// Always update to handle cases where user creates new identity or restores different key
				if (pendingTelegramUserId) {
					try {
						await holosphere.writeGlobal('telegram_mappings', {
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

			// First-time users should always go to their own holon
			// Returning users can respect the URL if they're viewing another holon
			if (isFirstTimeUser) {
				// New user - always redirect to their personal holon
				ID.set(userPublicKey);
				console.log('First time user - redirecting to personal holon:', userPublicKey);
				goto(`/${userPublicKey}/dashboard`);
			} else if (holonIdInUrl) {
				// Returning user - respect the holon ID in the URL
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

	// Set up global federation DM subscription for receiving requests/responses
	function setupFederationDMSubscription(privateKey: string) {
		if (!holosphere || dmUnsubscribe) return;

		const publicKey = holosphere.client?.publicKey;
		if (!publicKey) {
			console.warn('Cannot set up federation DM subscription: no public key');
			return;
		}

		console.log('Setting up global federation DM subscription...');

		dmUnsubscribe = handshake.subscribeToFederationDMs(
			holosphere,
			privateKey,
			publicKey,
			{
				onRequest: async (request: any, senderPubKey: string) => {
					console.log('[Global DM] Federation request received from:', senderPubKey?.slice(0, 8));
					// Dispatch event for UI components to handle
					if (browser) {
						window.dispatchEvent(new CustomEvent('federationRequest', {
							detail: { request, senderPubKey }
						}));
					}
				},
				onResponse: async (response: any, senderPubKey: string) => {
					console.log('[Global DM] Federation response received:', response?.status, 'from:', senderPubKey?.slice(0, 8));

					// Process the response (creates federation on our side)
					if (response.status === 'accepted') {
						try {
							const currentHolonId = holosphere.client?.publicKey;
							if (currentHolonId) {
								// Process the response to complete federation on our side
								const result = await handshake.processFederationResponse(
									holosphere,
									response,
									senderPubKey,
									{
										holonId: currentHolonId,
										inboundLenses: response.lensConfig?.outbound || []
									}
								);
								console.log('[Global DM] processFederationResponse result:', result);

								// Store federation relationship with lens config
								// IMPORTANT: Swap lensConfig from responder's perspective to initiator's
								// Responder's outbound (what they share) = Initiator's inbound (what I receive)
								// Responder's inbound (what they receive) = Initiator's outbound (what I share)
								// Note: processFederationResponse already calls addFederatedPartner internally,
								// but federateHolon also sets up lens config which may not be done by addFederatedPartner
								if (response.responderHolonId) {
									const initiatorLensConfig = {
										inbound: response.lensConfig?.outbound || [],
										outbound: response.lensConfig?.inbound || []
									};
									await holosphere.federateHolon(currentHolonId, response.responderHolonId, {
										lensConfig: initiatorLensConfig,
										partnerName: response.responderHolonName,
										skipPropagation: true // Data already propagated by processFederationResponse
									});
									console.log('[Global DM] Federation stored with:', response.responderHolonId, 'lensConfig:', initiatorLensConfig);
								}
							}
						} catch (error) {
							console.error('[Global DM] Failed to process federation response:', error);
						}
					}

					// Dispatch event for UI refresh
					if (browser) {
						window.dispatchEvent(new CustomEvent('federationResponse', {
							detail: { response, senderPubKey }
						}));
					}
				},
				onUpdate: async (update: any, senderPubKey: string) => {
					console.log('[Global DM] Federation update received from:', senderPubKey?.slice(0, 8), update);

					// DON'T auto-accept - dispatch event for UI to show approval dialog
					// The update contains: newLensConfig (with capabilities), senderHolonId, senderHolonName, message
					if (browser) {
						window.dispatchEvent(new CustomEvent('federationUpdate', {
							detail: { update, senderPubKey }
						}));
					}
				},
				onUpdateResponse: (response: any, senderPubKey: string) => {
					console.log('[Global DM] Federation update response received from:', senderPubKey?.slice(0, 8));
					if (browser) {
						window.dispatchEvent(new CustomEvent('federationUpdateResponse', {
							detail: { response, senderPubKey }
						}));
					}
				}
			}
		);

		console.log('Global federation DM subscription active');
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
		// 		peers: ['https://gun.holons.io/gun'],
		// 		radisk: true,
		// 		localStorage: true
		// 	}
		// });

		// -=-=-=-=-=-=-=-=- USE NOSTR
		holosphere = new HoloSphere({
			appName: environmentName,
			privateKey: hexToBytes(privateKey),
			backend: 'nostr',
			nostr: {
				peers: ['wss://relay.holons.io'],
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

		// Set up global federation DM subscription
		setupFederationDMSubscription(privateKey);

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
					await initializeUserHolon(privateKey);
				} else {
					console.log('Skipping initializeUserHolon for protected route:', currentPath);
				}
			} else {
				await initializeUserHolon(privateKey);
			}

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
		if (dmUnsubscribe) {
			dmUnsubscribe();
			dmUnsubscribe = null;
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

		if (mode === 'telegram-mapped') {
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

	// Check for URL private key parameter on mount (for direct access from safe environments)
	onMount(async () => {
		if (!browser) return;

		const urlPrivateKey = data?.urlPrivateKey;
		if (urlPrivateKey) {
			// Validate key format (64 hex characters)
			if (/^[0-9a-fA-F]{64}$/.test(urlPrivateKey)) {
				console.log('URL private key detected, auto-authenticating...');
				try {
					// Import the key into the nostr store
					await nostrStore.importKey(urlPrivateKey);

					// Initialize HoloSphere with the imported key
					await initHoloSphere(urlPrivateKey.toLowerCase());

					// Skip splash screen
					showSplash = false;
					splashComplete = true;

					// Clear the key from URL for security (replace current history entry)
					const cleanUrl = new URL(window.location.href);
					cleanUrl.searchParams.delete('key');
					window.history.replaceState({}, '', cleanUrl.toString());

					console.log('Auto-authenticated via URL parameter');
				} catch (error) {
					console.error('Failed to authenticate with URL private key:', error);
					// Fall through to show splash screen on error
				}
			} else {
				console.warn('Invalid private key format in URL parameter');
			}
		}
	});
</script>

<svelte:head>
	<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
</svelte:head>

<!-- Show splash screen for identity setup -->
{#if showSplash}
	<Splash on:authenticated={handleAuthenticated} on:skip={handleSkip} />
{/if}

<!-- Main app content (hidden while splash is showing) -->
{#if !showSplash && holosphere}
	<HolosphereProvider>
		<Layout>
			<slot />
		</Layout>
	</HolosphereProvider>
{/if}
