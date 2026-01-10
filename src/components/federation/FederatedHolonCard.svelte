<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { fly } from "svelte/transition";
    import { getLensIcon, shortenPubKey } from "../../lib/federation/lensUtils";
    import type { FederationPartner } from "../../types/federation";

    // Props
    export let holon: FederationPartner;
    export let availableLenses: string[] = [];
    export let saving: boolean = false;

    const dispatch = createEventDispatcher<{
        remove: { holonId: string };
        navigate: { holonId: string };
        toggleLens: { holonId: string; lens: string; direction: 'inbound' | 'outbound'; currentlyEnabled: boolean };
        copyPubKey: { pubKey: string };
        sendRequest: { holonId: string };
    }>();

    // Expand/collapse state
    let showAllOutbound = false;
    let showAllInbound = false;

    $: isDraft = holon.status === 'draft';
    $: isConnected = holon.status === 'connected';

    // Get lenses for each section
    $: outboundLenses = holon.lensConfig?.outbound || [];
    $: inboundLenses = holon.lensConfig?.inbound || [];

    // For draft: show all available lenses to toggle
    // For connected: show only configured lenses, but allow adding more for outbound
    $: displayOutboundLenses = isDraft ? availableLenses : availableLenses;
    $: displayInboundLenses = isDraft ? availableLenses : inboundLenses;

    function handleNavigate() {
        dispatch('navigate', { holonId: holon.id });
    }

    function handleRemove(e: MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        dispatch('remove', { holonId: holon.id });
    }

    function handleCopyPubKey() {
        if (holon.pubKey) {
            dispatch('copyPubKey', { pubKey: holon.pubKey });
        }
    }

    function handleToggleLens(lens: string, direction: 'inbound' | 'outbound', currentlyEnabled: boolean) {
        // For connected partners, inbound is read-only
        if (isConnected && direction === 'inbound') return;
        dispatch('toggleLens', { holonId: holon.id, lens, direction, currentlyEnabled });
    }

    function handleSendRequest(e: MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        dispatch('sendRequest', { holonId: holon.id });
    }

    function isLensEnabled(lens: string, direction: 'inbound' | 'outbound'): boolean {
        const config = direction === 'inbound' ? inboundLenses : outboundLenses;
        return config.includes(lens);
    }
</script>

<div
    class="group bg-gray-700/30 rounded-xl transition-all duration-300 hover:shadow-lg hover:shadow-purple-500/5 overflow-hidden {isDraft ? 'border-2 border-dashed border-amber-500/50 hover:border-amber-400' : 'border border-gray-600/30 hover:border-purple-500/30'}"
    in:fly={{ y: 20, duration: 300 }}
    out:fly={{ y: -20, duration: 200 }}
