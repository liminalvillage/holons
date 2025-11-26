<script lang="ts">
	import { openSidebar, ID } from './store';
	import { onMount, onDestroy, getContext } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import type { HoloSphere } from "holosphere";
	import { addVisitedHolon, getWalletAddress } from "../utils/localStorage";
	import { fetchHolonName, clearHolonNameCache } from "../utils/holonNames";
	import MyHolonsIcon from './sidebar/icons/MyHolonsIcon.svelte';
	import Menu from 'svelte-feather-icons/src/icons/MenuIcon.svelte';
	import VideoCall from '../components/VideoCall.svelte';
	import WidgetDashboard from '../components/WidgetDashboard.svelte';

	export let toggleMyHolons: () => void;

	// Add a function to refresh ALL holon names comprehensively
	async function refreshAllHolonNames() {
		if (browser) {
			try {
				// Dispatch a custom event to trigger comprehensive refresh in MyHolons component
				const refreshEvent = new CustomEvent('refreshAllHolonNames', {
					detail: { timestamp: Date.now() }
				});
				window.dispatchEvent(refreshEvent);
				
				// Also refresh the current holon name if we have one
				if ($ID && $ID !== 'undefined' && $ID !== 'null' && $ID.trim() !== '') {
					await updateCurrentHolonName($ID);
				}
			} catch (err) {
				console.error('Error dispatching comprehensive refresh event:', err);
			}
		}
	}

	// Enhanced toggle function that refreshes names comprehensively
	function handleToggleMyHolons() {
		// First refresh ALL types of holon names comprehensively
		refreshAllHolonNames();
		// Then call the original toggle function
		toggleMyHolons();
	}

	// Handle holon name update event from Settings
	function handleHolonNameUpdated(event: CustomEvent) {
		const { holonId, newName } = event.detail;
		if (holonId === $ID && newName) {
			// Update the current holon name immediately
			currentHolonName = newName;
			// Also trigger a refresh to ensure consistency
			setTimeout(() => updateCurrentHolonName(holonId), 100);
		}
	}

	// Handle holon navigation event from MyHolons component
	function handleHolonNavigated(event: CustomEvent) {
		const { holonId, holonName } = event.detail;
		console.log('[TopBar] Holon navigated event:', { holonId, holonName });
		if (holonId && holonName) {
			// Update the current holon name immediately
			currentHolonName = holonName;
			// Update the processed ID to match
			processedHolonId = holonId;
			// Also save to visited holons with the name
			if (browser && holonId !== 'undefined' && holonId !== 'null' && holonId.trim() !== '') {
				saveVisitedHolon(holonId, holonName);
			}
		}
	}

	let holosphere = getContext("holosphere") as HoloSphere;

	let currentHolonName: string | undefined;
	let holonID: string = '';
	let showToast = false;
	let isTranslating = false;
	let showVideoCall = false;
	let showWidgetDashboard = false;

	// Function to save visited holon
	async function saveVisitedHolon(holonId: string, holonName: string) {
		const walletAddr = getWalletAddress();
		if (holonId && holonId !== 'undefined' && holonId !== 'null' && holonId.trim() !== '') {
			try {
				await addVisitedHolon(walletAddr, holonId, holonName, 'personal');
				console.log(`Saved visited holon from TopBar: ${holonId}`);
			} catch (err) {
				console.warn('Failed to save visited holon from TopBar:', err);
			}
		}
	}

	// Track if we've already processed the current ID to prevent loops
	let processedHolonId = '';
	let isInitialized = false;

	// Initialize on mount
	onMount(async () => {
		// Set up initial state
		isInitialized = true;

		// Process initial ID immediately if available
		const initialId = $page.params.id;
		if (initialId && initialId !== 'undefined' && initialId !== 'null' && initialId.trim() !== '') {
			ID.set(initialId);
			processedHolonId = initialId;
			// Start fetching the name immediately (don't wait for holosphere)
			updateCurrentHolonName(initialId);
		}

		// Also retry after holosphere is ready
		await new Promise(resolve => setTimeout(resolve, 1000));
		if (initialId && initialId !== 'undefined' && initialId !== 'null' && initialId.trim() !== '') {
			// Retry the name fetch in case it failed the first time
			updateCurrentHolonName(initialId);
		}
		
			// Monitor for Google Translate activity
		const observer = new MutationObserver(() => {
			// Check if Google Translate is active by looking for translated elements
			const hasTranslatedElements = document.querySelector('font[style*="vertical-align"]') ||
										   document.querySelector('.goog-te-combo')?.value !== '';
			isTranslating = !!hasTranslatedElements;
		});

		observer.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true
		});

		// Listen for widget dashboard toggle events from Layout
		window.addEventListener('toggleWidgetDashboard', toggleWidgetDashboard);

		// Listen for holon name update events from Settings
		window.addEventListener('holonNameUpdated', handleHolonNameUpdated);

		// Listen for holon navigation events from MyHolons
		window.addEventListener('holonNavigated', handleHolonNavigated);
		
		// Listen for translation events
		window.addEventListener('flagLanguageChanged', () => {
			setTimeout(() => {
				const selectElement = document.querySelector('.goog-te-combo') as HTMLSelectElement;
				isTranslating = selectElement && selectElement.value !== '';
			}, 100);
		});
	});

	// Use centralized holon name service with proper reactivity
	async function updateCurrentHolonName(id: string, retryCount = 0) {
		if (!id || id === '') {
			currentHolonName = undefined;
			return;
		}

		// Check if holosphere is available
		if (!holosphere) {
			currentHolonName = `Holon ${id}`;
			// Retry when holosphere becomes available
			if (retryCount < 5) {
				setTimeout(() => {
					updateCurrentHolonName(id, retryCount + 1);
				}, 500);
			}
			return;
		}

		// On retries, wait a bit for connection to be ready
		if (retryCount > 0) {
			await new Promise(resolve => setTimeout(resolve, 300));
		}

		try {
			// Clear cache on retries to force a fresh fetch
			if (retryCount > 1) {
				clearHolonNameCache(id);
			}

			// Use centralized fetchHolonName function like MyHolons does
			const name = await fetchHolonName(holosphere, id);

			// Update the name and trigger reactivity
			if (name && name !== `Holon ${id}`) {
				currentHolonName = name;
				console.log(`[TopBar] Updated holon name: ${name}`);
			} else {
				currentHolonName = `Holon ${id}`;
			}
		} catch (error) {
			console.warn(`[TopBar] Error fetching holon name (attempt ${retryCount + 1}):`, error);
			// Retry logic - try up to 3 times with exponential backoff
			if (retryCount < 3) {
				const delay = Math.pow(2, retryCount) * 500; // 500ms, 1s, 2s
				setTimeout(() => {
					updateCurrentHolonName(id, retryCount + 1);
				}, delay);
			} else {
				currentHolonName = `Holon ${id}`; // Fallback to ID on error
			}
		}
	}

	// Handle URL parameter changes - only process once
	$: {
		const storedHolonID = $page.params.id;
		if (storedHolonID && storedHolonID !== 'undefined' && storedHolonID !== 'null' && storedHolonID.trim() !== '' && isInitialized) {
			// Only update if the ID actually changed
			if (processedHolonId !== storedHolonID) {
				ID.set(storedHolonID);
				processedHolonId = storedHolonID;
				updateCurrentHolonName(storedHolonID);
			}
		}
	}

	// Handle ID store changes - only process once and save visited holon
	$: if ($ID && $ID !== 'undefined' && $ID !== 'null' && $ID.trim() !== '' && isInitialized) {
		showToast = false;
		
		// Only process if this is a new ID
		if (processedHolonId !== $ID) {
			processedHolonId = $ID;
			
			// Always try to resolve the holon name when we have a valid ID
			updateCurrentHolonName($ID);
			
			// Save visited holon when we have a valid ID and we're not on a primary page
			if (browser && $page.url.pathname !== '/') {
				// Save the visited holon with the resolved name or fallback
				const holonName = currentHolonName || `Holon ${$ID}`;
				saveVisitedHolon($ID, holonName);
			}
			
			// Only update route if we're not on a primary page AND not on video route
			if ($page.url.pathname !== '/' && !$page.url.pathname.includes('/video')) {
				// Check if we're already on a valid path for this holon
				const currentPath = $page.url.pathname;
				const expectedPath = `/${$ID}`;
				
				// Only update if we're not already on the correct path
				if (!currentPath.startsWith(expectedPath)) {
					holonID = $ID;
					// Add a small delay to avoid interfering with initial navigation
					setTimeout(() => {
						updateRoute($ID);
					}, 100);
				} else {
					// Just update the holonID without changing the route
					holonID = $ID;
				}
			} else {
				// Just update the holonID without changing the route for video
				holonID = $ID;
			}
		}
	}

	function updateRoute(id: string) {
		if (!id || id === '' || id === 'undefined' || id === 'null' || id.trim() === '') {
			// If no valid ID, redirect to splash screen only if not already there
			if (browser && $page.url.pathname !== '/') {
				goto('/');
			}
			return;
		}
		
		// Check if we're already on the correct path for this holon
		const currentPath = $page.url.pathname;
		const expectedPath = `/${id}`;
		
		console.log('TopBar updateRoute called:', { id, currentPath, expectedPath });
		
		// Only navigate if we're not already on the correct path
		if (browser && !currentPath.startsWith(expectedPath)) {
			// Extract the sub-path more carefully
			const pathParts = currentPath.split('/');
			let subPath = pathParts[pathParts.length - 1]; // Get the last part
			
			console.log('TopBar: pathParts =', pathParts, 'subPath =', subPath);
			
			// Don't interfere with specific routes like video
			const protectedRoutes = ['video', 'map', 'settings', 'roles', 'offers', 'tasks', 'calendar', 'tags', 'proposals', 'shopping', 'checklists', 'status', 'federation', 'dashboard'];
			
			// Only default to dashboard if we're currently on a path that's just the holon ID
			// or if the subPath is the old holon ID (meaning we're switching holons)
			// BUT not if we're on a protected route
			if ((pathParts.length === 2 || subPath === holonID) && !protectedRoutes.includes(subPath)) {
				console.log('TopBar: Defaulting to dashboard because conditions met');
				subPath = 'dashboard';
			}
			
			const newPath = `/${id}/${subPath || 'dashboard'}`;
			console.log('TopBar: Navigating to', newPath);
			goto(newPath);
		} else {
			console.log('TopBar: Not navigating, already on correct path or path starts with expected');
		}
	}

	// Check if we're on a primary page (standalone routes)
	$: isPrimaryPage = $page.url.pathname === '/';

	function startVideoCall() {
		if ($ID) {
			showVideoCall = true;
		}
	}

	function toggleWidgetDashboard() {
		if ($ID) {
			showWidgetDashboard = !showWidgetDashboard;
		}
	}

	onDestroy(() => {
		// Clean up event listeners
		if (browser) {
			window.removeEventListener('toggleWidgetDashboard', toggleWidgetDashboard);
			window.removeEventListener('holonNameUpdated', handleHolonNameUpdated);
			window.removeEventListener('holonNavigated', handleHolonNavigated);
		}
	});



