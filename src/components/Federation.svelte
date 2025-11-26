<script lang="ts">
    import { createEventDispatcher, onMount, onDestroy, getContext } from "svelte";
    import { fade, slide, fly } from "svelte/transition";
    import { flip } from "svelte/animate";
    import { goto } from "$app/navigation";
    import type { HoloSphere } from "holosphere";
    import { ID, walletAddress } from "../dashboard/store";
    import { fetchHolonName } from "../utils/holonNames";
    import { addVisitedHolon } from "../utils/localStorage";

    const dispatch = createEventDispatcher();
    const holosphere = getContext("holosphere") as HoloSphere;

    // Default small set of commonly federated lenses
    const DEFAULT_AVAILABLE_LENSES = ['quests', 'offers', 'announcements'];
    
    // All possible lenses that could be federated
    const ALL_POSSIBLE_LENSES = [
        'quests', 'offers', 'tags', 'expenses', 
        'announcements', 'users', 'shopping', 'recurring'
    ];
    
    // User-configurable available lenses (starts with all possible lenses)
    let availableLenses: string[] = [...ALL_POSSIBLE_LENSES];
    let customLenses: string[] = [];
    let showAddCustomLens = false;
    let newCustomLens = '';
    
    // Helper function to normalize lens names for comparison
    function normalizeLensName(lensName: string): string {
        return lensName.toLowerCase();
    }
    
    // Helper function to check if a lens is in a lens array (case-insensitive)
    function isLensInArray(lens: string, lensArray: string[] | undefined): boolean {
        if (!lensArray || !Array.isArray(lensArray)) return false;
        const normalizedLens = normalizeLensName(lens);
        return lensArray.some(l => normalizeLensName(l) === normalizedLens);
    }

    // Helper function to get canonical lens name (always lowercase)
    function getCanonicalLensName(lensName: string): string {
        return lensName.toLowerCase();
    }

    interface FederationInfo {
        id: string;
        name: string;
        federated: string[];
        inbound: string[];
        outbound: string[];
        lensConfig?: Record<string, {
            inbound: string[];
            outbound: string[];
            timestamp: number;
        }>;
        timestamp: number;
    }

    interface FederatedHolon {
        id: string;
        name: string;
        status: 'connected' | 'pending' | 'error';
        lensConfig: {
            inbound: string[];
            outbound: string[];
        };
    }

    let currentHolonId: string = '';
    let federationInfo: FederationInfo | null = null;
    let federatedHolons: FederatedHolon[] = [];
    let loading = true;
    let saving = false;
    let showAddDialog = false;
    let newHolonId = '';
    let newHolonName = '';
    // Remove modal state and logic
    // Remove: let selectedHolon: FederatedHolon | null = null;
    let error = '';
    let success = '';
    let showNetworkView = false;

    // Subscribe to current holon ID
    let idStoreUnsubscribe: (() => void) | undefined;
    let federationSubscription: any = null;

    onMount(() => {
        idStoreUnsubscribe = ID.subscribe(async (newId) => {
            if (newId !== currentHolonId) {
                // Unsubscribe from previous federation data
                if (federationSubscription) {
                    federationSubscription.unsubscribe();
                    federationSubscription = null;
                }

                currentHolonId = newId || '';
                if (currentHolonId) {
                    await loadFederationData();
                    // Subscribe to federation data changes
                    await subscribeFederationChanges();
                } else {
                    federationInfo = null;
                    federatedHolons = [];
                    loading = false;
                }
            }
        });
    });

    onDestroy(() => {
        if (idStoreUnsubscribe) {
            idStoreUnsubscribe();
        }
        if (federationSubscription) {
            federationSubscription.unsubscribe();
        }
    });

    async function subscribeFederationChanges() {
        if (!holosphere || !currentHolonId) return;

        try {
            // Subscribe to the global federation data for this holon
            // Use subscribeGlobal to subscribe to global table path: appname/federation/holonId
            federationSubscription = await holosphere.subscribeGlobal(
                'federation',
                currentHolonId,
                async (data, itemId) => {
                    console.log('Federation data changed:', data, itemId);
                    // Reload federation data when changes occur
                    await loadFederationData();
                },
                { realtimeOnly: true }
            );
        } catch (err) {
            console.warn('Failed to subscribe to federation changes:', err);
        }
    }

    async function loadFederationData() {
        if (!holosphere || !currentHolonId) return;
        
        loading = true;
        error = '';
        
        try {
            // Get federation info
            federationInfo = await holosphere.getFederation(currentHolonId);
            console.log('Federation info loaded:', federationInfo);
            
            if (federationInfo) {
                // Build federated holons list using a temporary array
                const tempHolons: FederatedHolon[] = [];

                // Process federated list (all federated holons)
                const federatedList = federationInfo.federated || [];

                for (const holonId of federatedList) {
                    const rawLensConfig = federationInfo.lensConfig?.[holonId];
                    const lensConfig = {
                        inbound: Array.isArray(rawLensConfig?.inbound) ? rawLensConfig.inbound : [],
                        outbound: Array.isArray(rawLensConfig?.outbound) ? rawLensConfig.outbound : []
                    };

                    console.log(`Lens config for ${holonId}:`, lensConfig);

                    // Get actual holon name from settings
                    const holonName = await getHolonName(holonId);

                    tempHolons.push({
                        id: holonId,
                        name: holonName,
                        status: 'connected',
                        lensConfig
                    });
                }

                // Assign to trigger reactivity in Svelte 5
                federatedHolons = tempHolons;

                console.log('Final federated holons:', federatedHolons);
            } else {
                federatedHolons = [];
                console.log('No federation info found');
            }
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to load federation data';
            console.error('Federation load error:', err);
        } finally {
            loading = false;
        }
    }

    async function addFederation() {
        if (!newHolonId.trim() || !holosphere || !currentHolonId) return;

        saving = true;
        error = '';

        try {
            // Create federation with default lens config (empty arrays)
            const success = await holosphere.federateHolon(
                currentHolonId,
                newHolonId.trim(),
                {
                    lensConfig: { inbound: [], outbound: [] }
                }
            );

            if (success) {
                showAddDialog = false;
                newHolonId = '';
                newHolonName = '';

                // Wait a bit for GunDB to propagate the changes
                await new Promise(resolve => setTimeout(resolve, 300));

                // Force reload of federation data
                await loadFederationData();
                showSuccess('Federation created successfully');
            } else {
                error = 'Failed to create federation';
            }
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to create federation';
            console.error('Federation creation error:', err);
        } finally {
            saving = false;
        }
    }

    async function removeFederation(holonId: string) {
        console.log('removeFederation called with holonId:', holonId);

        if (!holosphere || !currentHolonId) {
            console.log('Early return: missing holosphere or currentHolonId', { holosphere: !!holosphere, currentHolonId });
            return;
        }

        saving = true;
        error = '';

        try {
            console.log('Calling holosphere.unfederateHolon...', { currentHolonId, holonId });
            const success = await holosphere.unfederateHolon(currentHolonId, holonId);
            console.log('unfederateHolon result:', success);

            if (success) {
                console.log('Federation removed successfully, reloading data...');

                // Wait a bit for GunDB to propagate the changes
                await new Promise(resolve => setTimeout(resolve, 300));

                // Force reload of federation data
                await loadFederationData();
                showSuccess('Federation removed successfully');
            } else {
                console.error('unfederateHolon returned false');
                error = 'Failed to remove federation';
            }
        } catch (err) {
            console.error('Federation removal error:', err);
            error = err instanceof Error ? err.message : 'Failed to remove federation';
        } finally {
            saving = false;
        }
    }

    async function updateLensConfig(holonId: string, inboundLenses: string[], outboundLenses: string[]) {
        if (!holosphere || !currentHolonId) return;

        saving = true;

        try {
            // Re-federate with updated lens config
            const success = await holosphere.federateHolon(
                currentHolonId,
                holonId,
                {
                    lensConfig: { inbound: inboundLenses, outbound: outboundLenses }
                }
            );

            if (success) {
                // Wait a bit for GunDB to propagate the changes
                await new Promise(resolve => setTimeout(resolve, 300));

                // Force reload of federation data
                await loadFederationData();
            }
        } catch (err) {
            console.error('Lens config update error:', err);
        } finally {
            saving = false;
        }
    }

    async function getHolonName(holonId: string): Promise<string> {
        if (!holonId || !holosphere) return 'Unknown';
        
        try {
            // Get settings for this holon
            const settings = await holosphere.get(holonId, 'settings', holonId);
            if (settings && settings.name) {
                return settings.name;
            }
        } catch (error) {
            console.warn(`Could not fetch settings name for holon ${holonId}:`, error);
        }
        
        // Fallback to holon ID
        return holonId;
    }

    function showSuccess(message: string) {
        success = message;
        setTimeout(() => {
            success = '';
        }, 3000);
    }

    function getLensIcon(lens: string): string {
        const normalizedLens = normalizeLensName(lens);
        const icons: Record<string, string> = {
            'quests': '🎯',
            'offers': '🤝',
            'tags': '🏷️',
            'expenses': '💰',
            'announcements': '📢',
            'users': '👥',
            'shopping': '🛒',
            'recurring': '🔄'
        };
        return icons[normalizedLens] || '📦';
    }

    function getStatusColor(status: string): string {
        switch (status) {
            case 'connected': return 'text-green-400';
            case 'pending': return 'text-yellow-400';
            case 'error': return 'text-red-400';
            default: return 'text-gray-400';
        }
    }

    function closeDialog() {
        showAddDialog = false;
        newHolonId = '';
        newHolonName = '';
        error = '';
    }

    function navigateToHolon(holonId: string) {
        ID.set(holonId);
        
        // Track this visit if wallet is connected
        if ($walletAddress) {
            addVisitedHolonToSeparateList(holonId);
        }
        
        goto(`/${holonId}/dashboard`);
    }

    async function addVisitedHolonToSeparateList(holonId: string) {
        if (!$walletAddress) return;
        
        try {
            const holonName = await fetchHolonName(holosphere, holonId);
            
            // Use the centralized function to add visited holon
            addVisitedHolon($walletAddress, holonId, holonName, 'federation');
            
        } catch (err) {
            console.warn('Failed to add visited holon:', err);
        }
    }

    function addCustomLens() {
        const lensName = newCustomLens.trim().toLowerCase();
        if (lensName && !availableLenses.includes(lensName) && !customLenses.includes(lensName)) {
            customLenses = [...customLenses, lensName];
            availableLenses = [...availableLenses, lensName];
            newCustomLens = '';
            showAddCustomLens = false;
        }
    }

    function removeCustomLens(lens: string) {
        customLenses = customLenses.filter(l => l !== lens);
        availableLenses = availableLenses.filter(l => l !== lens);
    }



    $: totalFederations = federatedHolons.length;
    $: activeLenses = federatedHolons.reduce((acc, holon) => {
        if (holon && holon.lensConfig && Array.isArray(holon.lensConfig.inbound)) {
            holon.lensConfig.inbound.forEach(lens => acc.add(lens));
        }
        return acc;
    }, new Set<string>()).size;
