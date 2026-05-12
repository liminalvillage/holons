<script lang="ts">
    import { createEventDispatcher, onMount, getContext } from "svelte";
    import { fade, slide } from "svelte/transition";
    import type { HoloSphere } from "holosphere";
    import { nameMap, resolvedName, resolvedInitials } from '$lib/stores/nameResolver';
    import DisplayName from './shared/DisplayName.svelte';
    import { REAAggregator, ZERO_USER_AGGREGATES, type UserAggregates } from "@holons/core/scoring";
    import { getEventStore } from "../lib/rea/eventStore";

    export let userId: string;
    export let holonId: string;
    export let userData: UserInfo | null = null;

    interface UserInfo {
        id: string;
        version: string;
        username: string;
        first_name: string;
        last_name?: string;
        participated: Record<string, any>;
        actions: any[];
        initiated: any[];
        received: number;
        sent: number;
        wants: string[];
        offers: string[];
        needs: string[];
        values: string[];
        appreciated: any[];
        completed: any[];
        collaboration: any[];
        hours: number;
        voice: number;
    }

    const dispatch = createEventDispatcher();
    const holosphere = getContext("holosphere") as HoloSphere;
    
    let user: UserInfo | null = null;
    let loading = true;
    let activeTab = 'overview';
    let selectedActionType = 'all';
    let aggregates: UserAggregates = { ...ZERO_USER_AGGREGATES };

    onMount(async () => {
        if (userData) {
            user = userData;
            loading = false;
        } else {
            await loadUserData();
        }
        // Name resolution is now automatic via resolvedName()
        await loadAggregates();
    });

    async function loadUserData() {
        if (!holosphere || !holonId || !userId) {
            loading = false;
            return;
        }
        
        try {
            const userData = await holosphere.get(holonId, "users", userId);
            if (userData) {
                user = userData as UserInfo;
            }
        } catch (error) {
            console.error("Error loading user data:", error);
        } finally {
            loading = false;
        }
    }

    async function loadAggregates() {
        if (!holosphere || !holonId || !userId) return;
        try {
            const aggregator = new REAAggregator(getEventStore(holosphere));
            aggregates = await aggregator.getUserAggregates(String(holonId), String(userId));
        } catch (error) {
            console.error("[User.svelte] Error loading REA aggregates:", error);
        }
    }

    function closeModal() {
        dispatch('close');
    }

    function handleClickOutside(event: MouseEvent) {
        if (event.target === event.currentTarget) {
            closeModal();
        }
    }

    function formatDate(timestamp: number) {
        return new Date(timestamp).toLocaleDateString();
    }


    $: stats = user ? [
        { label: 'Tasks Initiated', value: aggregates.initiated, color: 'text-blue-400' },
        { label: 'Tasks Completed', value: aggregates.completed, color: 'text-green-400' },
        { label: 'Appreciation Sent', value: aggregates.sent, color: 'text-purple-400' },
        { label: 'Appreciation Received', value: aggregates.received, color: 'text-orange-400' },
        { label: 'Hours Contributed', value: aggregates.hours, color: 'text-yellow-400' },
        { label: 'Collaboration Score', value: aggregates.collaboration, color: 'text-pink-400' }
    ] : [];

    // Get unique action types from user data
    $: actionTypes = user?.actions ? ['all', ...new Set(user.actions.map(action => action.type || 'Unknown').filter(Boolean))] : ['all'];

    // Filter actions based on selected type
    $: filteredActions = user?.actions ? 
        selectedActionType === 'all' 
            ? user.actions 
            : user.actions.filter(action => (action.type || 'Unknown') === selectedActionType)
        : [];
</script>

<!-- Modal Backdrop -->
<div 
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
    on:click={handleClickOutside}
    on:keydown={(e) => e.key === 'Escape' && closeModal()}
    role="presentation"
    transition:fade={{ duration: 200 }}
