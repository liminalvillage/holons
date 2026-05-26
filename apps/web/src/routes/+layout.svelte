<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { handshake } from "holosphere"
	import { createHoloSphere } from '@holons/core/holosphere';
	import { hexToBytes } from '@noble/hashes/utils';
	import Layout from '../dashboard/Layout.svelte';
	import Splash from '../components/Splash.svelte';
	import HolosphereProvider from '../components/HolosphereProvider.svelte';
	import { nostrStore } from '$lib/stores/nostr';
	import { homeHolonIdOverride } from '$lib/stores/homeHolonId';
	import { holosphereStore } from '$lib/stores/holosphere';
	import { ID } from '../dashboard/store';
	import { addVisitedHolon } from '../utils/localStorage';
	import { registerName as hnsRegister, lookupName as hnsLookup } from '$lib/hns';
	import { isValidHolonName, setName } from '$lib/stores/nameResolver';
	import { getEffectiveAppName } from '$lib/stores/appName';

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

	// Single source of truth: $lib/stores/appName.getEffectiveAppName(), which
	// reads VITE_HOLONS_APP from root .env unless a localStorage override is
	// active (toggled from the BrowserPanel footer in dev mode).
	let environmentName: string = getEffectiveAppName();

	console.log("Vite mode:", import.meta.env.MODE)
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

	// Splash UX deadline. The library's correctness timeouts are 5s (writes)
	// and 8s (reads) — fine for general code paths but too long for the splash,
	// which must feel responsive. Use this to race calls that don't accept a
	// per-call `{ timeout }` option yet (notably hnsLookup / hnsRegister, which
	// go through holosphere.getGlobal / writeGlobal). Local radisk hits
	// resolve in <100ms so 1s here is generous.
	const SPLASH_OP_TIMEOUT_MS = 1000;
	function withSplashTimeout<T>(promise: Promise<T>, label: string): Promise<T | undefined> {
		return Promise.race([
			promise,
			new Promise<undefined>((resolve) =>
				setTimeout(() => {
					console.warn(`${label} exceeded ${SPLASH_OP_TIMEOUT_MS}ms in splash — continuing`);
					resolve(undefined);
				}, SPLASH_OP_TIMEOUT_MS)
			)
		]);
	}

	// Initialize user's personal holon with their public key as ID
	async function initializeUserHolon(privateKey: string) {
		if (!holosphere || !holosphere.client?.publicKey) return;

		// Telegram users are namespaced by their Telegram user id, so the URL and
		// holon storage key reflect who they are (e.g. /12345678/...) rather
		// than the underlying Nostr signing key. Falls back to the mapped Nostr
		// pubkey for legacy sessions or to client.publicKey for plain Nostr.
		const userPublicKey = pendingTelegramUserId
			? String(pendingTelegramUserId)
			: isTelegramMappedSession && telegramMappedPublicKey
				? telegramMappedPublicKey
				: holosphere.client.publicKey;
		console.log('Initializing user holon with ID:', userPublicKey, 'telegram-mapped:', isTelegramMappedSession, 'telegramUserId:', pendingTelegramUserId);

		try {
			// Check if holon settings already exist with a short retry — Gun may
			// not have synced the user's namespace yet on first connection. Kept
			// tight (2 attempts × 300ms = ~600ms worst case) so the splash hides
			// quickly; if the real name shows up later the reactive nameResolver
			// will pick it up, and the write-guard below avoids clobbering a
			// returning user's custom name with the auto-generated default.
			let existingSettings: { name?: string; [key: string]: any } | null = null;
			const maxRetries = 2;
			const retryDelay = 300; // ms

			for (let attempt = 0; attempt < maxRetries; attempt++) {
				// holosphere.get is bounded by READ_TIMEOUT_MS in the library
				// (8s default), but the splash needs to feel fast: a local
				// radisk hit returns in <100ms, so cap each attempt at 1s
				// and let the retry/HNS/fallback chain take over from there.
				existingSettings = await holosphere.get(userPublicKey, 'settings', userPublicKey, null, { timeout: 1000 });
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
				pendingHolonNameFromStorage = sessionStorage.getItem('pending_holon_name');
				pendingHolonId = sessionStorage.getItem('pending_holon_id');
			}

			// Determine the holon name (from pending or existing settings or default)
			// Only use pending name if pendingHolonId matches this user's public key
			const existingName = existingSettings?.name;
			const existingNameValid = isValidHolonName(existingName);
			// Use pending name from localStorage OR from handleAuthenticated callback
			const pendingNameForThisUser = (pendingHolonId === userPublicKey)
				? pendingHolonNameFromStorage
				: pendingHolonName; // pendingHolonName is set by handleAuthenticated for splash-based creation
			// Multi-step name resolution chain:
			// 1. Pending name (from Create flow)
			// 2. Existing settings name (from relay)
			// 3. HNS lookup (global table, no federation needed)
			// 4. Final fallback: "My Holon"
			let hnsName: string | null = null;
			let resolvedName: string;
			let nameSource: string;

			if (pendingNameForThisUser) {
				resolvedName = pendingNameForThisUser;
				nameSource = 'pending';
			} else if (existingNameValid) {
				resolvedName = existingName!;
				nameSource = 'settings';
			} else {
				// Settings unavailable (slow relay) — try HNS before falling back.
				// hnsLookup goes through holosphere.getGlobal, which doesn't
				// yet accept a per-call timeout; race it explicitly for the
				// splash so a cold lookup doesn't add seconds to first paint.
				try {
					hnsName = (await withSplashTimeout(hnsLookup(holosphere, userPublicKey), 'hnsLookup')) ?? null;
				} catch (err) {
					console.warn('HNS lookup failed during init:', err);
				}
				if (hnsName && isValidHolonName(hnsName)) {
					resolvedName = hnsName;
					nameSource = 'hns';
					console.log('Resolved name from HNS:', hnsName);
				} else {
					resolvedName = 'My Holon';
					nameSource = 'fallback';
				}
			}
			const holonName = resolvedName;

			// Clear pending holon data from sessionStorage ONLY if we used the pending name
			if (browser && pendingHolonId && pendingHolonId === userPublicKey) {
				sessionStorage.removeItem('pending_holon_name');
				sessionStorage.removeItem('pending_holon_id');
				console.log('Cleared pending holon data from sessionStorage after using name:', pendingHolonNameFromStorage);
			}

			// Log name resolution
			if (nameSource === 'pending') {
				console.log('Using pending holon name for new identity:', pendingNameForThisUser);
			} else if (nameSource === 'settings') {
				console.log('Using existing settings name:', existingName);
			} else if (nameSource === 'hns') {
				console.log('Using name from HNS lookup:', hnsName);
			} else if (nameSource === 'fallback') {
				if (existingName && !existingNameValid) {
					console.log('Existing name invalid, using fallback:', existingName, '->', holonName);
				} else {
					console.log('No name found from settings or HNS, using temporary fallback:', holonName);
				}
			}

			// Distinguish genuinely new users from returning users with a slow relay
			// New user = came through Create flow (pendingNameForThisUser is set) AND no existing settings
			// Returning user = no pending name; may have settings or HNS name
			const isGenuinelyNewUser = !!pendingNameForThisUser && !existingSettings;
			const isFirstTimeUser = !existingSettings || !existingNameValid;

			// Telegram-mapped is the primary identity flow now, so it writes
			// settings/HNS/mappings just like a Nostr session. A new user is
			// either one that arrived via the Create flow (pendingName set) or
			// a fresh telegram user with no settings yet.
			const isFreshTelegramUser = isTelegramMappedSession && !!pendingTelegramUserId && !existingSettings;
			if (isGenuinelyNewUser || isFreshTelegramUser) {
				console.log('New user - creating personal holon:', holonName);
				// Library default is 5s; splash needs faster. Local radisk
				// ack returns in <100ms.
				await holosphere.put(userPublicKey, 'settings', {
					id: userPublicKey,
					name: holonName,
					purpose: 'Personal holon',
					createdAt: Date.now(),
					createdBy: userPublicKey
				}, { timeout: SPLASH_OP_TIMEOUT_MS });

				try {
					await withSplashTimeout(
						hnsRegister(holosphere, userPublicKey, holonName, privateKey),
						'hnsRegister'
					);
					console.log('Registered holon name in HNS:', holonName);
				} catch (error) {
					console.warn('Failed to register holon name in HNS:', error);
				}
			} else if (nameSource === 'fallback') {
				// Returning user with slow relay AND no HNS — do NOT overwrite with "My Holon"
				console.log('Returning user with unresolved name, skipping destructive write of fallback:', holonName);
			} else if (nameSource === 'settings' || nameSource === 'hns') {
				// Returning user with name resolved from settings or HNS — no write needed
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
					}, { timeout: SPLASH_OP_TIMEOUT_MS });
					console.log('Telegram mapping stored/updated for user:', pendingTelegramUserId, '-> publicKey:', userPublicKey);
				} catch (err) {
					console.error('Failed to store Telegram mapping:', err);
				}
			}

			// Populate the reactive name store so all components see it immediately
			// (avoids relay round-trip race after writing settings/HNS)
			// BUT: don't cache the "My Holon" fallback — let reactive resolveName() retry later
			if (nameSource !== 'fallback') {
				setName(userPublicKey, holonName);
			} else {
				console.log('Skipping eager name cache for unresolved fallback — resolveName() will retry');
			}

			// Add the holon to visited list so it appears in TopBar
			if (browser) {
				addVisitedHolon(null, userPublicKey, holonName, 'personal');
				// Dispatch event to refresh TopBar holon list
				window.dispatchEvent(new CustomEvent('holonCreated', {
					detail: { holonId: userPublicKey, holonName }
				}));
				// Dispatch holonNameUpdated so sidebar picks up the name immediately
				window.dispatchEvent(new CustomEvent('holonNameUpdated', {
					detail: { holonId: userPublicKey, newName: holonName }
				}));
			}

			// Check if there's already a holon ID in the URL path
			const currentPath = $page.url.pathname;
			const pathParts = currentPath.split('/').filter(Boolean);
			const holonIdInUrl = pathParts.length > 0 &&
				!['federated', 'navigator', 'global', 'sdgs', 'qr', 'demo', 'badges-demo'].includes(pathParts[0])
				? pathParts[0]
				: null;

			// New users (Create flow) go to their own holon unless on a special route (e.g. /qr)
			// Returning users can respect the URL if they're viewing another holon
			if (isGenuinelyNewUser) {
				ID.set(holonIdInUrl ?? userPublicKey);
				if (holonIdInUrl) {
					console.log('New user - respecting holon ID from URL:', holonIdInUrl);
				} else {
					console.log('New user - redirecting to personal holon:', userPublicKey);
					goto(`/${userPublicKey}/dashboard`);
				}
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
										inboundLenses: response.lensConfig?.lenses || response.lensConfig?.outbound || []
									}
								);
								console.log('[Global DM] processFederationResponse result:', result);

								// Store federation relationship with lens config
								// In the new share protocol, lenses are symmetric - no swapping needed
								if (response.responderHolonId) {
									const sharedLenses = response.lensConfig?.lenses || [...new Set([
										...(response.lensConfig?.inbound || []),
										...(response.lensConfig?.outbound || [])
									])];
									const initiatorLensConfig = {
										lenses: sharedLenses,
										inbound: sharedLenses,
										outbound: sharedLenses
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
		// Build the instance through @holons/core/holosphere — the single
		// factory every UI uses (CLAUDE.md: core owns meaning, UIs only
		// render). `awaitReady: true` returns the instance after ready()
		// has resolved, which is a no-op in alpha7 but keeps the contract.
		holosphere = await createHoloSphere({
			appName: environmentName,
			privateKey: hexToBytes(privateKey),
			awaitReady: true,
			// Holosphere 2: pass `backend: 'nostr'` + `extra: { nostr: { peers: [...] } }`
			// once the Nostr backend lands.
		});

		// Log the public key for verification
		if (holosphere.client) {
			console.log("HoloSphere Public Key:", holosphere.client.publicKey);
		}

		// Notify holonsbot on every put so the bot can bootstrap (or refresh)
		// the Telegram message for the touched entity. The bot's /refresh/<kind>
		// endpoints are idempotent — first call creates the message in the home
		// holon and stores its message_id in activeHolograms; subsequent calls
		// edit it. No-op if VITE_BOT_API_URL isn't configured.
		// In debug mode, default to a local bot at http://localhost:8080.
		const botApiUrl = import.meta.env.VITE_BOT_API_URL
			|| (import.meta.env.MODE !== 'production' ? 'http://localhost:8080' : undefined);
		// Skip the bot call when our current origin almost certainly won't
		// pass the bot's CORS allow-list. The production bot only allows
		// dashboard.holons.io; calling it from `localhost:5173` triggers a
		// preflight failure on every put — harmless but spams the console
		// and adds round-trip latency to every write. (Override by setting
		// VITE_BOT_API_URL=http://localhost:8080 when running a local bot.)
		const isDevOrigin = typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(window.location.host);
		const botIsLocal = !!botApiUrl && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(botApiUrl);
		const botReachable = !!botApiUrl && (!isDevOrigin || botIsLocal);
		if (botReachable) {
			const REFRESH_LENSES: Record<string, string> = {
				quests: 'quest',
				expenses: 'expense',
				events: 'event',
			};
			const origPut = holosphere.put.bind(holosphere);
			(holosphere as any).put = async (holonId: string, lens: string, data: any, opts?: any) => {
				const result = await origPut(holonId, lens, data, opts);
				const kind = REFRESH_LENSES[lens];
				const id = data?.id;
				if (kind && id != null) {
					fetch(`${botApiUrl}/refresh/${kind}`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ chatId: holonId, [`${kind}Id`]: id }),
					}).catch(() => {});
				}
				return result;
			};
		}

		// Update the global store (this can be called from async callbacks)
		holosphereStore.set(holosphere);

		// Set up global federation DM subscription
		setupFederationDMSubscription(privateKey);

		// Initialize the user's personal holon with their telegram-id (or pubkey)
		// as the namespace. Skipped only on protected/standalone routes.
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
			try {
				await initHoloSphere(privateKey);

				// For telegram-mapped sessions, pin the user's home holon id for
				// sidebar/federation source — $nostrPublicKey is null in this mode,
				// so without an override `homeHolonId` would fall back to the
				// URL-driven $ID and drift on every navigation. Routing itself is
				// handled by initializeUserHolon() inside initHoloSphere(), so we
				// don't call goto() again here (the old duplicate caused a race
				// with the layout's own redirect and with +page.svelte's subscription).
				if (isTelegramMappedSession && telegramMappedPublicKey) {
					const homeHolonId = pendingTelegramUserId
						? String(pendingTelegramUserId)
						: telegramMappedPublicKey;
					homeHolonIdOverride.set(homeHolonId);

					if (browser) {
						addVisitedHolon(null, homeHolonId, holonName || 'My Holon', 'personal');
					}
				}
			} catch (err) {
				// initHoloSphere can throw on invalid keys or Nostr/Gun init failures.
				// Without this catch the splash would stay visible forever — surface
				// the failure to the user instead of hanging on the loading view.
				console.error('HoloSphere initialization failed:', err);
				window.dispatchEvent(new CustomEvent('holosphere-init-failed', { detail: { error: err } }));
			}
		} else {
			console.error('No private key available for initialization');
		}

		showSplash = false;
		splashComplete = true;
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

		// Hydrate $nostrPublicKey from localStorage even when the user skipped
		// the splash (e.g. landed directly on a /[id]/dashboard URL). Without
		// this the home-holon row in the sidebar stays hidden after a refresh.
		await nostrStore.init();

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
