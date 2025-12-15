<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { fly } from "svelte/transition";

    // Types
    interface FederatedHolon {
        id: string;
        name: string;
        pubKey?: string;
        npub?: string;
        status: 'connected' | 'pending' | 'rejected' | 'error';
        lensConfig: {
            inbound: string[];
            outbound: string[];
        };
    }

    // Props
    export let holon: FederatedHolon;
    export let availableLenses: string[] = [];
    export let saving: boolean = false;

    const dispatch = createEventDispatcher<{
        remove: { holonId: string };
        navigate: { holonId: string };
        toggleLens: { holonId: string; lens: string; direction: 'inbound' | 'outbound'; currentlyEnabled: boolean };
        copyNpub: { npub: string };
    }>();

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

    // Get lens icon based on type
    function getLensIcon(lens: string): string {
        const normalizedLens = normalizeLensName(lens);
        const icons: Record<string, string> = {
            'quests': '🎯',
            'offers': '🎁',
            'tags': '🏷️',
            'expenses': '💰',
            'announcements': '📢',
            'users': '👥',
            'shopping': '🛒',
            'recurring': '🔄'
        };
        return icons[normalizedLens] || '📦';
    }

    // Shorten npub for display
    function shortenNpub(npub: string): string {
        if (!npub || npub.length < 20) return npub;
        return `${npub.slice(0, 12)}...${npub.slice(-8)}`;
    }

    function handleNavigate() {
        dispatch('navigate', { holonId: holon.id });
    }

    function handleRemove(e: MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        dispatch('remove', { holonId: holon.id });
    }

    function handleCopyNpub() {
        if (holon.npub) {
            dispatch('copyNpub', { npub: holon.npub });
        }
    }

    function handleToggleLens(lens: string, direction: 'inbound' | 'outbound', currentlyEnabled: boolean) {
        dispatch('toggleLens', { holonId: holon.id, lens, direction, currentlyEnabled });
    }
</script>

<div
    class="group bg-gray-700/30 rounded-xl border border-gray-600/30 hover:border-purple-500/30 transition-all duration-300 hover:shadow-lg hover:shadow-purple-500/5 overflow-hidden"
    in:fly={{ y: 20, duration: 300 }}
    out:fly={{ y: -20, duration: 200 }}
>
    <!-- Card Header with gradient -->
    <div class="bg-gradient-to-r from-gray-700/50 to-gray-800/50 p-4 border-b border-gray-600/30">
        <div class="flex items-center justify-between">
            <div class="flex items-center gap-3 min-w-0 flex-1">
                <!-- Avatar -->
                <div class="relative flex-shrink-0">
                    <div class="w-11 h-11 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-lg">
                        {(holon.name && typeof holon.name === 'string') ? holon.name.charAt(0).toUpperCase() : '?'}
                    </div>
                    <!-- Status indicator -->
                    <div
                        class="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-gray-700"
                        class:bg-green-500={holon.status === 'connected'}
                        class:bg-amber-500={holon.status === 'pending'}
                        class:bg-red-500={holon.status === 'rejected'}
                        class:bg-gray-500={holon.status === 'error'}
                    ></div>
                </div>
                <!-- Info -->
                <div class="min-w-0 flex-1">
                    <button
                        on:click={handleNavigate}
                        class="font-semibold text-white truncate hover:text-purple-400 transition-colors text-left block w-full text-sm"
                        title="Navigate to {holon.name || holon.id}"
                    >
                        {holon.name || holon.id}
                    </button>
                    {#if holon.npub}
                        <button
                            class="text-xs text-gray-400 font-mono hover:text-purple-400 transition-colors flex items-center gap-1 mt-0.5"
                            title="Copy npub"
                            on:click|stopPropagation={handleCopyNpub}
                        >
                            {shortenNpub(holon.npub)}
                            <svg class="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                            </svg>
                        </button>
                    {/if}
                </div>
            </div>
            <!-- Delete button -->
            <button
                on:click={handleRemove}
                class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 transition-all p-1.5 rounded-lg hover:bg-red-500/10"
                title="Remove Federation"
                aria-label="Remove federation with {holon.name || holon.id}"
                disabled={saving}
            >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                </svg>
            </button>
        </div>
    </div>

    <!-- Lens Configuration - Compact Grid -->
    <div class="p-4">
        <div class="flex items-center justify-between mb-3">
            <span class="text-xs font-medium text-gray-400 uppercase tracking-wider">Data Sharing</span>
            <div class="flex items-center gap-3 text-xs text-gray-500">
                <span class="flex items-center gap-1">
                    <svg class="w-3 h-3 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path>
                    </svg>
                    In
                </span>
                <span class="flex items-center gap-1">
                    <svg class="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18"></path>
                    </svg>
                    Out
                </span>
            </div>
        </div>

        {#if availableLenses.length > 0}
            <div class="grid grid-cols-2 gap-2">
                {#each availableLenses.slice(0, 6) as lens}
                    {@const isInbound = isLensInArray(lens, holon.lensConfig.inbound)}
                    {@const isOutbound = isLensInArray(lens, holon.lensConfig.outbound)}
                    <div class="bg-gray-600/20 rounded-lg p-2 flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2 min-w-0">
                            <span class="text-sm">{getLensIcon(lens)}</span>
                            <span class="text-xs text-gray-300 capitalize truncate">{lens}</span>
                        </div>
                        <div class="flex items-center gap-1.5 flex-shrink-0">
                            <!-- Inbound toggle -->
                            <button
                                class="w-5 h-5 rounded flex items-center justify-center transition-all {isInbound ? 'bg-blue-500 text-white' : 'bg-gray-600/50 text-gray-500 hover:bg-gray-600'}"
                                disabled={saving}
                                title={isInbound ? 'Receiving data' : 'Not receiving'}
                                on:click={() => handleToggleLens(lens, 'inbound', isInbound)}
                            >
                                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path>
                                </svg>
                            </button>
                            <!-- Outbound toggle -->
                            <button
                                class="w-5 h-5 rounded flex items-center justify-center transition-all {isOutbound ? 'bg-green-500 text-white' : 'bg-gray-600/50 text-gray-500 hover:bg-gray-600'}"
                                disabled={saving}
                                title={isOutbound ? 'Sharing data' : 'Not sharing'}
                                on:click={() => handleToggleLens(lens, 'outbound', isOutbound)}
                            >
                                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                {/each}
            </div>
            {#if availableLenses.length > 6}
                <p class="text-xs text-gray-500 text-center mt-2">+{availableLenses.length - 6} more lenses</p>
            {/if}
        {:else}
            <div class="text-center py-4 text-gray-500 text-xs">
                No lenses configured
            </div>
        {/if}
    </div>
</div>
