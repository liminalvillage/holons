<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { slide, fly } from "svelte/transition";
    import { Copy, Check, ChevronDown, Trash2, ExternalLink } from "svelte-feathers";

    // Types
    interface FederatedHolon {
        id: string;
        name: string;
        pubKey?: string;
        status: 'connected' | 'pending' | 'rejected' | 'error';
        lenses: string[];
    }

    // Props
    export let holon: FederatedHolon;
    export let availableLenses: string[] = [];
    export let saving: boolean = false;
    export let expanded: boolean = false;

    const dispatch = createEventDispatcher<{
        remove: { holonId: string };
        navigate: { holonId: string };
        toggleLens: { holonId: string; lens: string; currentlyEnabled: boolean };
    }>();

    // Local state
    let copied = false;

    // Normalize lens name for comparison
    function normalizeLensName(name: string): string {
        return name.toLowerCase();
    }

    function isLensEnabled(lens: string): boolean {
        if (!holon.lenses || !Array.isArray(holon.lenses)) return false;
        return holon.lenses.some(l => normalizeLensName(l) === normalizeLensName(lens));
    }

    function getLensIcon(lens: string): string {
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
        return icons[normalizeLensName(lens)] || '📦';
    }

    function shortenPubKey(pubKey: string): string {
        if (!pubKey || pubKey.length < 16) return pubKey;
        return `${pubKey.slice(0, 8)}...${pubKey.slice(-6)}`;
    }

    function toggleExpanded() {
        expanded = !expanded;
    }

    function handleNavigate(e: MouseEvent) {
        e.stopPropagation();
        dispatch('navigate', { holonId: holon.id });
    }

    function handleRemove(e: MouseEvent) {
        e.stopPropagation();
        if (confirm(`Remove federation with ${holon.name}?`)) {
            dispatch('remove', { holonId: holon.id });
        }
    }

    async function handleCopyPubKey(e: MouseEvent) {
        e.stopPropagation();
        if (holon.pubKey) {
            await navigator.clipboard.writeText(holon.pubKey);
            copied = true;
            setTimeout(() => copied = false, 2000);
        }
    }

    function handleToggleLens(lens: string) {
        const currentlyEnabled = isLensEnabled(lens);
        dispatch('toggleLens', { holonId: holon.id, lens, currentlyEnabled });
    }

    // Count active lenses
    $: lensCount = holon.lenses?.length || 0;
</script>

<div
    class="holon-card"
    class:holon-card--expanded={expanded}
    class:holon-card--connected={holon.status === 'connected'}
    class:holon-card--pending={holon.status === 'pending'}
    in:fly={{ y: 10, duration: 200 }}
