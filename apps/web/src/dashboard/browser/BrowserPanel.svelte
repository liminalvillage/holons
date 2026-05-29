<script lang="ts">
	import { createEventDispatcher, getContext, onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import type { HoloSphere } from 'holosphere';
	import { Search, Plus, X, Upload, ArrowDown, ArrowUp } from 'svelte-feathers';
	import { nostrPublicKey, nostrPrivateKey, nostrStore } from '../../lib/stores/nostr';
	import { homeHolonId } from '$lib/stores/homeHolonId';
	import { incomingRequests, outgoingRequests, pendingFederationRequests, federationNotifications, type PendingRequest, createIncomingRequest, createOutgoingRequest, incomingUpdates, pendingUpdates } from '../../lib/stores/federationRequests';
	import { handshake } from 'holosphere';
	import HolonList from './HolonList.svelte';
	import QRScanner from '../../components/QRScanner.svelte';

	import { ID, sidebarExpanded } from '../store';
	import { nameMap, resolveName, awaitName, forceRefreshHolonName } from '$lib/stores/nameResolver';
	import { activeHolonIdentity, userHolons, activeHolonIdentityStore } from '../../lib/stores/activeHolonIdentity';
	import { getEffectiveAppName, setAppNameOverride } from '$lib/stores/appName';

	// Vite `define` rewrites the bare `__COMMIT_HASH__` identifier at build time
	// (see vite.config.ts and types/global.d.ts). Property-access forms like
	// `globalThis.__COMMIT_HASH__` are NOT rewritten and silently fall back to "dev".
	const commitHash: string = typeof __COMMIT_HASH__ !== 'undefined' ? __COMMIT_HASH__ : 'dev';
	// Same pattern for the pinned holosphere version. Renders the full
	// alpha/beta/rc suffix (e.g. "1.3.0-alpha7"), not just holosphere.js's
	// HOLOSPHERE_VERSION constant which stops at "1.3.0".
	const holosphereVersion: string = typeof __HOLOSPHERE_VERSION__ !== 'undefined' ? __HOLOSPHERE_VERSION__ : 'unknown';

	// Same resolution as +layout.svelte so the footer always reflects the
	// actual HoloSphere appName the page connected with (env default unless
	// a localStorage override is active).
	const appName: string = getEffectiveAppName();
	// Only show the prod/debug toggle in dev builds — production builds should
	// never offer a way to flip away from "Holons" data.
	const showAppToggle: boolean = import.meta.env.DEV === true;

	function toggleAppName() {
		const next = appName === 'Holons' ? 'HolonsDebug' : 'Holons';
		const ok = confirm(
			`Switch HoloSphere appName to "${next}" and reload? You'll see ${next === 'Holons' ? 'production' : 'debug'} data.`
		);
		if (!ok) return;
		setAppNameOverride(next);
		location.reload();
	}

	// Props
	export let isOpen: boolean = true;

	const dispatch = createEventDispatcher();
	const holosphere = getContext<HoloSphere>('holosphere');

	// Federation status types
	type FederationStatus = 'none' | 'pending_outgoing' | 'pending_incoming' | 'accepted';

	// Unified holon type - populated from federation data
	interface SidebarHolon {
		id: string;
		name: string;
		federationStatus: FederationStatus;
		// lenses = union of inbound/outbound, kept for "any lens shared?" checks.
		lensConfig?: { lenses: string[]; inbound: string[]; outbound: string[] };
		pendingRequestId?: string;
	}

	// State
	let searchQuery: string = '';
	let holons: SidebarHolon[] = [];
	let isLoading: boolean = false;
	let homeHolonName: string = '';

	// Add Holon Modal state
	let showAddModal: boolean = false;
	let newHolonId: string = '';
	let newHolonName: string = '';
	let addError: string = '';
	let addSuccess: string = '';
	let showQRScanner: boolean = false;
	let isInitiatingFederation: boolean = false;

	// Lens configuration for federation (same as Federation component).
	// Per-direction sets mirror Federation.svelte: inbound = receive, outbound = send.
	const availableLenses = ['quests', 'offers', 'tags', 'expenses', 'announcements', 'users', 'shopping', 'recurring', 'library', 'roles', 'checklists'];
	const DEFAULT_LENSES = ['quests', 'offers', 'users'];
	let selectedInboundLenses: Set<string> = new Set(DEFAULT_LENSES);
	let selectedOutboundLenses: Set<string> = new Set(DEFAULT_LENSES);


	// Current holon from route
	$: currentHolonId = $ID;

	// Filtered holons based on search
	$: filteredHolons = getFilteredHolons(searchQuery, holons);

	function getFilteredHolons(query: string, holonList: SidebarHolon[]) {
		if (!query.trim()) return holonList;

		const lowerQuery = query.toLowerCase();
		return holonList.filter(
			(h) =>
				h.name.toLowerCase().includes(lowerQuery) ||
				h.id.toLowerCase().includes(lowerQuery)
		);
	}

	// Load holons on mount
	// Keep homeHolonName in sync with the reactive name store
	// (covers initial load via setName in layout AND later updates from Settings)
	$: if ($nostrPublicKey && $nameMap[$nostrPublicKey]) {
		homeHolonName = $nameMap[$nostrPublicKey];
	}

	onMount(async () => {
		if (browser) {
			// Initialize active holon identity store
			activeHolonIdentityStore.init();

			await loadHolons();

			// Trigger name resolution (reactive $: statement keeps homeHolonName in sync)
			if ($nostrPublicKey) {
				resolveName($nostrPublicKey);
				// Eagerly initialize from current nameMap snapshot so the first render has the correct name
				if ($nameMap[$nostrPublicKey]) {
					homeHolonName = $nameMap[$nostrPublicKey];
				}
			}

			// Initialize federation requests store
			if ($homeHolonId) {
				pendingFederationRequests.init($homeHolonId);
			}

			// Update user holons for the identity selector
			updateUserHolons();
		}

		// Listen for holon updates
		window.addEventListener('holonCreated', handleHolonCreated as EventListener);
		window.addEventListener('holonNavigated', handleHolonNavigated as EventListener);
		window.addEventListener('holonNameUpdated', handleHolonNameUpdated as EventListener);
		window.addEventListener('federationResponse', handleFederationResponseEvent as unknown as EventListener);
		window.addEventListener('federationRequest', handleFederationRequestEvent as EventListener);
		window.addEventListener('federationUpdate', handleFederationUpdateEvent as EventListener);
		window.addEventListener('federationChanged', handleFederationChanged as EventListener);
	});

	onDestroy(() => {
		if (browser) {
			window.removeEventListener('holonCreated', handleHolonCreated as EventListener);
			window.removeEventListener('holonNavigated', handleHolonNavigated as EventListener);
			window.removeEventListener('holonNameUpdated', handleHolonNameUpdated as EventListener);
			window.removeEventListener('federationResponse', handleFederationResponseEvent as unknown as EventListener);
			window.removeEventListener('federationRequest', handleFederationRequestEvent as EventListener);
			window.removeEventListener('federationUpdate', handleFederationUpdateEvent as EventListener);
			window.removeEventListener('federationChanged', handleFederationChanged as EventListener);
		}
	});

	// State for processing requests
	let processingRequestId: string | null = null;

	// Handle federation response from global DM subscription
	async function handleFederationResponseEvent(event: CustomEvent) {
		const { response, senderPubKey } = event.detail;
		console.log('[BrowserPanel] Federation response event:', response?.status, 'responderHolonId:', response?.responderHolonId?.slice(0, 12));

		// Update the status of our outgoing request
		if (response?.requestId) {
			if (response?.status === 'accepted') {
				pendingFederationRequests.updateStatus(response.requestId, 'accepted');
			} else if (response?.status === 'rejected') {
				pendingFederationRequests.updateStatus(response.requestId, 'rejected');
			}
		}

		if (response?.status === 'accepted') {
			// Small delay to allow federation storage to complete (race condition workaround)
			console.log('[BrowserPanel] Waiting 500ms for federation storage to complete...');
			await new Promise(resolve => setTimeout(resolve, 500));
			// Refresh holons list to show the newly federated partner
			loadHolons();
		}
	}

	// Handle incoming federation request from global DM subscription
	function handleFederationRequestEvent(event: CustomEvent) {
		const { request, senderPubKey } = event.detail;
		console.log('[BrowserPanel] Federation request event from:', senderPubKey?.slice(0, 8));
		// Add to pending requests store for UI display
		if (request && senderPubKey) {
			const pendingRequest = createIncomingRequest(
				request.requestId || `req-${Date.now()}`,
				senderPubKey,
				'', // npub - will be resolved if needed
				request.senderHolonId || senderPubKey,
				request.senderHolonName || 'Unknown Holon',
				request.lensConfig || { lenses: [] },
				request.capabilities || [],
				request.message
			);
			pendingFederationRequests.add(pendingRequest);
		}
	}

	// Handle lens update request from global DM subscription
	function handleFederationUpdateEvent(event: CustomEvent) {
		const { update, senderPubKey } = event.detail;
		console.log('[BrowserPanel] Lens update event from:', senderPubKey?.slice(0, 8), update);

		// Add to pending requests store for UI display (as a lens_update type)
		if (update && senderPubKey) {
			const newLensConfig = update.newLensConfig || { lenses: [] };

			const pendingRequest = createIncomingRequest(
				update.updateId || `update-${Date.now()}`,
				senderPubKey,
				'', // npub
				update.senderHolonId || senderPubKey,
				update.senderHolonName || 'Unknown Holon',
				newLensConfig,
				newLensConfig.capabilities || [],
				update.message
			);
			// Add requestKind to distinguish from federation requests (keep type as 'incoming' for store filtering)
			(pendingRequest as any).requestKind = 'lens_update';
			(pendingRequest as any).updateData = update; // Store full update data for processing
			pendingFederationRequests.add(pendingRequest);
		}
	}

	async function loadHolons() {
		isLoading = true;

		// IMPORTANT: Always load federation from the user's HOME holon, not the currently viewed holon.
		// Federation relationships are stored on the home holon; reading them from a federated peer
		// would surface that peer's partners instead of ours. `$homeHolonId` resolves to the Nostr
		// pubkey for plain sessions and to the telegram-mapped override otherwise.
		const federationSourceId = $homeHolonId || currentHolonId;
		console.log('[BrowserPanel] loadHolons called, currentHolonId:', currentHolonId?.slice(0, 12), 'federationSourceId:', federationSourceId?.slice(0, 12));

		try {
			const holonList: SidebarHolon[] = [];

			// Load federated holons from holosphere using the HOME holon ID.
			// Pending outgoing requests are NOT in holosphere's FederationInfo —
			// they live in the local `pendingFederationRequests` store and are
			// merged into the list below.
			if (holosphere && federationSourceId) {
				try {
					const federationInfo = await holosphere.getFederation(federationSourceId);
					console.log('[BrowserPanel] getFederation result:', {
						federated: federationInfo?.federated?.length || 0,
						federatedIds: federationInfo?.federated?.map((id: string) => id?.slice(0, 12)) || []
					});
					if (federationInfo?.federated && Array.isArray(federationInfo.federated)) {
						for (const holonId of federationInfo.federated) {
							// Try HNS first (authoritative), then fall back to stored partner name
							let name = await forceRefreshHolonName(holosphere, holonId);

							// If HNS returned a fallback name, use stored partnerName instead
							if (!name || name.startsWith('Holon ')) {
								const storedName = federationInfo.partnerNames?.[holonId];
								if (storedName && storedName !== holonId) {
									name = storedName;
								}
							}

							const storedLensConfig = federationInfo.lensConfig?.[holonId];
							const inbound = Array.isArray(storedLensConfig?.inbound) ? storedLensConfig.inbound : [];
							const outbound = Array.isArray(storedLensConfig?.outbound) ? storedLensConfig.outbound : [];
							holonList.push({
								id: holonId,
								name: name || `Holon ${holonId.slice(0, 8)}...`,
								federationStatus: 'accepted',
								lensConfig: {
									lenses: [...new Set([...inbound, ...outbound])],
									inbound,
									outbound
								}
							});
						}
					}

				} catch (err) {
					console.error('Failed to load federated holons:', err);
				}
			}

			// Also load pending outgoing requests from localStorage store
			// (these are requests we initiated that may not be in holosphere yet)
			const pendingOutgoing = pendingFederationRequests.getOutgoingPending();
			for (const request of pendingOutgoing) {
				// Skip if already added from holosphere
				if (holonList.some(h => h.id === request.recipientPubKey)) continue;

				holonList.push({
					id: request.recipientPubKey || request.senderHolonId,
					name: request.recipientHolonName || `Holon ${(request.recipientPubKey || '').slice(0, 8)}...`,
					federationStatus: 'pending_outgoing',
					pendingRequestId: request.id
				});
			}

			console.log('[BrowserPanel] Final holonList:', holonList.length, 'items:', holonList.map(h => ({ id: h.id?.slice(0, 12), status: h.federationStatus })));

			// Safety: Don't clear the list if we had holons before and now get empty
			// This can happen due to race conditions with federation storage
			if (holonList.length === 0 && holons.length > 0) {
				console.warn('[BrowserPanel] Ignoring empty result - keeping existing', holons.length, 'holons');
				return;
			}

			holons = holonList;
		} catch (error) {
			console.error('Failed to load holons:', error);
		} finally {
			isLoading = false;
		}
	}

	// Update the user holons store with the current user's holons
	function updateUserHolons() {
		if (!$homeHolonId) return;

		const memberships = [
			// User's own holon (they are always the owner of their pubkey holon)
			{ id: $homeHolonId, name: homeHolonName || 'My Holon', isOwner: true }
		];

		// Add federated holons where user might have write access
		// (membership in other holons is determined by the users lens)
		for (const holon of holons) {
			if (holon.federationStatus === 'accepted') {
				// For now, add all federated holons as potential identities
				// In practice, the server-side canWrite() will verify actual membership
				memberships.push({
					id: holon.id,
					name: holon.name,
					isOwner: false
				});
			}
		}

		activeHolonIdentityStore.setUserHolons(memberships);
	}

	// Handle changing the active holon identity
	function handleIdentityChange(event: Event) {
		const select = event.target as HTMLSelectElement;
		activeHolonIdentityStore.setActiveHolon(select.value);
	}

	// Update user holons whenever the holons list changes
	$: if (holons.length >= 0 && $homeHolonId) {
		updateUserHolons();
	}

	// Re-fetch federations once the home holon id becomes available. For
	// telegram-mapped sessions the override is set asynchronously by the
	// layout, so the initial loadHolons() on mount can fire with a null
	// federation source and yield nothing — this reactive trigger fills
	// the list in when the identity resolves.
	let lastLoadedHomeId: string | null = null;
	$: if ($homeHolonId && $homeHolonId !== lastLoadedHomeId) {
		lastLoadedHomeId = $homeHolonId;
		loadHolons();
	}

	function handleHolonCreated(event: CustomEvent<{ holonId: string; holonName: string }>) {
		// Reload federation list when a new holon is created
		loadHolons();
	}

	function handleHolonNameUpdated(event: CustomEvent<{ holonId: string; newName: string }>) {
		const { holonId, newName } = event.detail;
		// Update federated partner name in the holons list
		const idx = holons.findIndex(h => h.id === holonId);
		if (idx >= 0 && newName) {
			holons[idx].name = newName;
			holons = [...holons];
		}
	}

	function handleFederationChanged() {
		// Refresh the sidebar when federation list changes (e.g. removal from Federation.svelte)
		loadHolons();
	}

	function handleHolonNavigated(event: CustomEvent) {
		// No-op: holons list is managed by federation, not navigation history
	}

	function selectHolon(holonId: string) {

		// Preserve current lens when switching holons
		const currentPath = $page.url.pathname;
		const pathParts = currentPath.split('/').filter(Boolean);
		// Get lens (second part of path, e.g., "dashboard", "tasks", "flow")
		const currentLens = pathParts.length > 1 ? pathParts[pathParts.length - 1] : 'dashboard';

		ID.set(holonId);
		goto(`/${holonId}/${currentLens}`);
		dispatch('select', { holonId });

		// Close browser on mobile
		if (browser && window.innerWidth < 1024) {
			dispatch('close');
		}
	}

	function toggleStar(holonId: string) {
		// No-op: starring is not used in federation-based list
		// All holons in the list are federated partners
	}

	async function removeHolon(holonId: string) {
		// Find the holon to check its federation status
		const holon = holons.find(h => h.id === holonId);

		// Use home holon for federation operations
		const myHolonId = $homeHolonId || currentHolonId;

		// Revoke federation
		if (holon?.federationStatus === 'accepted' && holosphere && myHolonId) {
			try {
				if (holosphere.unfederateHolon) {
					await holosphere.unfederateHolon(myHolonId, holonId);
					console.log('[BrowserPanel] Federation revoked for:', holonId.slice(0, 12) + '...');
				}
			} catch (err) {
				console.warn('[BrowserPanel] Failed to revoke federation:', err);
			}
		}

		// Remove from local holons list
		holons = holons.filter(h => h.id !== holonId);

		// Notify other components (Tasks, Offers, etc.) that federation list changed
		window.dispatchEvent(new CustomEvent('federationChanged'));
	}

	async function handleLensConfigUpdate(event: CustomEvent<{ holonId: string; lensConfig: { lenses: string[]; inbound: string[]; outbound: string[] } }>) {
		const { holonId, lensConfig } = event.detail;

		// Per-direction comparison so toggling inbound-only counts as a change.
		const index = holons.findIndex(h => h.id === holonId);
		const oldInbound = index >= 0 ? (holons[index].lensConfig?.inbound || []) : [];
		const oldOutbound = index >= 0 ? (holons[index].lensConfig?.outbound || []) : [];
		const newInbound = lensConfig.inbound;
		const newOutbound = lensConfig.outbound;

		const sameSorted = (a: string[], b: string[]) =>
			JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
		if (sameSorted(oldInbound, newInbound) && sameSorted(oldOutbound, newOutbound)) return;

		// Update the holon's lens config in the list immediately for UI responsiveness
		if (index >= 0) {
			holons[index].lensConfig = lensConfig;
			holons = [...holons];
		}

		// Use home holon for federation operations
		const myHolonId = $homeHolonId || currentHolonId;

		// Update federation lens config in holosphere
		if (holosphere && myHolonId) {
			try {
				const fedLensConfig = { lenses: lensConfig.lenses, inbound: newInbound, outbound: newOutbound };
				// Cast: the library's options type is narrower than what the
				// runtime accepts (no `skipPropagation` in the public type).
				await holosphere.federateHolon(myHolonId, holonId, {
					lensConfig: fedLensConfig,
					skipPropagation: true // Don't re-propagate existing data
				} as any);
				console.log('[BrowserPanel] Lens config saved for:', holonId.slice(0, 12) + '...', lensConfig);

				// Send lens update notification to partner via NIP-44 DM
				if ($nostrPrivateKey) {
					const diff = (label: string, before: string[], after: string[]) => {
						const added = after.filter(l => !before.includes(l));
						const removed = before.filter(l => !after.includes(l));
						const out: string[] = [];
						if (added.length) out.push(`${label} added: ${added.join(', ')}`);
						if (removed.length) out.push(`${label} removed: ${removed.join(', ')}`);
						return out;
					};
					const parts = [
						...diff('Inbound', oldInbound, newInbound),
						...diff('Outbound', oldOutbound, newOutbound)
					];
					const message = parts.length > 0 ? parts.join('. ') : 'Updated lens configuration';

					try {
						const result = (await handshake.requestFederationUpdate(holosphere, $nostrPrivateKey, {
							partnerPubKey: holonId,
							holonId: myHolonId,
							holonName: homeHolonName || 'My Holon',
							newLensConfig: fedLensConfig,
							message
						})) as { success: boolean; error?: string };
						if (result.success) {
							console.log('[BrowserPanel] Sent lens update notification to partner:', message);
						} else {
							console.warn('[BrowserPanel] Failed to notify partner of lens update:', result.error);
						}
					} catch (err) {
						console.warn('[BrowserPanel] Failed to send lens update notification:', err);
					}
				}
			} catch (err) {
				console.warn('[BrowserPanel] Failed to update lens config:', err);
				// Revert UI change on error
				if (index >= 0) {
					holons[index].lensConfig = {
						lenses: [...new Set([...oldInbound, ...oldOutbound])],
						inbound: oldInbound,
						outbound: oldOutbound
					};
					holons = [...holons];
				}
			}
		}
	}

	function handleClose() {
		dispatch('close');
	}

	function handleAddHolon() {
		showAddModal = true;
		newHolonId = '';
		newHolonName = '';
		addError = '';
		addSuccess = '';
		isInitiatingFederation = false;
		// Reset lens config to defaults (both directions)
		selectedInboundLenses = new Set(DEFAULT_LENSES);
		selectedOutboundLenses = new Set(DEFAULT_LENSES);
	}


	function closeAddModal() {
		showAddModal = false;
		showQRScanner = false;
		newHolonId = '';
		newHolonName = '';
		addError = '';
		addSuccess = '';
		isInitiatingFederation = false;
	}

	function toggleInboundLens(lens: string) {
		if (selectedInboundLenses.has(lens)) selectedInboundLenses.delete(lens);
		else selectedInboundLenses.add(lens);
		selectedInboundLenses = new Set(selectedInboundLenses);
	}

	function toggleOutboundLens(lens: string) {
		if (selectedOutboundLenses.has(lens)) selectedOutboundLenses.delete(lens);
		else selectedOutboundLenses.add(lens);
		selectedOutboundLenses = new Set(selectedOutboundLenses);
	}

	// Federation request handlers
	async function handleAcceptRequest(request: PendingRequest) {
		// Use home holon for federation operations
		const myHolonId = $homeHolonId || currentHolonId;
		if (!$nostrPrivateKey || !holosphere || !myHolonId) return;

		processingRequestId = request.id;

		try {
			// Check if this is a lens update request or a federation request
			const isLensUpdate = (request as any).requestKind === 'lens_update';

			if (isLensUpdate) {
				// Handle lens update request
				await handleAcceptLensUpdate(request);
			} else {
				// Handle federation request
				await handleAcceptFederationRequest(request);
			}
		} catch (err) {
			console.error('[BrowserPanel] Failed to accept request:', err);
		} finally {
			processingRequestId = null;
		}
	}

	// Handle accepting a federation request
	async function handleAcceptFederationRequest(request: PendingRequest) {
		const myHolonId = $homeHolonId || currentHolonId;
		if (!$nostrPrivateKey || !holosphere || !myHolonId) {
			console.error('[BrowserPanel] Cannot accept: missing privateKey, holosphere, or home holon id');
			return;
		}

		const sharedLenses = request.lensConfig?.lenses || [];

		// Use the library's acceptFederationRequest which handles all steps:
		// partner registration, federateHolon, capability issuance,
		// response DM, dismissRequest, and hologram reception.
		// Cast options: the runtime accepts more than the public type declares.
		const result = (await handshake.acceptFederationRequest(holosphere, $nostrPrivateKey, {
			request: {
				requestId: request.id,
				senderHolonId: request.senderHolonId,
				senderHolonName: request.senderHolonName,
				capabilities: request.capabilities || [],
				lensConfig: { lenses: sharedLenses, inbound: sharedLenses, outbound: sharedLenses }
			},
			senderPubKey: request.senderPubKey,
			holonId: myHolonId,
			holonName: homeHolonName || 'My Holon',
			lensConfig: { lenses: sharedLenses, inbound: sharedLenses, outbound: sharedLenses }
		} as any)) as { success: boolean; error?: string };

		if (result.success) {
			pendingFederationRequests.updateStatus(request.id, 'accepted');
			await loadHolons();
			console.log('[BrowserPanel] Federation request accepted:', request.id);
		} else {
			console.error('[BrowserPanel] Failed to accept federation:', result.error);
		}
	}

	// Handle accepting a lens update request
	async function handleAcceptLensUpdate(request: PendingRequest) {
		const myHolonId = $homeHolonId || currentHolonId;
		if (!$nostrPrivateKey || !holosphere || !myHolonId) return;

		const update = (request as any).updateData;
		const senderPubKey = request.senderPubKey;

		const sharedUpdateLenses = request.lensConfig?.lenses || [];

		// acceptFederationUpdate handles both federateHolon and sending the response DM
		await handshake.acceptFederationUpdate(holosphere, $nostrPrivateKey, {
			updateId: update?.updateId || request.id,
			senderPubKey,
			holonId: myHolonId,
			newLensConfig: { lenses: sharedUpdateLenses, inbound: sharedUpdateLenses, outbound: sharedUpdateLenses }
		});

		pendingFederationRequests.updateStatus(request.id, 'accepted');
		await loadHolons();
		console.log('[BrowserPanel] Lens update accepted:', request.id);
	}

	async function handleDeclineRequest(request: PendingRequest) {
		if (!$nostrPrivateKey || !holosphere) return;

		try {
			// Cast: runtime accepts `senderPubKey`; public type omits it.
			await handshake.rejectFederationRequest(holosphere, $nostrPrivateKey, {
				requestId: request.id,
				senderPubKey: request.senderPubKey
			} as any);

			// Remove from requests store
			pendingFederationRequests.remove(request.id);

			console.log('[BrowserPanel] Federation request declined:', request.id);
		} catch (err) {
			console.error('[BrowserPanel] Failed to decline federation request:', err);
		}
	}

	// Recognize the holon-ID shapes this app uses, in order of confidence:
	// 64-char Nostr pubkey hex, npub bech32, or a numeric Telegram chat id.
	function looksLikeHolonId(s: string): boolean {
		return /^[0-9a-f]{64}$/i.test(s) || /^npub1[a-z0-9]+$/i.test(s) || /^-?\d+$/.test(s);
	}

	function extractHolonId(input: string): string {
		const text = input.trim();
		if (!text) return text;

		// Already an ID, not a URL.
		if (looksLikeHolonId(text)) {
			return text.toLowerCase().startsWith('npub1') ? text : text.toLowerCase();
		}

		// Parse as URL and look for an ID-shaped path segment. SvelteKit's
		// route is `/[id]/<lens>`, so the holon ID is the FIRST path segment —
		// the old `/(\w+)\/?$` matched the LAST segment, grabbing "dashboard".
		const tryUrl = (u: URL): string | null => {
			const segments = u.pathname.split('/').filter(Boolean);
			const idShaped = segments.find(looksLikeHolonId);
			if (idShaped) return idShaped;
			return segments[0] ?? null;
		};

		try {
			const matched = tryUrl(new URL(text));
			if (matched) return matched;
		} catch {
			// Not a parseable URL — fall through to path-style parse.
			const segments = text.split('/').filter(Boolean);
			const idShaped = segments.find(looksLikeHolonId);
			if (idShaped) return idShaped;
			if (segments[0]) return segments[0];
		}

		return text;
	}

	function handleQRScan(event: CustomEvent<{ decodedText: string }>) {
		showQRScanner = false;
		newHolonId = extractHolonId(event.detail.decodedText);
		addError = '';
		addSuccess = 'QR code scanned successfully!';
	}

	function openQRScanner() {
		showQRScanner = true;
		addError = '';
	}

	async function addNewHolon() {
		if (!newHolonId.trim()) {
			addError = 'Please enter a Holon ID';
			return;
		}

		const holonId = newHolonId.trim();
		addError = '';
		isInitiatingFederation = true;

		try {
			// Try to fetch the holon name if not provided
			let name = newHolonName.trim();
			if (!name && holosphere) {
				try {
					const fetchedName = await awaitName(holonId);
					name = fetchedName || `Holon ${holonId.slice(0, 8)}...`;
				} catch {
					name = `Holon ${holonId.slice(0, 8)}...`;
				}
			} else if (!name) {
				name = `Holon ${holonId.slice(0, 8)}...`;
			}

			// Initiate federation handshake if we have private key
			let federationStatus: FederationStatus = 'none';
			let pendingRequestId: string | undefined;

			// Use home holon for federation operations
			const myHolonId = $homeHolonId || currentHolonId;

			const inbound = Array.from(selectedInboundLenses);
			const outbound = Array.from(selectedOutboundLenses);
			const lensConfig = { lenses: [...new Set([...inbound, ...outbound])], inbound, outbound };
			const myHolonName = homeHolonName || 'My Holon';

			// Path A: full Nostr session — initiate a signed handshake DM so
			// the partner can accept/decline. Holon shows up as `pending_outgoing`
			// until they respond.
			if ($nostrPrivateKey && holosphere && myHolonId) {
				try {
					const result = (await handshake.initiateFederationHandshake(holosphere, $nostrPrivateKey, {
						partnerPubKey: holonId,
						holonId: myHolonId,
						holonName: myHolonName,
						lensConfig
					})) as { success: boolean; requestId?: string; error?: string };

					if (result.success && result.requestId) {
						federationStatus = 'pending_outgoing';
						pendingRequestId = result.requestId;

						const outgoing = createOutgoingRequest(
							result.requestId,
							myHolonId,
							'', // npub - not used for outgoing
							myHolonId,
							myHolonName,
							holonId,
							'', // recipientNpub - not used
							lensConfig,
							[],
							undefined,
							name // recipientHolonName
						);
						pendingFederationRequests.add(outgoing);

						console.log('[BrowserPanel] Federation handshake initiated:', result.requestId);
					} else {
						console.warn('[BrowserPanel] Federation handshake failed, will fall back to direct federate:', result.error);
					}
				} catch (err) {
					console.warn('[BrowserPanel] Federation handshake error, will fall back to direct federate:', err);
				}
			}

			// Path B: no local private key (telegram-mapped session) OR
			// handshake didn't produce a pending request — fall back to
			// `holosphere.federate(...)`, the same direct path Federation.svelte
			// uses. This writes the federation graph locally without needing
			// the partner to acknowledge a DM.
			if (federationStatus === 'none' && holosphere && myHolonId) {
				try {
					const ok = await holosphere.federate(
						myHolonId,
						holonId,
						null,
						null,
						true,
						{ inbound, outbound }
					);
					if (ok) {
						federationStatus = 'accepted';
						console.log('[BrowserPanel] Direct federation created with', holonId.slice(0, 12) + '...');
					} else {
						console.warn('[BrowserPanel] holosphere.federate returned false');
					}
				} catch (err) {
					console.error('[BrowserPanel] Direct federate failed:', err);
				}
			}

			// Add to holons list as pending or accepted.
			if (federationStatus === 'pending_outgoing' || federationStatus === 'accepted') {
				const exists = holons.some(h => h.id === holonId);
				if (!exists) {
					holons = [{
						id: holonId,
						name,
						federationStatus,
						pendingRequestId,
						lensConfig: { lenses: lensConfig.lenses, inbound, outbound }
					}, ...holons];
				}
				addSuccess = federationStatus === 'pending_outgoing'
					? 'Federation request sent! Waiting for response...'
					: 'Federation created.';
			} else {
				addError = 'Could not federate. Please check the Holon ID and try again.';
				return;
			}

			// Navigate to the holon
			setTimeout(() => {
				closeAddModal();
				goto(`/${holonId}/dashboard`);
			}, 500);
		} catch (err) {
			addError = err instanceof Error ? err.message : 'Failed to add holon';
		} finally {
			isInitiatingFederation = false;
		}
	}
</script>

<aside
	class="browser-panel"
	class:browser-panel--open={isOpen}
	aria-label="Holon browser"
>
	<!-- Compact header with search and add -->
	<div class="browser-panel__header">
		<div class="browser-panel__search">
			<Search size="14" />
			<input
				type="text"
				placeholder="Search holons..."
				bind:value={searchQuery}
			/>
		</div>
		<button
			class="browser-panel__add-btn"
			onclick={handleAddHolon}
			title="Add holon"
		>
			<Plus size="16" />
		</button>
	</div>

	<!-- Acting As holon selector (only shown when user has multiple holons) -->
	{#if $userHolons.length > 1}
		<div class="browser-panel__identity-selector">
			<label for="identity-selector">
				<span class="browser-panel__identity-label">Acting as:</span>
			</label>
			<select
				id="identity-selector"
				class="browser-panel__identity-select"
				value={$activeHolonIdentity}
				onchange={handleIdentityChange}
			>
				{#each $userHolons as holon}
					<option value={holon.id}>
						{holon.name}
						{#if holon.isOwner}(you){/if}
					</option>
				{/each}
			</select>
		</div>
	{/if}

	<!-- Holon List - unified view with federation status -->
	<HolonList
		holons={filteredHolons}
		{currentHolonId}
		{isLoading}
		showPinButton={false}
		showRemoveButton={true}
		homeHolonId={$homeHolonId || currentHolonId}
		{homeHolonName}
		showHomeSection={true}
		incomingRequests={$incomingRequests}
		{processingRequestId}
		on:select={(e) => selectHolon(e.detail.holonId)}
		on:star={(e) => toggleStar(e.detail.holonId)}
		on:remove={(e) => removeHolon(e.detail.holonId)}
		on:lensConfigUpdate={(e) => handleLensConfigUpdate(e)}
		on:acceptRequest={(e) => handleAcceptRequest(e.detail)}
		on:declineRequest={(e) => handleDeclineRequest(e.detail)}
	/>

	<!-- Version footer -->
	<div class="browser-panel__footer">
		<span class="browser-panel__app-name" class:browser-panel__app-name--debug={appName !== 'Holons'} title="HoloSphere appName">app: {appName}</span>
		{#if showAppToggle}
			<button
				type="button"
				class="browser-panel__app-toggle"
				onclick={toggleAppName}
				title="Switch to {appName === 'Holons' ? 'HolonsDebug (debug data)' : 'Holons (production data)'} and reload"
			>
				⇄ {appName === 'Holons' ? 'debug' : 'prod'}
			</button>
		{/if}
		<span title="Build: {commitHash}">build: {commitHash}</span>
		<span title="Holosphere version">holosphere: {holosphereVersion}</span>
	</div>
</aside>

<!-- Add Holon Modal -->
{#if showAddModal}
	<div
		class="add-modal-backdrop"
		onclick={closeAddModal}
		onkeydown={(e) => e.key === 'Escape' && closeAddModal()}
		role="button"
		tabindex="0"
	>
		<div
			class="add-modal"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<div class="add-modal__header">
				<h3>Add Holon</h3>
				<button class="add-modal__close" onclick={closeAddModal} aria-label="Close">×</button>
			</div>

			<div class="add-modal__content">
				{#if addError}
					<div class="add-modal__error">{addError}</div>
				{/if}
				{#if addSuccess}
					<div class="add-modal__success">{addSuccess}</div>
				{/if}

				<div class="add-modal__field">
					<label for="holon-id-input">Holon ID</label>
					<div class="add-modal__input-row">
						<input
							id="holon-id-input"
							type="text"
							bind:value={newHolonId}
							placeholder="Enter Holon ID"
							onkeydown={(e) => e.key === 'Enter' && addNewHolon()}
						/>
						<button
							type="button"
							class="add-modal__qr-btn"
							onclick={openQRScanner}
							title="Scan QR Code"
						>
							<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
							</svg>
						</button>
					</div>
				</div>

				<div class="add-modal__field">
					<label for="holon-name-input">Display Name (optional)</label>
					<input
						id="holon-name-input"
						type="text"
						bind:value={newHolonName}
						placeholder="Custom name for display"
						onkeydown={(e) => e.key === 'Enter' && addNewHolon()}
					/>
				</div>

				<!-- Lens Configuration: per-direction (mirrors Federation.svelte). -->
				<div class="add-modal__lens-config">
					<div class="add-modal__lens-section">
						<div class="add-modal__lens-head">
							<span class="add-modal__lens-label">Lens</span>
							<span class="add-modal__lens-col" title="Inbound — receive from this holon">
								<ArrowDown size="12" /> In
							</span>
							<span class="add-modal__lens-col" title="Outbound — send to this holon">
								<ArrowUp size="12" /> Out
							</span>
						</div>
						{#each availableLenses as lens}
							{@const isIn = selectedInboundLenses.has(lens)}
							{@const isOut = selectedOutboundLenses.has(lens)}
							<div class="add-modal__lens-row">
								<span class="add-modal__lens-name">{lens}</span>
								<button
									type="button"
									class="add-modal__toggle"
									class:add-modal__toggle--on={isIn}
									onclick={() => toggleInboundLens(lens)}
									aria-pressed={isIn}
									aria-label="{isIn ? 'Disable' : 'Enable'} inbound {lens}"
									title="{isIn ? 'Disable' : 'Enable'} inbound {lens}"
								>
									<span class="add-modal__toggle-dot"></span>
								</button>
								<button
									type="button"
									class="add-modal__toggle"
									class:add-modal__toggle--on={isOut}
									onclick={() => toggleOutboundLens(lens)}
									aria-pressed={isOut}
									aria-label="{isOut ? 'Disable' : 'Enable'} outbound {lens}"
									title="{isOut ? 'Disable' : 'Enable'} outbound {lens}"
								>
									<span class="add-modal__toggle-dot"></span>
								</button>
							</div>
						{/each}
					</div>
				</div>
			</div>

			<div class="add-modal__actions">
				<button
					class="btn btn--primary"
					onclick={addNewHolon}
					disabled={isInitiatingFederation}
				>
					{#if isInitiatingFederation}
						Connecting...
					{:else}
						Add & Federate
					{/if}
				</button>
				<button class="btn btn--secondary" onclick={closeAddModal}>Cancel</button>
			</div>
		</div>
	</div>
{/if}

<!-- QR Scanner -->
<QRScanner
	bind:showScanner={showQRScanner}
	on:scan={handleQRScan}
	on:close={() => showQRScanner = false}
/>

<style>
	.browser-panel {
		display: flex;
		flex-direction: column;
		width: var(--browser-width-expanded, 260px);
		height: 100vh;
		background: var(--color-bg-primary, var(--color-bg-primary));
		border-right: 1px solid var(--color-border, var(--color-bg-tertiary));
		transition: transform 350ms ease, width 350ms ease, margin-left 350ms ease;
		overflow: hidden;
		flex-shrink: 0;
	}

	/* Desktop: hide sidebar by shifting it off-screen */
	@media (min-width: 1025px) {
		.browser-panel:not(.browser-panel--open) {
			margin-left: calc(-1 * var(--browser-width-expanded, 260px));
		}
	}

	/* Mobile overlay style */
	@media (max-width: 1024px) {
		.browser-panel {
			position: fixed;
			left: 0;
			top: 0;
			bottom: 0;
			width: min(85vw, 300px);
			z-index: 50;
			transform: translateX(-100%);
			box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
		}

		.browser-panel--open {
			transform: translateX(0);
		}
	}

	/* Compact header with search and add button */
	.browser-panel__header {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		border-bottom: 1px solid var(--color-border, var(--color-bg-tertiary));
		flex-shrink: 0;
	}

	.browser-panel__search {
		flex: 1;
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		padding: var(--spacing-1, 0.25rem) var(--spacing-2, 0.5rem);
		background: var(--color-bg-secondary, var(--color-bg-secondary));
		border-radius: var(--radius-md, 0.375rem);
		color: var(--color-text-muted, var(--color-text-muted));
	}

	.browser-panel__search input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: var(--color-text-primary, #ffffff);
		font-size: var(--font-size-sm, 0.875rem);
	}

	.browser-panel__search input::placeholder {
		color: var(--color-text-muted, var(--color-text-muted));
	}

	.browser-panel__add-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: var(--color-accent, var(--color-accent));
		border: none;
		border-radius: var(--radius-md, 0.375rem);
		color: var(--color-text-primary);
		cursor: pointer;
		transition: background-color 150ms ease;
		flex-shrink: 0;
	}

	.browser-panel__add-btn:hover {
		background: var(--color-accent-dark, var(--color-accent-hover));
	}

	/* Identity selector (Acting As dropdown) */
	.browser-panel__identity-selector {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		border-bottom: 1px solid var(--color-border, var(--color-bg-tertiary));
		background: rgba(168, 85, 247, 0.1);
	}

	.browser-panel__identity-label {
		font-size: var(--font-size-xs, 0.75rem);
		color: var(--color-text-muted, var(--color-text-muted));
		white-space: nowrap;
	}

	.browser-panel__identity-select {
		flex: 1;
		padding: var(--spacing-1, 0.25rem) var(--spacing-2, 0.5rem);
		background: var(--color-bg-secondary, var(--color-bg-secondary));
		border: 1px solid var(--color-border, var(--color-bg-tertiary));
		border-radius: var(--radius-sm, 0.25rem);
		color: var(--color-text-primary, #ffffff);
		font-size: var(--font-size-xs, 0.75rem);
		cursor: pointer;
	}

	.browser-panel__identity-select:focus {
		outline: none;
		border-color: #a855f7;
		box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.2);
	}

	.browser-panel__identity-select option {
		background: var(--color-bg-secondary, var(--color-bg-secondary));
		color: var(--color-text-primary, #ffffff);
	}


	/* Add Holon Modal */
	.add-modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}

	.add-modal {
		background: var(--color-bg-secondary, var(--color-bg-secondary));
		border-radius: var(--radius-xl, 1rem);
		padding: var(--spacing-5, 1.25rem);
		max-width: 400px;
		width: 90%;
		box-shadow: var(--shadow-xl);
		border: 1px solid var(--color-border, var(--color-bg-tertiary));
	}

	.add-modal__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--spacing-4, 1rem);
	}

	.add-modal__header h3 {
		font-size: var(--font-size-lg, 1.125rem);
		font-weight: var(--font-weight-semibold, 600);
		color: var(--color-text-primary, #ffffff);
		margin: 0;
	}

	.add-modal__close {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: var(--color-text-muted, var(--color-text-muted));
		font-size: 1.5rem;
		cursor: pointer;
		border-radius: var(--radius-md, 0.375rem);
	}

	.add-modal__close:hover {
		background: var(--color-bg-tertiary, var(--color-bg-tertiary));
		color: var(--color-text-primary, #ffffff);
	}

	.add-modal__content {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-4, 1rem);
	}

	.add-modal__field {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-2, 0.5rem);
	}

	.add-modal__field label {
		font-size: var(--font-size-sm, 0.875rem);
		font-weight: var(--font-weight-medium, 500);
		color: var(--color-text-secondary, var(--color-text-secondary));
	}

	.add-modal__field input {
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		background: var(--color-bg-primary, var(--color-bg-primary));
		border: 1px solid var(--color-border, var(--color-bg-tertiary));
		border-radius: var(--radius-md, 0.375rem);
		color: var(--color-text-primary, #ffffff);
		font-size: var(--font-size-sm, 0.875rem);
	}

	.add-modal__field input:focus {
		outline: none;
		border-color: var(--color-accent, var(--color-accent));
		box-shadow: 0 0 0 2px var(--color-accent-subtle, rgba(79, 70, 229, 0.1));
	}

	.add-modal__field input::placeholder {
		color: var(--color-text-muted, var(--color-text-muted));
	}

	.add-modal__input-row {
		display: flex;
		gap: var(--spacing-2, 0.5rem);
	}

	.add-modal__input-row input {
		flex: 1;
	}

	.add-modal__qr-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 42px;
		height: 42px;
		background: var(--color-success, #22c55e);
		border: none;
		border-radius: var(--radius-md, 0.375rem);
		color: var(--color-text-primary);
		cursor: pointer;
		transition: background-color 150ms ease;
		flex-shrink: 0;
	}

	.add-modal__qr-btn:hover {
		background: var(--color-success-hover, #16a34a);
	}

	.add-modal__error {
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid var(--color-error, #ef4444);
		border-radius: var(--radius-md, 0.375rem);
		color: var(--color-error, #ef4444);
		font-size: var(--font-size-sm, 0.875rem);
	}

	.add-modal__success {
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		background: rgba(34, 197, 94, 0.1);
		border: 1px solid var(--color-success, #22c55e);
		border-radius: var(--radius-md, 0.375rem);
		color: var(--color-success, #22c55e);
		font-size: var(--font-size-sm, 0.875rem);
	}

	.add-modal__actions {
		display: flex;
		gap: var(--spacing-3, 0.75rem);
		margin-top: var(--spacing-4, 1rem);
	}

	.add-modal__actions .btn {
		flex: 1;
	}

	.add-modal__actions .btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	/* Lens Configuration */
	.add-modal__lens-config {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-3, 0.75rem);
		padding: var(--spacing-3, 0.75rem);
		background: var(--color-bg-primary, var(--color-bg-primary));
		border-radius: var(--radius-md, 0.375rem);
		border: 1px solid var(--color-border, var(--color-bg-tertiary));
	}

	.add-modal__lens-section {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-2, 0.5rem);
	}

	.add-modal__lens-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		font-size: var(--font-size-xs, 0.75rem);
		font-weight: var(--font-weight-medium, 500);
		color: var(--color-text-muted, var(--color-text-muted));
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}


	.add-modal__lens-head {
		display: grid;
		grid-template-columns: 1fr 56px 56px;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		padding: var(--spacing-1, 0.25rem) var(--spacing-2, 0.5rem);
		font-size: var(--font-size-xs, 0.75rem);
		color: var(--color-text-muted, var(--color-text-muted));
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.add-modal__lens-col {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		justify-content: center;
	}

	.add-modal__lens-row {
		display: grid;
		grid-template-columns: 1fr 56px 56px;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		padding: var(--spacing-1, 0.25rem) var(--spacing-2, 0.5rem);
		border-radius: var(--radius-sm, 0.25rem);
	}

	.add-modal__lens-row:hover {
		background: var(--color-bg-secondary, var(--color-bg-secondary));
	}

	.add-modal__lens-name {
		font-size: var(--font-size-sm, 0.875rem);
		color: var(--color-text-secondary, var(--color-text-secondary));
	}

	.add-modal__toggle {
		position: relative;
		width: 36px;
		height: 20px;
		justify-self: center;
		border-radius: 9999px;
		background: var(--color-bg-tertiary, var(--color-bg-tertiary));
		border: 1px solid var(--color-border, var(--color-border-light));
		cursor: pointer;
		transition: background-color 150ms ease, border-color 150ms ease;
		padding: 0;
	}

	.add-modal__toggle--on {
		background: var(--color-accent, var(--color-accent));
		border-color: var(--color-accent, var(--color-accent));
	}

	.add-modal__toggle-dot {
		display: block;
		position: absolute;
		top: 50%;
		left: 2px;
		width: 14px;
		height: 14px;
		border-radius: 9999px;
		background: white;
		transform: translateY(-50%);
		transition: left 150ms ease;
	}

	.add-modal__toggle--on .add-modal__toggle-dot {
		left: 18px;
	}

	/* Version footer */
	.browser-panel__footer {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		border-top: 1px solid var(--color-border, var(--color-bg-tertiary));
		margin-top: auto;
		flex-shrink: 0;
	}

	.browser-panel__footer span {
		font-size: 10px;
		font-family: monospace;
		color: var(--color-text-muted, var(--color-text-muted));
		opacity: 0.6;
	}

	.browser-panel__app-name {
		font-weight: 600;
		opacity: 0.85 !important;
	}

	.browser-panel__app-name--debug {
		color: #f59e0b !important;
	}

	.browser-panel__app-toggle {
		display: inline-block;
		font-size: 10px;
		font-family: monospace;
		color: var(--color-text-muted, var(--color-text-muted));
		background: rgba(245, 158, 11, 0.12);
		border: 1px solid rgba(245, 158, 11, 0.35);
		border-radius: 3px;
		padding: 1px 6px;
		margin-top: 2px;
		cursor: pointer;
		opacity: 0.85;
		width: fit-content;
		transition: background-color 120ms ease, opacity 120ms ease;
	}

	.browser-panel__app-toggle:hover {
		background: rgba(245, 158, 11, 0.22);
		opacity: 1;
	}

</style>
