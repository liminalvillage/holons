<script lang="ts">
	import { createEventDispatcher, getContext, onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import type { HoloSphere } from 'holosphere';
	import { Search, Plus, X, Star, Users, Clock } from 'svelte-feathers';
	import { nostrPublicKey } from '../../lib/stores/nostr';
	import HolonList from './HolonList.svelte';
	import QRScanner from '../../components/QRScanner.svelte';
	import { ID, sidebarExpanded } from '../store';
	import { loadPersonalHolons, loadVisitedHolons, savePersonalHolons, addVisitedHolon, getWalletAddress, saveVisitedHolons, type PersonalHolon } from '../../utils/localStorage';
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

	// Add Holon Modal state
	let showAddModal: boolean = false;
	let newHolonId: string = '';
	let newHolonName: string = '';
	let addError: string = '';
	let addSuccess: string = '';
	let showQRScanner: boolean = false;

	// Current holon from route
	$: currentHolonId = $ID;

	// Filtered holons based on search - include all holon arrays as dependencies
	$: filteredHolons = getFilteredHolons(activeTab, searchQuery, personalHolons, visitedHolons, federatedHolons);

	function getFilteredHolons(
		tab: string,
		query: string,
		personal: typeof personalHolons,
		visited: typeof visitedHolons,
		federated: typeof federatedHolons
	) {
		let holons: Array<{ id: string; name: string; isPinned?: boolean; lastVisited?: number }> = [];

		switch (tab) {
			case 'personal':
				holons = personal;
				break;
			case 'visited':
				holons = visited;
				break;
			case 'federated':
				holons = federated;
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

	// Load federated holons when tab changes or holon changes
	$: if (activeTab === 'federated' && currentHolonId && holosphere) {
		loadFederatedHolons();
	}

	onDestroy(() => {
		if (browser) {
			window.removeEventListener('holonCreated', handleHolonCreated as EventListener);
			window.removeEventListener('holonNavigated', handleHolonNavigated as EventListener);
		}
	});

	async function loadHolons() {
		isLoading = true;

		try {
			const walletAddress = getWalletAddress();

			// Load personal holons from localStorage (starred holons)
			const savedPersonal = loadPersonalHolons();
			personalHolons = savedPersonal.map((h: any) => ({
				id: h.id,
				name: h.name || `Holon ${h.id.slice(0, 6)}...`,
				isPinned: h.isPinned || false
			}));

			// Load visited holons from localStorage
			const savedVisited = loadVisitedHolons(walletAddress);
			visitedHolons = savedVisited.map((h: any) => ({
				id: h.id,
				name: h.name || `Holon ${h.id.slice(0, 6)}...`,
				lastVisited: h.lastVisited || Date.now()
			}));

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

		// Capture current holon IDs to avoid race conditions during async operations
		const personalIds = personalHolons.map(h => h.id);
		const visitedIds = visitedHolons.map(h => h.id);

		// Fetch all names concurrently for personal holons
		const personalNameResults = await Promise.all(
			personalIds.map(async (id) => ({
				id,
				name: await fetchHolonName(holosphere, id)
			}))
		);

		// Apply names atomically by matching on ID (not array position)
		const personalNameMap = new Map(personalNameResults.map(r => [r.id, r.name]));
		personalHolons = personalHolons.map(h => {
			const fetchedName = personalNameMap.get(h.id);
			return fetchedName ? { ...h, name: fetchedName } : h;
		});

		// Fetch all names concurrently for visited holons
		const visitedNameResults = await Promise.all(
			visitedIds.map(async (id) => ({
				id,
				name: await fetchHolonName(holosphere, id)
			}))
		);

		// Apply names atomically by matching on ID
		const visitedNameMap = new Map(visitedNameResults.map(r => [r.id, r.name]));
		visitedHolons = visitedHolons.map(h => {
			const fetchedName = visitedNameMap.get(h.id);
			return fetchedName ? { ...h, name: fetchedName } : h;
		});
	}

	async function loadFederatedHolons() {
		if (!holosphere || !currentHolonId) return;

		isLoading = true;
		try {
			// Get federation info from holosphere
			const federationInfo = await holosphere.getFederation(currentHolonId);

			if (federationInfo?.federated && Array.isArray(federationInfo.federated)) {
				// Fetch names for all federated holons
				const holonsWithNames: Array<{ id: string; name: string }> = [];

				for (const holonId of federationInfo.federated) {
					const name = await fetchHolonName(holosphere, holonId);
					holonsWithNames.push({
						id: holonId,
						name: name || `Holon ${holonId.slice(0, 8)}...`
					});
				}

				federatedHolons = holonsWithNames;
			} else {
				federatedHolons = [];
			}
		} catch (error) {
			console.error('Failed to load federated holons:', error);
			federatedHolons = [];
		} finally {
			isLoading = false;
		}
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
			visitedHolons = [...visitedHolons];
		} else {
			visitedHolons = [...visitedHolons, { id: holonId, name: holonName, lastVisited: Date.now() }];
		}
	}

	function selectHolon(holonId: string) {
		// Find holon name from any list
		const holon = personalHolons.find(h => h.id === holonId)
			|| visitedHolons.find(h => h.id === holonId)
			|| federatedHolons.find(h => h.id === holonId);
		const holonName = holon?.name || `Holon ${holonId.slice(0, 6)}...`;

		// Add to visited list
		const walletAddress = getWalletAddress();
		addVisitedHolon(walletAddress, holonId, holonName, 'personal');

		// Update local visited list
		const existingIndex = visitedHolons.findIndex((h) => h.id === holonId);
		if (existingIndex >= 0) {
			visitedHolons[existingIndex].lastVisited = Date.now();
			visitedHolons = [...visitedHolons];
		} else {
			visitedHolons = [...visitedHolons, { id: holonId, name: holonName, lastVisited: Date.now() }];
		}

		// Preserve current lens when switching holons
		const currentPath = $page.url.pathname;
		const pathParts = currentPath.split('/').filter(Boolean);
		// Get lens (second part of path, e.g., "dashboard", "tasks", "flow")
		const currentLens = pathParts.length > 1 ? pathParts[pathParts.length - 1] : 'dashboard';

		ID.set(holonId);
		goto(`/${holonId}/${currentLens}`);
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
			savePersonalHolons(personalHolons.map(h => ({
				id: h.id,
				name: h.name,
				lastVisited: Date.now(),
				isPinned: h.isPinned || false,
				isPersonal: true,
				order: 0
			})));
		}
	}

	function starHolon(holonId: string) {
		// Find holon in visited list
		const holon = visitedHolons.find(h => h.id === holonId);
		if (!holon) return;

		// Check if already in personal holons
		const existingIndex = personalHolons.findIndex(h => h.id === holonId);
		if (existingIndex >= 0) {
			// Remove from personal holons (unstar)
			personalHolons = personalHolons.filter(h => h.id !== holonId);
		} else {
			// Add to personal holons (star)
			personalHolons = [{ id: holon.id, name: holon.name, isPinned: false }, ...personalHolons];
		}

		// Save to localStorage
		savePersonalHolons(personalHolons.map(h => ({
			id: h.id,
			name: h.name,
			lastVisited: Date.now(),
			isPinned: h.isPinned || false,
			isPersonal: true,
			order: 0
		})));
	}

	function isStarred(holonId: string): boolean {
		return personalHolons.some(h => h.id === holonId);
	}

	function handleClose() {
		dispatch('close');
	}

	function handleAddHolon() {
		showAddModal = true;
		newHolonId = '';
		newHolonName = '';
		addError = '';
		addSuccess = '';
	}

	function closeAddModal() {
		showAddModal = false;
		showQRScanner = false;
		newHolonId = '';
		newHolonName = '';
		addError = '';
		addSuccess = '';
	}

	function handleQRScan(event: CustomEvent<{ decodedText: string }>) {
		const scannedText = event.detail.decodedText;
		showQRScanner = false;

		// Extract holon ID from the scanned text
		// Could be a full URL like https://holons.me/abc123 or just the ID
		let holonId = scannedText;

		// Try to extract ID from URL patterns
		const urlMatch = scannedText.match(/\/([a-zA-Z0-9_-]+)\/?$/);
		if (urlMatch) {
			holonId = urlMatch[1];
		}

		newHolonId = holonId;
		addError = '';
		addSuccess = 'QR code scanned successfully!';
	}

	function openQRScanner() {
		showQRScanner = true;
		addError = '';
	}

	async function addNewHolon() {
		if (!newHolonId.trim()) {
			addError = 'Please enter a Holon ID';
			return;
		}

		const holonId = newHolonId.trim();
		addError = '';

		try {
			// Try to fetch the holon name if not provided
			let name = newHolonName.trim();
			if (!name && holosphere) {
				try {
					const fetchedName = await fetchHolonName(holosphere, holonId);
					name = fetchedName || `Holon ${holonId.slice(0, 8)}...`;
				} catch {
					name = `Holon ${holonId.slice(0, 8)}...`;
				}
			} else if (!name) {
				name = `Holon ${holonId.slice(0, 8)}...`;
			}

			// Add to personal holons (starred)
			const exists = personalHolons.some(h => h.id === holonId);
			if (!exists) {
				personalHolons = [{ id: holonId, name, isPinned: false }, ...personalHolons];
				savePersonalHolons(personalHolons);
			}

			addSuccess = 'Holon added successfully!';

			// Navigate to the holon
			setTimeout(() => {
				closeAddModal();
				goto(`/${holonId}/dashboard`);
			}, 500);
		} catch (err) {
			addError = err instanceof Error ? err.message : 'Failed to add holon';
		}
	}
</script>

<aside
	class="browser-panel"
	class:browser-panel--open={isOpen}
	aria-label="Holon browser"
>
	<!-- Compact header with search and add -->
	<div class="browser-panel__header">
		<div class="browser-panel__search">
			<Search size={14} />
			<input
				type="text"
				placeholder="Search holons..."
				bind:value={searchQuery}
			/>
		</div>
		<button
			class="browser-panel__add-btn"
			onclick={handleAddHolon}
			title="Add holon"
		>
			<Plus size={16} />
		</button>
	</div>

	<!-- Tabs -->
	<div class="browser-panel__tabs">
		<button
			class="browser-panel__tab"
			class:browser-panel__tab--active={activeTab === 'personal'}
			onclick={() => (activeTab = 'personal')}
		>
			<Star size={12} />
			<span>Starred</span>
		</button>
		<button
			class="browser-panel__tab"
			class:browser-panel__tab--active={activeTab === 'visited'}
			onclick={() => (activeTab = 'visited')}
		>
			<Clock size={12} />
			<span>Recent</span>
		</button>
		<button
			class="browser-panel__tab"
			class:browser-panel__tab--active={activeTab === 'federated'}
			onclick={() => (activeTab = 'federated')}
		>
			<Users size={12} />
			<span>Federated</span>
		</button>
	</div>

	<!-- Holon List - main content -->
	<HolonList
		holons={filteredHolons}
		{currentHolonId}
		{isLoading}
		showPinButton={activeTab === 'personal'}
		showStarButton={activeTab === 'visited'}
		starredIds={personalHolons.map(h => h.id)}
		homeHolonId={$nostrPublicKey}
		showHomeSection={activeTab === 'personal'}
		on:select={(e) => selectHolon(e.detail.holonId)}
		on:pin={(e) => togglePin(e.detail.holonId)}
		on:star={(e) => starHolon(e.detail.holonId)}
	/>

	<!-- Federation link (only on federated tab) -->
	{#if activeTab === 'federated' && currentHolonId}
		<div class="browser-panel__footer">
			<button class="browser-panel__manage-btn" onclick={() => goto(`/${currentHolonId}/federation`)}>
				<i class="fas fa-cog"></i>
				<span>Manage Federation</span>
			</button>
		</div>
	{/if}
</aside>

<!-- Add Holon Modal -->
{#if showAddModal}
	<div
		class="add-modal-backdrop"
		onclick={closeAddModal}
		onkeydown={(e) => e.key === 'Escape' && closeAddModal()}
		role="button"
		tabindex="0"
	>
		<div
			class="add-modal"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<div class="add-modal__header">
				<h3>Add Holon</h3>
				<button class="add-modal__close" onclick={closeAddModal} aria-label="Close">×</button>
			</div>

			<div class="add-modal__content">
				{#if addError}
					<div class="add-modal__error">{addError}</div>
				{/if}
				{#if addSuccess}
					<div class="add-modal__success">{addSuccess}</div>
				{/if}

				<div class="add-modal__field">
					<label for="holon-id-input">Holon ID</label>
					<div class="add-modal__input-row">
						<input
							id="holon-id-input"
							type="text"
							bind:value={newHolonId}
							placeholder="Enter Holon ID"
							onkeydown={(e) => e.key === 'Enter' && addNewHolon()}
						/>
						<button
							type="button"
							class="add-modal__qr-btn"
							onclick={openQRScanner}
							title="Scan QR Code"
						>
							<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
							</svg>
						</button>
					</div>
				</div>

				<div class="add-modal__field">
					<label for="holon-name-input">Display Name (optional)</label>
					<input
						id="holon-name-input"
						type="text"
						bind:value={newHolonName}
						placeholder="Custom name for display"
						onkeydown={(e) => e.key === 'Enter' && addNewHolon()}
					/>
				</div>
			</div>

			<div class="add-modal__actions">
				<button class="btn btn--primary" onclick={addNewHolon}>Add Holon</button>
				<button class="btn btn--secondary" onclick={closeAddModal}>Cancel</button>
			</div>
		</div>
	</div>
{/if}

<!-- QR Scanner -->
<QRScanner
	bind:showScanner={showQRScanner}
	on:scan={handleQRScan}
	on:close={() => showQRScanner = false}
/>

<style>
	.browser-panel {
		display: flex;
		flex-direction: column;
		width: var(--browser-width-expanded, 260px);
		height: 100vh;
		background: var(--color-bg-primary, #111827);
		border-right: 1px solid var(--color-border, #374151);
		transition: transform 350ms ease, width 350ms ease, margin-left 350ms ease;
		overflow: hidden;
		flex-shrink: 0;
	}

	/* Desktop: hide sidebar by shifting it off-screen */
	@media (min-width: 1025px) {
		.browser-panel:not(.browser-panel--open) {
			margin-left: calc(-1 * var(--browser-width-expanded, 260px));
		}
	}

	/* Mobile overlay style */
	@media (max-width: 1024px) {
		.browser-panel {
			position: fixed;
			left: 0;
			top: 0;
			bottom: 0;
			width: min(85vw, 300px);
			z-index: 50;
			transform: translateX(-100%);
			box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
		}

		.browser-panel--open {
			transform: translateX(0);
		}
	}

	/* Compact header with search and add button */
	.browser-panel__header {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		border-bottom: 1px solid var(--color-border, #374151);
		flex-shrink: 0;
	}

	.browser-panel__search {
		flex: 1;
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		padding: var(--spacing-1, 0.25rem) var(--spacing-2, 0.5rem);
		background: var(--color-bg-secondary, #1f2937);
		border-radius: var(--radius-md, 0.375rem);
		color: var(--color-text-muted, #6b7280);
	}

	.browser-panel__search input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: var(--color-text-primary, #ffffff);
		font-size: var(--font-size-sm, 0.875rem);
	}

	.browser-panel__search input::placeholder {
		color: var(--color-text-muted, #6b7280);
	}

	.browser-panel__add-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: var(--color-accent, #4f46e5);
		border: none;
		border-radius: var(--radius-md, 0.375rem);
		color: white;
		cursor: pointer;
		transition: background-color 150ms ease;
		flex-shrink: 0;
	}

	.browser-panel__add-btn:hover {
		background: var(--color-accent-dark, #4338ca);
	}

	/* Tabs */
	.browser-panel__tabs {
		display: flex;
		border-bottom: 1px solid var(--color-border, #374151);
		flex-shrink: 0;
	}

	.browser-panel__tab {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		padding: var(--spacing-2, 0.5rem);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--color-text-muted, #6b7280);
		font-size: 11px;
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

	/* Footer */
	.browser-panel__footer {
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		border-top: 1px solid var(--color-border, #374151);
		flex-shrink: 0;
	}

	.browser-panel__manage-btn {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-2, 0.5rem);
		padding: var(--spacing-2, 0.5rem);
		background: var(--color-bg-secondary, #1f2937);
		border: 1px solid var(--color-border, #374151);
		border-radius: var(--radius-md, 0.375rem);
		color: var(--color-text-secondary, #d1d5db);
		font-size: var(--font-size-sm, 0.875rem);
		cursor: pointer;
		transition: all 150ms ease;
	}

	.browser-panel__manage-btn:hover {
		background: var(--color-bg-tertiary, #374151);
		border-color: var(--color-accent, #4f46e5);
		color: var(--color-text-primary, #ffffff);
	}

	/* Add Holon Modal */
	.add-modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}

	.add-modal {
		background: var(--color-bg-secondary, #1f2937);
		border-radius: var(--radius-xl, 1rem);
		padding: var(--spacing-5, 1.25rem);
		max-width: 400px;
		width: 90%;
		box-shadow: var(--shadow-xl);
		border: 1px solid var(--color-border, #374151);
	}

	.add-modal__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--spacing-4, 1rem);
	}

	.add-modal__header h3 {
		font-size: var(--font-size-lg, 1.125rem);
		font-weight: var(--font-weight-semibold, 600);
		color: var(--color-text-primary, #ffffff);
		margin: 0;
	}

	.add-modal__close {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: var(--color-text-muted, #6b7280);
		font-size: 1.5rem;
		cursor: pointer;
		border-radius: var(--radius-md, 0.375rem);
	}

	.add-modal__close:hover {
		background: var(--color-bg-tertiary, #374151);
		color: var(--color-text-primary, #ffffff);
	}

	.add-modal__content {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-4, 1rem);
	}

	.add-modal__field {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-2, 0.5rem);
	}

	.add-modal__field label {
		font-size: var(--font-size-sm, 0.875rem);
		font-weight: var(--font-weight-medium, 500);
		color: var(--color-text-secondary, #d1d5db);
	}

	.add-modal__field input {
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		background: var(--color-bg-primary, #111827);
		border: 1px solid var(--color-border, #374151);
		border-radius: var(--radius-md, 0.375rem);
		color: var(--color-text-primary, #ffffff);
		font-size: var(--font-size-sm, 0.875rem);
	}

	.add-modal__field input:focus {
		outline: none;
		border-color: var(--color-accent, #4f46e5);
		box-shadow: 0 0 0 2px var(--color-accent-subtle, rgba(79, 70, 229, 0.1));
	}

	.add-modal__field input::placeholder {
		color: var(--color-text-muted, #6b7280);
	}

	.add-modal__input-row {
		display: flex;
		gap: var(--spacing-2, 0.5rem);
	}

	.add-modal__input-row input {
		flex: 1;
	}

	.add-modal__qr-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 42px;
		height: 42px;
		background: var(--color-success, #22c55e);
		border: none;
		border-radius: var(--radius-md, 0.375rem);
		color: white;
		cursor: pointer;
		transition: background-color 150ms ease;
		flex-shrink: 0;
	}

	.add-modal__qr-btn:hover {
		background: var(--color-success-hover, #16a34a);
	}

	.add-modal__error {
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid var(--color-error, #ef4444);
		border-radius: var(--radius-md, 0.375rem);
		color: var(--color-error, #ef4444);
		font-size: var(--font-size-sm, 0.875rem);
	}

	.add-modal__success {
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		background: rgba(34, 197, 94, 0.1);
		border: 1px solid var(--color-success, #22c55e);
		border-radius: var(--radius-md, 0.375rem);
		color: var(--color-success, #22c55e);
		font-size: var(--font-size-sm, 0.875rem);
	}

	.add-modal__actions {
		display: flex;
		gap: var(--spacing-3, 0.75rem);
		margin-top: var(--spacing-4, 1rem);
	}

	.add-modal__actions .btn {
		flex: 1;
	}
</style>
