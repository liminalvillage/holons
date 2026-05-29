<script lang="ts">
	import { createEventDispatcher, getContext, onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { Globe, ChevronDown, Users, Settings, Bell } from 'svelte-feathers';
	import { goto } from '$app/navigation';
	import { ID } from '../store';
	import { federationNotifications } from '$lib/stores/federationRequests';
	import type { HoloSphere } from 'holosphere';

	const dispatch = createEventDispatcher();
	const holosphere = getContext<HoloSphere>('holosphere');

	// UI State
	let isExpanded: boolean = false;
	let federationInfo: any = null;
	let federatedCount: number = 0;
	let isLoading: boolean = false;

	// Current holon from store
	$: currentHolonId = $ID;
	$: pendingRequests = $federationNotifications;

	// Load collapse state from localStorage
	if (typeof window !== 'undefined') {
		const saved = localStorage.getItem('sidebar_federation_expanded');
		isExpanded = saved === 'true';
	}

	// Load federation data when holon changes
	$: if (currentHolonId && holosphere && isExpanded) {
		loadFederationData();
	}

	function toggleExpanded() {
		isExpanded = !isExpanded;
		if (typeof window !== 'undefined') {
			localStorage.setItem('sidebar_federation_expanded', String(isExpanded));
		}
		if (isExpanded && currentHolonId) {
			loadFederationData();
		}
	}

	async function loadFederationData() {
		if (!holosphere || !currentHolonId) return;

		isLoading = true;
		try {
			// Try to get federation info from holosphere
			const settings = await holosphere.get(currentHolonId, 'settings', currentHolonId);
			if (settings) {
				federationInfo = settings;
				federatedCount = settings.federated?.length || 0;
			}
		} catch (error) {
			console.error('Failed to load federation data:', error);
			federatedCount = 0;
		} finally {
			isLoading = false;
		}
	}

	function goToFederation() {
		if (currentHolonId) {
			goto(`/${currentHolonId}/federation`);
			dispatch('navigate', { path: 'federation' });
		}
	}
</script>

<div class="federation-section">
	<button
		class="federation-section__header"
		on:click={toggleExpanded}
		aria-expanded={isExpanded}
	>
		<div class="federation-section__header-left">
			<Globe size="16" />
			<span>Federation</span>
			{#if pendingRequests > 0}
				<span class="federation-section__badge">{pendingRequests}</span>
			{/if}
		</div>
		<div class="federation-section__header-right">
			{#if federatedCount > 0}
				<span class="federation-section__count">{federatedCount}</span>
			{/if}
			<ChevronDown size="16" class="federation-section__chevron {isExpanded ? 'federation-section__chevron--up' : ''}" />
		</div>
	</button>

	{#if isExpanded}
		<div class="federation-section__content" transition:slide={{ duration: 200 }}>
			{#if !currentHolonId}
				<div class="federation-section__empty">
					<p>Select a holon to view federation</p>
				</div>
			{:else if isLoading}
				<div class="federation-section__loading">
					<i class="fas fa-spinner fa-spin"></i>
					<span>Loading...</span>
				</div>
			{:else}
				<!-- Federation Status -->
				<div class="federation-section__status">
					<div class="federation-section__status-item">
						<Users size="14" />
						<span>{federatedCount} connected holon{federatedCount !== 1 ? 's' : ''}</span>
					</div>
					{#if pendingRequests > 0}
						<div class="federation-section__status-item federation-section__status-item--pending">
							<Bell size="14" />
							<span>{pendingRequests} pending request{pendingRequests !== 1 ? 's' : ''}</span>
						</div>
					{/if}
				</div>

				<!-- Actions -->
				<div class="federation-section__actions">
					<button class="federation-section__action" on:click={goToFederation}>
						<Settings size="14" />
						<span>Manage Federation</span>
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.federation-section {
		border-bottom: 1px solid var(--color-border, var(--color-bg-tertiary));
	}

	.federation-section__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: var(--spacing-3, 0.75rem) var(--spacing-4, 1rem);
		background: transparent;
		border: none;
		color: var(--color-text-secondary, var(--color-text-secondary));
		cursor: pointer;
		transition: background-color 150ms ease;
	}

	.federation-section__header:hover {
		background: var(--color-bg-secondary, var(--color-bg-secondary));
	}

	.federation-section__header-left {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		font-size: var(--font-size-sm, 0.875rem);
		font-weight: var(--font-weight-medium, 500);
	}

	.federation-section__header-right {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
	}

	.federation-section__badge {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		background: #ef4444;
		color: var(--color-text-primary);
		font-size: 0.65rem;
		font-weight: 600;
		border-radius: var(--radius-full, 9999px);
	}

	.federation-section__count {
		font-size: var(--font-size-xs, 0.75rem);
		padding: 2px 8px;
		border-radius: var(--radius-full, 9999px);
		background: var(--color-bg-tertiary, var(--color-bg-tertiary));
		color: var(--color-text-muted, var(--color-text-muted));
	}


	.federation-section__content {
		padding: var(--spacing-3, 0.75rem) var(--spacing-4, 1rem);
		background: var(--color-bg-secondary, var(--color-bg-secondary));
	}

	.federation-section__empty,
	.federation-section__loading {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-2, 0.5rem);
		padding: var(--spacing-4, 1rem);
		color: var(--color-text-muted, var(--color-text-muted));
		font-size: var(--font-size-sm, 0.875rem);
	}

	.federation-section__status {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-2, 0.5rem);
		margin-bottom: var(--spacing-3, 0.75rem);
	}

	.federation-section__status-item {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		font-size: var(--font-size-sm, 0.875rem);
		color: var(--color-text-secondary, var(--color-text-secondary));
	}

	.federation-section__status-item--pending {
		color: #fbbf24;
	}

	.federation-section__actions {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-1, 0.25rem);
	}

	.federation-section__action {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		width: 100%;
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		background: var(--color-bg-primary, var(--color-bg-primary));
		border: none;
		border-radius: var(--radius-md, 0.375rem);
		color: var(--color-text-secondary, var(--color-text-secondary));
		font-size: var(--font-size-sm, 0.875rem);
		cursor: pointer;
		transition: background-color 150ms ease;
		text-align: left;
	}

	.federation-section__action:hover {
		background: var(--color-bg-tertiary, var(--color-bg-tertiary));
	}
</style>
