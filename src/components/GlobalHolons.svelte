<script lang="ts">
    import { createEventDispatcher, onMount, onDestroy, getContext } from "svelte";
    import { fade, slide } from "svelte/transition";
    import { goto } from "$app/navigation";
    import { browser } from "$app/environment";
    import type { HoloSphere } from "holosphere";
    import { ID } from "../dashboard/store";
    import { fetchHolonName } from "../utils/holonNames";
    import { addClickedHolon, addVisitedHolon, getWalletAddress } from "../utils/localStorage";

    // Initialize holosphere
    const holosphere = getContext("holosphere") as HoloSphere;
    const dispatch = createEventDispatcher();

    let unsubscribe: (() => void) | undefined;
    let isLoading = true;
    let connectionReady = false;
    let holons: any[] = [];
    let filteredHolons: any[] = [];
    let searchQuery = "";
    let sortBy = "name";
    let sortDirection = "asc";
    let refreshing = false;
    let processingHolons = new Set<string>(); // Track which holons are being processed
    let discoveredHolons = new Set<string>(); // Track which holons have been discovered
    let statsComputed = new Set<string>(); // Track which holons have computed stats

    interface HolonStats {
        id: string;
        name: string;
        users: number;
        activeUsers: number;
        totalTasks: number;
        completedTasks: number;
        openTasks: number;
        shoppingItems: number;
        offers: number;
        needs: number;
        checklists: number;
        completedChecklists: number;
        announcements: number;
        expenses: number;
        federationCount: number;
        inboundConnections: string[];  // Holons this one receives data from
        outboundConnections: string[]; // Holons this one sends data to
        purpose: string;
        lastActivity: number;
        status: "active" | "inactive" | "unknown";
        isLoading?: boolean; // Optional flag to show loading state
        updatedAt?: number; // Timestamp of when stats were last updated
    }

    // Helper function to ensure we get arrays from API calls
    function ensureArray(data: any): any[] {
        if (!data) return [];
        
        // Handle case where data might be individual characters from a JSON string
        if (typeof data === 'string') {
            // If it's a single character, it's likely part of a JSON string being streamed
            if (data.length === 1) {
                console.warn('Received single character, likely incomplete JSON:', data);
                return [];
            }
            // If it looks like a JSON string, try to parse it
            if (data.startsWith('{') || data.startsWith('[')) {
                try {
                    const parsed = JSON.parse(data);
                    if (Array.isArray(parsed)) return parsed;
                    if (typeof parsed === 'object') return Object.values(parsed);
                } catch (e) {
                    console.warn('Failed to parse JSON string:', data);
                }
            }
            return [];
        }
        
        if (Array.isArray(data)) return data;
        if (typeof data === 'object' && Object.keys(data).length === 0) return [];
        // If it's an object with properties, convert to array of values
        if (typeof data === 'object') return Object.values(data);
        return [];
    }

    onMount(() => {
        // Wait for holosphere to be ready before proceeding
        const checkConnection = async () => {
            if (!holosphere) {
                setTimeout(checkConnection, 100);
                return;
            }

            connectionReady = true;

            // Initial fetch
            await fetchAllHolons();
        };

        checkConnection();

        // Cleanup subscription on unmount
        return () => {
            if (unsubscribe) unsubscribe();
        };
    });

    // Watch search query
    $: {
        if (searchQuery) {
            filteredHolons = holons.filter(holon => 
                holon.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                holon.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                holon.purpose.toLowerCase().includes(searchQuery.toLowerCase())
            );
        } else {
            filteredHolons = [...holons];
        }
        
        // Apply sorting
        filteredHolons.sort((a, b) => {
            let aVal = a[sortBy];
            let bVal = b[sortBy];
            
            if (typeof aVal === 'string') {
                aVal = aVal.toLowerCase();
                bVal = bVal.toLowerCase();
            }
            
            if (sortDirection === 'asc') {
                return aVal > bVal ? 1 : -1;
            } else {
                return aVal < bVal ? 1 : -1;
            }
        });
    }

    async function fetchAllHolons() {
        if (!holosphere || !connectionReady) return;

        isLoading = true;
        holons = [];

        try {
            console.log("Fetching all holons from global registry...");

            // Get all holons from the global holons registry
            const holonsData = await holosphere.getAllGlobal('holons_registry');

            // Extract holon IDs from the registry
            const holonIds = new Set<string>();

            if (holonsData) {
                // Handle different data formats
                if (Array.isArray(holonsData)) {
                    holonsData.forEach((entry: any) => {
                        if (entry && entry.id) {
                            holonIds.add(entry.id);
                        }
                    });
                } else if (typeof holonsData === 'object') {
                    // If it's an object, iterate over values
                    Object.values(holonsData).forEach((entry: any) => {
                        if (entry && typeof entry === 'object' && entry.id) {
                            holonIds.add(entry.id);
                        }
                    });
                }
            }

            console.log(`Found ${holonIds.size} holons in global registry`);

            // If registry is empty or has very few entries, try communities lens
            if (holonIds.size < 2) {
                console.log("Registry empty or sparse, checking communities lens...");

                try {
                    const communities = await holosphere.getAll('global', 'communities');
                    if (communities && typeof communities === 'object') {
                        Object.keys(communities).forEach(key => {
                            if (key && !key.startsWith('_')) {
                                holonIds.add(key);
                            }
                        });
                    }
                    console.log(`After communities scan: Found ${holonIds.size} holons.`);
                } catch (error) {
                    console.warn('Error fetching communities:', error);
                }
            }

            // Add current holon if not already included
            if ($ID && !holonIds.has($ID)) {
                holonIds.add($ID);

                // Register current holon in global registry if not there
                try {
                    const settings = await holosphere.get($ID, 'settings', $ID);
                    if (settings?.name) {
                        await holosphere.putGlobal('holons_registry', {
                            id: $ID,
                            name: settings.name,
                            purpose: settings.purpose || '',
                            createdAt: settings.createdAt || Date.now(),
                            type: 'personal'
                        });
                        console.log(`Registered current holon ${$ID} in global registry`);
                    }
                } catch (error) {
                    console.warn('Failed to register current holon:', error);
                }
            }

            // Filter out invalid IDs - only keep actual holon IDs
            const validHolonIds = Array.from(holonIds).filter(id => {
                if (!id || typeof id !== 'string') return false;
                const trimmed = id.trim();
                
                // Skip empty, undefined, or malformed IDs
                if (trimmed === '' || trimmed === 'undefined' || trimmed === '-' || trimmed.includes('\n')) return false;
                
                // Skip known metadata/system entries (exact matches only)
                const systemEntries = [
                    'federation', 'federationMeta', 'federation_messages', 'fedInfo2',
                    'chats', 'checklists', 'expenses', 'quests', 'shopping', 'users', 'roles',
                    'announcements', 'recurring', 'recurringlookup', 'reminders', 'reminderslookup',
                    'settings', 'tags', 'user_private_quest_messages', 'hubs', 'library',
                    'quest', 'Holons', '/federate'
                ];
                if (systemEntries.includes(trimmed)) return false;
                
                // Skip shopping items and other path-like entries
                if (trimmed.includes('/')) return false;
                
                // Skip very long hex-like strings that are clearly internal IDs (more than 15 chars)
                if (trimmed.length > 15 && /^[0-9a-f]+$/i.test(trimmed)) return false;

                // Skip specific hex patterns but be more specific
                if (trimmed.match(/^8[0-9a-f]{15,}$/i)) return false;
                
                console.log(`Checking holon ID: "${trimmed}" - keeping it`);
                return true; // Keep everything else for now
            });
            
            console.log(`Found ${validHolonIds.length} valid holons after filtering:`, validHolonIds);
            
            // Phase 1: Quickly create basic holon entries and display them
            console.log(`Creating basic entries for ${validHolonIds.length} holons...`);
            
            // Clear loading state and create basic entries
            isLoading = false;
            
            // Create basic holon entries immediately
            const basicHolons = validHolonIds.map(holonId => ({
                id: holonId,
                name: holonId, // Will be updated with real name later
                users: 0,
                activeUsers: 0,
                totalTasks: 0,
                completedTasks: 0,
                openTasks: 0,
                shoppingItems: 0,
                offers: 0,
                needs: 0,
                checklists: 0,
                completedChecklists: 0,
                announcements: 0,
                expenses: 0,
                federationCount: 0,
                inboundConnections: [],
                outboundConnections: [],
                purpose: "",
                lastActivity: 0,
                status: "unknown" as const,
                isLoading: true // Flag to show this is being updated
            }));
            
            // Display basic entries immediately
            holons = basicHolons;
            console.log(`Displayed ${holons.length} basic holon entries`);
            
            // Phase 2: Fetch all holon names at once
            console.log(`Fetching names for all ${validHolonIds.length} holons...`);
            
            // Fetch all names in parallel
            const namePromises = validHolonIds.map(async (holonId) => {
                try {
                    const settingsResult = await holosphere.get(holonId, "settings", holonId);
                    const settings = settingsResult;
                    const holonName = settings?.name || holonId;
                    return { holonId, name: holonName };
                } catch (error) {
                    console.warn(`Failed to fetch name for holon ${holonId}:`, error);
                    return { holonId, name: holonId }; // Fallback to ID
                }
            });
            
            // Wait for all names to be fetched
            const nameResults = await Promise.all(namePromises);
            
            // Update all holons with their names at once
            holons = holons.map(holon => {
                const nameResult = nameResults.find(result => result.holonId === holon.id);
                return {
                    ...holon,
                    name: nameResult?.name || holon.id,
                    isLoading: false,
                    updatedAt: Date.now()
                };
            });
            
            console.log(`Updated all ${holons.length} holons with names`);
            
            // Phase 3: Compute stats asynchronously in the background
            console.log(`Starting async stats computation for ${validHolonIds.length} holons...`);
            
            // Start stats computation without blocking the UI
            computeStatsAsync(validHolonIds);
            
        } catch (error) {
            console.error('Error fetching all holons:', error);
        } finally {
            isLoading = false;
        }
    }

    // Simple function to fetch just the holon name
    async function getHolonName(holonId: string): Promise<string> {
        try {
            const settingsResult = await holosphere.get(holonId, "settings", holonId);
            return settingsResult?.name || holonId;
        } catch (error) {
            console.warn(`Failed to fetch name for holon ${holonId}:`, error);
            return holonId; // Fallback to ID
        }
    }

    // Async function to compute stats in the background
    async function computeStatsAsync(holonIds: string[]) {
        console.log(`Starting parallel stats computation for ${holonIds.length} holons`);
        
        // Process all holons in parallel with concurrency limit
        const concurrencyLimit = 10; // Process 10 holons simultaneously
        let processedCount = 0;
        let completedCount = 0;
        
        // Create all promises but limit concurrency
        const allPromises = holonIds.map(async (holonId, index) => {
            // Add a small delay based on index to stagger requests
            await new Promise(resolve => setTimeout(resolve, (index % concurrencyLimit) * 100));
            
            try {
                // Add timeout to prevent hanging
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), 8000)
                );
                
                const statsPromise = (async () => {
                    // Fetch stats using holosphere API
                    const stats = await getStatsDirectly(holonId);
                    return { holonId, stats };
                })();
                
                // Race between stats computation and timeout
                const result = await Promise.race([statsPromise, timeoutPromise]) as {
                    holonId: string;
                    stats: {
                        userCount: number;
                        actualTasks: number;
                        completedTasks: number;
                        openTasks: number;
                        shoppingCount: number;
                        offersCount: number;
                        needs: number;
                        inboundCount: number;
                        outboundCount: number;
                        federationCount: number;
                    };
                };

                // Update holon with computed stats - force reactivity
                const updatedHolons = holons.map(holon =>
                    holon.id === result.holonId
                        ? {
                            ...holon,
                            users: result.stats.userCount,
                            totalTasks: result.stats.actualTasks,
                            completedTasks: result.stats.completedTasks,
                            openTasks: result.stats.openTasks,
                            shoppingItems: result.stats.shoppingCount,
                            offers: result.stats.offersCount,
                            needs: result.stats.needs,
                            federationCount: result.stats.federationCount,
                            inboundConnections: [], // Will be populated with actual IDs if needed
                            outboundConnections: [], // Will be populated with actual IDs if needed
                            updatedAt: Date.now()
                        }
                        : holon
                );
                holons = [...updatedHolons]; // Force new array reference
                statsComputed = new Set([...statsComputed, result.holonId]); // Force new Set reference
                
                completedCount++;
                console.log(`✓ Updated stats for ${result.holonId}: ${result.stats.userCount} users, ${result.stats.actualTasks} tasks, ${result.stats.shoppingCount} shopping, ${result.stats.offersCount} offers (${completedCount}/${holonIds.length})`);
                
                return result;
                
            } catch (error) {
                console.warn(`✗ Failed to compute stats for holon ${holonId}:`, error);
                completedCount++;
                
                // Still mark as computed to avoid infinite retries
                statsComputed = new Set([...statsComputed, holonId]);
                return { holonId, error: (error as Error).message };
            }
        });
        
        // Wait for all promises to complete
        const results = await Promise.allSettled(allPromises);
        
        // Log summary
        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        
        console.log(`Completed parallel stats computation: ${successful} successful, ${failed} failed out of ${holonIds.length} total`);
    }

    // Direct holosphere access for faster stats computation
    async function getStatsDirectly(holonId: string) {
        return new Promise<{
            userCount: number;
            actualTasks: number;
            completedTasks: number;
            openTasks: number;
            shoppingCount: number;
            offersCount: number;
            needs: number;
            inboundCount: number;
            outboundCount: number;
            federationCount: number;
        }>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Direct stats fetch timeout'));
            }, 8000); // Increased timeout for more reliable data

            try {
                // Try HoloSphere getAll first for accurate data
                const tryHoloSphereGetAll = async () => {
                    try {
                        const [users, quests, shopping, offers, federation] = await Promise.allSettled([
                            holosphere.getAll(holonId, "users"),
                            holosphere.getAll(holonId, "quests"),
                            holosphere.getAll(holonId, "shopping"),
                            holosphere.getAll(holonId, "offers"),
                            holosphere.getFederation(holonId)
                        ]);

                        const userCount = ensureArray(users.status === 'fulfilled' ? users.value : null).length;
                        const questsArray = ensureArray(quests.status === 'fulfilled' ? quests.value : null);
                        const shoppingCount = ensureArray(shopping.status === 'fulfilled' ? shopping.value : null).length;
                        const offersCount = ensureArray(offers.status === 'fulfilled' ? offers.value : null).length;

                        // Process quests safely
                        const actualTasks = questsArray.filter((item: any) => item && (!item.type || item.type === "task"));
                        const completedTasks = actualTasks.filter((task: any) => task && task.status === "completed").length;
                        const openTasks = actualTasks.filter((task: any) => task && task.status !== "completed").length;
                        const needs = questsArray.filter((item: any) => item && (item.type === "need" || item.type === "want")).length;

                        // Process federation data
                        const federationData = federation.status === 'fulfilled' ? federation.value : null;
                        const inboundCount = federationData?.inbound?.length || 0;
                        const outboundCount = federationData?.outbound?.length || 0;
                        const federationCount = inboundCount + outboundCount;

                        return {
                            userCount,
                            actualTasks: actualTasks.length,
                            completedTasks,
                            openTasks,
                            shoppingCount,
                            offersCount,
                            needs,
                            inboundCount,
                            outboundCount,
                            federationCount
                        };
                    } catch (error) {
                        throw new Error('HoloSphere getAll failed, falling back to direct access');
                    }
                };
                
                // Use HoloSphere API to get stats
                tryHoloSphereGetAll()
                    .then(stats => {
                        clearTimeout(timeout);
                        resolve(stats);
                    })
                    .catch((error) => {
                        // If HoloSphere fails, return empty stats
                        console.warn('Failed to fetch holon stats:', error);
                        clearTimeout(timeout);
                        resolve({
                            userCount: 0,
                            actualTasks: 0,
                            completedTasks: 0,
                            openTasks: 0,
                            shoppingCount: 0,
                            offersCount: 0,
                            needs: 0,
                            inboundCount: 0,
                            outboundCount: 0,
                            federationCount: 0
                        });
                    });

        } catch (error) {
                clearTimeout(timeout);
                reject(error);
        }
        });
    }

    async function navigateToHolon(holonId: string) {
        // Navigate to the holon
        dispatch('navigate', { holonId });

        // Also update the ID store
        ID.set(holonId);

        // Track this click and visit (with or without wallet)
        const walletAddr = getWalletAddress();
        try {
            const holonName = await fetchHolonName(holosphere, holonId);

            // Dispatch event with the holon name so TopBar can use it immediately
            if (browser && holonName) {
                window.dispatchEvent(new CustomEvent('holonNavigated', {
                    detail: { holonId, holonName }
                }));
            }

            // Track as clicked holon (from global view)
            addClickedHolon(walletAddr, holonId, holonName, 'global');

            // Also track as visited holon
            addVisitedHolon(walletAddr, holonId, holonName, 'global');

            console.log(`Tracked holon click from global view: ${holonId}`);
        } catch (err) {
            console.warn('Failed to track holon click:', err);
        }

        // Navigate to the dashboard using SvelteKit's goto
        goto(`/${holonId}/dashboard`);
    }



    function handleSort(field: string) {
        if (sortBy === field) {
            sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            sortBy = field;
            sortDirection = 'asc';
        }
    }

    async function refreshData() {
        refreshing = true;
        await fetchAllHolons();
        refreshing = false;
    }

    function formatDate(timestamp: number) {
        if (!timestamp) return "Never";
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) return "Today";
        if (diffDays === 1) return "Yesterday";
        if (diffDays < 7) return `${diffDays} days ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
        if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
        return `${Math.floor(diffDays / 365)} years ago`;
    }

    function getStatusColor(status: string) {
        switch (status) {
            case 'active': return 'text-green-400';
            case 'inactive': return 'text-yellow-400';
            default: return 'text-gray-400';
        }
    }

    function getStatusIcon(status: string) {
        switch (status) {
            case 'active': return '🟢';
            case 'inactive': return '🟡';
            default: return '⚪';
        }
    }
</script>

{#if isLoading && !connectionReady}
<div class="flex items-center justify-center min-h-screen">
    <div class="text-center">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
        <p class="text-gray-400">Connecting to holosphere...</p>
    </div>
</div>
{:else}
<div class="space-y-6">
    <!-- Header -->
    <div class="bg-gradient-to-r from-gray-800 to-gray-700 py-6 px-8 rounded-3xl shadow-2xl">
        <div class="flex flex-col md:flex-row justify-between items-center">
            <div class="text-center md:text-left mb-4 md:mb-0">
                <h1 class="text-4xl font-bold text-white mb-2">Global Holons Network</h1>
                <p class="text-gray-300 text-lg">Discover and explore all holons in the network</p>
            </div>
            <div class="flex items-center space-x-4">
                <button 
                    on:click={refreshData}
                    disabled={refreshing}
                    class="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white px-4 py-2 rounded-lg transition-colors flex items-center space-x-2"
                >
                    <i class="fas fa-sync-alt {refreshing ? 'animate-spin' : ''}"></i>
                    <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
                </button>
                <div class="text-white text-right">
                    <p class="text-2xl font-bold">{holons.length}</p>
                    <p class="text-sm text-gray-300">Total Holons</p>
                        {#if statsComputed.size > 0 && statsComputed.size < holons.length}
                            <p class="text-xs text-blue-400">Stats: {statsComputed.size}/{holons.length}</p>
                            <div class="w-16 h-1 bg-gray-600 rounded-full mt-1">
                                <div class="h-1 bg-blue-500 rounded-full" style="width: {(statsComputed.size / holons.length) * 100}%"></div>
                            </div>
                        {:else if statsComputed.size === holons.length && holons.length > 0}
                            <p class="text-xs text-green-400">✓ All stats computed</p>
                        {/if}
                </div>
            </div>
        </div>
    </div>

    <!-- Search and Filters -->
    <div class="bg-gray-800 p-6 rounded-2xl shadow-xl">
        <div class="flex flex-col md:flex-row gap-4">
            <!-- Search -->
            <div class="flex-1">
                <div class="relative">
                    <i class="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
                    <input
                        type="text"
                        bind:value={searchQuery}
                        placeholder="Search holons by name, ID, or purpose..."
                        class="w-full pl-10 pr-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>
            </div>

            <!-- Quick Stats -->
            <div class="flex items-center space-x-6 text-sm">
                <div class="text-center">
                    <div class="text-green-400 font-bold text-lg">{holons.filter(h => h.status === 'active').length}</div>
                    <div class="text-gray-400">Active</div>
                </div>
                <div class="text-center">
                    <div class="text-yellow-400 font-bold text-lg">{holons.filter(h => h.status === 'inactive').length}</div>
                    <div class="text-gray-400">Inactive</div>
                </div>
                <div class="text-center">
                    <div class="text-blue-400 font-bold text-lg">{holons.reduce((sum, h) => sum + h.federationCount, 0)}</div>
                    <div class="text-gray-400">Federations</div>
                </div>
            </div>
        </div>
    </div>

    <!-- Holons Table -->
    <div class="bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
        {#if isLoading && holons.length === 0}
            <div class="p-8 text-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
                <p class="text-gray-400">Loading holons...</p>
            </div>
        {:else if filteredHolons.length === 0}
            <div class="p-8 text-center">
                {#if processingHolons.size > 0}
                    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
                    <p class="text-gray-400">Processing holons...</p>
                    <p class="text-gray-500 text-sm mt-2">Found {processingHolons.size} holons, fetching data...</p>
                {:else}
                <i class="fas fa-search text-4xl text-gray-500 mb-4"></i>
                <p class="text-gray-400 text-lg">No holons found</p>
                <p class="text-gray-500 text-sm mt-2">Try adjusting your search criteria</p>
                {/if}
            </div>
        {:else}
            <div class="overflow-x-auto">
                <table class="w-full">
                    <thead class="bg-gray-700">
                        <tr>
                            <th class="px-6 py-4 text-left">
                                <button 
                                    on:click={() => handleSort('name')}
                                    class="flex items-center space-x-1 text-gray-300 hover:text-white transition-colors"
                                >
                                    <span>Holon</span>
                                    <i class="fas fa-sort text-xs"></i>
                                </button>
                            </th>
                            <th class="px-6 py-4 text-left">
                                <button 
                                    on:click={() => handleSort('status')}
                                    class="flex items-center space-x-1 text-gray-300 hover:text-white transition-colors"
                                >
                                    <span>Status</span>
                                    <i class="fas fa-sort text-xs"></i>
                                </button>
                            </th>
                            <th class="px-6 py-4 text-left">
                                <button 
                                    on:click={() => handleSort('users')}
                                    class="flex items-center space-x-1 text-gray-300 hover:text-white transition-colors"
                                >
                                    <span>Users</span>
                                    <i class="fas fa-sort text-xs"></i>
                                </button>
                            </th>
                            <th class="px-6 py-4 text-left">
                                <button 
                                    on:click={() => handleSort('totalTasks')}
                                    class="flex items-center space-x-1 text-gray-300 hover:text-white transition-colors"
                                >
                                    <span>Tasks</span>
                                    <i class="fas fa-sort text-xs"></i>
                                </button>
                            </th>
                            <th class="px-6 py-4 text-left">
                                <button 
                                    on:click={() => handleSort('shoppingItems')}
                                    class="flex items-center space-x-1 text-gray-300 hover:text-white transition-colors"
                                >
                                    <span>Shopping</span>
                                    <i class="fas fa-sort text-xs"></i>
                                </button>
                            </th>
                            <th class="px-6 py-4 text-left">
                                <button 
                                    on:click={() => handleSort('offers')}
                                    class="flex items-center space-x-1 text-gray-300 hover:text-white transition-colors"
                                >
                                    <span>Offers</span>
                                    <i class="fas fa-sort text-xs"></i>
                                </button>
                            </th>
                            <th class="px-6 py-4 text-left">
                                <button 
                                    on:click={() => handleSort('needs')}
                                    class="flex items-center space-x-1 text-gray-300 hover:text-white transition-colors"
                                >
                                    <span>Needs</span>
                                    <i class="fas fa-sort text-xs"></i>
                                </button>
                            </th>
                            <th class="px-6 py-4 text-left">
                                <button 
                                    on:click={() => handleSort('federationCount')}
                                    class="flex items-center space-x-1 text-gray-300 hover:text-white transition-colors"
                                >
                                    <span>Federation</span>
                                    <i class="fas fa-sort text-xs"></i>
                                </button>
                            </th>
                            <th class="px-6 py-4 text-left">
                                <button 
                                    on:click={() => handleSort('lastActivity')}
                                    class="flex items-center space-x-1 text-gray-300 hover:text-white transition-colors"
                                >
                                    <span>Last Activity</span>
                                    <i class="fas fa-sort text-xs"></i>
                                </button>
                            </th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-700">
                        {#each filteredHolons as holon, index (holon.id)}
                            <tr 
                                class="hover:bg-gray-700 transition-colors"
                                in:fade={{ duration: 200, delay: index * 50 }}
                            >
                                <!-- Holon Name (Clickable) -->
                                <td class="px-6 py-4">
                                    <button
                                        on:click={() => navigateToHolon(holon.id)}
                                        class="text-left group"
                                        title="Navigate to {holon.name}"
                                    >
                                        <div class="font-semibold text-blue-400 group-hover:text-blue-300 transition-colors flex items-center space-x-2">
                                            {holon.name}
                                            {#if statsComputed.has(holon.id)}
                                                <span class="text-xs text-green-400">✓</span>
                                            {:else}
                                                <span class="text-xs text-gray-400">⋯</span>
                                            {/if}
                                        </div>
                                        <div class="text-xs text-gray-500 mt-1">{holon.id}</div>
                                        {#if holon.purpose}
                                            <div class="text-xs text-gray-400 mt-1 italic max-w-xs truncate">
                                                "{holon.purpose}"
                                            </div>
                                        {/if}
                                    </button>
                                </td>

                                <!-- Status -->
                                <td class="px-6 py-4">
                                    <div class="flex items-center space-x-2">
                                        <span class="text-lg">{getStatusIcon(holon.status)}</span>
                                        <span class="{getStatusColor(holon.status)} capitalize font-medium">
                                            {holon.status}
                                        </span>
                                    </div>
                                </td>

                                <!-- Users -->
                                <td class="px-6 py-4">
                                    {#if statsComputed.has(holon.id)}
                                    <div class="text-white font-medium">{holon.users}</div>
                                    {#if holon.activeUsers > 0}
                                        <div class="text-xs text-green-400">{holon.activeUsers} active</div>
                                        {/if}
                                    {:else}
                                        <div class="text-gray-400 text-sm">Computing...</div>
                                    {/if}
                                </td>

                                <!-- Tasks -->
                                <td class="px-6 py-4">
                                    {#if statsComputed.has(holon.id)}
                                    <div class="text-white font-medium">{holon.totalTasks}</div>
                                    <div class="text-xs text-gray-400">
                                        {holon.completedTasks} done, {holon.openTasks} open
                                    </div>
                                    {:else}
                                        <div class="text-gray-400 text-sm">Computing...</div>
                                    {/if}
                                </td>

                                <!-- Shopping -->
                                <td class="px-6 py-4">
                                    {#if statsComputed.has(holon.id)}
                                    <div class="text-white font-medium">{holon.shoppingItems}</div>
                                    <div class="text-xs text-gray-400">items</div>
                                    {:else}
                                        <div class="text-gray-400 text-sm">Computing...</div>
                                    {/if}
                                </td>

                                <!-- Offers -->
                                <td class="px-6 py-4">
                                    {#if statsComputed.has(holon.id)}
                                    <div class="text-white font-medium">{holon.offers}</div>
                                    <div class="text-xs text-gray-400">available</div>
                                    {:else}
                                        <div class="text-gray-400 text-sm">Computing...</div>
                                    {/if}
                                </td>

                                <!-- Needs -->
                                <td class="px-6 py-4">
                                    {#if statsComputed.has(holon.id)}
                                    <div class="text-white font-medium">{holon.needs}</div>
                                    <div class="text-xs text-gray-400">requested</div>
                                    {:else}
                                        <div class="text-gray-400 text-sm">Computing...</div>
                                    {/if}
                                </td>

                                <!-- Federation -->
                                <td class="px-6 py-4">
                                    <div class="text-white font-medium">{holon.federationCount}</div>
                                    <div class="text-xs text-gray-400">
                                        {holon.inboundConnections.length} in, {holon.outboundConnections.length} out
                                    </div>
                                </td>

                                <!-- Last Activity -->
                                <td class="px-6 py-4">
                                    <div class="text-white font-medium">{formatDate(holon.lastActivity)}</div>
                                    {#if holon.lastActivity}
                                        <div class="text-xs text-gray-400">
                                            {new Date(holon.lastActivity).toLocaleDateString()}
                                        </div>
                                    {/if}
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        {/if}
    </div>

    <!-- Summary Stats -->
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <div class="bg-gray-800 p-6 rounded-2xl shadow-xl">
            <div class="flex items-center justify-between">
                <div>
                    <p class="text-3xl font-bold text-white">{holons.reduce((sum, h) => sum + h.users, 0)}</p>
                    <p class="text-gray-400">Total Users</p>
                </div>
                <i class="fas fa-users text-2xl text-blue-400"></i>
            </div>
        </div>

        <div class="bg-gray-800 p-6 rounded-2xl shadow-xl">
            <div class="flex items-center justify-between">
                <div>
                    <p class="text-3xl font-bold text-white">{holons.reduce((sum, h) => sum + h.totalTasks, 0)}</p>
                    <p class="text-gray-400">Total Tasks</p>
                </div>
                <i class="fas fa-tasks text-2xl text-green-400"></i>
            </div>
        </div>

        <div class="bg-gray-800 p-6 rounded-2xl shadow-xl">
            <div class="flex items-center justify-between">
                <div>
                    <p class="text-3xl font-bold text-white">{holons.reduce((sum, h) => sum + h.offers, 0)}</p>
                    <p class="text-gray-400">Total Offers</p>
                </div>
                <i class="fas fa-handshake text-2xl text-yellow-400"></i>
            </div>
        </div>

        <div class="bg-gray-800 p-6 rounded-2xl shadow-xl">
            <div class="flex items-center justify-between">
                <div>
                    <p class="text-3xl font-bold text-white">{holons.reduce((sum, h) => sum + h.federationCount, 0)}</p>
                    <p class="text-gray-400">Federation Links</p>
                </div>
                <i class="fas fa-network-wired text-2xl text-purple-400"></i>
            </div>
        </div>
    </div>
</div>
{/if} 