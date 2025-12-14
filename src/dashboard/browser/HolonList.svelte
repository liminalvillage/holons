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

	// Separate pinned and unpinned holons
	$: pinnedHolons = holons.filter((h) => h.isPinned);
	$: unpinnedHolons = holons.filter((h) => !h.isPinned);
</script>

<div class="holon-list">
	{#if isLoading}
		<div class="holon-list__loading">
			<div class="holon-list__spinner"></div>
			<span>Loading holons...</span>
		</div>
	{:else if holons.length === 0}
		<div class="holon-list__empty">
			<p>No holons found</p>
			<p class="holon-list__empty-hint">Add a holon to get started</p>
		</div>
	{:else}
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
						isHome={holon.id === homeHolonId}
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
				{#if pinnedHolons.length > 0}
					<span class="holon-list__section-title">All</span>
				{/if}
				{#each unpinnedHolons as holon (holon.id)}
					<HolonItem
						id={holon.id}
						name={holon.name}
						isActive={holon.id === currentHolonId}
						isPinned={false}
						isStarred={starredIds.includes(holon.id)}
						isHome={holon.id === homeHolonId}
						{showPinButton}
						{showStarButton}
						on:select={() => selectHolon(holon.id)}
						on:pin={() => pinHolon(holon.id)}
						on:star={() => starHolon(holon.id)}
					/>
				{/each}
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
</style>
