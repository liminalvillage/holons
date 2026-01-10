<script lang="ts">
    import { fade } from "svelte/transition";
    import { getFederationService } from "../services/FederationService";
    import { isHologram, isResolvedHologram } from "../types/federation";

    /**
     * HologramBadge - Visual indicator for federated (hologram) items
     *
     * Shows a small badge indicating that an item is a hologram from another holon.
     * Displays source holon name on hover.
     *
     * @prop item - The data item to check for hologram status
     * @prop size - Badge size: 'sm' | 'md' | 'lg'
     * @prop showLabel - Whether to show text label (default: false)
     * @prop class - Additional CSS classes
     */

    // Props
    export let item: unknown;
    export let size: 'sm' | 'md' | 'lg' = 'sm';
    export let showLabel: boolean = false;
    let className: string = '';
    export { className as class };

    // State
    let showTooltip = false;

    // Computed
    $: isItemHologram = isHologram(item) || isResolvedHologram(item);

    $: sourceInfo = (() => {
        if (isHologram(item)) {
            return {
                holonId: item.target.holonId,
                pubKey: item.target.authorPubKey
            };
        }
        if (isResolvedHologram(item)) {
            const info = item._hologram;
            return {
                holonId: info.sourceHolon,
                pubKey: info.sourcePubKey
            };
        }
        return null;
    })();

    $: sourceName = (() => {
        if (!sourceInfo) return '';
        const federation = getFederationService();
        if (federation) {
            return federation.getPartnerName(sourceInfo.holonId);
        }
        // Fallback: truncate pubkey
        const id = sourceInfo.holonId;
        return `${id.slice(0, 6)}...${id.slice(-4)}`;
    })();

    // Size classes
    const sizeClasses = {
        sm: 'w-4 h-4 text-xs',
        md: 'w-5 h-5 text-sm',
        lg: 'w-6 h-6 text-base'
    };
</script>

{#if isItemHologram}
    <span
        class="hologram-badge inline-flex items-center gap-1 {sizeClasses[size]} {className}"
        role="img"
        aria-label="Federated item from {sourceName}"
        on:mouseenter={() => showTooltip = true}
        on:mouseleave={() => showTooltip = false}
    >
        <!-- Hologram icon (connected circles) -->
        <svg
            class="hologram-icon {sizeClasses[size]}"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <!-- Two overlapping circles representing federation -->
            <circle cx="9" cy="12" r="5" class="text-purple-400" />
            <circle cx="15" cy="12" r="5" class="text-blue-400" />
            <!-- Connection line -->
            <line x1="9" y1="12" x2="15" y2="12" class="text-purple-300" stroke-dasharray="2,1" />
        </svg>

        {#if showLabel}
            <span class="hologram-label text-purple-300 text-xs">
                from {sourceName}
            </span>
        {/if}

        <!-- Tooltip -->
        {#if showTooltip && !showLabel}
            <div
                class="hologram-tooltip absolute z-50 px-2 py-1 text-xs bg-gray-800 text-white rounded shadow-lg whitespace-nowrap -mt-8 left-1/2 -translate-x-1/2"
                transition:fade={{ duration: 150 }}
            >
                From: {sourceName}
                <div class="absolute w-2 h-2 bg-gray-800 transform rotate-45 left-1/2 -translate-x-1/2 -bottom-1"></div>
            </div>
        {/if}
    </span>
{/if}

<style>
    .hologram-badge {
        position: relative;
        cursor: help;
    }

    .hologram-icon {
        color: #a78bfa; /* purple-400 */
        opacity: 0.9;
        transition: opacity 0.15s ease;
    }

    .hologram-badge:hover .hologram-icon {
        opacity: 1;
    }

    .hologram-icon circle:first-child {
        stroke: #a78bfa; /* purple-400 */
        fill: rgba(167, 139, 250, 0.1);
    }

    .hologram-icon circle:last-of-type {
        stroke: #60a5fa; /* blue-400 */
        fill: rgba(96, 165, 250, 0.1);
    }

    .hologram-tooltip {
        pointer-events: none;
    }
</style>