>
    <!-- Card Header -->
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
                        class:bg-amber-500={holon.status === 'pending' || holon.status === 'draft'}
                        class:bg-red-500={holon.status === 'rejected'}
                        class:bg-gray-500={holon.status === 'error'}
                    ></div>
                </div>
                <!-- Info -->
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                        <button
                            on:click={handleNavigate}
                            class="font-semibold text-white truncate hover:text-purple-400 transition-colors text-left text-sm"
                            title="Navigate to {holon.name || holon.id}"
                        >
                            {holon.name || shortenPubKey(holon.pubKey || holon.id)}
                        </button>
                        {#if isDraft}
                            <span class="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">Draft</span>
                        {/if}
                    </div>
                    {#if holon.pubKey}
                        <button
                            class="text-xs text-gray-400 font-mono hover:text-purple-400 transition-colors flex items-center gap-1 mt-0.5"
                            title="Copy public key"
                            on:click|stopPropagation={handleCopyPubKey}
                        >
                            {shortenPubKey(holon.pubKey)}
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

    <!-- Data Sharing Configuration -->
    <div class="p-4 space-y-4">

        <!-- YOU SHARE (Outbound) - Always interactive -->
        <div>
            <div class="flex items-center gap-2 mb-2">
                <svg class="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18"></path>
                </svg>
                <span class="text-xs font-semibold text-green-400 uppercase tracking-wider">
                    {isDraft ? 'I will share' : 'You share'}
                </span>
                <span class="text-xs text-gray-500">({outboundLenses.length} lenses)</span>
            </div>

            <div class="flex flex-wrap gap-1.5">
                {#each (showAllOutbound ? displayOutboundLenses : displayOutboundLenses.slice(0, 6)) as lens}
                    {@const enabled = isLensEnabled(lens, 'outbound')}
                    <button
                        type="button"
                        class="px-2.5 py-1 rounded-lg text-xs transition-all flex items-center gap-1.5 {enabled ? 'bg-green-600/30 text-green-300 border border-green-500/50' : 'bg-gray-600/30 text-gray-400 border border-gray-600/50 hover:border-gray-500'}"
                        disabled={saving}
                        on:click={() => handleToggleLens(lens, 'outbound', enabled)}
                        title={enabled ? `Stop sharing ${lens}` : `Share ${lens}`}
                    >
                        <span>{getLensIcon(lens)}</span>
                        <span class="capitalize">{lens}</span>
                        {#if enabled}
                            <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
                            </svg>
                        {/if}
                    </button>
                {/each}
            </div>

            {#if displayOutboundLenses.length > 6}
                <button
                    type="button"
                    class="text-xs text-gray-400 hover:text-green-400 mt-2 flex items-center gap-1"
                    on:click={() => showAllOutbound = !showAllOutbound}
                >
                    {showAllOutbound ? 'Show less' : `+${displayOutboundLenses.length - 6} more`}
                    <svg class="w-3 h-3 transition-transform" class:rotate-180={showAllOutbound} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                    </svg>
                </button>
            {/if}
        </div>

        <!-- Divider -->
        <div class="border-t border-gray-600/30"></div>

        <!-- THEY SHARE (Inbound) - Interactive for draft, read-only for connected -->
        <div>
            <div class="flex items-center gap-2 mb-2">
                <svg class="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path>
                </svg>
                <span class="text-xs font-semibold text-blue-400 uppercase tracking-wider">
                    {#if isDraft}
                        I'd like to receive
                    {:else}
                        They share with you
                    {/if}
                </span>
                {#if isDraft}
                    <span class="text-xs text-gray-500">(request)</span>
                {:else}
                    <span class="text-xs text-gray-500">({inboundLenses.length} lenses)</span>
                {/if}
            </div>

            {#if isDraft}
                <!-- Draft: Interactive toggles for what you'd like to receive -->
                <div class="flex flex-wrap gap-1.5">
                    {#each (showAllInbound ? displayInboundLenses : displayInboundLenses.slice(0, 6)) as lens}
                        {@const enabled = isLensEnabled(lens, 'inbound')}
                        <button
                            type="button"
                            class="px-2.5 py-1 rounded-lg text-xs transition-all flex items-center gap-1.5 {enabled ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50' : 'bg-gray-600/30 text-gray-400 border border-gray-600/50 hover:border-gray-500'}"
                            disabled={saving}
                            on:click={() => handleToggleLens(lens, 'inbound', enabled)}
                            title={enabled ? `Don't request ${lens}` : `Request ${lens}`}
                        >
                            <span>{getLensIcon(lens)}</span>
                            <span class="capitalize">{lens}</span>
                            {#if enabled}
                                <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
                                </svg>
                            {/if}
                        </button>
                    {/each}
                </div>

                {#if displayInboundLenses.length > 6}
                    <button
                        type="button"
                        class="text-xs text-gray-400 hover:text-blue-400 mt-2 flex items-center gap-1"
                        on:click={() => showAllInbound = !showAllInbound}
                    >
                        {showAllInbound ? 'Show less' : `+${displayInboundLenses.length - 6} more`}
                        <svg class="w-3 h-3 transition-transform" class:rotate-180={showAllInbound} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                        </svg>
                    </button>
                {/if}

                <p class="text-xs text-gray-500 mt-2 italic">
                    These are requests. The partner decides what to share.
                </p>
            {:else}
                <!-- Connected: Read-only display of what they've granted -->
                {#if inboundLenses.length > 0}
                    <div class="flex flex-wrap gap-1.5">
                        {#each inboundLenses as lens}
                            <div class="px-2.5 py-1 rounded-lg text-xs bg-blue-600/20 text-blue-300 border border-blue-500/30 flex items-center gap-1.5">
                                <span>{getLensIcon(lens)}</span>
                                <span class="capitalize">{lens}</span>
                            </div>
                        {/each}
                    </div>
                {:else}
                    <p class="text-xs text-gray-500 italic">
                        They haven't shared any data with you yet.
                    </p>
                {/if}
            {/if}
        </div>

        <!-- Establish Link Button (Draft only) -->
        {#if isDraft}
            <div class="pt-2">
                <button
                    on:click={handleSendRequest}
                    disabled={saving || outboundLenses.length === 0}
                    class="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed text-white py-2.5 px-4 rounded-lg transition-all flex items-center justify-center gap-2 text-sm font-medium shadow-lg shadow-green-500/20 disabled:shadow-none"
                >
                    {#if saving}
                        <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"/>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                    {:else}
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path>
                        </svg>
                    {/if}
                    Establish Link
                </button>
                {#if outboundLenses.length === 0}
                    <p class="text-xs text-amber-400 text-center mt-2">
                        Select at least one lens to share before linking
                    </p>
                {/if}
            </div>
        {/if}
    </div>
</div>