>
    <!-- Modal Content -->
    <div 
        class="bg-gray-800 rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl"
        transition:slide={{ duration: 300 }}
    >
        {#if loading}
            <div class="flex items-center justify-center py-20 text-gray-400">
                <svg class="animate-spin h-8 w-8 mr-3" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"/>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                </svg>
                <span>Loading user data...</span>
            </div>
        {:else if user}
            <!-- Header -->
            <div class="bg-gradient-to-r from-gray-700 to-gray-600 px-8 py-6">
                <div class="flex items-center justify-between">
                    <div class="flex items-center space-x-4">
                        <img
                            src={`https://telegram.holons.io/getavatar?user_id=${user.id}`}
                            alt={resolvedName(user.id, $nameMap, user)}
                            class="w-16 h-16 rounded-full object-cover border-2 border-gray-300"
                            on:error={(e) => {
                                // Fallback to initials if image fails to load
                                e.currentTarget.style.display = 'none';
                                e.currentTarget.nextElementSibling.style.display = 'flex';
                            }}
                        />
                        <div class="w-16 h-16 rounded-full bg-gray-500 flex items-center justify-center text-white text-xl font-bold" style="display: none;">
                            {resolvedInitials(user.id, $nameMap, user)}
                        </div>
                        <div>
                            <h1 class="text-3xl font-bold text-white">
                                <DisplayName id={user.id} {user} />
                            </h1>
                            <p class="text-gray-400 text-sm">{user.id?.length === 64 ? `${user.id.slice(0, 12)}...` : user.id}</p>
                        </div>
                    </div>
                    <button 
                        on:click={closeModal}
                        class="text-gray-400 hover:text-white transition-colors p-2"
                        aria-label="Close modal"
                    >
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>
            </div>

            <!-- Navigation Tabs -->
            <div class="border-b border-gray-700">
                <nav class="flex px-8">
                    <button 
                        class="px-6 py-4 text-sm font-medium transition-colors {activeTab === 'overview' ? 'text-white border-b-2 border-blue-500' : 'text-gray-400 hover:text-white'}"
                        on:click={() => activeTab = 'overview'}
                    >
                        Overview
                    </button>
                    <button 
                        class="px-6 py-4 text-sm font-medium transition-colors {activeTab === 'activity' ? 'text-white border-b-2 border-blue-500' : 'text-gray-400 hover:text-white'}"
                        on:click={() => activeTab = 'activity'}
                    >
                        Activity
                    </button>
                    <button 
                        class="px-6 py-4 text-sm font-medium transition-colors {activeTab === 'social' ? 'text-white border-b-2 border-blue-500' : 'text-gray-400 hover:text-white'}"
                        on:click={() => activeTab = 'social'}
                    >
                        Social
                    </button>
                </nav>
            </div>

            <!-- Content -->
            <div class="overflow-y-auto max-h-[60vh] p-8">
                {#if activeTab === 'overview'}
                    <!-- Stats Grid -->
                    <div class="grid grid-cols-2 md:grid-cols-3 gap-6 mb-8">
                        {#each stats as stat}
                            <div class="bg-gray-700 rounded-xl p-6 text-center">
                                <div class="text-3xl font-bold {stat.color} mb-2">
                                    {stat.value}
                                </div>
                                <div class="text-gray-300 text-sm">
                                    {stat.label}
                                </div>
                            </div>
                        {/each}
                    </div>

                    <!-- Quick Info -->
                    <div class="grid md:grid-cols-2 gap-6">
                        <!-- Personal Values -->
                        {#if user.values && user.values.length > 0}
                            <div class="bg-gray-700 rounded-xl p-6">
                                <h3 class="text-xl font-semibold text-white mb-4">Values</h3>
                                <div class="flex flex-wrap gap-2">
                                    {#each user.values as value}
                                        <span class="bg-blue-600 text-white px-3 py-1 rounded-full text-sm">
                                            {value}
                                        </span>
                                    {/each}
                                </div>
                            </div>
                        {/if}

                        <!-- Voice / governance signals -->
                        <div class="bg-gray-700 rounded-xl p-6">
                            <h3 class="text-xl font-semibold text-white mb-4">Voice</h3>
                            <div class="space-y-3">
                                <div class="flex justify-between items-center">
                                    <span class="text-gray-300">Voice Credits</span>
                                    <span class="text-blue-400 font-semibold">{user.voice || 0}</span>
                                </div>
                                <p class="text-xs text-gray-500">Currency balances live in the Status table — see the score breakdown there.</p>
                            </div>
                        </div>
                    </div>
                {:else if activeTab === 'activity'}
                    <div class="space-y-6">
                        <!-- Recent Actions -->
                        {#if user.actions && user.actions.length > 0}
                            <div class="bg-gray-700 rounded-xl p-6">
                                <div class="flex justify-between items-center mb-4">
                                    <h3 class="text-xl font-semibold text-white">Recent Actions</h3>
                                    <select 
                                        bind:value={selectedActionType}
                                        class="bg-gray-600 text-white px-3 py-1 rounded-lg text-sm border border-gray-500 focus:border-blue-500 focus:outline-none"
                                    >
                                        {#each actionTypes as actionType}
                                            <option value={actionType}>
                                                {actionType === 'all' ? 'All Types' : actionType}
                                            </option>
                                        {/each}
                                    </select>
                                </div>
                                <div class="space-y-3 max-h-64 overflow-y-auto">
                                    {#each filteredActions.slice(0, 20) as action}
                                        <div class="flex items-center justify-between py-2 border-b border-gray-600 last:border-0">
                                            <div>
                                                <span class="text-white font-medium">{action.type || 'Unknown'}</span>
                                                {#if action.action}
                                                    <span class="text-gray-300 ml-2">- {action.action}</span>
                                                {/if}
                                            </div>
                                            {#if action.timestamp}
                                                <span class="text-gray-400 text-sm">
                                                    {formatDate(action.timestamp)}
                                                </span>
                                            {/if}
                                        </div>
                                    {/each}
                                    {#if filteredActions.length === 0}
                                        <div class="text-gray-400 text-center py-4">
                                            No actions of this type found
                                        </div>
                                    {/if}
                                </div>
                                <div class="mt-3 text-xs text-gray-400 text-center">
                                    Showing {Math.min(filteredActions.length, 20)} of {filteredActions.length} actions
                                </div>
                            </div>
                        {/if}

                        <!-- Initiated Tasks -->
                        {#if user.initiated && user.initiated.length > 0}
                            <div class="bg-gray-700 rounded-xl p-6">
                                <h3 class="text-xl font-semibold text-white mb-4">Initiated Tasks</h3>
                                <div class="space-y-2 max-h-48 overflow-y-auto">
                                    {#each user.initiated as task}
                                        <div class="bg-gray-600 rounded-lg p-3">
                                            <span class="text-white">{task}</span>
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        {/if}

                        <!-- Completed Tasks -->
                        {#if user.completed && user.completed.length > 0}
                            <div class="bg-gray-700 rounded-xl p-6">
                                <h3 class="text-xl font-semibold text-white mb-4">Completed Tasks</h3>
                                <div class="space-y-2 max-h-48 overflow-y-auto">
                                    {#each user.completed as task}
                                        <div class="bg-green-900 bg-opacity-50 rounded-lg p-3">
                                            <span class="text-green-300">{task}</span>
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        {/if}
                    </div>
                {:else if activeTab === 'social'}
                    <div class="space-y-6">
                        <!-- Wants & Offers -->
                        <div class="grid md:grid-cols-2 gap-6">
                            {#if user.wants && user.wants.length > 0}
                                <div class="bg-gray-700 rounded-xl p-6">
                                    <h3 class="text-xl font-semibold text-white mb-4">Wants</h3>
                                    <div class="space-y-2">
                                        {#each user.wants as want}
                                            <div class="bg-red-900 bg-opacity-30 rounded-lg p-3">
                                                <span class="text-red-300">{want}</span>
                                            </div>
                                        {/each}
                                    </div>
                                </div>
                            {/if}

                            {#if user.offers && user.offers.length > 0}
                                <div class="bg-gray-700 rounded-xl p-6">
                                    <h3 class="text-xl font-semibold text-white mb-4">Offers</h3>
                                    <div class="space-y-2">
                                        {#each user.offers as offer}
                                            <div class="bg-green-900 bg-opacity-30 rounded-lg p-3">
                                                <span class="text-green-300">{offer}</span>
                                            </div>
                                        {/each}
                                    </div>
                                </div>
                            {/if}
                        </div>

                        <!-- Needs & Collaboration -->
                        <div class="grid md:grid-cols-2 gap-6">
                            {#if user.needs && user.needs.length > 0}
                                <div class="bg-gray-700 rounded-xl p-6">
                                    <h3 class="text-xl font-semibold text-white mb-4">Needs</h3>
                                    <div class="space-y-2">
                                        {#each user.needs as need}
                                            <div class="bg-orange-900 bg-opacity-30 rounded-lg p-3">
                                                <span class="text-orange-300">{need}</span>
                                            </div>
                                        {/each}
                                    </div>
                                </div>
                            {/if}

                            {#if user.appreciated && user.appreciated.length > 0}
                                <div class="bg-gray-700 rounded-xl p-6">
                                    <h3 class="text-xl font-semibold text-white mb-4">Appreciated</h3>
                                    <div class="space-y-2 max-h-48 overflow-y-auto">
                                        {#each user.appreciated as item}
                                            <div class="bg-pink-900 bg-opacity-30 rounded-lg p-3">
                                                <span class="text-pink-300">{typeof item === 'string' ? item : JSON.stringify(item)}</span>
                                            </div>
                                        {/each}
                                    </div>
                                </div>
                            {/if}
                        </div>

                        <!-- Participation -->
                        {#if user.participated && Object.keys(user.participated).length > 0}
                            <div class="bg-gray-700 rounded-xl p-6">
                                <h3 class="text-xl font-semibold text-white mb-4">Participation</h3>
                                <div class="space-y-2 max-h-48 overflow-y-auto">
                                    {#each Object.entries(user.participated) as [key, value]}
                                        <div class="flex justify-between items-center py-2 border-b border-gray-600 last:border-0">
                                            <span class="text-white">{key}</span>
                                            <span class="text-gray-300">{typeof value === 'object' ? JSON.stringify(value) : value}</span>
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        {/if}
                    </div>
                {/if}
            </div>
        {:else}
            <div class="flex items-center justify-center py-20 text-gray-400">
                <p>User not found</p>
            </div>
        {/if}
    </div>
</div>

<style>
    /* Custom scrollbar for better appearance */
    .overflow-y-auto::-webkit-scrollbar {
        width: 6px;
    }
    
    .overflow-y-auto::-webkit-scrollbar-track {
        background: #374151;
        border-radius: 3px;
    }
    
    .overflow-y-auto::-webkit-scrollbar-thumb {
        background: #6B7280;
        border-radius: 3px;
    }
    
    .overflow-y-auto::-webkit-scrollbar-thumb:hover {
        background: #9CA3AF;
    }
</style>