</script>

<style>
	.toast {
		position: fixed;
		bottom: 20px;
		right: 20px;
		background-color: rgba(0, 0, 0, 0.7);
		color: white;
		padding: 10px 20px;
		border-radius: 5px;
		transition: opacity 0.5s ease;
		opacity: 0;
	}
	.toast.show {
		opacity: 1;
	}

	/* Add styles for the holon name in the top bar */
	.flex-shrink-0 {
		z-index: 102;
		background-color: #1f2937;
		padding: 0.5rem;
		border-radius: 0.5rem;
		margin-right: 1rem;
	}

</style>

<div class="top-bar-container w-full px-4 py-2 flex items-center gap-4 relative">
    <!-- Mobile menu button (outside bar) -->
    <div class="lg:hidden z-10">
        <button on:click={openSidebar} class="text-white p-2 hover:bg-gray-700 rounded-lg transition-colors">
            <Menu size="24" />
        </button>
    </div>

    <!-- Dashboard-style bar - full width -->
    {#if !isPrimaryPage}
        <div class="flex-1 flex flex-col gap-3">
            <!-- Title section - takes full width -->
            <button 
                on:click={handleToggleMyHolons} 
                class="group bg-gray-800 hover:bg-gray-750 transition-all duration-300 px-4 sm:px-6 py-2 rounded-2xl shadow-xl hover:shadow-2xl transform hover:scale-[1.01] relative overflow-hidden w-full"
                title="Open My Holons"
            >
                <!-- Gradient overlay -->
                <div class="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-blue-600/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                
                <!-- Bar content - responsive layout -->
                <div class="relative z-10 flex flex-row items-center gap-3">
                    <!-- Holons Logo -->
                    <div class="flex-shrink-0">
                        <div class="w-12 h-12 sm:w-20 sm:h-20 group-hover:scale-105 transition-transform">
                            <MyHolonsIcon />
                        </div>
                    </div>
                    
                    <!-- Title and ID -->
                    <div class="text-left">
                        <div class="text-lg sm:text-xl font-bold text-white group-hover:text-blue-400 transition-colors leading-tight">
                            {#if currentHolonName && !isTranslating}
                                {currentHolonName}
                            {:else if isTranslating && currentHolonName}
                                <span class="notranslate">{currentHolonName}</span>
                            {:else if $ID && $ID !== 'undefined' && $ID !== 'null' && $ID.trim() !== ''}
                                <span class="notranslate">Holon {$ID}</span>
                            {:else}
                                <span class="notranslate">Loading...</span>
                            {/if}
                        </div>
                        <div class="text-xs sm:text-sm text-gray-400 font-mono mt-1">
                            {$ID || '...'}
                        </div>
                    </div>
                </div>
            </button>
            
        </div>
    {:else}
        <!-- Root page - centered logo -->
        <div class="flex-1 flex items-center justify-center">
            <button on:click={handleToggleMyHolons} class="p-2 rounded-full hover:ring-4 hover:ring-blue-400 ring-offset-2 transition-all cursor-pointer animate-pulse hover:animate-none" title="Open My Holons">
                <div class="w-20 h-20">
                    <MyHolonsIcon />
                </div>
            </button>
        </div>
        
    {/if}

    <!-- Right side controls - single column layout -->
    <div class="z-10 ml-auto hidden sm:flex flex-col items-center gap-1">
        <!-- Google Translate Widget -->
        <div id="google_translate_element" class="scale-75"></div>

        <!-- Action Buttons (only on dashboard pages) -->
        {#if !isPrimaryPage && $ID}
            <!-- Widget Dashboard Button -->
            <button
                on:click={toggleWidgetDashboard}
                class="p-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-all duration-200 group"
                title="Toggle Widget Dashboard"
                aria-label="Toggle Widget Dashboard"
            >
                <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                </svg>
            </button>

            <!-- Video Call Button -->
            <button
                on:click={startVideoCall}
                class="p-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-all duration-200 group"
                title="Start Video Call"
                aria-label="Start Video Call"
            >
                <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
            </button>
        {/if}

    </div>
</div>

{#if showToast}
	<button
		class="toast show"
		on:click={() => showToast = false}
		on:keydown={(e) => e.key === 'Enter' && (showToast = false)}
	>
		To begin using the dashboard, please type the Holon ID in the search bar.<br/> You can get the Holon ID using the command /id on any chat containing the Telegram bot @HolonsBot.
	</button>
{/if}

<!-- Floating Video Call Component -->
<VideoCall roomId={$ID} bind:show={showVideoCall} floating={true} />

<!-- Widget Dashboard Component -->
<WidgetDashboard bind:isVisible={showWidgetDashboard} />

<!-- API Key Configuration Modal - MOVED TO COUNCIL COMPONENT -->
