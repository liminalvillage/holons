<script lang="ts">
	// @ts-nocheck

	import { onMount, getContext } from "svelte";
	import { ID } from "../dashboard/store";
	import { formatDate, formatTime } from "../utils/date";
	import type { HoloSphere } from "holosphere";
	import Announcements from "./Announcements.svelte";
	import { getHologramSourceName, fetchHolonName } from "../utils/holonNames";
	import TitleBar from "./shared/TitleBar.svelte";

	/**
	 * @type {string | any[]}
	 */
	let store = {};
	let holonID: string | null = null;
	let holonName = 'Offers & Requests';

	// Federated offers toggle
	let includeFederatedOffers = false;
	let loadingFederated = false;

	$: offers = Object.values(store).filter((item) => {
		// Use the classification function for better categorization
		const classifiedType = classifyTask(item);
		const isOffer = classifiedType === "offer";
		console.log(`Checking item ${item.id}: type=${item.type}, classifiedType=${classifiedType}, isOffer=${isOffer}`);
		return isOffer;
	});
	$: needs = Object.values(store).filter((item) => {
		// Use the classification function for better categorization
		const classifiedType = classifyTask(item);
		const isNeed = classifiedType === "request" || classifiedType === "need";
		console.log(`Checking item ${item.id}: type=${item.type}, classifiedType=${classifiedType}, isNeed=${isNeed}`);
		return isNeed;
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
			userStore = usersKeyedById;
		} catch (e) {
			userStore = {};
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
				// Load holon name for TitleBar
				if (holosphere) {
					fetchHolonName(holosphere, value).then(name => {
						holonName = name || 'Offers & Requests';
					});
				}
				// Force re-initialization when ID changes with error handling
				initializeComponent().catch(error => {
					// Silently handle re-initialization errors
				});
			}
		});
		
		// Add click outside handler
		document.addEventListener('click', handleClickOutside);
		
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
					// Use regular subscription
					questSubscriptionOff = holosphere.subscribe(holonID, "quests", (newItem, key) => {
						try {
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

	// Handle federated toggle change
	async function handleFederatedToggle() {
		includeFederatedOffers = !includeFederatedOffers;
		await subscribeToOffersAndNeeds();
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

		// Use the centralized service to get hologram source name
		// This will return cached name immediately or trigger async fetch with callback
		return getHologramSourceName(holosphere, soul, () => {
			// Trigger reactivity by updating store when name is fetched
			console.log('[Offers] Hologram source name updated, triggering reactivity');
			store = { ...store };
		});
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
		
		// If this is a federated item (has _hologram metadata), we need to handle it differently
		// to avoid creating duplicates. Instead of putting it directly to the local holon,
		// we should update the original source or use a different approach.
		if (item._federation || item._hologram?.isHologram) {
			console.log("[Offers.svelte] Taking federated item:", item.id);

			// For federated items, we'll store the participation in a separate local tracking system
			// to avoid duplicating the entire item
			const participationKey = `participation_${item.id}`;
			const participationData = {
				itemId: item.id,
				itemTitle: item.title,
				participant: newParticipant,
				participatedAt: new Date().toISOString(),
				originalHolonId: item._federation?.sourceHolonId || item._hologram?.sourceHolon,
				itemSoul: item._federation?.soul || item._hologram?.soul
			};
			
			// Store participation locally
			await holosphere.put(holonID, 'participations', participationData);
			
			// Update the item in the store to show the user as a participant
			// This is just for UI display - the actual item remains federated
			store = {
				...store,
				[item.key]: updatedItem
			};
			
			console.log("[Offers.svelte] Stored participation for federated item:", participationData);
		} else {
			// For local items, update normally - the subscription will handle the store update
			await holosphere.put(holonID, 'quests', updatedItem);
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
			const fedInfo = await holosphere.getFederation(holonID);
			console.log("[Offers.svelte] Federation info:", fedInfo);
			
			// Check if we have either federated chats OR if this is a hex-based holon that can propagate to parents
			const hasFederatedChats = fedInfo && fedInfo.outbound && fedInfo.outbound.length > 0;
			
			// For hex-based holons, we can still propagate to parents even without federation
			// Let's proceed with propagation regardless of federation status
			if (!hasFederatedChats) {
				console.log("[Offers.svelte] No federated chats available, but proceeding with parent propagation for hex-based holons");
			}

			publishStatus = 'Publishing...';

			// Create a hologram for the item to propagate
			// Use the full item data instead of just the ID reference
			const hologram = holosphere.createHologram(holonID, 'quests', item);
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

	// Remove a user's participation from an offer or need
	async function removeParticipation(item, user) {
		if (!holosphere || !holonID || !item || !user) return;
		
		// Check if user is actually a participant
		const isParticipant = item.participants?.some(p => p.id === user.id);
		if (!isParticipant) {
			return;
		}
		
		// If this is a federated item, remove from participations
		if (item._federation || item._hologram?.isHologram) {
			console.log("[Offers.svelte] Removing participation from federated item:", item.id);
			
			// Find and remove the participation record
			const participationData = await holosphere.getAll(holonID, "participations");
			if (Array.isArray(participationData)) {
				const participationToRemove = participationData.find(p => 
					p.itemId === item.id && p.participant.id === user.id
				);
				
				if (participationToRemove) {
					// Delete the participation record
					await holosphere.delete(holonID, "participations", participationToRemove.id || participationToRemove.key);
					
					// Update the item in the store to remove the user from participants
					const updatedParticipants = item.participants.filter(p => p.id !== user.id);
					store = {
						...store,
						[item.key]: {
							...item,
							participants: updatedParticipants
						}
					};
					
					console.log("[Offers.svelte] Removed participation for federated item:", item.id);
				}
			}
		} else {
			// For local items, update normally
			const updatedParticipants = item.participants.filter(p => p.id !== user.id);
			const updatedItem = {
				...item,
				participants: updatedParticipants
			};
			
			await holosphere.put(holonID, 'quests', updatedItem);
		}
	}
</script>

<div class="space-y-4">
	<!-- TitleBar -->
	<TitleBar {holonName} title="Offers & Requests">
		<div slot="actions" class="flex items-center gap-3">
			<span class="text-white text-sm font-medium hidden sm:inline">Include Federated</span>
			<button
				class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 {includeFederatedOffers ? 'bg-blue-600' : 'bg-gray-600'}"
				on:click={handleFederatedToggle}
				disabled={loadingFederated}
			>
				<span class="sr-only">Include federated offers</span>
				<span
					class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform {includeFederatedOffers ? 'translate-x-6' : 'translate-x-1'}"
				></span>
			</button>
			{#if loadingFederated}
				<div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
			{/if}
		</div>
	</TitleBar>

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
				<!-- Stats Section -->
				<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
					<div class="bg-gray-700/50 rounded-2xl p-4 text-center">
						<div class="text-2xl font-bold text-white mb-1">{offers.length}</div>
						<div class="text-sm text-gray-400">Offers</div>
					</div>
					<div class="bg-gray-700/50 rounded-2xl p-4 text-center">
						<div class="text-2xl font-bold text-white mb-1">{needs.length}</div>
						<div class="text-sm text-gray-400">Requests</div>
					</div>
					<div class="bg-gray-700/50 rounded-2xl p-4 text-center">
						<div class="text-2xl font-bold text-white mb-1">
							{offers.length + needs.length - offers.concat(needs).filter((item) => item.participants?.length > 0).length}
						</div>
						<div class="text-sm text-gray-400">Unassigned</div>
				</div>
					<div class="bg-gray-700/50 rounded-2xl p-4 text-center">
						<div class="text-2xl font-bold text-white mb-1">{offers.length + needs.length}</div>
						<div class="text-sm text-gray-400">Total</div>
					</div>
				</div>

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
					<h2 class="text-2xl font-bold text-white mb-6">Active Offers</h2>
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
																window.location.href = `/${sourceHolon}/offers`;
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
													{#if offer._federation?.origin && offer._federation.origin !== holonID}
														<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/20 text-purple-800 flex-shrink-0">
															<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
																<path fill-rule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd" />
															</svg>
															{offer._federation.origin}
														</span>
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
											</div>
										</div>

										<!-- Right Side Meta Info -->
										<div class="flex items-center gap-3 flex-shrink-0 text-sm">
											<!-- Cast Button -->
											<button
												class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
													class="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm transition-colors" 
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
																<img class="w-6 h-6 rounded-full border border-gray-400" src={`https://telegram.holons.io/getavatar?user_id=${user.id}`} alt={user.first_name} />
																<span>{user.first_name} {user.last_name || ''}</span>
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
													<div class="flex -space-x-1 relative group" title={offer.participants.map(p => `${p.firstName || p.username} ${p.lastName ? p.lastName[0] + '.' : ''}`).join(', ')}>
														{#each offer.participants.slice(0, 2) as participant}
															<div class="relative">
																<img
																	class="w-5 h-5 rounded-full border border-white shadow-sm"
																	src={`https://telegram.holons.io/getavatar?user_id=${participant.id}`}
																	alt={`${participant.firstName || participant.username} ${participant.lastName ? participant.lastName[0] + '.' : ''}`}
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
					<h2 class="text-2xl font-bold text-white mb-6">Active Requests</h2>
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
																window.location.href = `/${sourceHolon}/offers`;
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
													{#if need._federation?.origin && need._federation.origin !== holonID}
														<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/20 text-purple-800 flex-shrink-0">
															<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
																<path fill-rule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd" />
															</svg>
															{need._federation.origin}
														</span>
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
											</div>
										</div>

										<!-- Right Side Meta Info -->
										<div class="flex items-center gap-3 flex-shrink-0 text-sm">
											<!-- Cast Button -->
											<button
												class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
													class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors" 
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
																<img class="w-6 h-6 rounded-full border border-gray-400" src={`https://telegram.holons.io/getavatar?user_id=${user.id}`} alt={user.first_name} />
																<span>{user.first_name} {user.last_name || ''}</span>
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
													<div class="flex -space-x-1 relative group" title={need.participants.map(p => `${p.firstName || p.username} ${p.lastName ? p.lastName[0] + '.' : ''}`).join(', ')}>
														{#each need.participants.slice(0, 2) as participant}
															<div class="relative">
																<img
																	class="w-5 h-5 rounded-full border border-white shadow-sm"
																	src={`https://telegram.holons.io/getavatar?user_id=${participant.id}`}
																	alt={`${participant.firstName || participant.username} ${participant.lastName ? participant.lastName[0] + '.' : ''}`}
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
</style>
