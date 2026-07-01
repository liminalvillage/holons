<script lang="ts">
	// @ts-nocheck

	import { onMount, getContext } from "svelte";
	import { goto } from "$app/navigation";
	import { ID } from "../dashboard/store";
	import { formatDate, formatTime } from "../utils/date";
	import { formatRelativeExpiry } from "$lib/util/relativeTime";
	import type { HoloSphere } from "holosphere";
	import Announcements from "./Announcements.svelte";
	import { nameMap, resolvedName, resolveName, resolvedInitials, resolveHologramSource, extractHolonIdFromSoul } from '$lib/stores/nameResolver';
	import TitleBar from "./shared/TitleBar.svelte";
	import FeatureToolbar from "./shared/FeatureToolbar.svelte";
	import Modal from "./shared/Modal.svelte";
	import OfferDetailModal from "./OfferDetailModal.svelte";
	import { Gift, Plus, ArrowDownCircle, ArrowUpCircle, Search } from 'svelte-feathers';
	import { loadFilters, saveFilters } from '$lib/util/persistedFilters';
	import { showFederated, showHolograms, showUnverified, passesLensFilters } from "$lib/stores/lensFilters";
	import SourceBadge from "./shared/SourceBadge.svelte";
	import { nostrPublicKey } from "../lib/stores/nostr";
	import { notifyWriteDenied } from "../lib/stores/writeNotifications";
	import { mergeSelfIntoUsers, getSelfInitiator } from "$lib/util/usersWithSelf";
	import { classifyMarketItem, createMarketItem } from "@holons/core/tasks";

	// Add offer/request modal state
	let showAddModal = false;
	let addModalType: 'offer' | 'request' = 'offer';
	let newItemTitle = '';
	let newItemDescription = '';
	let newItemItemType: 'good' | 'service' | '' = '';
	let newItemTransactionTypes: string[] = [];
	let newItemTagInput = '';
	let newItemTags: string[] = [];
	let newItemExpiresAtLocal = ''; // datetime-local value (empty = no expiry)

	const TRANSACTION_TYPES = [
		{ value: 'borrow-lend',    offerLabel: 'Lend',    requestLabel: 'Borrow' },
		{ value: 'rent-lease',     offerLabel: 'Rent',    requestLabel: 'Rent' },
		{ value: 'buy-sell',       offerLabel: 'Sell',    requestLabel: 'Buy' },
		{ value: 'receive-donate', offerLabel: 'Donate',  requestLabel: 'Receive' },
	];

	/**
	 * @type {string | any[]}
	 */
	let store = {};
	let holonID: string | null = null;
	$: holonName = resolvedName(holonID, $nameMap, null, 'Offers & Requests');

	// Per-feature filters (search). The federation/hologram toggles are
	// global — see $lib/stores/lensFilters.
	let filters = loadFilters('offers', {
		searchQueryOffers: '',
		searchQueryRequests: '',
	});
	$: saveFilters('offers', filters);
	$: includeFederatedOffers = $showFederated;
	let loadingFederated = false;

	function matchesVisibility(item: any): boolean {
		return passesLensFilters(item, $showHolograms, $showFederated, $showUnverified);
	}

	function matchesSearch(item: any, query: string): boolean {
		const q = query.trim().toLowerCase();
		if (!q) return true;
		const tagsText = Array.isArray(item.tags) ? item.tags.join(' ') : '';
		return `${item.title ?? ''} ${item.description ?? ''} ${tagsText}`
			.toLowerCase()
			.includes(q);
	}

	$: offers = Object.values(store).filter((item) => {
		if (classifyMarketItem(item) !== 'offer') return false;
		if (!matchesVisibility(item)) return false;
		return matchesSearch(item, filters.searchQueryOffers);
	});
	$: needs = Object.values(store).filter((item) => {
		const t = classifyMarketItem(item);
		if (t !== 'request' && t !== 'need') return false;
		if (!matchesVisibility(item)) return false;
		return matchesSearch(item, filters.searchQueryRequests);
	});

	let holosphere = getContext("holosphere") as HoloSphere;

	let userStore = {};
	let selectedItem: any = null; // item currently shown in detail modal
	let componentReady = false; // Track if component is ready to work

	// Add publish functionality
	let isPublishing = false;
	let publishStatus = '';
	let publishingItemKey = null;

	// Check holosphere availability with retry logic
	async function waitForHolosphere(): Promise<boolean> {
		if (holosphere) {
			return true;
		}
		
		let retries = 0;
		const maxRetries = 5; // Reduced retries to fail faster
		
		while (retries < maxRetries) {
			await new Promise(resolve => setTimeout(resolve, 200)); // Slightly longer delay
			try {
				holosphere = getContext("holosphere");
				if (holosphere) {
					return true;
				}
			} catch (error) {
				// Silently handle context errors
			}
			retries++;
		}
		
		return false;
	}

	// Use the shared merge so the logged-in user always appears in the picker,
	// even on holons where they haven't been added to the `users` lens yet.
	const ensureCurrentUserInStore = (store: any) => mergeSelfIntoUsers(store);

	// Fetch and subscribe to users for the current holon
	// Gun-listener handle for the users subscription. Tear it down before
	// re-subscribing (called on every holon change) and on destroy, or each
	// switch leaks a `.map().on()` callback Gun keeps forever.
	let usersSubscriptionOff: (() => void) | null = null;

	async function fetchAndSubscribeUsers() {
		if (!holosphere || !holonID) {
			userStore = {};
			return;
		}

		try {
			// holosphere.getAll resolves to Array<T>.
			const initialUsers = (await holosphere.getAll(holonID, "users")) ?? [];
			const usersKeyedById: Record<string, any> = {};
			for (const user of initialUsers) {
				if (user?.id) usersKeyedById[user.id] = user;
			}
			// Ensure current user is in the store
			userStore = ensureCurrentUserInStore(usersKeyedById);
		} catch (e) {
			userStore = ensureCurrentUserInStore({});
		}

		// Subscribe to user updates with error handling
		try {
			usersSubscriptionOff?.();
			const usersSub = holosphere.subscribe(holonID, "users", (updatedUser, key) => {
				try {
					if (updatedUser) {
						// Use user.id as the canonical key if available
						const canonicalKey = updatedUser.id || key;
						
						if (updatedUser.id && key !== updatedUser.id) {
							// Remove the old key if it's different from the canonical key
							const { [key]: _, ...rest } = userStore;
							userStore = { ...rest, [canonicalKey]: updatedUser };
						} else {
							// Use the key directly
							userStore = { ...userStore, [canonicalKey]: updatedUser };
						}
					} else {
						const { [key]: _, ...rest } = userStore;
						userStore = rest;
					}
				} catch (error) {
					// Silently handle user update errors
				}
			});
			usersSubscriptionOff = (usersSub as any)?.unsubscribe ?? (usersSub as any) ?? null;
		} catch (error) {
			// Silently handle subscription setup errors
		}
	}

	onMount(() => {
		let isDestroyed = false;
		
		// Set up ID subscription with proper cleanup
		const idUnsubscribe = ID.subscribe((value) => {
			if (isDestroyed) return;
			if (value && value !== holonID) {
				holonID = value;
				// Resolve holon name reactively
				resolveName(value);
				// Force re-initialization when ID changes with error handling
				initializeComponent().catch(error => {
					// Silently handle re-initialization errors
				});
			}
		});
		
		// Listen for federation changes (e.g. holon removed from federation)
		const handleFederationChanged = () => {
			if (includeFederatedOffers) {
				subscribeToOffersAndNeeds();
			} else {
				subscribeToOffersAndNeeds();
			}
		};
		window.addEventListener('federationChanged', handleFederationChanged);

		// Initial load if holonID is already set from the ID store
		if ($ID) {
			holonID = $ID;
			initializeComponent().catch(error => {
				// Silently handle initial initialization errors
			});
		}

		return () => {
			isDestroyed = true;
			window.removeEventListener('federationChanged', handleFederationChanged);
			idUnsubscribe();
			// Clean up subscriptions on unmount
			if (questSubscriptionOff) {
				try {
					questSubscriptionOff();
				} catch (error) {
					// Silently handle cleanup errors
				}
				questSubscriptionOff = null;
			}
			if (usersSubscriptionOff) {
				try {
					usersSubscriptionOff();
				} catch (error) {
					// Silently handle cleanup errors
				}
				usersSubscriptionOff = null;
			}
		};
	});

	// Separate initialization function to avoid duplication
	async function initializeComponent() {
		if (!holonID) {
			componentReady = true; // Set ready even if no holonID to not block navigation
			return;
		}
		
		try {
			// Wait for holosphere to be available
			const holosphereAvailable = await waitForHolosphere();
			if (!holosphereAvailable) {
				componentReady = true; // Set ready even if holosphere not available to not block navigation
				return;
			}
			
			// Run both initializations
			await Promise.all([
				subscribeToOffersAndNeeds(),
				fetchAndSubscribeUsers()
			]);
		} catch (error) {
			// Silently handle initialization errors
		} finally {
			// Always set component as ready to not block navigation
			componentReady = true;
		}
	}

	// Store cleanup function to avoid subscription conflicts
	let questSubscriptionOff = null;

	// Subscribe to changes in the specified holon
	// One live federation-aware offers/needs stream. subscribeFederated folds in
	// the local holon plus inbound `quests` partners (tagged `_federation`), and
	// `setFederated` toggles partners live. Two overlays are re-merged on every
	// emit and refreshed one-shot in federated mode only: the per-USER-holon
	// offers fan-out (`_userSpecific` — a DIFFERENT aggregation than federation,
	// so it can't fold into subscribeFederated) and the participations lens.
	let offersSub: { unsubscribe: () => void; setFederated: (on: boolean) => void } | undefined;
	let latestOfferItems: any[] = [];
	let userSpecificOverlay: Record<string, any> = {};
	let participationsMap = new Map<string, any[]>();

	function rebuildOffersStore() {
		const next: Record<string, any> = {};
		for (const item of latestOfferItems) {
			if (!item?.id) continue;
			const key = item.key || item.id;
			const processed: any = { ...item, key };
			const parts = participationsMap.get(item.id);
			if (parts && parts.length) {
				const merged = [...(processed.participants || [])];
				for (const p of parts) {
					if (!merged.some((x: any) => x && x.id === p.id)) merged.push(p);
				}
				processed.participants = merged;
			}
			next[key] = processed;
		}
		// User-specific offers overlay on top (distinct `user_<holon>_<id>` keys).
		for (const [k, v] of Object.entries(userSpecificOverlay)) next[k] = v;
		store = next;
	}

	// Refresh the federated-only overlays (participations + per-user-holon
	// offers); clear them when federation is off. Triggers a store rebuild.
	async function refreshOfferOverlays() {
		if (!holosphere || !holonID) return;
		if (!$showFederated) {
			participationsMap = new Map();
			userSpecificOverlay = {};
			rebuildOffersStore();
			return;
		}
		try {
			const participationData = await holosphere.getAll(holonID, "participations");
			const map = new Map<string, any[]>();
			if (Array.isArray(participationData)) {
				for (const p of participationData as any[]) {
					if (p && p.itemId) {
						if (!map.has(p.itemId)) map.set(p.itemId, []);
						map.get(p.itemId)!.push(p.participant);
					}
				}
			}
			participationsMap = map;
		} catch (error) {
			console.error("[Offers] participations fetch error:", error);
		}
		try {
			const userOffers = await fetchUserSpecificOffers();
			const overlay: Record<string, any> = {};
			for (const item of userOffers as any[]) {
				if (!item?.id) continue;
				const key = item.key || item.id;
				overlay[key] = { ...item, key };
			}
			userSpecificOverlay = overlay;
		} catch (error) {
			console.error("[Offers] user-specific offers error:", error);
		}
		rebuildOffersStore();
	}

	async function subscribeToOffersAndNeeds() {
		try {
			if (offersSub) {
				offersSub.unsubscribe();
				offersSub = undefined;
			}
			store = {};
			latestOfferItems = [];
			userSpecificOverlay = {};
			participationsMap = new Map();
			if (!holosphere || !holonID) return;

			const boundHolon = holonID;
			offersSub = holosphere.subscribeFederated(
				boundHolon,
				"quests",
				(items: any[]) => {
					if (holonID !== boundHolon) return; // stale (holon switched)
					latestOfferItems = items;
					rebuildOffersStore();
				},
				{ includeFederated: $showFederated }
			);
			questSubscriptionOff = () => offersSub?.unsubscribe();
			void refreshOfferOverlays();
		} catch (error) {
			// Set component as ready even if subscription fails to not block navigation
			componentReady = true;
		}
	}


	// Fetch offers from each user's personal holon
	async function fetchUserSpecificOffers() {
		if (!holosphere || !holonID || !userStore) return [];
		
		const userOffers = [];
		const userIds = Object.keys(userStore);
		
		console.log(`Fetching offers from ${userIds.length} users:`, userIds);
		
		// Fetch offers from each user's personal holon
		for (const userId of userIds) {
			try {
				const user = userStore[userId];
				if (!user || !user.id) continue;
				
				// Each user's personal holon is typically their user ID
				const userHolonId = user.id;
				
				console.log(`Fetching offers from user ${user.first_name} (${userHolonId})`);
				
				// Fetch quests from user's personal holon
				const userQuests = await holosphere.getAll(userHolonId, "quests");
				
				if (userQuests && userQuests.length > 0) {
					console.log(`Found ${userQuests.length} quests from user ${user.first_name}`);
					
					// Process each quest and mark it as user-specific
					userQuests.forEach((quest, index) => {
						if (quest && quest.id) {
							const processedQuest = {
								...quest,
								key: `user_${userHolonId}_${quest.id}`,
								_userSpecific: {
									userId: user.id,
									userName: `${user.first_name} ${user.last_name || ''}`.trim(),
									userHolonId: userHolonId,
									fetchedAt: Date.now()
								}
							};
							userOffers.push(processedQuest);
						}
					});
				}
			} catch (error) {
				console.warn(`Error fetching offers from user ${userId}:`, error);
				// Continue with other users even if one fails
			}
		}
		
		console.log(`Total user-specific offers found: ${userOffers.length}`);
		return userOffers;
	}

	// Flip partners in/out live on the existing stream and refresh the
	// federated-only overlays — no re-subscribe, so local offers never blink out.
	let lastFederatedFlag = $showFederated;
	$: if ($showFederated !== lastFederatedFlag) {
		lastFederatedFlag = $showFederated;
		offersSub?.setFederated($showFederated);
		void refreshOfferOverlays();
	}



	function getTransactionLabel(value: string, side: 'offer' | 'request'): string {
		const entry = TRANSACTION_TYPES.find((t) => t.value === value);
		if (!entry) return value;
		return side === 'offer' ? entry.offerLabel : entry.requestLabel;
	}

	// Function to get item background color
	function getItemBackgroundColor(itemType) {
		if (itemType === 'offer') {
			return 'hsl(160, 60%, 80%)'; // Minty Green for offers
		} else if (itemType === 'request') {
			return '#E5E7EB';  // Tailwind gray-200 for requests
		}
		return 'hsl(210, 15%, 75%)'; // Default gray
	}

	// Function to get hologram source name using centralized service
	function getHologramSourceDisplay(soul: string | undefined): string {
		if (!soul) return '';

		resolveHologramSource(soul);
		const holonId = extractHolonIdFromSoul(soul);
		return resolvedName(holonId, $nameMap, null, 'External Source');
	}

	// Assign a user as a participant to an offer or need
	async function takeOfferOrNeed(item, user) {
		if (!holosphere || !holonID || !item || !user) return;

		// Check if user is already a participant
		const isAlreadyParticipant = item.participants?.some(p => String(p.id) === String(user.id));
		if (isAlreadyParticipant) return;

		// Use the correct property names that match the Tasks component expectations
		const newParticipant = {
			id: user.id,
			firstName: user.first_name,  // Changed from first_name to firstName
			lastName: user.last_name,    // Changed from last_name to lastName
			username: user.username
		};

		// Add to existing participants or create new array
		const updatedParticipants = [...(item.participants || []), newParticipant];

		const updatedItem = {
			...item,
			participants: updatedParticipants
		};

		try {
			await holosphere.put(holonID, 'quests', updatedItem);
			if (selectedItem && selectedItem.key === item.key) {
				selectedItem = { ...updatedItem, key: item.key };
			}
		} catch (error: any) {
			if (error?.name === 'AuthorizationError') {
				notifyWriteDenied('Unable to save - no write permission for this holon');
			} else {
				console.error('[Offers.svelte] Error updating quest:', error);
			}
		}
	}

	function openDetail(item: any) {
		selectedItem = item;
	}

	function closeDetail() {
		selectedItem = null;
	}



	// Add publish functionality
	async function publishToFederatedChats(item) {
		console.log("[Offers.svelte] publishToFederatedChats function called with item:", item);
		console.log("[Offers.svelte] holosphere:", holosphere);
		console.log("[Offers.svelte] holonID:", holonID);
		
		if (!holosphere || !holonID || !item) {
			console.error("Cannot publish: missing holosphere, holonId, or item");
			return;
		}

		isPublishing = true;
		publishingItemKey = item.key;
		publishStatus = 'Checking federation...';

		try {
			console.log("[Offers.svelte] Publishing item to federated chats:", { itemId: item.id, holonID });

			// First check if there are any federated chats available
			// Federation relationships are stored on the home holon, not on federated partner holons
			const federationSourceId = $nostrPublicKey || holonID;
			const fedInfo = await holosphere.getFederation(federationSourceId);
			console.log("[Offers.svelte] Federation info:", {
				hasFederated: !!(fedInfo?.federated?.length),
				federatedCount: fedInfo?.federated?.length || 0,
				federated: fedInfo?.federated
			});

			// Check if we have federated holons (use federated array since propagate uses federated || outbound)
			const hasFederatedChats = fedInfo && fedInfo.federated && fedInfo.federated.length > 0;
			
			// For hex-based holons, we can still propagate to parents even without federation
			// Let's proceed with propagation regardless of federation status
			if (!hasFederatedChats) {
				console.log("[Offers.svelte] No federated chats available, but proceeding with parent propagation for hex-based holons");
			}

			publishStatus = 'Publishing...';

			// Create a hologram for the item to propagate
			// Use the full item data instead of just the ID reference
			const hologram = await holosphere.createHologram(holonID, 'quests', item);
			console.log("[Offers.svelte] Created hologram:", hologram);

			// Use federation propagation to publish to federated spaces
			// Explicitly enable parent propagation for hex-based holons
			const propagationResult = await holosphere.propagate(holonID, 'quests', hologram, {
				useHolograms: true,
				propagateToParents: true,
				maxParentLevels: 1  // Only propagate to immediate parent (1 level up)
			});

			console.log("[Offers.svelte] Propagation result:", propagationResult);

			if (propagationResult.success > 0 || propagationResult.parentPropagation?.success > 0) {
				const totalSuccess = (propagationResult.success || 0) + (propagationResult.parentPropagation?.success || 0);
				publishStatus = `Published to ${totalSuccess} location(s)`;
				
				// Update the item to show it's been published
				const updatedItem = {
					...item,
					published: true,
					publishedAt: new Date().toISOString(),
					publishedTo: totalSuccess
				};
				
				// Update in store
				store = {
					...store,
					[item.key]: updatedItem
				};
				
				// Show success message briefly
				setTimeout(() => {
					publishStatus = '';
					publishingItemKey = null;
				}, 3000);
			} else {
				const errorMessage = propagationResult.message || propagationResult.parentPropagation?.messages?.join(', ') || 'Unknown propagation error';
				publishStatus = `Failed to publish: ${errorMessage}`;
				console.error('Propagation failed:', propagationResult);
				
				// Show error message briefly
				setTimeout(() => {
					publishStatus = '';
					publishingItemKey = null;
				}, 5000);
			}
		} catch (error) {
			console.error("[Offers.svelte] Error publishing item:", error);
			publishStatus = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
			
			// Show error message briefly
			setTimeout(() => {
				publishStatus = '';
				publishingItemKey = null;
			}, 5000);
		} finally {
			isPublishing = false;
		}
	}

	// Open add modal for offer or request
	function openAddModal(type: 'offer' | 'request') {
		addModalType = type;
		newItemTitle = '';
		newItemDescription = '';
		newItemItemType = '';
		newItemTransactionTypes = [];
		newItemTagInput = '';
		newItemTags = [];
		newItemExpiresAtLocal = '';
		showAddModal = true;
	}

	function toggleTransactionType(value: string) {
		if (newItemTransactionTypes.includes(value)) {
			newItemTransactionTypes = newItemTransactionTypes.filter((v) => v !== value);
		} else {
			newItemTransactionTypes = [...newItemTransactionTypes, value];
		}
	}

	function handleTagKeydown(event: KeyboardEvent) {
		if (event.isComposing) return;
		if (event.key === 'Enter' || event.key === ',') {
			event.preventDefault();
			const trimmed = newItemTagInput.trim();
			if (trimmed) {
				if (!newItemTags.includes(trimmed)) {
					newItemTags = [...newItemTags, trimmed];
				}
				newItemTagInput = '';
			}
		} else if (event.key === 'Backspace' && newItemTagInput === '' && newItemTags.length > 0) {
			newItemTags = newItemTags.slice(0, -1);
		}
	}

	function removeTag(tag: string) {
		newItemTags = newItemTags.filter((t) => t !== tag);
	}

	// Create a new offer or request
	async function createNewItem() {
		if (!holosphere || !holonID || !newItemTitle.trim()) return;
		if (newItemTransactionTypes.length === 0) return;

		const expiresAtMs = newItemExpiresAtLocal
			? new Date(newItemExpiresAtLocal).getTime()
			: undefined;

		// Core owns the marketplace item shape; the web only supplies inputs +
		// an id (the bot uses the Telegram message id instead).
		const newItem = createMarketItem({
			holonId: holonID,
			initiator: getSelfInitiator() ?? undefined,
			kind: addModalType,
			title: newItemTitle.trim(),
			description: newItemDescription.trim(),
			itemType: newItemItemType || undefined,
			transactionTypes: newItemTransactionTypes,
			tags: newItemTags,
			expiresAt: expiresAtMs,
		});
		newItem.id = crypto.randomUUID();

		try {
			await holosphere.put(holonID, 'quests', newItem);
			showAddModal = false;
		} catch (error: any) {
			if (error?.name === 'AuthorizationError') {
				notifyWriteDenied('Unable to save - no write permission for this holon');
			} else {
				console.error('[Offers.svelte] Error creating item:', error);
			}
		}
	}

	// Remove a user's participation from an offer or need
	async function removeParticipation(item, user) {
		if (!holosphere || !holonID || !item || !user) return;
		
		// Check if user is actually a participant
		const isParticipant = item.participants?.some(p => String(p.id) === String(user.id));
		if (!isParticipant) {
			return;
		}
		
		const updatedParticipants = (item.participants || []).filter(p => String(p.id) !== String(user.id));
		const updatedItem = {
			...item,
			participants: updatedParticipants
		};

		try {
			await holosphere.put(holonID, 'quests', updatedItem);
			if (selectedItem && selectedItem.key === item.key) {
				selectedItem = { ...updatedItem, key: item.key };
			}
		} catch (error: any) {
			if (error?.name === 'AuthorizationError') {
				notifyWriteDenied('Unable to save - no write permission for this holon');
			} else {
				console.error('[Offers.svelte] Error updating quest:', error);
			}
		}
	}
