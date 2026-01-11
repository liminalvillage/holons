<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { Star } from 'svelte-feathers';
	import HolonItem from './HolonItem.svelte';

	interface Holon {
		id: string;
		name: string;
		isPinned?: boolean;
		isStarred?: boolean;
		lastVisited?: number;
	}

	export let holons: Holon[] = [];
	export let currentHolonId: string | null = null;
	export let isLoading: boolean = false;
	export let showPinButton: boolean = false;
	export let showStarButton: boolean = false;
	export let starredIds: string[] = [];
	export let homeHolonId: string | null = null;
	export let showHomeSection: boolean = true;

	const dispatch = createEventDispatcher();

	function selectHolon(holonId: string) {
		dispatch('select', { holonId });
	}

	function pinHolon(holonId: string) {
		dispatch('pin', { holonId });
	}

	function starHolon(holonId: string) {
		dispatch('star', { holonId });
	}

	// Filter out home holon from the regular list
	$: otherHolons = homeHolonId ? holons.filter(h => h.id !== homeHolonId) : holons;

	// Separate pinned and unpinned holons (excluding home)
	$: pinnedHolons = otherHolons.filter((h) => h.isPinned);
	$: unpinnedHolons = otherHolons.filter((h) => !h.isPinned);
</script>

<div class="holon-list">
	{#if isLoading}
		<div class="holon-list__loading">
			<div class="holon-list__spinner"></div>
			<span>Loading...</span>
		</div>
	{:else}
		<!-- Home Holon - Always at top, uses HolonItem with key management -->
		{#if showHomeSection && homeHolonId}
			<div class="holon-list__home">
				<HolonItem
					id={homeHolonId}
					name="Home"
					isActive={currentHolonId === homeHolonId}
					isPinned={false}
					isStarred={false}
					isHome={true}
					showPinButton={false}
					showStarButton={false}
					on:select={() => selectHolon(homeHolonId)}
				/>
			</div>
		{/if}

		<!-- Pinned holons -->
		{#if pinnedHolons.length > 0}
			<div class="holon-list__section">
				<span class="holon-list__section-title">
					<Star size={10} />
					Pinned
				</span>
				{#each pinnedHolons as holon (holon.id)}
					<HolonItem
						id={holon.id}
						name={holon.name}
						isActive={holon.id === currentHolonId}
						isPinned={true}
						isStarred={starredIds.includes(holon.id)}
						isHome={false}
						{showPinButton}
						{showStarButton}
						on:select={() => selectHolon(holon.id)}
						on:pin={() => pinHolon(holon.id)}
						on:star={() => starHolon(holon.id)}
					/>
				{/each}
			</div>
		{/if}

		<!-- Unpinned holons -->
		{#if unpinnedHolons.length > 0}
			<div class="holon-list__section">
				{#if pinnedHolons.length > 0}
					<span class="holon-list__section-title">Holons</span>
				{/if}
				{#each unpinnedHolons as holon (holon.id)}
					<HolonItem
						id={holon.id}
						name={holon.name}
						isActive={holon.id === currentHolonId}
						isPinned={false}
						isStarred={starredIds.includes(holon.id)}
						isHome={false}
						{showPinButton}
						{showStarButton}
						on:select={() => selectHolon(holon.id)}
						on:pin={() => pinHolon(holon.id)}
						on:star={() => starHolon(holon.id)}
					/>
				{/each}
			</div>
		{/if}

		<!-- Empty state -->
		{#if holons.length === 0 && !homeHolonId}
			<div class="holon-list__empty">
				<p>No holons yet</p>
				<p class="holon-list__empty-hint">Add a holon with the + button</p>
			</div>
		{:else if otherHolons.length === 0 && homeHolonId}
			<div class="holon-list__empty holon-list__empty--compact">
				<p class="holon-list__empty-hint">Star holons to see them here</p>
			</div>
		{/if}
	{/if}
</div>

<style>
	.holon-list {
		flex: 1;
		overflow-y: auto;
		padding: var(--spacing-1, 0.25rem) 0;
	}

	.holon-list::-webkit-scrollbar {
		width: 4px;
	}

	.holon-list::-webkit-scrollbar-track {
		background: transparent;
	}

	.holon-list::-webkit-scrollbar-thumb {
		background: var(--color-bg-tertiary, #374151);
		border-radius: var(--radius-full, 9999px);
	}

	.holon-list::-webkit-scrollbar-thumb:hover {
		background: var(--color-border-light, #4b5563);
	}

	/* Home section - with divider */
	.holon-list__home {
		padding-bottom: var(--spacing-2, 0.5rem);
		margin-bottom: var(--spacing-1, 0.25rem);
		border-bottom: 1px solid var(--color-border, #374151);
	}

	.holon-list__section {
		margin-bottom: var(--spacing-2, 0.5rem);
	}

	.holon-list__section-title {
		display: flex;
		align-items: center;
		gap: var(--spacing-1, 0.25rem);
		padding: var(--spacing-1, 0.25rem) var(--spacing-4, 1rem);
		font-size: 10px;
		font-weight: var(--font-weight-medium, 500);
		color: var(--color-text-muted, #6b7280);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.holon-list__loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-8, 2rem);
		gap: var(--spacing-3, 0.75rem);
		color: var(--color-text-muted, #6b7280);
		font-size: var(--font-size-sm, 0.875rem);
	}

	.holon-list__spinner {
		width: 20px;
		height: 20px;
		border: 2px solid var(--color-bg-tertiary, #374151);
		border-top-color: var(--color-accent, #4f46e5);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.holon-list__empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-8, 2rem) var(--spacing-4, 1rem);
		text-align: center;
		color: var(--color-text-muted, #6b7280);
	}

	.holon-list__empty p {
		margin: 0;
		font-size: var(--font-size-sm, 0.875rem);
	}

	.holon-list__empty-hint {
		font-size: var(--font-size-xs, 0.75rem);
		margin-top: var(--spacing-1, 0.25rem);
	}

	.holon-list__empty--compact {
		padding: var(--spacing-4, 1rem);
	}
</style>