>
    <!-- Header - Always visible, clickable to expand -->
    <button class="holon-card__header" on:click={toggleExpanded}>
        <!-- Avatar with status -->
        <div class="holon-card__avatar">
            <span class="holon-card__avatar-letter">
                {holon.name?.charAt(0)?.toUpperCase() || '?'}
            </span>
            <span class="holon-card__status" class:connected={holon.status === 'connected'} class:pending={holon.status === 'pending'}></span>
        </div>

        <!-- Info -->
        <div class="holon-card__info">
            <span class="holon-card__name">{holon.name || holon.id}</span>
            {#if holon.pubKey}
                <span class="holon-card__npub">{shortenPubKey(holon.pubKey)}</span>
            {/if}
        </div>

        <!-- Quick stats -->
        <div class="holon-card__stats">
            {#if lensCount > 0}
                <span class="holon-card__stat">
                    {lensCount} {lensCount === 1 ? 'lens' : 'lenses'}
                </span>
            {:else}
                <span class="holon-card__stat holon-card__stat--empty">No lenses</span>
            {/if}
        </div>

        <!-- Expand indicator -->
        <div class="holon-card__expand" class:holon-card__expand--rotated={expanded}>
            <ChevronDown size="18" />
        </div>
    </button>

    <!-- Expanded content -->
    {#if expanded}
        <div class="holon-card__content" transition:slide={{ duration: 200 }}>
            <!-- Actions bar -->
            <div class="holon-card__actions">
                <button class="holon-card__action" on:click={handleCopyPubKey} title="Copy Public Key">
                    {#if copied}
                        <Check size="14" />
                        <span>Copied</span>
                    {:else}
                        <Copy size="14" />
                        <span>Copy ID</span>
                    {/if}
                </button>
                <button class="holon-card__action" on:click={handleNavigate} title="Open holon">
                    <ExternalLink size="14" />
                    <span>Open</span>
                </button>
                <button class="holon-card__action holon-card__action--danger" on:click={handleRemove} disabled={saving} title="Remove federation">
                    <Trash2 size="14" />
                    <span>Remove</span>
                </button>
            </div>

            <!-- Lens configuration -->
            <div class="holon-card__lenses">
                <div class="holon-card__lenses-header">
                    <span class="holon-card__lenses-title">Shared Lenses</span>
                </div>

                <div class="holon-card__lens-grid">
                    {#each availableLenses as lens}
                        {@const enabled = isLensEnabled(lens)}
                        <div class="holon-card__lens" class:holon-card__lens--active={enabled}>
                            <div class="holon-card__lens-info">
                                <span class="holon-card__lens-icon">{getLensIcon(lens)}</span>
                                <span class="holon-card__lens-name">{lens}</span>
                            </div>
                            <button
                                class="holon-card__lens-toggle"
                                class:holon-card__lens-toggle--active={enabled}
                                disabled={saving}
                                title="{enabled ? 'Remove' : 'Add'} {lens}"
                                on:click={() => handleToggleLens(lens)}
                            >
                                {enabled ? '✓' : '+'}
                            </button>
                        </div>
                    {/each}
                </div>
            </div>
        </div>
    {/if}
</div>

<style>
    .holon-card {
        background: var(--color-bg-secondary, #1f2937);
        border: 1px solid var(--color-border, #374151);
        border-radius: var(--radius-lg, 0.5rem);
        overflow: hidden;
        transition: all 200ms ease;
    }

    .holon-card:hover {
        border-color: var(--color-accent-subtle, rgba(99, 102, 241, 0.3));
    }

    .holon-card--expanded {
        border-color: var(--color-accent, #4f46e5);
        box-shadow: 0 0 0 1px var(--color-accent-subtle, rgba(99, 102, 241, 0.2));
    }

    .holon-card__header {
        display: flex;
        align-items: center;
        gap: var(--spacing-3, 0.75rem);
        padding: var(--spacing-3, 0.75rem) var(--spacing-4, 1rem);
        width: 100%;
        background: transparent;
        border: none;
        cursor: pointer;
        text-align: left;
        transition: background-color 150ms ease;
    }

    .holon-card__header:hover {
        background: var(--color-bg-tertiary, rgba(55, 65, 81, 0.5));
    }

    .holon-card__avatar {
        position: relative;
        width: 40px;
        height: 40px;
        border-radius: var(--radius-md, 0.375rem);
        background: linear-gradient(135deg, var(--color-accent, #4f46e5), #6366f1);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .holon-card__avatar-letter {
        font-size: var(--font-size-lg, 1.125rem);
        font-weight: var(--font-weight-bold, 700);
        color: white;
    }

    .holon-card__status {
        position: absolute;
        bottom: -2px;
        right: -2px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #6b7280;
        border: 2px solid var(--color-bg-secondary, #1f2937);
    }

    .holon-card__status.connected {
        background: #22c55e;
    }

    .holon-card__status.pending {
        background: #f59e0b;
    }

    .holon-card__info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .holon-card__name {
        font-size: var(--font-size-sm, 0.875rem);
        font-weight: var(--font-weight-semibold, 600);
        color: var(--color-text-primary, #ffffff);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .holon-card__npub {
        font-size: 10px;
        font-family: monospace;
        color: var(--color-text-muted, #6b7280);
    }

    .holon-card__stats {
        display: flex;
        align-items: center;
        gap: var(--spacing-2, 0.5rem);
    }

    .holon-card__stat {
        display: flex;
        align-items: center;
        gap: 2px;
        font-size: 11px;
        color: var(--color-text-secondary, #d1d5db);
        font-weight: var(--font-weight-medium, 500);
    }

    .holon-card__stat--empty {
        color: var(--color-text-muted, #6b7280);
        font-style: italic;
    }

    .holon-card__expand {
        color: var(--color-text-muted, #6b7280);
        transition: transform 200ms ease;
    }

    .holon-card__expand--rotated {
        transform: rotate(180deg);
    }

    /* Expanded content */
    .holon-card__content {
        border-top: 1px solid var(--color-border, #374151);
    }

    .holon-card__actions {
        display: flex;
        gap: var(--spacing-2, 0.5rem);
        padding: var(--spacing-3, 0.75rem) var(--spacing-4, 1rem);
        background: var(--color-bg-primary, #111827);
    }

    .holon-card__action {
        display: flex;
        align-items: center;
        gap: var(--spacing-1, 0.25rem);
        padding: var(--spacing-1, 0.25rem) var(--spacing-2, 0.5rem);
        background: var(--color-bg-tertiary, #374151);
        border: none;
        border-radius: var(--radius-sm, 0.25rem);
        color: var(--color-text-secondary, #d1d5db);
        font-size: 11px;
        cursor: pointer;
        transition: all 150ms ease;
    }

    .holon-card__action:hover {
        background: var(--color-bg-secondary, #1f2937);
        color: var(--color-text-primary, #ffffff);
    }

    .holon-card__action--danger:hover {
        background: rgba(239, 68, 68, 0.2);
        color: #ef4444;
    }

    .holon-card__action:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    /* Lenses section */
    .holon-card__lenses {
        padding: var(--spacing-3, 0.75rem) var(--spacing-4, 1rem);
    }

    .holon-card__lenses-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--spacing-3, 0.75rem);
    }

    .holon-card__lenses-title {
        font-size: 10px;
        font-weight: var(--font-weight-semibold, 600);
        color: var(--color-text-muted, #6b7280);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .holon-card__lens-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: var(--spacing-2, 0.5rem);
    }

    @media (min-width: 640px) {
        .holon-card__lens-grid {
            grid-template-columns: repeat(4, 1fr);
        }
    }

    .holon-card__lens {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-2, 0.5rem);
        background: var(--color-bg-primary, #111827);
        border-radius: var(--radius-md, 0.375rem);
        border: 1px solid transparent;
        transition: all 150ms ease;
    }

    .holon-card__lens--active {
        border-color: var(--color-accent-subtle, rgba(99, 102, 241, 0.3));
        background: rgba(99, 102, 241, 0.05);
    }

    .holon-card__lens-info {
        display: flex;
        align-items: center;
        gap: var(--spacing-2, 0.5rem);
        min-width: 0;
    }

    .holon-card__lens-icon {
        font-size: 14px;
    }

    .holon-card__lens-name {
        font-size: 11px;
        color: var(--color-text-secondary, #d1d5db);
        text-transform: capitalize;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .holon-card__lens-toggle {
        width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        border-radius: var(--radius-sm, 0.25rem);
        background: var(--color-bg-tertiary, #374151);
        color: var(--color-text-muted, #6b7280);
        font-size: 11px;
        font-weight: bold;
        cursor: pointer;
        transition: all 150ms ease;
    }

    .holon-card__lens-toggle:hover:not(:disabled) {
        background: var(--color-bg-secondary, #1f2937);
    }

    .holon-card__lens-toggle--active {
        background: var(--color-accent, #4f46e5);
        color: white;
    }

    .holon-card__lens-toggle:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
</style>
