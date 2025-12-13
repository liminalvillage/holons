<script lang="ts">
	import { createEventDispatcher, getContext, onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import type { HoloSphere } from 'holosphere';
	import { Search, Plus, X, Star, Users, Clock } from 'svelte-feathers';
	import BrowserHeader from './BrowserHeader.svelte';
	import HolonList from './HolonList.svelte';
	import { ID, sidebarExpanded } from '../store';
	import { loadPersonalHolons, loadVisitedHolons, savePersonalHolons } from '../../utils/localStorage';
	import { fetchHolonName } from '../../utils/holonNames';

	// Props
	export let isOpen: boolean = true;

	const dispatch = createEventDispatcher();
	const holosphere = getContext<HoloSphere>('holosphere');

	// State
	let searchQuery: string = '';
	let activeTab: 'personal' | 'visited' | 'federated' = 'personal';
	let personalHolons: Array<{ id: string; name: string; isPinned?: boolean }> = [];
	let visitedHolons: Array<{ id: string; name: string; lastVisited?: number }> = [];
	let federatedHolons: Array<{ id: string; name: string }> = [];
	let isLoading: boolean = false;

	// Current holon from route
	$: currentHolonId = $ID;

	// Filtered holons based on search
	$: filteredHolons = getFilteredHolons(activeTab, searchQuery);

	function getFilteredHolons(tab: string, query: string) {
		let holons: Array<{ id: string; name: string; isPinned?: boolean; lastVisited?: number }> = [];

		switch (tab) {
			case 'personal':
				holons = personalHolons;
				break;
			case 'visited':
				holons = visitedHolons;
				break;
			case 'federated':
				holons = federatedHolons;
				break;
		}

		if (!query.trim()) return holons;

		const lowerQuery = query.toLowerCase();
		return holons.filter(
			(h) =>
				h.name.toLowerCase().includes(lowerQuery) ||
				h.id.toLowerCase().includes(lowerQuery)
		);
	}

	// Load holons on mount
	onMount(async () => {
		if (browser) {
			await loadHolons();
		}

		// Listen for holon updates
		window.addEventListener('holonCreated', handleHolonCreated as EventListener);
		window.addEventListener('holonNavigated', handleHolonNavigated as EventListener);
	});

	onDestroy(() => {
		if (browser) {
			window.removeEventListener('holonCreated', handleHolonCreated as EventListener);
			window.removeEventListener('holonNavigated', handleHolonNavigated as EventListener);
		}
	});

	async function loadHolons() {
		isLoading = true;

		try {
			// Load personal holons from localStorage
			const savedPersonal = loadPersonalHolons();
			personalHolons = savedPersonal.map((h: any) => ({
				id: h.id,
				name: h.name || `Holon ${h.id.slice(0, 6)}...`,
				isPinned: h.isPinned || false
			}));

			// Load visited holons from localStorage
			const savedVisited = loadVisitedHolons();
			visitedHolons = savedVisited.map((h: any) => ({
				id: h.id,
				name: h.name || `Holon ${h.id.slice(0, 6)}...`,
				lastVisited: h.lastVisited || Date.now()
			}));

			// Sort visited by last visited (most recent first)
			visitedHolons.sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0));

			// Fetch names for holons that need updating
			await refreshHolonNames();
		} catch (error) {
			console.error('Failed to load holons:', error);
		} finally {
			isLoading = false;
		}
	}

	async function refreshHolonNames() {
		if (!holosphere) return;

		// Update names for personal holons
		for (const holon of personalHolons) {
			if (!holon.name || holon.name.startsWith('Holon ')) {
				const name = await fetchHolonName(holosphere, holon.id);
				if (name) {
					holon.name = name;
				}
			}
		}
		personalHolons = [...personalHolons];

		// Update names for visited holons
		for (const holon of visitedHolons) {
			if (!holon.name || holon.name.startsWith('Holon ')) {
				const name = await fetchHolonName(holosphere, holon.id);
				if (name) {
					holon.name = name;
				}
			}
		}
		visitedHolons = [...visitedHolons];
	}

	function handleHolonCreated(event: CustomEvent) {
		const { holonId, holonName } = event.detail;
		// Add to personal holons if not already there
		if (!personalHolons.find((h) => h.id === holonId)) {
			personalHolons = [{ id: holonId, name: holonName, isPinned: false }, ...personalHolons];
		}
	}

	function handleHolonNavigated(event: CustomEvent) {
		const { holonId, holonName } = event.detail;
		// Update visited holons
		const existingIndex = visitedHolons.findIndex((h) => h.id === holonId);
		if (existingIndex >= 0) {
			visitedHolons[existingIndex].lastVisited = Date.now();
			visitedHolons = [...visitedHolons].sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0));
		} else {
			visitedHolons = [{ id: holonId, name: holonName, lastVisited: Date.now() }, ...visitedHolons];
		}
	}

	function selectHolon(holonId: string) {
		ID.set(holonId);
		goto(`/${holonId}/dashboard`);
		dispatch('select', { holonId });

		// Close browser on mobile
		if (browser && window.innerWidth < 1024) {
			dispatch('close');
		}
	}

	function togglePin(holonId: string) {
		const index = personalHolons.findIndex((h) => h.id === holonId);
		if (index >= 0) {
			personalHolons[index].isPinned = !personalHolons[index].isPinned;
			personalHolons = [...personalHolons];
			savePersonalHolons(personalHolons);
		}
	}

	function handleClose() {
		dispatch('close');
	}

	function handleAddHolon() {
		dispatch('add');
	}
