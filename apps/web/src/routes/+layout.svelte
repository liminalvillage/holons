<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { handshake } from "holosphere"
	import { createHoloSphere, resolveRelays, parseSigningMode, signingOptionsFor } from '@holons/core/holosphere';
	import { hexToBytes } from '@noble/hashes/utils';
	import Layout from '../dashboard/Layout.svelte';
	import Splash from '../components/Splash.svelte';
	import HolosphereProvider from '../components/HolosphereProvider.svelte';
	import AssistantWidget from '../components/AssistantWidget.svelte';
	import { nostrStore } from '$lib/stores/nostr';
	import { buildProjections, parseProjectionList } from '@holons/core/nostr';
	import { cellToLatLng } from 'h3-js';
	import { homeHolonIdOverride } from '$lib/stores/homeHolonId';
	import { holosphereStore } from '$lib/stores/holosphere';
	import { ID } from '../dashboard/store';
	import { addVisitedHolon } from '../utils/localStorage';
	import { registerName as hnsRegister, lookupName as hnsLookup } from '$lib/hns';
	import { isValidHolonName, setName } from '$lib/stores/nameResolver';
	import { getEffectiveAppName } from '$lib/stores/appName';
	import { installQuietLogs } from '$lib/quietLogs';

	// Import global design system styles
	import '../styles/index.css';

	// Mute a small allowlist of known-noisy third-party console messages
	// (holosphere internals, mapbox fingerprinting warning). Installed as
	// early as possible so the filter is in place before holosphere boots
	// and starts emitting its "Fetching ALL items" trail.
	if (browser) installQuietLogs();

	// Track if user has passed the splash screen
	let showSplash = true;
	let splashComplete = false;
	let holosphere: any = null;
	// Surfaced when login succeeds but HoloSphere init fails or is missing a
	// signing key. Without this the app would hide the splash with no holosphere
	// instance and render nothing — a blank background, seen on mobile when
	// storage is blocked or the relay can't be reached.
	let initError: string | null = null;

	// Subscribe to holosphere store for reactive updates
	$: holosphere = $holosphereStore;

	// Single source of truth: $lib/stores/appName.getEffectiveAppName(), which
	// reads HOLONS_APP from root .env unless a localStorage override is
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
		// than the underlying derived Nostr signing key. Key-based logins
		// (passkey / Nostr key / Ethereum wallet) have no Telegram id: their
		// holon id IS the signing pubkey.
		const userPublicKey = pendingTelegramUserId
			? String(pendingTelegramUserId)
			: holosphere.client.publicKey;
		console.log('Initializing user holon with ID:', userPublicKey, 'telegramUserId:', pendingTelegramUserId);

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

			// Any verified identity — Telegram, passkey, Nostr key, wallet — that
			// has no settings yet is a fresh user and gets its personal holon
			// (settings + HNS) created here. Telegram-specific bookkeeping
			// (telegram_mappings) stays gated on pendingTelegramUserId below.
			const isFreshUser = !existingSettings;
			if (isGenuinelyNewUser || isFreshUser) {
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

	// Synchronous routing used to render the dashboard immediately, before the
	// background reconciliation in initializeUserHolon resolves names/settings.
	// The holon namespace is fully determined by the telegram id (or pubkey) and
	// the URL — no relay I/O — so this mirrors initializeUserHolon's routing tail
	// without any of its awaited reads/writes. initializeUserHolon then re-sets
	// the same ID idempotently in the background.
	function routeUserHolonSync() {
		const userPublicKey = pendingTelegramUserId
			? String(pendingTelegramUserId)
			: holosphere?.client?.publicKey;
		if (!userPublicKey) return;

		// Seed a provisional name so the sidebar shows the holon immediately
		// instead of flashing a fallback until the relay responds.
		if (pendingHolonName) {
			setName(userPublicKey, pendingHolonName);
			addVisitedHolon(null, userPublicKey, pendingHolonName, 'personal');
		}

		const currentPath = $page.url.pathname;
		const pathParts = currentPath.split('/').filter(Boolean);
		const holonIdInUrl = pathParts.length > 0 &&
			!['federated', 'navigator', 'global', 'sdgs', 'qr', 'demo', 'badges-demo'].includes(pathParts[0])
			? pathParts[0]
			: null;

		if (holonIdInUrl) {
			ID.set(holonIdInUrl);
		} else {
			ID.set(userPublicKey);
			if (currentPath === '/' || currentPath === '') {
				goto(`/${userPublicKey}/dashboard`);
			}
		}
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
		// render). The relays are the wire: every read/write/subscription
		// travels as a signed kind-30078 event and is mirrored into the local
		// IndexedDB store, so a reload paints instantly and then catches up
		// from its cursor. Env:
		//   VITE_HOLOSPHERE_RELAYS      = comma-separated wss:// relay URLs
		//                                 (default: the production relays)
		//   VITE_HOLOSPHERE_SIGNING     = off (default) | shadow | enforce
		//   VITE_HOLOSPHERE_READ_KEYS   = comma-separated npub/hex keys to trust
		//   VITE_HOLOSPHERE_PROJECTIONS = off | all | quests,…
		const relays = resolveRelays(import.meta.env.VITE_HOLOSPHERE_RELAYS);
		const signingMode = parseSigningMode(import.meta.env.VITE_HOLOSPHERE_SIGNING);
		// Standard-kind projections: listed lenses are ALSO published as their
		// standard Nostr kind next to the 30078 record. The logged-in user's own
		// key signs their kind-0 profile / RSVPs; nobody else's. See
		// packages/holosphere/NOSTR-BACKEND.md.
		const projectionLenses = parseProjectionList(import.meta.env.VITE_HOLOSPHERE_PROJECTIONS);
		const ownPubkey = nostrStore.getState().publicKey || '';
		// Reverse sync (VITE_HOLOSPHERE_PROJECTIONS_SYNC=on|off, default on):
		// external edits of those kinds are folded back into the records. In
		// the browser only our own key and the read-list are trusted; the bot
		// (which knows every member's derived key) is the authority for RSVPs.
		const reverseSync = !['off', 'false', '0', 'no'].includes(
			String(import.meta.env.VITE_HOLOSPHERE_PROJECTIONS_SYNC || 'on').trim().toLowerCase()
		);
		const projectionOptions = projectionLenses.length && ownPubkey
			? {
				projections: buildProjections(projectionLenses, {
					appName: environmentName,
					holonPubkey: ownPubkey,
					cellToLatLng,
					pubkeyFor: (id: string | number) =>
						pendingTelegramUserId && String(id) === String(pendingTelegramUserId)
							? ownPubkey
							: undefined,
					userIdFor: (pubkey: string) =>
						pendingTelegramUserId && pubkey === ownPubkey ? pendingTelegramUserId : undefined,
				}),
				signerFor: (id: string | number) =>
					pendingTelegramUserId && String(id) === String(pendingTelegramUserId) ? privateKey : null,
				reverseSync,
				trustedAuthors: () => [
					ownPubkey,
					...((holosphere as any)?.getReadKeys?.() ?? []),
				],
			}
			: {};
		holosphere = await createHoloSphere({
			appName: environmentName,
			privateKey: hexToBytes(privateKey),
			relays,
			store: { adapter: 'indexeddb' },
			signing: signingOptionsFor(signingMode),
			nostr: projectionOptions,
			awaitReady: true,
		});

		// Log the public key for verification
		if (holosphere.client) {
			console.log("HoloSphere Public Key:", holosphere.client.publicKey);
		}
		console.log(`[holosphere] ${relays.length} relay(s), signing ${signingMode}`);

		// Signing modes (the constructor owns the signer; nothing to enable here):
		// - off:     reads are unchanged (default — safe for production).
		// - shadow:  every write is signed + published; reads UNCHANGED. Inspect
		//            via window.__signingReport().
		// - enforce: reads return only your own writes + writes from keys in your
		//            federation read-list (VITE_HOLOSPHERE_READ_KEYS / addReadKey).
		//            Your own key is always trusted.
		if (typeof window !== 'undefined') {
			try {
				const readKeys = (import.meta.env.VITE_HOLOSPHERE_READ_KEYS || '')
					.split(',').map((r: string) => r.trim()).filter(Boolean);
				if (readKeys.length && typeof (holosphere as any).addReadKey === 'function') {
					for (const k of readKeys) {
						try { await (holosphere as any).addReadKey(k); } catch { /* bad key format */ }
					}
				}
				(window as any).__signingReport = () => (holosphere as any).getShadowReport?.();
				// Direct delete escape hatch for known-bad keys, e.g.
				// await __del('123','quests','moufplh7i0t').
				(window as any).__del = (h: string, l: string, k: string) => (holosphere as any).delete(h, l, k);
			} catch (e) {
				console.warn('[holosphere] signing/helper setup failed:', (e as any)?.message);
			}
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
				// Route synchronously, then reconcile in the background. The
				// holon namespace is fully determined by the telegram id (or
				// pubkey) and the URL — none of it needs the relay. Doing the
				// ID/route now lets the splash hide and the dashboard render as
				// soon as Gun is constructed; the slow part of
				// initializeUserHolon (settings read retries, HNS lookup +
				// register, settings/mappings writes) used to be awaited here
				// and, on a cold device with an empty cache, stalled toward each
				// op's timeout — the splash sat for many seconds before first
				// paint. Now those run after paint and the name/data fill in
				// reactively (setName + holonNameUpdated events).
				routeUserHolonSync();
				console.log('Calling initializeUserHolon in background...');
				void initializeUserHolon(privateKey);
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

	// Handle splash screen completion. The signing key is the per-user Nostr key
	// derived server-side from the verified Telegram session — telegramStore has
	// already handed it to nostrStore, so we just read it here.
	async function handleAuthenticated(event: CustomEvent) {
		const { publicKey, holonName, telegramUserId, mode } = event.detail;
		console.log('User authenticated:', publicKey, 'mode:', mode, 'holonName:', holonName);

		// Store holon name and telegram user ID for use in initializeUserHolon
		if (holonName) {
			pendingHolonName = holonName;
		}
		if (telegramUserId) {
			pendingTelegramUserId = telegramUserId;
		}

		const privateKey = nostrStore.getState().privateKey;
		if (!privateKey) {
			console.error('No signing key available for initialization');
			window.dispatchEvent(new CustomEvent('holosphere-init-failed', {
				detail: { error: new Error('No signing key') }
			}));
			initError = 'Your session was verified but no signing key was available on this device. This can happen when site storage is blocked. Try again, or enable site data / cookies for this site.';
			showSplash = false;
			splashComplete = true;
			return;
		}

		try {
			// Race init against a deadline so a stalled relay/storage layer
			// surfaces an error screen instead of hanging on the splash forever.
			await Promise.race([
				initHoloSphere(privateKey),
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error('Initialization timed out — the network or storage may be unavailable.')), 30000)
				)
			]);

			// Telegram users are namespaced by their Telegram id, which differs
			// from the derived Nostr pubkey ($nostrPublicKey). Pin the home holon
			// id so the sidebar/federation source doesn't drift to the URL-driven
			// $ID on navigation. Routing itself is handled by initializeUserHolon().
			if (telegramUserId) {
				const homeHolonId = String(telegramUserId);
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
			initError = (err instanceof Error ? err.message : String(err)) || 'HoloSphere failed to initialize.';
		}

		showSplash = false;
		splashComplete = true;
	}

	// Retry from the error screen: reloading re-runs the verified session
	// restore, which re-derives the signing key and re-attempts init.
	function retryInit() {
		if (browser) window.location.reload();
	}

	onMount(async () => {
		if (!browser) return;

		// Hydrate the signing pubkey from the localStorage cache even before the
		// session endpoint responds (e.g. landed directly on a /[id]/dashboard
		// URL). Without this the home-holon row in the sidebar stays hidden after
		// a refresh. The authoritative key arrives via the verified session in
		// Splash → handleAuthenticated.
		await nostrStore.init();
	});
</script>

<!-- Show splash screen for identity setup -->
{#if showSplash}
	<Splash on:authenticated={handleAuthenticated} />
{/if}

<!-- Init failed after a successful login: show an actionable error instead of
     a blank background (previously the only outcome when holosphere stayed null). -->
{#if !showSplash && !holosphere && initError}
	<div class="init-error">
		<div class="init-error__card">
			<h1>Couldn't load your dashboard</h1>
			<p>{initError}</p>
			<button class="init-error__retry" on:click={retryInit}>Try again</button>
		</div>
	</div>
{/if}

<!-- Main app content (hidden while splash is showing) -->
{#if !showSplash && holosphere}
	<HolosphereProvider>
		<Layout>
			<slot />
		</Layout>
	</HolosphereProvider>
	<!-- Text-input agent (kiosk voice widget's input-only sibling); renders
	     only while a local @holons/voice-ui server is reachable. -->
	<AssistantWidget />
{/if}

<style>
	.init-error {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: var(--color-bg-primary, #0f172a);
		z-index: 9999;
	}
	.init-error__card {
		max-width: 420px;
		width: 100%;
		text-align: center;
		background: rgba(30, 41, 59, 0.9);
		border: 1px solid rgba(100, 116, 139, 0.3);
		border-radius: 1rem;
		padding: 2rem;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
	}
	.init-error__card h1 {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--color-text-primary, #f1f5f9);
		margin: 0 0 0.75rem;
	}
	.init-error__card p {
		color: #94a3b8;
		font-size: 0.95rem;
		line-height: 1.5;
		margin: 0 0 1.5rem;
	}
	.init-error__retry {
		width: 100%;
		padding: 0.875rem 1rem;
		background: #2aabee;
		border: none;
		border-radius: 0.5rem;
		color: #fff;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
	}
	.init-error__retry:hover {
		background: #1d97d8;
	}
</style>
