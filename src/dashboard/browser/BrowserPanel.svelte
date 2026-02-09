<script lang="ts">
	import { createEventDispatcher, getContext, onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import type { HoloSphere } from 'holosphere';
	import { Search, Plus, X, Upload } from 'svelte-feathers';
	import { nostrPublicKey, nostrPrivateKey, nostrStore } from '../../lib/stores/nostr';
	import { incomingRequests, outgoingRequests, pendingFederationRequests, federationNotifications, type PendingRequest, createIncomingRequest, createOutgoingRequest, incomingUpdates, pendingUpdates } from '../../lib/stores/federationRequests';
	import { handshake } from 'holosphere';
	import HolonList from './HolonList.svelte';
	import QRScanner from '../../components/QRScanner.svelte';

	import { ID, sidebarExpanded } from '../store';
	import { nameMap, resolveName, awaitName, forceRefreshHolonName } from '$lib/stores/nameResolver';
	import { activeHolonIdentity, userHolons, activeHolonIdentityStore } from '../../lib/stores/activeHolonIdentity';

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
		lensConfig?: { lenses: string[] };
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

	// Lens configuration for federation (same as Federation component)
	const availableLenses = ['quests', 'offers', 'tags', 'expenses', 'announcements', 'users', 'shopping', 'recurring'];
	let selectedLenses: Set<string> = new Set(['quests', 'offers', 'users']);


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

	// Starred IDs (not used in federation-only mode, but kept for HolonList compatibility)
	const starredIds: string[] = [];

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
			if ($nostrPublicKey) {
				pendingFederationRequests.init($nostrPublicKey);
			}

			// Update user holons for the identity selector
			updateUserHolons();
		}

		// Listen for holon updates
		window.addEventListener('holonCreated', handleHolonCreated as EventListener);
		window.addEventListener('holonNavigated', handleHolonNavigated as EventListener);
		window.addEventListener('holonNameUpdated', handleHolonNameUpdated as EventListener);
		window.addEventListener('federationResponse', handleFederationResponseEvent as EventListener);
		window.addEventListener('federationRequest', handleFederationRequestEvent as EventListener);
		window.addEventListener('federationUpdate', handleFederationUpdateEvent as EventListener);
		window.addEventListener('federationChanged', handleFederationChanged as EventListener);
	});

	onDestroy(() => {
		if (browser) {
			window.removeEventListener('holonCreated', handleHolonCreated as EventListener);
			window.removeEventListener('holonNavigated', handleHolonNavigated as EventListener);
			window.removeEventListener('holonNameUpdated', handleHolonNameUpdated as EventListener);
			window.removeEventListener('federationResponse', handleFederationResponseEvent as EventListener);
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

		// IMPORTANT: Always load federation from the user's HOME holon, not the currently viewed holon
		// Federation relationships are stored on the home holon, not on federated partner holons
		const federationSourceId = $nostrPublicKey || currentHolonId;
		console.log('[BrowserPanel] loadHolons called, currentHolonId:', currentHolonId?.slice(0, 12), 'federationSourceId:', federationSourceId?.slice(0, 12));

		try {
			const holonList: SidebarHolon[] = [];

			// Load federated holons from holosphere using the HOME holon ID
			if (holosphere && federationSourceId) {
				try {
					const federationInfo = await holosphere.getFederation(federationSourceId);
					console.log('[BrowserPanel] getFederation result:', {
						federated: federationInfo?.federated?.length || 0,
						pending: federationInfo?.pending?.length || 0,
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
							holonList.push({
								id: holonId,
								name: name || `Holon ${holonId.slice(0, 8)}...`,
								federationStatus: 'accepted',
								lensConfig: {
									lenses: Array.isArray(storedLensConfig?.lenses)
										? storedLensConfig.lenses
										: [...new Set([
											...(Array.isArray(storedLensConfig?.inbound) ? storedLensConfig.inbound : []),
											...(Array.isArray(storedLensConfig?.outbound) ? storedLensConfig.outbound : [])
										])]
								}
							});
						}
					}

					// Also load pending outgoing requests from holosphere
					if (federationInfo?.pending && Array.isArray(federationInfo.pending)) {
						for (const holonId of federationInfo.pending) {
							// Try HNS first, then fall back to stored partner name
							let name = await forceRefreshHolonName(holosphere, holonId);

							if (!name || name.startsWith('Holon ')) {
								const storedName = federationInfo.partnerNames?.[holonId];
								if (storedName && storedName !== holonId) {
									name = storedName;
								}
							}

							holonList.push({
								id: holonId,
								name: name || `Holon ${holonId.slice(0, 8)}...`,
								federationStatus: 'pending_outgoing'
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
		if (!$nostrPublicKey) return;

		const memberships = [
			// User's own holon (they are always the owner of their pubkey holon)
			{ id: $nostrPublicKey, name: homeHolonName || 'My Holon', isOwner: true }
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
	$: if (holons.length >= 0 && $nostrPublicKey) {
		updateUserHolons();
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
		const homeHolonId = $nostrPublicKey || currentHolonId;

		// Revoke federation
		if (holon?.federationStatus === 'accepted' && holosphere && homeHolonId) {
			try {
				if (holosphere.unfederateHolon) {
					await holosphere.unfederateHolon(homeHolonId, holonId);
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

	async function handleLensConfigUpdate(event: CustomEvent<{ holonId: string; lensConfig: { lenses: string[] } }>) {
		const { holonId, lensConfig } = event.detail;

		// Get old lens config to determine what's new
		const index = holons.findIndex(h => h.id === holonId);
		const oldLenses = index >= 0 ? (holons[index].lensConfig?.lenses || []) : [];
		const newLenses = lensConfig.lenses;

		// Check if there's actually a change
		const changed = JSON.stringify([...oldLenses].sort()) !== JSON.stringify([...newLenses].sort());
		if (!changed) return;

		// Update the holon's lens config in the list immediately for UI responsiveness
		if (index >= 0) {
			holons[index].lensConfig = lensConfig;
			holons = [...holons];
		}

		// Use home holon for federation operations
		const homeHolonId = $nostrPublicKey || currentHolonId;

		// Update federation lens config in holosphere
		if (holosphere && homeHolonId) {
			try {
				// Use federateHolon to update the lens config (it handles updates too)
				const fedLensConfig = { lenses: newLenses, inbound: newLenses, outbound: newLenses };
				await holosphere.federateHolon(homeHolonId, holonId, {
					lensConfig: fedLensConfig,
					skipPropagation: true // Don't re-propagate existing data
				});
				console.log('[BrowserPanel] Lens config saved for:', holonId.slice(0, 12) + '...', lensConfig);

				// Send lens update notification to partner via NIP-44 DM
				if ($nostrPrivateKey) {
					const addedLenses = newLenses.filter(l => !oldLenses.includes(l));
					const removedLenses = oldLenses.filter(l => !newLenses.includes(l));
					const parts: string[] = [];
					if (addedLenses.length > 0) parts.push(`Added: ${addedLenses.join(', ')}`);
					if (removedLenses.length > 0) parts.push(`Removed: ${removedLenses.join(', ')}`);
					const message = parts.length > 0 ? parts.join('. ') : 'Updated lens configuration';

					try {
						const result = await handshake.requestFederationUpdate(holosphere, $nostrPrivateKey, {
							partnerPubKey: holonId,
							holonId: homeHolonId,
							holonName: homeHolonName || 'My Holon',
							newLensConfig: fedLensConfig,
							message
						});
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
					holons[index].lensConfig = { lenses: oldLenses };
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
		// Reset lens config to defaults
		selectedLenses = new Set(['quests', 'offers', 'users']);
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

	function toggleLens(lens: string) {
		if (selectedLenses.has(lens)) {
			selectedLenses.delete(lens);
		} else {
			selectedLenses.add(lens);
		}
		selectedLenses = new Set(selectedLenses);
	}

	// Federation request handlers
	async function handleAcceptRequest(request: PendingRequest) {
		// Use home holon for federation operations
		const homeHolonId = $nostrPublicKey || currentHolonId;
		if (!$nostrPrivateKey || !holosphere || !homeHolonId) return;

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
		const homeHolonId = $nostrPublicKey || currentHolonId;
		if (!$nostrPrivateKey || !holosphere || !homeHolonId) {
			console.error('[BrowserPanel] Cannot accept: missing privateKey, holosphere, or homeHolonId');
			return;
		}

		const sharedLenses = request.lensConfig?.lenses || [];

		// Use the library's acceptFederationRequest which handles all steps:
		// partner registration, federateHolon, capability issuance,
		// response DM, dismissRequest, and hologram reception
		const result = await handshake.acceptFederationRequest(holosphere, $nostrPrivateKey, {
			request: {
				requestId: request.id,
				senderHolonId: request.senderHolonId,
				senderHolonName: request.senderHolonName,
				capabilities: request.capabilities || [],
				lensConfig: { lenses: sharedLenses, inbound: sharedLenses, outbound: sharedLenses }
			},
			senderPubKey: request.senderPubKey,
			holonId: homeHolonId,
			holonName: homeHolonName || 'My Holon',
			lensConfig: { lenses: sharedLenses, inbound: sharedLenses, outbound: sharedLenses }
		});

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
		const homeHolonId = $nostrPublicKey || currentHolonId;
		if (!$nostrPrivateKey || !holosphere || !homeHolonId) return;

		const update = (request as any).updateData;
		const senderPubKey = request.senderPubKey;

		const sharedUpdateLenses = request.lensConfig?.lenses || [];

		// acceptFederationUpdate handles both federateHolon and sending the response DM
		await handshake.acceptFederationUpdate(holosphere, $nostrPrivateKey, {
			updateId: update?.updateId || request.id,
			senderPubKey,
			holonId: homeHolonId,
			newLensConfig: { lenses: sharedUpdateLenses, inbound: sharedUpdateLenses, outbound: sharedUpdateLenses }
		});

		pendingFederationRequests.updateStatus(request.id, 'accepted');
		await loadHolons();
		console.log('[BrowserPanel] Lens update accepted:', request.id);
	}

	async function handleDeclineRequest(request: PendingRequest) {
		if (!$nostrPrivateKey || !holosphere) return;

		try {
			await handshake.rejectFederationRequest(holosphere, $nostrPrivateKey, {
				requestId: request.id,
				senderPubKey: request.senderPubKey
			});

			// Remove from requests store
			pendingFederationRequests.remove(request.id);

			console.log('[BrowserPanel] Federation request declined:', request.id);
		} catch (err) {
			console.error('[BrowserPanel] Failed to decline federation request:', err);
		}
	}

	function handleQRScan(event: CustomEvent<{ decodedText: string }>) {
		const scannedText = event.detail.decodedText;
		showQRScanner = false;

		// Extract holon ID from the scanned text
		// Could be a full URL like https://holons.me/abc123 or just the ID
		let holonId = scannedText;

		// Try to extract ID from URL patterns
		const urlMatch = scannedText.match(/\/([a-zA-Z0-9_-]+)\/?$/);
		if (urlMatch) {
			holonId = urlMatch[1];
		}

		newHolonId = holonId;
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
			const homeHolonId = $nostrPublicKey || currentHolonId;

			if ($nostrPrivateKey && holosphere && homeHolonId) {
				try {
					const lenses = Array.from(selectedLenses);
					const lensConfig = { lenses, inbound: lenses, outbound: lenses };

					// Get home holon name for federation request
					const myHolonName = homeHolonName || 'My Holon';

					const result = await handshake.initiateFederationHandshake(holosphere, $nostrPrivateKey, {
						partnerPubKey: holonId,
						holonId: homeHolonId,
						holonName: myHolonName,
						lensConfig
					});

					if (result.success && result.requestId) {
						federationStatus = 'pending_outgoing';
						pendingRequestId = result.requestId;

						// Persist outgoing request to store for reload persistence
						const outgoing = createOutgoingRequest(
							result.requestId,
							$nostrPublicKey || homeHolonId,
							'', // npub - not used for outgoing
							homeHolonId,
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
						console.warn('[BrowserPanel] Federation handshake failed:', result.error);
						// Still add the holon but without federation
					}
				} catch (err) {
					console.warn('[BrowserPanel] Federation handshake error:', err);
					// Still add the holon but without federation
				}
			}

			// Add to holons list as pending (will appear in list until federation completes)
			if (federationStatus === 'pending_outgoing') {
				const exists = holons.some(h => h.id === holonId);
				if (!exists) {
					holons = [{
						id: holonId,
						name,
						federationStatus,
						pendingRequestId
					}, ...holons];
				}
				addSuccess = 'Federation request sent! Waiting for response...';
			} else {
				addError = 'Could not initiate federation. Make sure you have a valid identity.';
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
			<Search size={14} />
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
			<Plus size={16} />
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
		showStarButton={true}
		showRemoveButton={true}
		{starredIds}
		homeHolonId={$nostrPublicKey}
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

				<!-- Lens Configuration -->
				<div class="add-modal__lens-config">
					<div class="add-modal__lens-section">
						<span class="add-modal__lens-label">Shared Lenses</span>
						<div class="add-modal__lens-toggles">
							{#each availableLenses as lens}
								<label class="add-modal__lens-toggle">
									<input
										type="checkbox"
										checked={selectedLenses.has(lens)}
										onchange={() => toggleLens(lens)}
									/>
									<span>{lens}</span>
								</label>
							{/each}
						</div>
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
		background: var(--color-bg-primary, #111827);
		border-right: 1px solid var(--color-border, #374151);
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
		border-bottom: 1px solid var(--color-border, #374151);
		flex-shrink: 0;
	}

	.browser-panel__search {
		flex: 1;
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		padding: var(--spacing-1, 0.25rem) var(--spacing-2, 0.5rem);
		background: var(--color-bg-secondary, #1f2937);
		border-radius: var(--radius-md, 0.375rem);
		color: var(--color-text-muted, #6b7280);
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
		color: var(--color-text-muted, #6b7280);
	}

	.browser-panel__add-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: var(--color-accent, #4f46e5);
		border: none;
		border-radius: var(--radius-md, 0.375rem);
		color: white;
		cursor: pointer;
		transition: background-color 150ms ease;
		flex-shrink: 0;
	}

	.browser-panel__add-btn:hover {
		background: var(--color-accent-dark, #4338ca);
	}

	/* Identity selector (Acting As dropdown) */
	.browser-panel__identity-selector {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		border-bottom: 1px solid var(--color-border, #374151);
		background: rgba(168, 85, 247, 0.1);
	}

	.browser-panel__identity-label {
		font-size: var(--font-size-xs, 0.75rem);
		color: var(--color-text-muted, #6b7280);
		white-space: nowrap;
	}

	.browser-panel__identity-select {
		flex: 1;
		padding: var(--spacing-1, 0.25rem) var(--spacing-2, 0.5rem);
		background: var(--color-bg-secondary, #1f2937);
		border: 1px solid var(--color-border, #374151);
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
		background: var(--color-bg-secondary, #1f2937);
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
		background: var(--color-bg-secondary, #1f2937);
		border-radius: var(--radius-xl, 1rem);
		padding: var(--spacing-5, 1.25rem);
		max-width: 400px;
		width: 90%;
		box-shadow: var(--shadow-xl);
		border: 1px solid var(--color-border, #374151);
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
		color: var(--color-text-muted, #6b7280);
		font-size: 1.5rem;
		cursor: pointer;
		border-radius: var(--radius-md, 0.375rem);
	}

	.add-modal__close:hover {
		background: var(--color-bg-tertiary, #374151);
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
		color: var(--color-text-secondary, #d1d5db);
	}

	.add-modal__field input {
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		background: var(--color-bg-primary, #111827);
		border: 1px solid var(--color-border, #374151);
		border-radius: var(--radius-md, 0.375rem);
		color: var(--color-text-primary, #ffffff);
		font-size: var(--font-size-sm, 0.875rem);
	}

	.add-modal__field input:focus {
		outline: none;
		border-color: var(--color-accent, #4f46e5);
		box-shadow: 0 0 0 2px var(--color-accent-subtle, rgba(79, 70, 229, 0.1));
	}

	.add-modal__field input::placeholder {
		color: var(--color-text-muted, #6b7280);
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
		color: white;
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
		background: var(--color-bg-primary, #111827);
		border-radius: var(--radius-md, 0.375rem);
		border: 1px solid var(--color-border, #374151);
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
		color: var(--color-text-muted, #6b7280);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.add-modal__lens-icon {
		font-size: var(--font-size-sm, 0.875rem);
	}

	.add-modal__lens-toggles {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-2, 0.5rem);
	}

	.add-modal__lens-toggle {
		display: flex;
		align-items: center;
		gap: var(--spacing-1, 0.25rem);
		padding: var(--spacing-1, 0.25rem) var(--spacing-2, 0.5rem);
		background: var(--color-bg-secondary, #1f2937);
		border-radius: var(--radius-sm, 0.25rem);
		cursor: pointer;
		transition: background-color 150ms ease;
	}

	.add-modal__lens-toggle:hover {
		background: var(--color-bg-tertiary, #374151);
	}

	.add-modal__lens-toggle input[type="checkbox"] {
		width: 14px;
		height: 14px;
		accent-color: var(--color-accent, #4f46e5);
	}

	.add-modal__lens-toggle span {
		font-size: var(--font-size-xs, 0.75rem);
		color: var(--color-text-secondary, #d1d5db);
	}

</style>