</script>

<aside
	class="browser-panel"
	class:browser-panel--open={isOpen}
	role="complementary"
	aria-label="Holon browser"
>
	<BrowserHeader
		bind:searchQuery
		on:close={handleClose}
		on:add={handleAddHolon}
	/>

	<!-- Tabs -->
	<div class="browser-panel__tabs">
		<button
			class="browser-panel__tab"
			class:browser-panel__tab--active={activeTab === 'personal'}
			on:click={() => (activeTab = 'personal')}
		>
			<Star size={14} />
			<span>My Holons</span>
		</button>
		<button
			class="browser-panel__tab"
			class:browser-panel__tab--active={activeTab === 'visited'}
			on:click={() => (activeTab = 'visited')}
		>
			<Clock size={14} />
			<span>Recent</span>
		</button>
		<button
			class="browser-panel__tab"
			class:browser-panel__tab--active={activeTab === 'federated'}
			on:click={() => (activeTab = 'federated')}
		>
			<Users size={14} />
			<span>Federated</span>
		</button>
	</div>

	<!-- Holon List -->
	<HolonList
		holons={filteredHolons}
		{currentHolonId}
		{isLoading}
		showPinButton={activeTab === 'personal'}
		on:select={(e) => selectHolon(e.detail.holonId)}
		on:pin={(e) => togglePin(e.detail.holonId)}
	/>
</aside>

<style>
	.browser-panel {
		display: flex;
		flex-direction: column;
		width: var(--browser-width-expanded, 280px);
		height: 100%;
		background: var(--color-bg-primary, #111827);
		border-right: 1px solid var(--color-border, #374151);
		transition: transform 350ms ease, width 350ms ease;
		overflow: hidden;
		flex-shrink: 0;
	}

	/* Mobile overlay style */
	@media (max-width: 1024px) {
		.browser-panel {
			position: fixed;
			left: 0;
			top: 0;
			bottom: 0;
			width: min(85vw, 320px);
			z-index: var(--z-fixed, 30);
			transform: translateX(-100%);
			box-shadow: var(--shadow-xl);
		}

		.browser-panel--open {
			transform: translateX(0);
		}
	}

	.browser-panel__tabs {
		display: flex;
		border-bottom: 1px solid var(--color-border, #374151);
		padding: 0 var(--spacing-2, 0.5rem);
	}

	.browser-panel__tab {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-1, 0.25rem);
		padding: var(--spacing-2, 0.5rem) var(--spacing-2, 0.5rem);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--color-text-muted, #6b7280);
		font-size: var(--font-size-xs, 0.75rem);
		font-weight: var(--font-weight-medium, 500);
		cursor: pointer;
		transition: color 150ms ease, border-color 150ms ease;
	}

	.browser-panel__tab:hover {
		color: var(--color-text-secondary, #d1d5db);
	}

	.browser-panel__tab--active {
		color: var(--color-accent-light, #6366f1);
		border-bottom-color: var(--color-accent, #4f46e5);
	}

	.browser-panel__tab span {
		display: none;
	}

	@media (min-width: 400px) {
		.browser-panel__tab span {
			display: inline;
		}
	}
</style>