</script>

<div class="space-y-4">
	<!-- TitleBar -->
	<TitleBar {holonName} holonId={holonID} showLensFilters title="Offers & Requests" icon={Gift} />

	<FeatureToolbar
		onAdd={null}
		federatedLoading={loadingFederated}
	/>

	<!-- Main Content Container -->
	{#if !componentReady}
		<!-- Loading State -->
		<div class="flex items-center justify-center min-h-[600px] bg-gray-800 rounded-3xl">
			<div class="text-center">
				<div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4 mx-auto"></div>
				<p class="text-gray-400">Loading offers and requests...</p>
				{#if holonID}
					<p class="text-gray-500 text-sm mt-2">Holon: {holonID}</p>
				{/if}
			</div>
		</div>
	{:else}
		<div class="flex flex-col xl:flex-row gap-8">
			<!-- Offers & Requests Panel -->
			<div class="xl:flex-1 bg-gray-800 rounded-3xl shadow-xl min-h-[600px]">
			<div class="p-8">
				<!-- Federated Status Indicator -->
				{#if includeFederatedOffers}
					<div class="mb-6 p-3 bg-blue-500/20 border border-blue-500/30 rounded-lg">
						<div class="flex items-center gap-2 text-blue-300">
							<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
								<path fill-rule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd" />
							</svg>
							<span class="text-sm font-medium">Showing federated offers from connected holons and user-specific offers</span>
						</div>
					</div>
				{/if}

				<!-- Offers Section -->
				<div class="mb-8">
					<div class="section-header">
						<div class="section-header__title-group">
							<ArrowUpCircle size="20" />
							<h2 class="section-header__title">Offers</h2>
							<span class="section-header__count">({offers.length})</span>
						</div>
						<div class="section-header__controls">
							<div class="section-header__search">
								<span class="section-header__search-icon" aria-hidden="true">
									<Search size="14" />
								</span>
								<input
									type="search"
									class="section-header__search-input"
									placeholder="Search offers…"
									bind:value={filters.searchQueryOffers}
								/>
							</div>
							<button
								type="button"
								class="add-btn"
								on:click={() => openAddModal('offer')}
								aria-label="Add Offer"
							>
								<Plus size="16" />
								<span>Add Offer</span>
							</button>
						</div>
					</div>
					{#if offers.length > 0}
						<div class="space-y-3">
							{#each offers as offer (offer.key)}
								<div
									class="task-card relative text-left group p-4 rounded-xl transition-all duration-300 border border-transparent hover:border-gray-600 hover:shadow-md transform hover:scale-[1.005]"
									role="button"
									tabindex="0"
									on:click={() => openDetail(offer)}
									on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(offer); } }}
									style="background-color: {getItemBackgroundColor(offer.type)};
										   opacity: {offer._hologram?.isHologram ? '0.75' : '1'};
										   {offer._hologram?.isHologram ? 'border: 2px solid #00BFFF; box-sizing: border-box; box-shadow: 0 0 20px rgba(0, 191, 255, 0.4), inset 0 0 20px rgba(0, 191, 255, 0.1);' : ''}"
								>
									<div class="flex items-center justify-between gap-3">
										<div class="flex items-center gap-3 flex-1 min-w-0">
											<!-- Initiator Picture -->
											{#if offer.initiator?.id}
												<img 
													class="w-8 h-8 rounded-full border border-gray-400 flex-shrink-0" 
													src={`https://telegram.holons.io/getavatar?user_id=${offer.initiator.id}`} 
													alt={offer.initiator.firstName || offer.initiator.username || 'User'} 
												/>
											{:else}
												<!-- Fallback Offer Icon -->
												<div class="flex-shrink-0 w-8 h-8 rounded-lg bg-black/20 flex items-center justify-center text-sm">
													🤝
												</div>
											{/if}

											<!-- Main Content -->
											<div class="flex-1 min-w-0">
												<div class="flex items-center gap-2 mb-1">
													<h3 class="text-base font-bold text-gray-800 truncate">
														{offer.title}
													</h3>
													<SourceBadge item={offer} currentHolonId={holonID} lensRoute="offers" />
													{#if offer._userSpecific}
														<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-500/20 text-orange-800 flex-shrink-0">
															<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
																<path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd" />
															</svg>
															{offer._userSpecific.userName}
														</span>
													{/if}
													{#if offer.published}
														<span
															class="inline-flex items-center gap-2 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-800 border border-green-500/50"
															title="Cast to {offer.publishedTo || 'federated'} chat(s) on {new Date(offer.publishedAt).toLocaleDateString()}"
															style="display: none"
														>
															<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor">
																<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z"/>
															</svg>
															<span>Cast</span>
														</span>
													{/if}
												</div>
												{#if offer.initiator?.firstName || offer.initiator?.username}
													<p class="text-xs text-gray-600 mb-1">
														Offered by {offer.initiator.firstName || offer.initiator.username}
													</p>
												{/if}
												{#if offer.description}
													<p class="text-sm text-gray-700 truncate">
														{offer.description}
													</p>
												{/if}
												{#if offer.item_type || (offer.transaction_type && offer.transaction_type.length > 0) || (offer.tags && offer.tags.length > 0) || offer.expires_at}
													<div class="meta-row">
														{#if offer.item_type}
															<span class="meta-row__icon" title={offer.item_type === 'good' ? 'Good' : 'Service'}>
																{offer.item_type === 'good' ? '📦' : '🛠️'}
															</span>
														{/if}
														{#if offer.transaction_type}
															{#each offer.transaction_type as tx}
																<span class="meta-row__pill">{getTransactionLabel(tx, 'offer')}</span>
															{/each}
														{/if}
														{#if offer.tags}
															{#each offer.tags.slice(0, 3) as tag}
																<span class="meta-row__chip">#{tag}</span>
															{/each}
															{#if offer.tags.length > 3}
																<span class="meta-row__chip">+{offer.tags.length - 3}</span>
															{/if}
														{/if}
														{#if offer.expires_at}
															<span class="meta-row__expiry">{formatRelativeExpiry(offer.expires_at, Date.now())}</span>
														{/if}
													</div>
												{/if}
											</div>
										</div>

										<!-- Right Side Meta Info -->
										<div class="flex items-center gap-3 flex-shrink-0 text-sm">
											<!-- Cast Button -->
											<button
												class="btn btn--primary btn--sm"
												on:click|stopPropagation={() => {
													console.log("[Offers.svelte] Cast button clicked for offer:", offer);
													console.log("[Offers.svelte] Offer data:", offer);
													console.log("[Offers.svelte] holosphere available:", !!holosphere);
													console.log("[Offers.svelte] holonID:", holonID);
													publishToFederatedChats(offer);
												}}
												disabled={isPublishing}
												title={offer.published ? 
													`Cast to ${offer.publishedTo || 'federated'} chat(s) on ${new Date(offer.publishedAt).toLocaleDateString()}` : 
													'Cast this offer to federated chats'
												}
												style="display: none"
											>
												<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z"/>
												</svg>
												{#if isPublishing && publishingItemKey === offer.key}
													<span class="text-sm">{publishStatus}</span>
												{:else if offer.published}
													<span class="text-sm">Cast</span>
												{:else}
													<span class="text-sm">Cast</span>
												{/if}
											</button>

											<!-- Open detail modal -->
											<button
												class="btn btn--primary btn--sm"
												on:click|stopPropagation={() => openDetail(offer)}
												aria-label={offer.participants && offer.participants.length > 0 ? `Manage participants (${offer.participants.length})` : 'Accept offer'}
											>
												{#if offer.participants && offer.participants.length > 0}
													Manage
												{:else}
													Accept
												{/if}
											</button>

											{#if offer.participants?.length > 0}
												<div class="flex items-center gap-1">
													<div class="flex -space-x-1 relative group" title={offer.participants.map(p => resolvedName(p.id, $nameMap, { first_name: p.firstName, last_name: p.lastName, username: p.username })).join(', ')}>
														{#each offer.participants.slice(0, 2) as participant}
															<div class="relative">
																<img
																	class="w-5 h-5 rounded-full border border-white shadow-sm"
																	src={`https://telegram.holons.io/getavatar?user_id=${participant.id}`}
																	alt={resolvedName(participant.id, $nameMap, { first_name: participant.firstName, last_name: participant.lastName, username: participant.username })}
																/>
															</div>
														{/each}
														{#if offer.participants.length > 2}
															<div class="w-5 h-5 rounded-full bg-gray-400 flex items-center justify-center text-xs border border-white shadow-sm text-white font-medium">
																<span>+{offer.participants.length - 2}</span>
															</div>
														{/if}
													</div>
												</div>
											{/if}

											{#if offer.when}
												<div class="text-xs font-medium text-gray-700 whitespace-nowrap">
													<div class="text-xs text-gray-600 mb-1">{formatDate(offer.when)}</div>
													{formatTime(offer.when)}
													{#if offer.ends}<br/>{formatTime(offer.ends)}{/if}
												</div>
											{/if}
										</div>
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<div class="text-center py-12">
							<div class="w-16 h-16 mx-auto mb-4 bg-gray-700 rounded-full flex items-center justify-center">
								<svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
								</svg>
							</div>
							<h3 class="text-lg font-medium text-white mb-2">No offers found</h3>
							<p class="text-gray-400">No active offers at the moment.</p>
						</div>
					{/if}
				</div>

				<!-- Requests Section -->
				<div class="mb-8">
					<div class="section-header">
						<div class="section-header__title-group">
							<ArrowDownCircle size="20" />
							<h2 class="section-header__title">Requests</h2>
							<span class="section-header__count">({needs.length})</span>
						</div>
						<div class="section-header__controls">
							<div class="section-header__search">
								<span class="section-header__search-icon" aria-hidden="true">
									<Search size="14" />
								</span>
								<input
									type="search"
									class="section-header__search-input"
									placeholder="Search requests…"
									bind:value={filters.searchQueryRequests}
								/>
							</div>
							<button
								type="button"
								class="add-btn"
								on:click={() => openAddModal('request')}
								aria-label="Add Request"
							>
								<Plus size="16" />
								<span>Add Request</span>
							</button>
						</div>
					</div>
					{#if needs.length > 0}
						<div class="space-y-3">
							{#each needs as need (need.key)}
								<div
									class="task-card relative text-left group p-4 rounded-xl transition-all duration-300 border border-transparent hover:border-gray-600 hover:shadow-md transform hover:scale-[1.005]"
									role="button"
									tabindex="0"
									on:click={() => openDetail(need)}
									on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(need); } }}
									style="background-color: {getItemBackgroundColor(need.type)};
										   opacity: {need._hologram?.isHologram ? '0.75' : '1'};
										   {need._hologram?.isHologram ? 'border: 2px solid #00BFFF; box-sizing: border-box; box-shadow: 0 0 20px rgba(0, 191, 255, 0.4), inset 0 0 20px rgba(0, 191, 255, 0.1);' : ''}"
								>
									<div class="flex items-center justify-between gap-3">
										<div class="flex items-center gap-3 flex-1 min-w-0">
											<!-- Initiator Picture -->
											{#if need.initiator?.id}
												<img 
													class="w-8 h-8 rounded-full border border-gray-400 flex-shrink-0" 
													src={`https://telegram.holons.io/getavatar?user_id=${need.initiator.id}`} 
													alt={need.initiator.firstName || need.initiator.username || 'User'} 
												/>
											{:else}
												<!-- Fallback Request Icon -->
												<div class="flex-shrink-0 w-8 h-8 rounded-lg bg-black/20 flex items-center justify-center text-sm">
													📋
												</div>
											{/if}
											
											<!-- Main Content -->
											<div class="flex-1 min-w-0">
												<div class="flex items-center gap-2 mb-1">
													<h3 class="text-base font-bold text-gray-800 truncate">
														{need.title}
													</h3>
													<SourceBadge item={need} currentHolonId={holonID} lensRoute="offers" />
													{#if need._userSpecific}
														<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-500/20 text-orange-800 flex-shrink-0">
															<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
																<path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd" />
															</svg>
															{need._userSpecific.userName}
														</span>
													{/if}
													{#if need.published}
														<span
															class="inline-flex items-center gap-2 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-800 border border-green-500/50"
															title="Cast to {need.publishedTo || 'federated'} chat(s) on {new Date(need.publishedAt).toLocaleDateString()}"
															style="display: none"
														>
															<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor">
																<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z"/>
															</svg>
															<span>Cast</span>
														</span>
													{/if}
												</div>
												{#if need.initiator?.firstName || need.initiator?.username}
													<p class="text-xs text-gray-600 mb-1">
														Requested by {need.initiator.firstName || need.initiator.username}
													</p>
												{/if}
												{#if need.description}
													<p class="text-sm text-gray-700 truncate">
														{need.description}
													</p>
												{/if}
												{#if need.item_type || (need.transaction_type && need.transaction_type.length > 0) || (need.tags && need.tags.length > 0) || need.expires_at}
													<div class="meta-row">
														{#if need.item_type}
															<span class="meta-row__icon" title={need.item_type === 'good' ? 'Good' : 'Service'}>
																{need.item_type === 'good' ? '📦' : '🛠️'}
															</span>
														{/if}
														{#if need.transaction_type}
															{#each need.transaction_type as tx}
																<span class="meta-row__pill">{getTransactionLabel(tx, 'request')}</span>
															{/each}
														{/if}
														{#if need.tags}
															{#each need.tags.slice(0, 3) as tag}
																<span class="meta-row__chip">#{tag}</span>
															{/each}
															{#if need.tags.length > 3}
																<span class="meta-row__chip">+{need.tags.length - 3}</span>
															{/if}
														{/if}
														{#if need.expires_at}
															<span class="meta-row__expiry">{formatRelativeExpiry(need.expires_at, Date.now())}</span>
														{/if}
													</div>
												{/if}
											</div>
										</div>

										<!-- Right Side Meta Info -->
										<div class="flex items-center gap-3 flex-shrink-0 text-sm">
											<!-- Cast Button -->
											<button
												class="btn btn--primary btn--sm"
												on:click|stopPropagation={() => {
													console.log("[Offers.svelte] Cast button clicked for need:", need);
													console.log("[Offers.svelte] Need data:", need);
													console.log("[Offers.svelte] holosphere available:", !!holosphere);
													console.log("[Offers.svelte] holonID:", holonID);
													publishToFederatedChats(need);
												}}
												disabled={isPublishing}
												title={need.published ? 
													`Cast to ${need.publishedTo || 'federated'} chat(s) on ${new Date(need.publishedAt).toLocaleDateString()}` : 
													'Cast this request to federated chats'
												}
												style="display: none"
											>
												<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z"/>
												</svg>
												{#if isPublishing && publishingItemKey === need.key}
													<span class="text-sm">{publishStatus}</span>
												{:else if need.published}
													<span class="text-sm">Cast</span>
												{:else}
													<span class="text-sm">Cast</span>
												{/if}
											</button>

											<!-- Open detail modal -->
											<button
												class="btn btn--primary btn--sm"
												on:click|stopPropagation={() => openDetail(need)}
												aria-label={need.participants && need.participants.length > 0 ? `Manage participants (${need.participants.length})` : 'Fulfill request'}
											>
												{#if need.participants && need.participants.length > 0}
													Manage
												{:else}
													Fulfill
												{/if}
											</button>

											{#if need.participants?.length > 0}
												<div class="flex items-center gap-1">
													<div class="flex -space-x-1 relative group" title={need.participants.map(p => resolvedName(p.id, $nameMap, { first_name: p.firstName, last_name: p.lastName, username: p.username })).join(', ')}>
														{#each need.participants.slice(0, 2) as participant}
															<div class="relative">
																<img
																	class="w-5 h-5 rounded-full border border-white shadow-sm"
																	src={`https://telegram.holons.io/getavatar?user_id=${participant.id}`}
																	alt={resolvedName(participant.id, $nameMap, { first_name: participant.firstName, last_name: participant.lastName, username: participant.username })}
																/>
															</div>
														{/each}
														{#if need.participants.length > 2}
															<div class="w-5 h-5 rounded-full bg-gray-400 flex items-center justify-center text-xs border border-white shadow-sm text-white font-medium">
																<span>+{need.participants.length - 2}</span>
															</div>
														{/if}
													</div>
												</div>
											{/if}

											{#if need.when}
												<div class="text-xs font-medium text-gray-700 whitespace-nowrap">
													<div class="text-xs text-gray-600 mb-1">{formatDate(need.when)}</div>
													{formatTime(need.when)}
													{#if need.ends}<br/>{formatTime(need.ends)}{/if}
												</div>
											{/if}
										</div>
									</div>
								</div>
							{/each}
						</div>
				{:else}
						<div class="text-center py-12">
							<div class="w-16 h-16 mx-auto mb-4 bg-gray-700 rounded-full flex items-center justify-center">
								<svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
								</svg>
							</div>
							<h3 class="text-lg font-medium text-white mb-2">No requests found</h3>
							<p class="text-gray-400">No active requests at the moment.</p>
						</div>
				{/if}
				</div>
			</div>
		</div>

		<!-- Announcements Panel -->
		<div class="hidden xl:block xl:w-80 xl:flex-shrink-0">
			<div class="bg-gray-800 rounded-3xl shadow-xl">
				<Announcements />
			</div>
		</div>
	</div>
	{/if}
</div>

<!-- Add Offer/Request Modal -->
<Modal
	open={showAddModal}
	title={addModalType === 'offer' ? 'New offer' : 'New request'}
	size="md"
	on:close={() => (showAddModal = false)}
>
	<div class="add-form">
		<div class="add-form__field">
			<label for="item-title" class="add-form__label">Title</label>
			<input
				id="item-title"
				type="text"
				bind:value={newItemTitle}
				placeholder={addModalType === 'offer' ? 'What are you offering?' : 'What do you need?'}
				class="add-form__input"
			/>
		</div>

		<div class="add-form__field">
			<label for="item-description" class="add-form__label">Description <span class="add-form__hint">(optional)</span></label>
			<textarea
				id="item-description"
				bind:value={newItemDescription}
				placeholder="Add more details…"
				rows="3"
				class="add-form__input add-form__textarea"
			></textarea>
		</div>

		<div class="add-form__field">
			<span class="add-form__label">Item type</span>
			<div class="add-form__radio-group">
				<label class="add-form__radio">
					<input
						type="radio"
						name="item-type"
						value="good"
						bind:group={newItemItemType}
					/>
					<span>📦 Good</span>
				</label>
				<label class="add-form__radio">
					<input
						type="radio"
						name="item-type"
						value="service"
						bind:group={newItemItemType}
					/>
					<span>🛠️ Service</span>
				</label>
			</div>
		</div>

		<div class="add-form__field">
			<span class="add-form__label">
				Transaction type <span class="add-form__required">*</span>
			</span>
			<div class="add-form__chips">
				{#each TRANSACTION_TYPES as tx}
					{@const label = addModalType === 'offer' ? tx.offerLabel : tx.requestLabel}
					{@const selected = newItemTransactionTypes.includes(tx.value)}
					<button
						type="button"
						class="add-form__chip"
						class:add-form__chip--selected={selected}
						on:click={() => toggleTransactionType(tx.value)}
					>
						{label}
					</button>
				{/each}
			</div>
		</div>

		<div class="add-form__field">
			<label for="item-tags" class="add-form__label">Tags</label>
			<div class="add-form__tag-input">
				{#each newItemTags as tag}
					<span class="add-form__tag">
						{tag}
						<button
							type="button"
							class="add-form__tag-remove"
							on:click={() => removeTag(tag)}
							aria-label={`Remove tag ${tag}`}
						>&times;</button>
					</span>
				{/each}
				<input
					id="item-tags"
					type="text"
					bind:value={newItemTagInput}
					on:keydown={handleTagKeydown}
					placeholder={newItemTags.length === 0 ? 'Add tags (Enter or , to add)' : ''}
					class="add-form__tag-field"
				/>
			</div>
		</div>

		<div class="add-form__field">
			<label for="item-expires-at" class="add-form__label">Expires at <span class="add-form__hint">(optional)</span></label>
			<input
				id="item-expires-at"
				type="datetime-local"
				bind:value={newItemExpiresAtLocal}
				class="add-form__input"
			/>
		</div>
	</div>

	<svelte:fragment slot="footer">
		<button class="btn btn--secondary" on:click={() => (showAddModal = false)}>Cancel</button>
		<button
			class="btn btn--primary"
			on:click={createNewItem}
			disabled={!newItemTitle.trim() || newItemTransactionTypes.length === 0}
		>
			Create {addModalType === 'offer' ? 'offer' : 'request'}
		</button>
	</svelte:fragment>
</Modal>

<!-- Detail modal -->
<OfferDetailModal
	open={selectedItem !== null}
	item={selectedItem}
	{holonID}
	{userStore}
	on:close={closeDetail}
	on:addParticipant={(e) => takeOfferOrNeed(e.detail.item, e.detail.user)}
	on:removeParticipant={(e) => removeParticipation(e.detail.item, e.detail.user)}
/>

<style>
	/* Task card styling */
	.task-card {
		position: relative;
		cursor: pointer;
	}

	.task-card:hover {
		cursor: pointer;
	}

	/* Smooth animations */
	@keyframes slideDown {
		from {
			opacity: 0;
			transform: translateY(-10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Card hover effects */
	.task-card:hover .group {
		transform: translateY(-1px);
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.section-header__title-group {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text-primary);
	}

	.section-header__title {
		font-size: 1.5rem;
		font-weight: 700;
		line-height: 1;
	}

	.section-header__count {
		color: var(--color-text-muted);
		font-size: 1rem;
		font-weight: 500;
	}

	.section-header__controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.section-header__search {
		position: relative;
		display: flex;
		align-items: center;
		min-width: 10rem;
		max-width: 20rem;
	}

	.section-header__search-icon {
		position: absolute;
		left: 0.625rem;
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-text-muted);
		pointer-events: none;
	}

	.section-header__search-input {
		width: 100%;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-light);
		border-radius: 0.5rem;
		color: var(--color-text-primary);
		font-size: 0.875rem;
		padding: 0.5rem 0.75rem 0.5rem 2rem;
		transition: border-color 150ms ease;
	}

	.section-header__search-input:focus {
		outline: none;
		border-color: #3b82f6;
	}

	.section-header__search-input::placeholder {
		color: var(--color-text-muted);
	}

	.meta-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		margin-top: 0.5rem;
	}

	.meta-row__icon {
		font-size: 0.875rem;
		line-height: 1;
	}

	.meta-row__pill {
		display: inline-flex;
		align-items: center;
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		background: rgba(17, 24, 39, 0.15);
		color: #1f2937;
		font-size: 0.7rem;
		font-weight: 500;
	}

	.meta-row__chip {
		display: inline-flex;
		align-items: center;
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		background: rgba(99, 102, 241, 0.2);
		color: #3730a3;
		font-size: 0.7rem;
		font-weight: 500;
	}

	.meta-row__expiry {
		font-size: 0.7rem;
		color: #374151;
		margin-left: auto;
	}

	/* Add modal form */
	.add-form {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.add-form__field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.add-form__label {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.add-form__hint {
		font-weight: 400;
		text-transform: none;
		letter-spacing: normal;
		color: var(--color-text-muted);
	}

	.add-form__required {
		color: #f87171;
	}

	.add-form__input {
		width: 100%;
		background: var(--color-bg-primary);
		border: 1px solid var(--color-bg-tertiary);
		border-radius: 0.5rem;
		color: #f9fafb;
		font-size: 0.9rem;
		padding: 0.55rem 0.75rem;
		transition: border-color 150ms ease;
	}

	.add-form__input:focus {
		outline: none;
		border-color: var(--color-accent-light);
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
	}

	.add-form__textarea {
		resize: vertical;
		min-height: 4.5rem;
	}

	.add-form__radio-group {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.add-form__radio {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		color: var(--color-text-secondary);
		font-size: 0.875rem;
		cursor: pointer;
	}

	.add-form__radio input {
		accent-color: var(--color-accent-light);
	}

	.add-form__chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.add-form__chip {
		padding: 0.3rem 0.7rem;
		border-radius: 9999px;
		border: 1px solid var(--color-bg-tertiary);
		background: var(--color-bg-primary);
		color: var(--color-text-secondary);
		font-size: 0.8rem;
		cursor: pointer;
		transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;
	}

	.add-form__chip:hover {
		border-color: var(--color-accent-light);
		color: var(--color-text-primary);
	}

	.add-form__chip--selected {
		background: var(--color-accent-light);
		border-color: var(--color-accent-light);
		color: var(--color-text-primary);
	}

	.add-form__tag-input {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		padding: 0.4rem;
		background: var(--color-bg-primary);
		border: 1px solid var(--color-bg-tertiary);
		border-radius: 0.5rem;
	}

	.add-form__tag-input:focus-within {
		border-color: var(--color-accent-light);
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
	}

	.add-form__tag {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.15rem 0.55rem;
		border-radius: 9999px;
		background: rgba(99, 102, 241, 0.3);
		color: #e0e7ff;
		font-size: 0.8rem;
	}

	.add-form__tag-remove {
		background: transparent;
		border: none;
		color: inherit;
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
	}

	.add-form__tag-remove:hover {
		color: var(--color-text-primary);
	}

	.add-form__tag-field {
		flex: 1;
		min-width: 6rem;
		background: transparent;
		border: none;
		outline: none;
		color: var(--color-text-primary);
		font-size: 0.875rem;
	}
</style>
