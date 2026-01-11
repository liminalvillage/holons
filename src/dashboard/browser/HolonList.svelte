<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { Star, Home } from 'svelte-feathers';
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

	// Separate home holon from others
	$: homeHolon = homeHolonId ? holons.find(h => h.id === homeHolonId) : null;

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
			<span>Loading holons...</span>
		</div>
	{:else if holons.length === 0 && !homeHolonId}
		<div class="holon-list__empty">
			<p>No holons found</p>
			<p class="holon-list__empty-hint">Add a holon to get started</p>
		</div>
	{:else}
		<!-- Home Holon Section - Always visible at top when showHomeSection is true -->
		{#if showHomeSection && homeHolonId}
			<div class="holon-list__home-section">
				<button
					class="holon-list__home-item"
					class:holon-list__home-item--active={currentHolonId === homeHolonId}
					on:click={() => selectHolon(homeHolonId)}
				>
					<div class="holon-list__home-icon" class:holon-list__home-icon--active={currentHolonId === homeHolonId}>
						<Home size={18} />
					</div>
					<div class="holon-list__home-content">
						<span class="holon-list__home-label">Home</span>
						<span class="holon-list__home-sublabel">Your personal space</span>
					</div>
					{#if currentHolonId === homeHolonId}
						<div class="holon-list__home-indicator"></div>
					{/if}
				</button>
			</div>
		{/if}

		{#if pinnedHolons.length > 0}
			<div class="holon-list__section">
				<span class="holon-list__section-title">
					<Star size={12} />
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

		{#if unpinnedHolons.length > 0}
			<div class="holon-list__section">
				{#if pinnedHolons.length > 0 || (showHomeSection && homeHolonId)}
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

		{#if holons.length === 0 && homeHolonId}
			<div class="holon-list__empty holon-list__empty--with-home">
				<p>No other holons yet</p>
				<p class="holon-list__empty-hint">Star or add holons to see them here</p>
			</div>
		{/if}
	{/if}
</div>

<style>
	.holon-list {
		flex: 1;
		overflow-y: auto;
		padding: var(--spacing-2, 0.5rem);
	}

	.holon-list::-webkit-scrollbar {
		width: 6px;
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

	/* Home Section - Anchored at top */
	.holon-list__home-section {
		padding: var(--spacing-2, 0.5rem);
		margin-bottom: var(--spacing-2, 0.5rem);
		border-bottom: 1px solid var(--color-border, #374151);
	}

	.holon-list__home-item {
		display: flex;
		align-items: center;
		gap: var(--spacing-3, 0.75rem);
		width: 100%;
		padding: var(--spacing-3, 0.75rem);
		background: var(--color-bg-secondary, #1f2937);
		border: 1px solid var(--color-border, #374151);
		border-radius: var(--radius-lg, 0.5rem);
		cursor: pointer;
		transition: all 150ms ease;
		text-align: left;
		position: relative;
		overflow: hidden;
	}

	.holon-list__home-item:hover {
		background: var(--color-bg-tertiary, #374151);
		border-color: var(--color-accent, #4f46e5);
	}

	.holon-list__home-item--active {
		background: linear-gradient(135deg, rgba(79, 70, 229, 0.15), rgba(99, 102, 241, 0.1));
		border-color: var(--color-accent, #4f46e5);
		box-shadow: 0 0 0 1px rgba(79, 70, 229, 0.3);
	}

	.holon-list__home-item--active:hover {
		background: linear-gradient(135deg, rgba(79, 70, 229, 0.2), rgba(99, 102, 241, 0.15));
	}

	.holon-list__home-icon {
		width: 40px;
		height: 40px;
		border-radius: var(--radius-md, 0.375rem);
		background: var(--color-accent-subtle, rgba(79, 70, 229, 0.2));
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-accent-light, #818cf8);
		flex-shrink: 0;
		transition: all 150ms ease;
	}

	.holon-list__home-icon--active {
		background: var(--color-accent, #4f46e5);
		color: white;
	}

	.holon-list__home-content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.holon-list__home-label {
		font-size: var(--font-size-base, 1rem);
		font-weight: var(--font-weight-semibold, 600);
		color: var(--color-text-primary, #ffffff);
	}

	.holon-list__home-sublabel {
		font-size: var(--font-size-xs, 0.75rem);
		color: var(--color-text-muted, #6b7280);
	}

	.holon-list__home-indicator {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-accent, #4f46e5);
		box-shadow: 0 0 8px var(--color-accent, #4f46e5);
		animation: pulse 2s infinite;
	}

	@keyframes pulse {
		0%, 100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.7;
			transform: scale(1.1);
		}
	}

	.holon-list__section {
		margin-bottom: var(--spacing-3, 0.75rem);
	}

	.holon-list__section-title {
		display: flex;
		align-items: center;
		gap: var(--spacing-1, 0.25rem);
		padding: var(--spacing-1, 0.25rem) var(--spacing-2, 0.5rem);
		font-size: var(--font-size-xs, 0.75rem);
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
		gap: var(--spacing-3, 0.75rem);
		padding: var(--spacing-8, 2rem);
		color: var(--color-text-muted, #6b7280);
		font-size: var(--font-size-sm, 0.875rem);
	}

	.holon-list__spinner {
		width: 24px;
		height: 24px;
		border: 2px solid var(--color-bg-tertiary, #374151);
		border-top-color: var(--color-accent, #4f46e5);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.holon-list__empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-8, 2rem);
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

	.holon-list__empty--with-home {
		padding: var(--spacing-4, 1rem);
	}
</style>
