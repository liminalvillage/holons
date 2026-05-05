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
	import DisplayName from './shared/DisplayName.svelte';
	import TitleBar from "./shared/TitleBar.svelte";
	import FeatureToolbar from "./shared/FeatureToolbar.svelte";
	import { Gift, Plus, ArrowDownCircle, ArrowUpCircle, Search } from 'svelte-feathers';
	import { loadFilters, saveFilters } from '$lib/util/persistedFilters';
	import { nostrPublicKey } from "../lib/stores/nostr";
	import { telegramStore } from "../lib/stores/telegram";
	import { notifyWriteDenied } from "../lib/stores/writeNotifications";

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

	// Shared toolbar state (same field keys as other features). `showFederated`
	// supersedes the legacy `includeFederatedOffers` flag while keeping the
	// same meaning: when on, also pull in items from federated partners.
	let filters = loadFilters('offers', {
		searchQueryOffers: '',
		searchQueryRequests: '',
		showFederated: false,
		showHolograms: true,
	});
	$: saveFilters('offers', filters);
	$: includeFederatedOffers = filters.showFederated;
	let loadingFederated = false;

	function matchesVisibility(item: any): boolean {
		const isHologram = item?._hologram?.isHologram === true;
		if (!filters.showHolograms && isHologram) return false;
		if (!filters.showFederated && isHologram) return false;
		return true;
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
		if (classifyTask(item) !== 'offer') return false;
		if (!matchesVisibility(item)) return false;
		return matchesSearch(item, filters.searchQueryOffers);
	});
	$: needs = Object.values(store).filter((item) => {
		const t = classifyTask(item);
		if (t !== 'request' && t !== 'need') return false;
		if (!matchesVisibility(item)) return false;
		return matchesSearch(item, filters.searchQueryRequests);
	});

	let holosphere = getContext("holosphere") as HoloSphere;

	let userStore = {};
	let showDropdownFor = null; // key of offer/need for which dropdown is open
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

	// Function to add current logged-in user to userStore if not already present
	function ensureCurrentUserInStore(store: any): any {
		const telegramState = telegramStore.getState();
		const telegramUser = telegramState.user;
		let pubKey: string | null = null;
		nostrPublicKey.subscribe(v => pubKey = v)();

		// Check if Telegram user is logged in
		if (telegramUser) {
			const telegramId = String(telegramUser.id);
			if (!store[telegramId]) {
				store[telegramId] = {
					id: telegramId,
					first_name: telegramUser.first_name,
					last_name: telegramUser.last_name,
					username: telegramUser.username || telegramId
				};
			}
		}
		// Check if Nostr user is logged in
		else if (pubKey) {
			if (!store[pubKey]) {
				// Name resolution is automatic via resolvedName()
				store[pubKey] = {
					id: pubKey,
					first_name: resolvedName(pubKey, $nameMap),
					last_name: '',
					username: pubKey  // Use full pubKey as username (like telegram ID)
				};
			}
		}

		return store;
	}

	// Fetch and subscribe to users for the current holon
	async function fetchAndSubscribeUsers() {
		if (!holosphere || !holonID) {
			userStore = {};
			return;
		}

		try {
			const initialUsers = await holosphere.getAll(holonID, "users");
			let usersKeyedById = {};
			if (Array.isArray(initialUsers)) {
				initialUsers.forEach(user => {
					if (user && user.id) usersKeyedById[user.id] = user;
				});
			} else if (typeof initialUsers === 'object' && initialUsers !== null) {
				Object.values(initialUsers).forEach((user) => {
					if (user && user.id) usersKeyedById[user.id] = user;
				});
			}
			// Ensure current user is in the store
			userStore = ensureCurrentUserInStore(usersKeyedById);
		} catch (e) {
			userStore = ensureCurrentUserInStore({});
		}

		// Subscribe to user updates with error handling
		try {
			holosphere.subscribe(holonID, "users", (updatedUser, key) => {
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
		
		// Add click outside handler
		document.addEventListener('click', handleClickOutside);

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
			document.removeEventListener('click', handleClickOutside);
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
	async function subscribeToOffersAndNeeds() {
		try {
			// Clean up any existing subscription
			if (questSubscriptionOff) {
				try {
					questSubscriptionOff();
				} catch (error) {
					// Silently handle cleanup errors
				}
				questSubscriptionOff = null;
			}

			store = {};
			if (holosphere && holonID) {
				if (includeFederatedOffers) {
					// Use federated data retrieval
					await fetchFederatedOffersAndNeeds();
				} else {
					// First, load initial data with getAll (subscription only gets updates, not existing data)
					try {
						const initialData = await holosphere.getAll(holonID, "quests");
						if (Array.isArray(initialData)) {
							initialData.forEach((item) => {
								if (item && item.id) {
									const key = item.id;
									store[key] = { ...item, key };
								}
							});
						} else if (typeof initialData === 'object' && initialData !== null) {
							Object.entries(initialData).forEach(([key, item]: [string, any]) => {
								if (item && item.id) {
									store[key] = { ...item, key };
								}
							});
						}
						store = store; // Trigger reactivity
					} catch (error) {
						console.error('Error loading initial offers data:', error);
					}

					// Then set up subscription for live updates
					const subscribedHolonId = holonID;
					questSubscriptionOff = holosphere.subscribe(holonID, "quests", (newItem, key) => {
						try {
							if (holonID !== subscribedHolonId) {
								return; // Ignore updates from old holon subscription
							}
							if (newItem) {
								const parsedItem = newItem;
								parsedItem.key = key; // Add the key to the parsed item object
								store[key] = parsedItem;
							} else {
								// A key may contain a null value (if data has been deleted/set to null)
								// if so, we remove the item from the store
								delete store[key];
							}
							store = store; // Trigger reactivity
						} catch (error) {
							// Silently handle subscription item processing errors
						}
					});
				}
			}
		} catch (error) {
			// Set component as ready even if subscription fails to not block navigation
			componentReady = true;
		}
	}

	// Fetch federated offers and needs
	async function fetchFederatedOffersAndNeeds() {
		if (!holosphere || !holonID) return;
		
		loadingFederated = true;
		try {
			console.log("Fetching federated offers and needs...");
			console.log("Current holonID:", holonID);
			
			// First, let's check what's in the local holon directly
			console.log("Checking local data first...");
			const localData = await holosphere.getAll(holonID, "quests");
			console.log("Local data:", localData);
			
			// Fetch participation data for federated items
			console.log("Fetching participation data...");
			const participationData = await holosphere.getAll(holonID, "participations");
			console.log("Participation data:", participationData);
			
			// Create a map of item participations
			const participationsMap = new Map();
			if (Array.isArray(participationData)) {
				participationData.forEach((participation) => {
					if (participation && participation.itemId) {
						if (!participationsMap.has(participation.itemId)) {
							participationsMap.set(participation.itemId, []);
						}
						participationsMap.get(participation.itemId).push(participation.participant);
					}
				});
			}
			
			// Get federated data from connected holons
			const federatedData = await holosphere.getFederated(holonID, "quests", {
				includeLocal: true,
				includeFederated: true,
				resolveReferences: true,
				aggregate: false
			});
			
			console.log("Federated data result:", federatedData);
			
			// Get user-specific offers from each user's personal holon
			console.log("Fetching user-specific offers...");
			const userOffers = await fetchUserSpecificOffers();
			console.log("User-specific offers:", userOffers);
			
			// Combine all data sources
			const allData = [...federatedData, ...userOffers];
			console.log("Combined data:", allData);
			
			// Convert array to keyed object for consistency with subscription format
			const keyedStore = {};
			
			// Handle all data (federated + user-specific)
			allData.forEach((item, index) => {
				if (item && item.id) {
					// For federated data, we need to preserve the original key structure
					// If the item has a key from the original subscription, use it
					// Otherwise, use the id as the key
					const key = item.key || item.id || `combined_${index}`;
					
					// Add federation metadata if it's from a federated source
					const processedItem = {
						...item,
						key: key
					};
					
					// If this item has federation metadata, it's from a federated source
					if (item._federation) {
						processedItem._federation = item._federation;
					}

					// Hologram metadata is now automatically added by HoloSphere via _hologram
					// No manual assignment needed - resolved holograms have _hologram.isHologram = true
					if (item._hologram) {
						processedItem._hologram = item._hologram;
					}
					
					// Mark user-specific offers
					if (item._userSpecific) {
						processedItem._userSpecific = item._userSpecific;
					}
					
					// Check if this item has participation data and merge it
					const participations = participationsMap.get(item.id);
					if (participations && participations.length > 0) {
						// Merge participation data with existing participants
						const existingParticipants = processedItem.participants || [];
						const mergedParticipants = [...existingParticipants];
						
						// Add participations that aren't already in the participants list
						participations.forEach((participation) => {
							const alreadyExists = mergedParticipants.some((p) => p.id === participation.id);
							if (!alreadyExists) {
								mergedParticipants.push(participation);
							}
						});
						
						processedItem.participants = mergedParticipants;
					}
					
					keyedStore[key] = processedItem;
					console.log(`Added item to store with key ${key}:`, processedItem);
					console.log(`Item type: ${processedItem.type}, is offer: ${processedItem.type === 'offer'}`);
				}
			});
			
			// If no data was found, fall back to local data only
			if (allData.length === 0 && localData.length > 0) {
				console.log("No combined data found, using local data only");
				localData.forEach((item, index) => {
					if (item && item.id) {
						const key = item.key || item.id || `local_${index}`;
						
						// Check if this item has participation data and merge it
						const participations = participationsMap.get(item.id);
						if (participations && participations.length > 0) {
							// Merge participation data with existing participants
							const existingParticipants = item.participants || [];
							const mergedParticipants = [...existingParticipants];
							
							// Add participations that aren't already in the participants list
							participations.forEach((participation) => {
								const alreadyExists = mergedParticipants.some((p) => p.id === participation.id);
								if (!alreadyExists) {
									mergedParticipants.push(participation);
								}
							});
							
							item.participants = mergedParticipants;
						}
						
						keyedStore[key] = {
							...item,
							key: key
						};
					}
				});
			}
			
			store = keyedStore;
			console.log(`Final store:`, store);
			console.log(`Fetched ${federatedData.length} federated items + ${userOffers.length} user items, store has ${Object.keys(store).length} keys`);
			
			// Debug: Check what's in the store after processing
			const storeValues = Object.values(store);
			console.log("Store values:", storeValues);
			console.log("Items with type 'offer':", storeValues.filter(item => item.type === 'offer'));
			console.log("Items with type 'request':", storeValues.filter(item => item.type === 'request'));
		} catch (error) {
			console.error("Error fetching federated data:", error);
			// Fallback to local data only
			try {
				console.log("Falling back to local data only...");
				const localData = await holosphere.getAll(holonID, "quests");
				const keyedStore = {};
				localData.forEach((item, index) => {
					if (item && item.id) {
						const key = item.key || item.id || `local_${index}`;
						keyedStore[key] = {
							...item,
							key: key
						};
					}
				});
				store = keyedStore;
				console.log(`Fallback: Loaded ${localData.length} local items`);
			} catch (fallbackError) {
				console.error("Error in fallback to local data:", fallbackError);
				store = {};
			}
		} finally {
			loadingFederated = false;
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

	// Handle federated toggle change. Invoked via the FeatureToolbar binding.
	async function handleFederatedToggle() {
		await subscribeToOffersAndNeeds();
	}
	// Kick off re-subscription when the federation toggle flips.
	let lastFederatedFlag = filters.showFederated;
	$: if (filters.showFederated !== lastFederatedFlag) {
		lastFederatedFlag = filters.showFederated;
		handleFederatedToggle();
	}



	function getTransactionLabel(value: string, side: 'offer' | 'request'): string {
		const entry = TRANSACTION_TYPES.find((t) => t.value === value);
		if (!entry) return value;
		return side === 'offer' ? entry.offerLabel : entry.requestLabel;
	}

	// Function to classify a task as offer or request
	function classifyTask(item) {
		if (!item) return null;
		
		// Only accept items that are explicitly marked as offers or requests
		if (item.type === "offer" || item.type === "request" || item.type === "need") {
			return item.type;
		}
		
		// If it's not explicitly an offer/request/need, return null (filtered out)
		return null;
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
		const isAlreadyParticipant = item.participants?.some(p => p.id === user.id);
		if (isAlreadyParticipant) {
			showDropdownFor = null;
			return;
		}
		
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
		} catch (error: any) {
			if (error?.name === 'AuthorizationError') {
				notifyWriteDenied('Unable to save - no write permission for this holon');
			} else {
				console.error('[Offers.svelte] Error updating quest:', error);
			}
		}

		showDropdownFor = null;
	}

	// Toggle dropdown for a specific item
	function toggleDropdown(itemKey) {
		console.log('toggleDropdown called with:', itemKey, 'current showDropdownFor:', showDropdownFor);
		showDropdownFor = showDropdownFor === itemKey ? null : itemKey;
		console.log('showDropdownFor set to:', showDropdownFor);
	}

	// Close dropdown when clicking outside
	function handleClickOutside(event) {
		console.log('handleClickOutside called');
		const dropdowns = document.querySelectorAll('.user-dropdown');
		let clickedInside = false;
		dropdowns.forEach(dropdown => {
			if (dropdown.contains(event.target)) clickedInside = true;
		});
		if (!clickedInside) {
			console.log('Clicked outside, closing dropdown');
			showDropdownFor = null;
		}
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

		const newItem: Record<string, any> = {
			id: crypto.randomUUID(),
			type: addModalType,
			exchange_type: addModalType === 'offer' ? 'offer' : 'want',
			title: newItemTitle.trim(),
			description: newItemDescription.trim(),
			transaction_type: [...newItemTransactionTypes],
			participants: [],
			created_at: new Date().toISOString()
		};
		if (newItemItemType) newItem.item_type = newItemItemType;
		if (newItemTags.length > 0) newItem.tags = [...newItemTags];
		if (expiresAtMs && !Number.isNaN(expiresAtMs)) newItem.expires_at = expiresAtMs;

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
		const isParticipant = item.participants?.some(p => p.id === user.id);
		if (!isParticipant) {
			return;
		}
		
		const updatedParticipants = (item.participants || []).filter(p => p.id !== user.id);
		const updatedItem = {
			...item,
			participants: updatedParticipants
		};

		try {
			await holosphere.put(holonID, 'quests', updatedItem);
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
	<TitleBar {holonName} title="Offers & Requests" icon={Gift} />

	<FeatureToolbar
		onAdd={null}
		bind:showFederated={filters.showFederated}
		bind:showHolograms={filters.showHolograms}
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
													{#if offer._hologram?.isHologram}
													<button
														class="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-800 flex-shrink-0 hover:bg-blue-500/30 transition-colors"
														title="Navigate to source holon: {getHologramSourceDisplay(offer._hologram.soul)}"
														on:click|stopPropagation={() => {
															const sourceHolon = offer._hologram?.sourceHolon;
															if (sourceHolon) {
																goto(`/${sourceHolon}/offers`);
															}
														}}
													>
														<svg class="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
															<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
														</svg>
														{getHologramSourceDisplay(offer._hologram.soul)}
														<svg class="w-2 h-2" viewBox="0 0 24 24" fill="none" stroke="currentColor">
															<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
														</svg>
													</button>
												{/if}
													{#if offer._federation?.origin && offer._federation.origin !== holonID && !offer._hologram?.isHologram}
														{@const fedOrigin = offer._federation.origin}
														{@const fedName = (resolveName(fedOrigin), resolvedName(fedOrigin, $nameMap))}
														<button
															class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/20 text-purple-800 flex-shrink-0 hover:bg-purple-500/30 transition-colors"
															title="Navigate to source holon: {fedName}"
															on:click|stopPropagation={() => goto(`/${fedOrigin}/offers`)}
															aria-label="Navigate to source holon: {fedName}"
														>
															<svg class="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
																<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
															</svg>
															{fedName}
															<svg class="w-2 h-2" viewBox="0 0 24 24" fill="none" stroke="currentColor">
																<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
															</svg>
														</button>
													{/if}
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

											<!-- Take Offer Dropdown -->
											<div class="relative">
												<button
													class="btn btn--primary btn--sm"
													on:click|stopPropagation={(e) => {
														console.log('Take Offer button clicked for:', offer.key);
														toggleDropdown(offer.key);
													}}
												>
													{#if offer.participants && offer.participants.length > 0}
														Add ({offer.participants.length})
													{:else}
														Accept
													{/if}
												</button>
												{#if showDropdownFor === offer.key}
													<div class="absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50 user-dropdown">
														{#each Object.entries(userStore).filter(([userId, user]) => !offer.participants?.some(p => p.id === user.id)) as [userId, user]}
															<button class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2" on:click|stopPropagation={() => takeOfferOrNeed(offer, user)}>
																<img class="w-6 h-6 rounded-full border border-gray-400" src={`https://telegram.holons.io/getavatar?user_id=${user.id}`} alt={resolvedName(user.id, $nameMap, user)} />
																<span><DisplayName id={user.id} {user} /></span>
															</button>
														{/each}
														{#if Object.entries(userStore).filter(([userId, user]) => !offer.participants?.some(p => p.id === user.id)).length === 0}
															<div class="px-4 py-2 text-gray-400 text-sm">All users already participating</div>
														{/if}
													</div>
												{/if}
											</div>

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
													{#if need._hologram?.isHologram}
													<button
														class="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-800 flex-shrink-0 hover:bg-blue-500/30 transition-colors"
														title="Navigate to source holon: {getHologramSourceDisplay(need._hologram.soul)}"
														on:click|stopPropagation={() => {
															const sourceHolon = need._hologram?.sourceHolon;
															if (sourceHolon) {
																goto(`/${sourceHolon}/offers`);
															}
														}}
													>
														<svg class="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
															<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
														</svg>
														{getHologramSourceDisplay(need._hologram.soul)}
														<svg class="w-2 h-2" viewBox="0 0 24 24" fill="none" stroke="currentColor">
															<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
														</svg>
													</button>
												{/if}
													{#if need._federation?.origin && need._federation.origin !== holonID && !need._hologram?.isHologram}
														{@const needFedOrigin = need._federation.origin}
														{@const needFedName = (resolveName(needFedOrigin), resolvedName(needFedOrigin, $nameMap))}
														<button
															class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/20 text-purple-800 flex-shrink-0 hover:bg-purple-500/30 transition-colors"
															title="Navigate to source holon: {needFedName}"
															on:click|stopPropagation={() => goto(`/${needFedOrigin}/offers`)}
															aria-label="Navigate to source holon: {needFedName}"
														>
															<svg class="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
																<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
															</svg>
															{needFedName}
															<svg class="w-2 h-2" viewBox="0 0 24 24" fill="none" stroke="currentColor">
																<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
															</svg>
														</button>
													{/if}
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

											<!-- Take Need Dropdown -->
											<div class="relative">
												<button 
													class="btn btn--primary btn--sm"
													on:click|stopPropagation={(e) => {
														console.log('Take Need button clicked for:', need.key);
														toggleDropdown(need.key);
													}}
												>
													{#if need.participants && need.participants.length > 0}
														Add ({need.participants.length})
													{:else}
														Fulfill
													{/if}
												</button>
												{#if showDropdownFor === need.key}
													<div class="absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50 user-dropdown">
														{#each Object.entries(userStore).filter(([userId, user]) => !need.participants?.some(p => p.id === user.id)) as [userId, user]}
															<button class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2" on:click|stopPropagation={() => takeOfferOrNeed(need, user)}>
																<img class="w-6 h-6 rounded-full border border-gray-400" src={`https://telegram.holons.io/getavatar?user_id=${user.id}`} alt={resolvedName(user.id, $nameMap, user)} />
																<span><DisplayName id={user.id} {user} /></span>
															</button>
														{/each}
														{#if Object.entries(userStore).filter(([userId, user]) => !need.participants?.some(p => p.id === user.id)).length === 0}
															<div class="px-4 py-2 text-gray-400 text-sm">All users already participating</div>
														{/if}
													</div>
												{/if}
											</div>

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
{#if showAddModal}
	<div
		class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
		on:click|self={() => showAddModal = false}
		on:keydown={(e) => e.key === 'Escape' && (showAddModal = false)}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div class="bg-gray-800 rounded-2xl w-full max-w-md shadow-xl">
			<div class="p-6 border-b border-gray-700">
				<div class="flex justify-between items-center">
					<h2 class="text-xl font-bold text-white">
						New {addModalType === 'offer' ? 'Offer' : 'Request'}
					</h2>
					<button
						class="text-gray-400 hover:text-white transition-colors"
						on:click={() => showAddModal = false}
						aria-label="Close modal"
					>
						<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
			</div>

			<div class="p-6 space-y-4">
				<div>
					<label for="item-title" class="block text-sm font-medium text-gray-300 mb-2">Title</label>
					<input
						id="item-title"
						type="text"
						bind:value={newItemTitle}
						placeholder={addModalType === 'offer' ? 'What are you offering?' : 'What do you need?'}
						class="w-full px-4 py-3 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors"
					/>
				</div>

				<div>
					<label for="item-description" class="block text-sm font-medium text-gray-300 mb-2">Description (optional)</label>
					<textarea
						id="item-description"
						bind:value={newItemDescription}
						placeholder="Add more details..."
						rows="3"
						class="w-full px-4 py-3 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors resize-none"
					></textarea>
				</div>

				<div>
					<span class="block text-sm font-medium text-gray-300 mb-2">Item type</span>
					<div class="flex gap-4">
						<label class="inline-flex items-center gap-2 text-gray-200">
							<input
								type="radio"
								name="item-type"
								value="good"
								bind:group={newItemItemType}
								class="accent-indigo-500"
							/>
							Good
						</label>
						<label class="inline-flex items-center gap-2 text-gray-200">
							<input
								type="radio"
								name="item-type"
								value="service"
								bind:group={newItemItemType}
								class="accent-indigo-500"
							/>
							Service
						</label>
					</div>
				</div>

				<div>
					<span class="block text-sm font-medium text-gray-300 mb-2">
						Transaction type
						<span class="text-red-400">*</span>
					</span>
					<div class="flex flex-wrap gap-2">
						{#each TRANSACTION_TYPES as tx}
							{@const label = addModalType === 'offer' ? tx.offerLabel : tx.requestLabel}
							{@const selected = newItemTransactionTypes.includes(tx.value)}
							<button
								type="button"
								class="px-3 py-1 rounded-full text-sm border transition-colors"
								class:bg-indigo-500={selected}
								class:border-indigo-500={selected}
								class:text-white={selected}
								class:bg-gray-700={!selected}
								class:border-gray-600={!selected}
								class:text-gray-300={!selected}
								on:click={() => toggleTransactionType(tx.value)}
							>
								{label}
							</button>
						{/each}
					</div>
				</div>

				<div>
					<label for="item-tags" class="block text-sm font-medium text-gray-300 mb-2">Tags</label>
					<div class="flex flex-wrap gap-2 p-2 bg-gray-700 rounded-lg border border-gray-600 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500">
						{#each newItemTags as tag}
							<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/30 text-indigo-100 text-sm">
								{tag}
								<button
									type="button"
									class="hover:text-white"
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
							class="flex-1 min-w-[6rem] bg-transparent text-white outline-none text-sm py-1"
						/>
					</div>
				</div>

				<div>
					<label for="item-expires-at" class="block text-sm font-medium text-gray-300 mb-2">Expires at (optional)</label>
					<input
						id="item-expires-at"
						type="datetime-local"
						bind:value={newItemExpiresAtLocal}
						class="w-full px-4 py-3 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors"
					/>
				</div>
			</div>

			<div class="p-6 border-t border-gray-700 flex justify-end gap-3">
				<button
					class="btn btn--secondary"
					on:click={() => showAddModal = false}
				>
					Cancel
				</button>
				<button
					class="btn btn--primary"
					on:click={createNewItem}
					disabled={!newItemTitle.trim() || newItemTransactionTypes.length === 0}
				>
					Create {addModalType === 'offer' ? 'Offer' : 'Request'}
				</button>
			</div>
		</div>
	</div>
{/if}

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
		color: #fff;
	}

	.section-header__title {
		font-size: 1.5rem;
		font-weight: 700;
		line-height: 1;
	}

	.section-header__count {
		color: #9ca3af;
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
		color: #9ca3af;
		pointer-events: none;
	}

	.section-header__search-input {
		width: 100%;
		background: #374151;
		border: 1px solid #4b5563;
		border-radius: 0.5rem;
		color: #fff;
		font-size: 0.875rem;
		padding: 0.5rem 0.75rem 0.5rem 2rem;
		transition: border-color 150ms ease;
	}

	.section-header__search-input:focus {
		outline: none;
		border-color: #3b82f6;
	}

	.section-header__search-input::placeholder {
		color: #6b7280;
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
</style>