</script>

<div class="space-y-8">
    <!-- Header Section -->
    <div class="bg-gradient-to-r from-gray-800 to-gray-700 py-8 px-8 rounded-3xl shadow-2xl">
        <div class="flex flex-col md:flex-row justify-between items-center">
            <div class="text-center md:text-left mb-4 md:mb-0">
                <h1 class="text-4xl font-bold text-white mb-2">Federation Configuration</h1>
                <p class="text-gray-300 text-lg">Manage data sharing between holons</p>
            </div>
            <div class="flex flex-wrap items-center gap-3">
                <button 
                    on:click={() => showNetworkView = !showNetworkView}
                    class="bg-green-600 hover:bg-green-700 px-3 py-2 rounded-lg transition-colors flex items-center space-x-2 text-sm"
                    title="Toggle network view"
                >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zM13 12a1 1 0 11-2 0 1 1 0 012 0zM20 12a1 1 0 11-2 0 1 1 0 012 0z"></path>
                    </svg>
                    <span>{showNetworkView ? 'List View' : 'Network View'}</span>
                </button>
                <button 
                    on:click={() => showAddCustomLens = true}
                    class="bg-purple-600 hover:bg-purple-700 px-3 py-2 rounded-lg transition-colors flex items-center space-x-2 text-sm"
                    title="Add custom lens"
                >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                    </svg>
                    <span>Add Lens</span>
                </button>
                <button 
                    on:click={() => showAddDialog = true}
                    class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors flex items-center space-x-2"
                    disabled={!currentHolonId || saving}
                >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                    </svg>
                    <span>Add Federation</span>
                </button>
            </div>
        </div>
    </div>

    <!-- Main Content Container -->
    <div class="bg-gray-800 rounded-3xl shadow-xl min-h-[600px]">
        <div class="p-8">

            <!-- Status Messages -->
            {#if error}
                <div class="bg-red-900/50 border border-red-700 rounded-lg p-4 mb-6" transition:slide>
                    <div class="flex items-center space-x-2">
                        <svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        <span class="text-red-300">{error}</span>
                    </div>
                </div>
            {/if}

            {#if success}
                <div class="bg-green-900/50 border border-green-700 rounded-lg p-4 mb-6" transition:slide>
                    <div class="flex items-center space-x-2">
                        <svg class="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        <span class="text-green-300">{success}</span>
                    </div>
                </div>
            {/if}

            <!-- Stats Section -->
            {#if !loading && currentHolonId && federatedHolons.length > 0}
                <div class="grid grid-cols-2 gap-4 mb-8">
                    <div class="bg-gray-700/50 rounded-2xl p-4 text-center">
                        <div class="text-2xl font-bold text-white mb-1">{totalFederations}</div>
                        <div class="text-sm text-gray-400">Federations</div>
                    </div>
                    <div class="bg-gray-700/50 rounded-2xl p-4 text-center">
                        <div class="text-2xl font-bold text-white mb-1">{activeLenses}</div>
                        <div class="text-sm text-gray-400">Active Lenses</div>
                    </div>
                </div>
            {/if}

        {#if loading}
            <!-- Loading State -->
            <div class="flex items-center justify-center py-20">
                <div class="text-center">
                    <svg class="animate-spin h-8 w-8 text-blue-400 mx-auto mb-4" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"/>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                    </svg>
                    <p class="text-gray-400">Loading federation data...</p>
                </div>
            </div>
        {:else if !currentHolonId}
            <!-- No Holon Selected -->
            <div class="text-center py-20">
                <svg class="w-16 h-16 text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>
                </svg>
                <h3 class="text-xl font-semibold text-gray-300 mb-2">No Holon Selected</h3>
                <p class="text-gray-500">Please select a holon to configure federation settings.</p>
            </div>
        {:else if federatedHolons.length === 0}
            <!-- Empty State -->
            <div class="text-center py-20">
                <svg class="w-16 h-16 text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path>
                </svg>
                <h3 class="text-xl font-semibold text-gray-300 mb-2">No Federations Configured</h3>
                <p class="text-gray-500 mb-6">Start by creating your first federation to share data with other holons.</p>
                <button 
                    on:click={() => showAddDialog = true}
                    class="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg transition-colors inline-flex items-center space-x-2"
                >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                    </svg>
                    <span>Create Federation</span>
                </button>
            </div>
        {:else}
            {#if !showNetworkView}
                <!-- Federation List -->
                <div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                    {#each federatedHolons as holon (holon.id)}
                        <div 
                            class="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50 hover:border-gray-600/50 transition-all duration-300 hover:shadow-xl hover:bg-gray-800/70 backdrop-blur-sm"
                            animate:flip={{ duration: 300 }}
                            in:fly={{ y: 20, duration: 300 }}
                            out:fly={{ y: -20, duration: 200 }}
                        >
                        <!-- Holon Header -->
                        <div class="flex items-center justify-between mb-6">
                            <div class="flex items-center space-x-3">
                                <div class="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-lg">
                                    {(holon.name && typeof holon.name === 'string') ? holon.name.charAt(0).toUpperCase() : '?'}
                                </div>
                                <div class="flex-1 min-w-0">
                                    <button 
                                        on:click={() => navigateToHolon(holon.id)}
                                        class="font-semibold text-white truncate hover:text-blue-400 transition-colors text-left block w-full"
                                        title="Navigate to {holon.name || holon.id}"
                                    >
                                        {holon.name || holon.id}
                                    </button>
                                    <div class="flex items-center space-x-2 mt-1">
                                        <div class={`w-2 h-2 rounded-full ${getStatusColor(holon.status).replace('text-', 'bg-')} shadow-sm`}></div>
                                        <span class="text-xs text-gray-400 capitalize font-medium">{holon.status}</span>
                                    </div>
                                </div>
                            </div>
                            <div class="flex items-center space-x-1">
                                <button 
                                    on:click={() => { }}
                                    class="text-gray-400 hover:text-blue-400 transition-colors p-2 rounded-lg hover:bg-blue-900/20"
                                    title="Configure Lenses"
                                    aria-label="Configure lenses for {holon.name || holon.id}"
                                >
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                                    </svg>
                                </button>
                                <button 
                                    on:click={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        removeFederation(holon.id);
                                    }}
                                    class="text-gray-400 hover:text-red-400 transition-colors p-2 rounded-lg hover:bg-red-900/20"
                                    title="Remove Federation"
                                    aria-label="Remove federation with {holon.name || holon.id}"
                                    disabled={saving}
                                >
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <!-- Lens Configuration Table -->
                        <div class="mt-4">
                            <h4 class="text-sm font-medium text-gray-300 mb-3 flex items-center">
                                <i class="fas fa-cog mr-2 text-purple-400"></i>
                                Lens Configuration
                            </h4>
                            
                            {#if availableLenses.length > 0}
                                <div class="bg-gray-700/30 rounded-lg border border-gray-600/50 overflow-hidden">
                                    <table class="w-full">
                                        <thead>
                                            <tr class="border-b border-gray-600/50">
                                                <th class="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">
                                                    Lens
                                                </th>
                                                <th class="text-center py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">
                                                    <div class="flex items-center justify-center space-x-1">
                                                        <i class="fas fa-download text-blue-400 text-xs"></i>
                                                        <span>Inbound</span>
                                                    </div>
                                                </th>
                                                <th class="text-center py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">
                                                    <div class="flex items-center justify-center space-x-1">
                                                        <i class="fas fa-upload text-green-400 text-xs"></i>
                                                        <span>Outbound</span>
                                                    </div>
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody class="divide-y divide-gray-600/30">
                                            {#each availableLenses as lens}
                                                {@const isInbound = isLensInArray(lens, holon.lensConfig.inbound)}
                                                {@const isOutbound = isLensInArray(lens, holon.lensConfig.outbound)}
                                                <tr class="hover:bg-gray-700/20 transition-colors">
                                                    <td class="py-3 px-4">
                                                        <div class="flex items-center space-x-2">
                                                            <span class="text-lg">{getLensIcon(lens)}</span>
                                                            <span class="text-sm font-medium text-gray-300 capitalize">{lens}</span>
                                                        </div>
                                                    </td>
                                                    <td class="py-3 px-4 text-center">
                                                        <button
                                                            class="w-6 h-6 flex items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                                                            disabled={saving}
                                                            aria-pressed={isInbound}
                                                            title={isInbound ? 'Remove inbound' : 'Add inbound'}
                                                            on:click={async (e) => {
                                                                e.preventDefault();
                                                                if (saving) return;
                                                                // Toggle inbound
                                                                let newInbound = isInbound
                                                                    ? holon.lensConfig.inbound.filter(l => normalizeLensName(l) !== normalizeLensName(lens))
                                                                    : [...holon.lensConfig.inbound, getCanonicalLensName(lens)];
                                                                await updateLensConfig(
                                                                    holon.id,
                                                                    newInbound,
                                                                    holon.lensConfig.outbound
                                                                );
                                                            }}
                                                        >
                                                            {#if isInbound}
                                                                <div class="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                                                                    <svg class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                                                        <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
                                                                    </svg>
                                                                </div>
                                                            {:else}
                                                                <div class="w-5 h-5 border border-gray-500 rounded-full bg-gray-700/50"></div>
                                                            {/if}
                                                        </button>
                                                    </td>
                                                    <td class="py-3 px-4 text-center">
                                                        <button
                                                            class="w-6 h-6 flex items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-green-500 transition"
                                                            disabled={saving}
                                                            aria-pressed={isOutbound}
                                                            title={isOutbound ? 'Remove outbound' : 'Add outbound'}
                                                            on:click={async (e) => {
                                                                e.preventDefault();
                                                                if (saving) return;
                                                                // Toggle outbound
                                                                let newOutbound = isOutbound
                                                                    ? holon.lensConfig.outbound.filter(l => normalizeLensName(l) !== normalizeLensName(lens))
                                                                    : [...holon.lensConfig.outbound, getCanonicalLensName(lens)];
                                                                await updateLensConfig(
                                                                    holon.id,
                                                                    holon.lensConfig.inbound,
                                                                    newOutbound
                                                                );
                                                            }}
                                                        >
                                                            {#if isOutbound}
                                                                <div class="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                                                                    <svg class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                                                        <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
                                                                    </svg>
                                                                </div>
                                                            {:else}
                                                                <div class="w-5 h-5 border border-gray-500 rounded-full bg-gray-700/50"></div>
                                                            {/if}
                                                        </button>
                                                    </td>
                                                </tr>
                                            {/each}
                                        </tbody>
                                    </table>
                                </div>
                            {:else}
                                <div class="flex items-center justify-center py-6 px-4 bg-gray-700/30 rounded-lg border border-gray-600/50">
                                    <span class="text-xs text-gray-500 flex items-center">
                                        <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                                        </svg>
                                        No lenses available
                                    </span>
                                </div>
                            {/if}
                        </div>


                        </div>
                    {/each}
                </div>
            {:else}
                <!-- Network View -->
                <div class="bg-gray-800 rounded-xl p-6 border border-gray-700">
                    <div class="text-center mb-6">
                        <h3 class="text-lg font-semibold text-white mb-2">Federation Network</h3>
                        <p class="text-gray-400 text-sm">Interactive visualization of holon connections</p>
                    </div>
                    
                    <div class="flex justify-center">
                        <svg width="800" height="600" class="rounded-lg bg-gradient-to-br from-gray-900 to-gray-800 border border-gray-600">
                            <!-- Background Grid -->
                            <defs>
                                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                                    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#374151" stroke-width="0.5" opacity="0.3"/>
                                </pattern>
                                <filter id="glow">
                                    <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                                    <feMerge> 
                                        <feMergeNode in="coloredBlur"/>
                                        <feMergeNode in="SourceGraphic"/>
                                    </feMerge>
                                </filter>
                            </defs>
                            
                            <rect width="100%" height="100%" fill="url(#grid)"/>
                            
                            <!-- Connection Lines -->
                            {#each federatedHolons as holon, index}
                                {@const angle = (index / federatedHolons.length) * 2 * Math.PI - Math.PI/2}
                                {@const radius = 200}
                                {@const x = 400 + Math.cos(angle) * radius}
                                {@const y = 300 + Math.sin(angle) * radius}
                                
                                <!-- Connection Line -->
                                <line 
                                    x1="400" 
                                    y1="300" 
                                    x2={x} 
                                    y2={y} 
                                    stroke={(holon.lensConfig.inbound.length > 0 && holon.lensConfig.outbound.length > 0) ? '#10B981' : '#6B7280'}
                                    stroke-width={(holon.lensConfig.inbound.length > 0 && holon.lensConfig.outbound.length > 0) ? '3' : '2'}
                                    stroke-dasharray={(holon.lensConfig.inbound.length > 0 && holon.lensConfig.outbound.length > 0) ? 'none' : '5,5'}
                                    opacity="0.7"
                                    class="transition-all duration-300"
                                />
                            {/each}
                            
                            <!-- Current Holon (Center) -->
                            <g class="current-holon">
                                <circle 
                                    cx="400" 
                                    cy="300" 
                                    r="40" 
                                    fill="#3B82F6" 
                                    stroke="#60A5FA" 
                                    stroke-width="3"
                                    class="cursor-pointer hover:fill-blue-500 transition-all duration-300"
                                    on:click={() => navigateToHolon(currentHolonId)}
                                    on:keydown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            navigateToHolon(currentHolonId);
                                        }
                                    }}
                                    role="button"
                                    tabindex="0"
                                    aria-label="Navigate to current holon"
                                    style="filter: url(#glow)"
                                />
                                <text 
                                    x="400" 
                                    y="300" 
                                    text-anchor="middle" 
                                    dy="0.35em" 
                                    fill="white" 
                                    font-size="18" 
                                    font-weight="bold"
                                    class="pointer-events-none"
                                >
                                    ⬢
                                </text>
                                <text 
                                    x="400" 
                                    y="350" 
                                    text-anchor="middle" 
                                    fill="white" 
                                    font-size="12" 
                                    font-weight="600"
                                    class="pointer-events-none"
                                >
                                    Current
                                </text>
                            </g>
                            
                            <!-- Federated Holons -->
                            {#each federatedHolons as holon, index}
                                {@const angle = (index / federatedHolons.length) * 2 * Math.PI - Math.PI/2}
                                {@const radius = 200}
                                {@const x = 400 + Math.cos(angle) * radius}
                                {@const y = 300 + Math.sin(angle) * radius}
                                {@const nodeColor = (holon.lensConfig.inbound.length > 0 && holon.lensConfig.outbound.length > 0) ? '#10B981' : '#6B7280'}
                                
                                <g class="federated-holon">
                                    <!-- Main Node -->
                                    <circle 
                                        cx={x} 
                                        cy={y} 
                                        r="30" 
                                        fill={nodeColor}
                                        stroke="white"
                                        stroke-width="2"
                                        class="cursor-pointer hover:r-35 transition-all duration-300"
                                        on:click={() => navigateToHolon(holon.id)}
                                        on:keydown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                navigateToHolon(holon.id);
                                            }
                                        }}
                                        role="button"
                                        tabindex="0"
                                        aria-label="Navigate to {holon.name || holon.id}"
                                        style="filter: url(#glow)"
                                    />
                                    
                                    <!-- Avatar Letter -->
                                    <text 
                                        x={x} 
                                        y={y} 
                                        text-anchor="middle" 
                                        dy="0.35em" 
                                        fill="white" 
                                        font-size="16" 
                                        font-weight="bold"
                                        class="pointer-events-none"
                                    >
                                        {(holon.name && typeof holon.name === 'string') ? holon.name.charAt(0).toUpperCase() : '?'}
                                    </text>
                                    
                                    <!-- Status Indicator -->
                                    <circle 
                                        cx={x + 20} 
                                        cy={y - 20} 
                                        r="6" 
                                        fill={holon.status === 'connected' ? '#10B981' : holon.status === 'pending' ? '#F59E0B' : '#EF4444'}
                                        stroke="white"
                                        stroke-width="2"
                                        class="pointer-events-none"
                                    />
                                    
                                    <!-- Lens Count Badge -->
                                    {#if holon.lensConfig.inbound.length > 0}
                                        <circle
                                            cx={x - 20}
                                            cy={y + 20}
                                            r="8"
                                            fill="#3B82F6"
                                            stroke="white"
                                            stroke-width="1"
                                            class="pointer-events-none"
                                        />
                                        <text
                                            x={x - 20}
                                            y={y + 20}
                                            text-anchor="middle"
                                            dy="0.35em"
                                            fill="white"
                                            font-size="10"
                                            font-weight="bold"
                                            class="pointer-events-none"
                                        >
                                            {holon.lensConfig.inbound.length}
                                        </text>
                                    {/if}
                                </g>
                                
                                <!-- Holon Name Label -->
                                <text 
                                    x={x} 
                                    y={y + 50} 
                                    text-anchor="middle" 
                                    fill="white" 
                                    font-size="11" 
                                    font-weight="500"
                                    class="pointer-events-none"
                                >
                                    {holon.name || holon.id}
                                </text>
                            {/each}
                            
                            <!-- Legend -->
                            <g class="legend" transform="translate(20, 20)">
                                <rect x="0" y="0" width="180" height="120" fill="rgba(0,0,0,0.8)" stroke="#374151" stroke-width="1" rx="8"/>
                                <text x="10" y="20" fill="white" font-size="12" font-weight="bold">Network Legend</text>
                                
                                <circle cx="15" cy="40" r="4" fill="#10B981"/>
                                <text x="25" y="40" dy="0.35em" fill="white" font-size="10">Bidirectional</text>
                                
                                <circle cx="15" cy="60" r="4" fill="#6B7280"/>
                                <text x="25" y="60" dy="0.35em" fill="white" font-size="10">Notify Only</text>
                                
                                <circle cx="15" cy="80" r="4" fill="#10B981"/>
                                <text x="25" y="80" dy="0.35em" fill="white" font-size="10">Connected</text>
                                
                                <circle cx="15" cy="100" r="4" fill="#3B82F6"/>
                                <text x="25" y="100" dy="0.35em" fill="white" font-size="10">Lens Count</text>
                            </g>
                            
                            <!-- Stats -->
                            <g class="stats" transform="translate(600, 20)">
                                <rect x="0" y="0" width="160" height="80" fill="rgba(0,0,0,0.8)" stroke="#374151" stroke-width="1" rx="8"/>
                                <text x="10" y="20" fill="white" font-size="12" font-weight="bold">Network Stats</text>
                                
                                <text x="10" y="40" fill="#60A5FA" font-size="10">Connections:</text>
                                <text x="120" y="40" fill="white" font-size="10" font-weight="bold">{federatedHolons.length}</text>
                                
                                <text x="10" y="60" fill="#10B981" font-size="10">Active Lenses:</text>
                                <text x="120" y="60" fill="white" font-size="10" font-weight="bold">{activeLenses}</text>
                            </g>
                        </svg>
                    </div>
                    
                    {#if federatedHolons.length === 0}
                        <div class="text-center mt-6">
                            <div class="bg-gray-700 rounded-lg p-8 border border-gray-600">
                                <div class="text-6xl mb-4">🌐</div>
                                <h4 class="text-xl font-semibold text-white mb-2">No Network Connections</h4>
                                <p class="text-gray-400">Create your first federation to see the network visualization</p>
                            </div>
                        </div>
                    {/if}
                </div>
            {/if}
        {/if}
        </div>
    </div>
</div>

<!-- Add Federation Dialog -->
{#if showAddDialog}
    <div 
        class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
        on:click={(e) => e.target === e.currentTarget && closeDialog()}
        on:keydown={(e) => {
            if (e.key === 'Escape') {
                closeDialog();
            }
        }}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        transition:fade={{ duration: 200 }}
    >
        <div 
            class="bg-gray-800 rounded-xl p-6 w-full max-w-md"
            transition:fly={{ y: -50, duration: 300 }}
        >
            <div class="flex items-center justify-between mb-6">
                <h2 class="text-xl font-semibold text-white">Add Federation</h2>
                <button 
                    on:click={closeDialog}
                    class="text-gray-400 hover:text-white transition-colors"
                    aria-label="Close dialog"
                >
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>

            <form on:submit|preventDefault={addFederation} class="space-y-4">
                <div>
                    <label for="holonId" class="block text-sm font-medium text-gray-300 mb-2">
                        Holon ID *
                    </label>
                    <input 
                        id="holonId"
                        type="text" 
                        bind:value={newHolonId}
                        placeholder="Enter holon ID..."
                        class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        required
                    />
                </div>

                <div>
                    <label for="holonName" class="block text-sm font-medium text-gray-300 mb-2">
                        Display Name (Optional)
                    </label>
                    <input 
                        id="holonName"
                        type="text" 
                        bind:value={newHolonName}
                        placeholder="Enter display name..."
                        class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>

                <div class="bg-blue-900/30 border border-blue-700 rounded-lg p-3">
                    <div class="flex items-start space-x-2">
                        <svg class="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        <div class="text-sm text-blue-300">
                            <p class="font-medium mb-1">Federation Setup</p>
                            <p>This will create a federation link. You can configure inbound and outbound lens settings after creation.</p>
                        </div>
                    </div>
                </div>

                <div class="flex space-x-3 pt-4">
                    <button 
                        type="button"
                        on:click={closeDialog}
                        class="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 py-2 rounded-lg transition-colors"
                        disabled={saving}
                    >
                        Cancel
                    </button>
                    <button 
                        type="submit"
                        class="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                        disabled={saving || !newHolonId.trim()}
                    >
                        {#if saving}
                            <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"/>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                            </svg>
                        {/if}
                        <span>{saving ? 'Creating...' : 'Create Federation'}</span>
                    </button>
                </div>
            </form>
        </div>
    </div>
{/if}

<!-- Add Custom Lens Dialog -->
{#if showAddCustomLens}
    <div 
        class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
        on:click={(e) => e.target === e.currentTarget && (showAddCustomLens = false)}
        on:keydown={(e) => {
            if (e.key === 'Escape') {
                showAddCustomLens = false;
            }
        }}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        transition:fade={{ duration: 200 }}
    >
        <div 
            class="bg-gray-800 rounded-xl p-6 w-full max-w-sm"
            transition:fly={{ y: -50, duration: 300 }}
        >
            <div class="flex items-center justify-between mb-6">
                <h2 class="text-xl font-semibold text-white">Add Custom Lens</h2>
                <button 
                    on:click={() => showAddCustomLens = false}
                    class="text-gray-400 hover:text-white transition-colors"
                    aria-label="Close custom lens dialog"
                >
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>

            <form on:submit|preventDefault={addCustomLens} class="space-y-4">
                <div>
                    <label for="customLensName" class="block text-sm font-medium text-gray-300 mb-2">
                        Lens Name *
                    </label>
                    <input 
                        id="customLensName"
                        type="text" 
                        bind:value={newCustomLens}
                        placeholder="Enter lens name..."
                        class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        required

                    />
                </div>

                <div class="bg-purple-900/30 border border-purple-700 rounded-lg p-3">
                    <div class="flex items-start space-x-2">
                        <svg class="w-5 h-5 text-purple-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        <div class="text-sm text-purple-300">
                            <p class="font-medium mb-1">Custom Lens</p>
                            <p>Add a custom lens type for federation. Use descriptive names like "Events", "Projects", etc.</p>
                        </div>
                    </div>
                </div>

                {#if customLenses.length > 0}
                    <div>
                        <h3 class="text-sm font-medium text-gray-300 mb-2">Custom Lenses</h3>
                        <div class="space-y-1">
                            {#each customLenses as lens}
                                <div class="flex items-center justify-between p-2 bg-gray-700 rounded text-sm">
                                    <span class="text-gray-300">{lens}</span>
                                    <button 
                                        type="button"
                                        on:click={() => removeCustomLens(lens)}
                                        class="text-red-400 hover:text-red-300 transition-colors"
                                        title="Remove custom lens"
                                        aria-label="Remove custom lens {lens}"
                                    >
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                                        </svg>
                                    </button>
                                </div>
                            {/each}
                        </div>
                    </div>
                {/if}

                <div class="flex space-x-3 pt-4">
                    <button 
                        type="button"
                        on:click={() => showAddCustomLens = false}
                        class="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 py-2 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button 
                        type="submit"
                        class="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={!newCustomLens.trim()}
                    >
                        Add Lens
                    </button>
                </div>
            </form>
        </div>
    </div>
{/if}