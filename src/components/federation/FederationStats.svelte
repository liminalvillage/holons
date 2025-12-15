<script lang="ts">
    import { slide } from "svelte/transition";

    export let totalPartners: number = 0;
    export let activeLenses: number = 0;
    export let connectedCount: number = 0;
    export let pendingCount: number = 0;
</script>

{#if totalPartners > 0}
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3" transition:slide>
        <!-- Partners -->
        <div class="bg-gray-800/80 rounded-xl p-4 border border-gray-700/50 flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"></path>
                </svg>
            </div>
            <div>
                <div class="text-xl font-bold text-white">{totalPartners}</div>
                <div class="text-xs text-gray-400">Partners</div>
            </div>
        </div>

        <!-- Active Lenses -->
        <div class="bg-gray-800/80 rounded-xl p-4 border border-gray-700/50 flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <svg class="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                </svg>
            </div>
            <div>
                <div class="text-xl font-bold text-white">{activeLenses}</div>
                <div class="text-xs text-gray-400">Active Lenses</div>
            </div>
        </div>

        <!-- Connected -->
        <div class="bg-gray-800/80 rounded-xl p-4 border border-gray-700/50 flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                <svg class="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
            </div>
            <div>
                <div class="text-xl font-bold text-white">{connectedCount}</div>
                <div class="text-xs text-gray-400">Connected</div>
            </div>
        </div>

        <!-- Pending -->
        <div class="bg-gray-800/80 rounded-xl p-4 border border-gray-700/50 flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <svg class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
            </div>
            <div>
                <div class="text-xl font-bold text-white">{pendingCount}</div>
                <div class="text-xs text-gray-400">Pending</div>
            </div>
        </div>
    </div>
{/if}
