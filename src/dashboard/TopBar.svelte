<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { ID, walletAddress } from './store';
	import { onMount, onDestroy, getContext } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { fade, scale } from 'svelte/transition';
	import type { HoloSphere } from "holosphere";
	import { addVisitedHolon, getWalletAddress, loadVisitedHolons, saveVisitedHolons, type VisitedHolon } from "../utils/localStorage";
	import { fetchHolonName, clearHolonNameCache } from "../utils/holonNames";
	import { nostrPublicKey } from '$lib/stores/nostr';
	import Menu from 'svelte-feather-icons/src/icons/MenuIcon.svelte';
	import VideoCall from '../components/VideoCall.svelte';
	import WidgetDashboard from '../components/WidgetDashboard.svelte';
	import KeyManager from '../components/KeyManager.svelte';
	import QRScanner from '../components/QRScanner.svelte';
	import TopNavItems from './TopNavItems.svelte';

	const dispatch = createEventDispatcher();

	// Visited holons for add modal
	let visitedHolons: VisitedHolon[] = [];

	// Add holon modal state
	let showAddHolonModal = false;
	let newHolonId = '';
	let newHolonName = '';
	let addHolonError = '';
	let addHolonLoading = false;
	let showQRScanner = false;

	// Helper to validate holon ID
	const isValidHolonId = (id: string | undefined | null): id is string => {
		return !!id && id !== 'undefined' && id !== 'null' && id.trim() !== '';
	};

	let holosphere = getContext("holosphere") as HoloSphere;
	let currentHolonName: string | undefined;
	let holonID = '';
	let processedHolonId = '';
	let isInitialized = false;
	let showVideoCall = false;
	let showWidgetDashboard = false;

	// Handle QR scan result
	function handleQRScan(event: CustomEvent<{ decodedText: string }>) {
		const { decodedText } = event.detail;

		// Extract holon ID from the scanned text
		let holonId = decodedText;

		try {
			// If it's a URL, try to extract the holon ID from it
			if (decodedText.includes('://') || decodedText.startsWith('http')) {
				const url = new URL(decodedText);
				const pathParts = url.pathname.split('/').filter(part => part.trim() !== '');
				const excludedPaths = ['dashboard', 'qr', 'settings', 'admin', 'holons', 'tasks', 'offers', 'map', 'council', 'proposals'];

				for (const part of pathParts) {
					if (excludedPaths.includes(part.toLowerCase())) continue;
					if (/^[a-zA-Z0-9\-_]+$/.test(part) && part.length > 3) {
						holonId = part;
						break;
					}
				}

				if (holonId === decodedText && pathParts.length > 0) {
					holonId = pathParts[0];
				}
			} else if (decodedText.includes('/')) {
				const pathParts = decodedText.split('/').filter(part => part.trim() !== '');
				const excludedPaths = ['dashboard', 'qr', 'settings', 'admin', 'holons', 'tasks', 'offers', 'map', 'council', 'proposals'];

				for (const part of pathParts) {
					if (excludedPaths.includes(part.toLowerCase())) continue;
					if (/^[a-zA-Z0-9\-_]+$/.test(part) && part.length > 3) {
						holonId = part;
						break;
					}
				}

				if (holonId === decodedText && pathParts.length > 0) {
					holonId = pathParts[0];
				}
			}

			// Clean up the holon ID
			holonId = holonId.split('?')[0];
			holonId = holonId.split('#')[0];
			holonId = holonId.replace(/\.(html|htm|php|asp|aspx|jsp|jspx)$/i, '');

			const holonIdPattern = /^[a-zA-Z0-9\-_]+$/;

			if (holonId && holonId.trim() && holonIdPattern.test(holonId.trim())) {
				newHolonId = holonId.trim();
			} else {
				addHolonError = `Invalid holon ID format: "${holonId}". Please scan a valid holon QR code.`;
				setTimeout(() => addHolonError = '', 5000);
			}
		} catch (err) {
			console.error('Error parsing QR code:', err);
			addHolonError = 'Error parsing QR code. Please try again.';
			setTimeout(() => addHolonError = '', 5000);
		}

		showQRScanner = false;
	}

	function handleQRScanError(event: CustomEvent<{ message: string }>) {
		const { message } = event.detail;
		addHolonError = `QR scan error: ${message}`;
		setTimeout(() => addHolonError = '', 5000);
		showQRScanner = false;
	}

	// Handle holon name update from Settings
	function handleHolonNameUpdated(event: CustomEvent) {
		const { holonId, newName } = event.detail;
		if (holonId === $ID && newName) {
			currentHolonName = newName;
		}
	}

	// Handle holon navigation from MyHolons
	function handleHolonNavigated(event: CustomEvent) {
		const { holonId, holonName } = event.detail;
		if (holonId && holonName) {
			currentHolonName = holonName;
			processedHolonId = holonId;
			if (browser && isValidHolonId(holonId)) {
				saveVisitedHolon(holonId, holonName);
			}
		}
	}

	// Save visited holon to localStorage
	async function saveVisitedHolon(holonId: string, holonName: string) {
		if (!isValidHolonId(holonId)) return;
		try {
			await addVisitedHolon(getWalletAddress(), holonId, holonName, 'personal');
		} catch (err) {
			console.warn('Failed to save visited holon:', err);
		}
	}

	// Fetch holon name with simple retry
	async function updateCurrentHolonName(id: string, attempt = 0) {
		if (!isValidHolonId(id)) {
			currentHolonName = undefined;
			return;
		}

		if (!holosphere) {
			currentHolonName = `Holon ${id}`;
			if (attempt < 3) {
				setTimeout(() => updateCurrentHolonName(id, attempt + 1), 500);
			}
			return;
		}

		try {
			if (attempt > 0) clearHolonNameCache(id);
			const name = await fetchHolonName(holosphere, id);
			currentHolonName = name && name !== `Holon ${id}` ? name : `Holon ${id}`;
		} catch (error) {
			if (attempt < 2) {
				setTimeout(() => updateCurrentHolonName(id, attempt + 1), 500 * (attempt + 1));
			} else {
				currentHolonName = `Holon ${id}`;
			}
		}
	}

	// Route management
	function updateRoute(id: string) {
		if (!isValidHolonId(id)) {
			if (browser && $page.url.pathname !== '/') goto('/');
			return;
		}

		const currentPath = $page.url.pathname;
		if (browser && !currentPath.startsWith(`/${id}`)) {
			const pathParts = currentPath.split('/');
			let subPath = pathParts[pathParts.length - 1];
			const protectedRoutes = ['video', 'map', 'settings', 'roles', 'offers', 'tasks', 'calendar', 'tags', 'proposals', 'shopping', 'checklists', 'status', 'federation', 'dashboard', 'db'];

			if ((pathParts.length === 2 || subPath === holonID) && !protectedRoutes.includes(subPath)) {
				subPath = 'dashboard';
			}
			goto(`/${id}/${subPath || 'dashboard'}`);
		}
	}

	// Reactive statements
	$: isPrimaryPage = $page.url.pathname === '/';

	// Handle URL parameter changes
	$: {
		const storedHolonID = $page.params.id;
		if (isValidHolonId(storedHolonID) && isInitialized && processedHolonId !== storedHolonID) {
			ID.set(storedHolonID);
			processedHolonId = storedHolonID;
			updateCurrentHolonName(storedHolonID);
		}
	}

	// Handle ID store changes
	$: if (isValidHolonId($ID) && isInitialized && processedHolonId !== $ID) {
		processedHolonId = $ID;
		updateCurrentHolonName($ID);

		if (browser && $page.url.pathname !== '/') {
			saveVisitedHolon($ID, currentHolonName || `Holon ${$ID}`);
		}

		if ($page.url.pathname !== '/' && !$page.url.pathname.includes('/video')) {
			if (!$page.url.pathname.startsWith(`/${$ID}`)) {
				holonID = $ID;
				setTimeout(() => updateRoute($ID), 100);
			} else {
				holonID = $ID;
			}
		} else {
			holonID = $ID;
		}
	}

	// Actions
	function startVideoCall() {
		if ($ID) showVideoCall = true;
	}

	function toggleWidgetDashboard() {
		if ($ID) showWidgetDashboard = !showWidgetDashboard;
	}

	// Copy holon ID to clipboard
	async function copyHolonId() {
		if (isValidHolonId($ID)) {
			await navigator.clipboard.writeText($ID);
		}
	}

	// Navigate to home holon (user's public key)
	function goToHomeHolon() {
		if ($nostrPublicKey) {
			navigateToHolon($nostrPublicKey);
		}
	}

	// Load visited holons for tabs
	function loadVisitedHolonsForTabs() {
		if (browser) {
			const loaded = loadVisitedHolons($walletAddress);
			// Keep original order (by when they were first added), limit to 10
			visitedHolons = loaded.slice(0, 10);
		}
	}

	// Navigate to a holon while preserving the current component
	function navigateToHolon(holonId: string) {
		if (!isValidHolonId(holonId)) return;
		ID.set(holonId);

		// Get current path component (tasks, shopping, etc.)
		const currentPath = $page.url.pathname;
		const pathParts = currentPath.split('/').filter(Boolean);
		// pathParts[0] is the holon ID, pathParts[1] is the component
		const currentComponent = pathParts.length > 1 ? pathParts[1] : 'dashboard';

		goto(`/${holonId}/${currentComponent}`);
	}

	// Remove a holon from the visited list
	function removeHolonFromTabs(holonId: string) {
		if (browser) {
			import('../utils/localStorage').then(({ loadVisitedHolons, saveVisitedHolons }) => {
				const loaded = loadVisitedHolons($walletAddress);
				const filtered = loaded.filter(h => h.id !== holonId);
				saveVisitedHolons($walletAddress, filtered);
				loadVisitedHolonsForTabs();
			});
		}
	}

	// Truncate name for display
	function truncateName(name: string, maxLength: number = 14): string {
		if (name.length <= maxLength) return name;
		return name.slice(0, maxLength) + '...';
	}

	// Add new holon to the topbar
	async function addNewHolon() {
		if (!newHolonId.trim()) {
			addHolonError = 'Please enter a holon ID';
			return;
		}

		// Check if already exists
		if (visitedHolons.find(h => h.id === newHolonId.trim())) {
			addHolonError = 'Holon already exists in your list';
			return;
		}

		addHolonLoading = true;
		addHolonError = '';

		try {
			const holonId = newHolonId.trim();
			const name = newHolonName.trim() || await fetchHolonName(holosphere, holonId);

			// Add to visited holons
			const newHolon: VisitedHolon = {
				id: holonId,
				name: name || `Holon ${holonId}`,
				lastVisited: Date.now(),
				visitCount: 1
			};

			visitedHolons = [...visitedHolons, newHolon];
			saveVisitedHolons($walletAddress, visitedHolons);

			// Close modal and reset
			showAddHolonModal = false;
			newHolonId = '';
			newHolonName = '';

			// Navigate to the new holon
			navigateToHolon(holonId);
		} catch (err) {
			console.error('Error adding holon:', err);
			addHolonError = err instanceof Error ? err.message : 'Failed to add holon';
		} finally {
			addHolonLoading = false;
		}
	}

	// Open add holon modal
	function openAddHolonModal() {
		showAddHolonModal = true;
		addHolonError = '';
		newHolonId = '';
		newHolonName = '';
	}

	// Close add holon modal
	function closeAddHolonModal() {
		showAddHolonModal = false;
		addHolonError = '';
		newHolonId = '';
		newHolonName = '';
	}

	// Handle new holon creation event
	function handleHolonCreated() {
		loadVisitedHolonsForTabs();
	}

	onMount(async () => {
		isInitialized = true;
		const initialId = $page.params.id;

		if (isValidHolonId(initialId)) {
			ID.set(initialId);
			processedHolonId = initialId;
			updateCurrentHolonName(initialId);
		}

		// Load visited holons for add modal
		loadVisitedHolonsForTabs();

		// Event listeners
		window.addEventListener('toggleWidgetDashboard', toggleWidgetDashboard);
		window.addEventListener('holonNameUpdated', handleHolonNameUpdated as EventListener);
		window.addEventListener('holonNavigated', handleHolonNavigated as EventListener);
		window.addEventListener('holonCreated', handleHolonCreated);
		window.addEventListener('openAddHolonModal', openAddHolonModal);
		window.addEventListener('storage', loadVisitedHolonsForTabs);
	});

	onDestroy(() => {
		if (browser) {
			window.removeEventListener('toggleWidgetDashboard', toggleWidgetDashboard);
			window.removeEventListener('holonNameUpdated', handleHolonNameUpdated as EventListener);
			window.removeEventListener('holonNavigated', handleHolonNavigated as EventListener);
			window.removeEventListener('holonCreated', handleHolonCreated);
			window.removeEventListener('openAddHolonModal', openAddHolonModal);
			window.removeEventListener('storage', loadVisitedHolonsForTabs);
		}
	});

	// Reload visited holons when ID changes (so tabs stay in sync)
	$: if ($ID && browser) {
		// Give a small delay to let localStorage update
		setTimeout(loadVisitedHolonsForTabs, 100);
	}
</script>

<div class="topbar">
	<!-- Menu button to toggle browser panel (holon browser on left) -->
	<button class="menu-btn" on:click={() => dispatch('toggleBrowser')} aria-label="Toggle holon browser">
		<Menu size="22" />
	</button>

	<!-- Home holon button -->
	{#if $nostrPublicKey}
		<button
			class="home-btn"
			class:active={$ID === $nostrPublicKey}
			on:click={goToHomeHolon}
			title="Go to Home Holon"
			aria-label="Go to Home Holon"
		>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
				<polyline points="9 22 9 12 15 12 15 22"/>
			</svg>
		</button>
	{/if}

	<!-- Current holon indicator (compact) -->
	{#if currentHolonName && $ID}
		<div class="current-holon" title={currentHolonName}>
			<span class="current-holon__name">{truncateName(currentHolonName, 20)}</span>
		</div>
	{/if}

	<!-- Navigation cards (replaces holon tabs) -->
	<TopNavItems />

	<!-- Add holon button -->
	<button class="add-holon-btn" on:click={openAddHolonModal} title="Add or Create Holon">
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M12 4v16m8-8H4"/>
		</svg>
	</button>

	<!-- Right controls -->
	<div class="controls">
		{#if !isPrimaryPage && $ID}
			<!-- Copy ID button -->
			<button class="icon-btn" on:click={copyHolonId} title="Copy Holon ID">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
					<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
				</svg>
			</button>

			<!-- Action buttons -->
			<button class="icon-btn" on:click={toggleWidgetDashboard} title="Widget Dashboard">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<rect x="3" y="3" width="7" height="7" rx="1"/>
					<rect x="14" y="3" width="7" height="7" rx="1"/>
					<rect x="3" y="14" width="7" height="7" rx="1"/>
					<rect x="14" y="14" width="7" height="7" rx="1"/>
				</svg>
			</button>

			<button class="icon-btn" on:click={startVideoCall} title="Video Call">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
				</svg>
			</button>

			<div class="divider"></div>
		{/if}

		<!-- Key Manager -->
		<KeyManager />

		<!-- Google Translate -->
		<div id="google_translate_element" class="translate-widget"></div>
	</div>
</div>

<!-- Floating components -->
<VideoCall roomId={$ID || ''} bind:show={showVideoCall} floating={true} />
<WidgetDashboard bind:isVisible={showWidgetDashboard} />

<!-- Add Holon Modal -->
<!-- QR Scanner Component -->
<QRScanner
	showScanner={showQRScanner}
	on:scan={handleQRScan}
	on:error={handleQRScanError}
	on:close={() => showQRScanner = false}
/>

{#if showAddHolonModal}
	<div
		class="modal-overlay"
		transition:fade={{ duration: 150 }}
		on:click|self={closeAddHolonModal}
		on:keydown={(e) => e.key === 'Escape' && closeAddHolonModal()}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div class="modal-content" transition:scale={{ duration: 150, start: 0.95 }}>
			<h3 class="modal-title">Add New Holon</h3>

			{#if addHolonError}
				<div class="modal-error">{addHolonError}</div>
			{/if}

			<div class="modal-fields">
				<div class="modal-field">
					<label for="new-holon-id">Holon ID *</label>
					<div class="input-with-button">
						<input
							id="new-holon-id"
							type="text"
							bind:value={newHolonId}
							placeholder="Enter holon ID"
							on:keydown={(e) => e.key === 'Enter' && addNewHolon()}
						/>
						<button
							type="button"
							class="qr-scan-btn"
							on:click={() => showQRScanner = true}
							title="Scan QR Code"
						>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M3 3h6v6H3V3zm12 0h6v6h-6V3zM3 15h6v6H3v-6zm12 0h6v6h-6v-6zM9 3v6m0 6v6" />
							</svg>
						</button>
					</div>
					<p class="modal-hint">Get your holon ID from @HolonsBot on Telegram using /id or /dashboard, or scan a QR code</p>
				</div>

				<div class="modal-field">
					<label for="new-holon-name">Display Name (optional)</label>
					<input
						id="new-holon-name"
						type="text"
						bind:value={newHolonName}
						placeholder="Custom name for display"
						on:keydown={(e) => e.key === 'Enter' && addNewHolon()}
					/>
				</div>
			</div>

			<div class="modal-actions">
				<button class="modal-btn modal-btn-primary" on:click={addNewHolon} disabled={addHolonLoading}>
					{#if addHolonLoading}
						Adding...
					{:else}
						Add Holon
					{/if}
				</button>
				<button class="modal-btn modal-btn-secondary" on:click={closeAddHolonModal}>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.topbar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 1rem;
		background: linear-gradient(to bottom, rgba(17, 24, 39, 0.98), rgba(17, 24, 39, 0.95));
		backdrop-filter: blur(12px);
		border-bottom: 1px solid rgba(75, 85, 99, 0.3);
		min-height: 56px;
		position: sticky;
		top: 0;
		z-index: 50;
		width: 100%;
	}

	.menu-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem;
		color: #9ca3af;
		background: transparent;
		border: none;
		border-radius: 0.5rem;
		cursor: pointer;
		transition: all 0.15s ease;
		flex-shrink: 0;
	}

	.menu-btn:hover {
		color: white;
		background: rgba(55, 65, 81, 0.5);
	}

	.home-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		padding: 0;
		color: #9ca3af;
		background: rgba(31, 41, 55, 0.8);
		border: 1px solid rgba(75, 85, 99, 0.4);
		border-radius: 0.75rem;
		cursor: pointer;
		transition: all 0.2s ease;
		flex-shrink: 0;
	}

	.home-btn svg {
		width: 20px;
		height: 20px;
	}

	.home-btn:hover {
		color: white;
		background: rgba(55, 65, 81, 0.8);
		border-color: rgba(96, 165, 250, 0.4);
		transform: translateY(-1px);
	}

	.home-btn.active {
		color: #818cf8;
		background: rgba(79, 70, 229, 0.3);
		border-color: rgba(129, 140, 248, 0.6);
		box-shadow: 0 0 12px rgba(129, 140, 248, 0.3);
	}

	/* Current holon indicator */
	.current-holon {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.75rem;
		background: rgba(79, 70, 229, 0.2);
		border: 1px solid rgba(129, 140, 248, 0.4);
		border-radius: 0.5rem;
		flex-shrink: 0;
		max-width: 180px;
	}

	.current-holon__name {
		font-size: 0.875rem;
		font-weight: 600;
		color: #a5b4fc;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Add holon button */
	.add-holon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		padding: 0;
		background: rgba(16, 185, 129, 0.2);
		border: 1px solid rgba(16, 185, 129, 0.3);
		border-radius: 0.75rem;
		color: #10b981;
		cursor: pointer;
		transition: all 0.2s ease;
		flex-shrink: 0;
	}

	.add-holon-btn:hover {
		background: rgba(16, 185, 129, 0.4);
		border-color: rgba(16, 185, 129, 0.6);
		color: #34d399;
		transform: translateY(-1px);
	}

	.add-holon-btn svg {
		width: 20px;
		height: 20px;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		padding: 0;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 0.5rem;
		color: #9ca3af;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.icon-btn svg {
		width: 18px;
		height: 18px;
	}

	.icon-btn:hover {
		color: white;
		background: rgba(55, 65, 81, 0.6);
		border-color: rgba(75, 85, 99, 0.5);
	}

	.divider {
		width: 1px;
		height: 24px;
		background: rgba(75, 85, 99, 0.5);
		margin: 0 0.25rem;
	}

	.translate-widget {
		transform: scale(0.75);
		transform-origin: right center;
	}

	/* Mobile adjustments */
	@media (max-width: 640px) {
		.topbar {
			padding: 0.5rem 0.75rem;
			gap: 0.5rem;
		}

		.home-btn {
			width: 32px;
			height: 32px;
		}

		.home-btn svg {
			width: 16px;
			height: 16px;
		}

		.current-holon {
			display: none;
		}

		.add-holon-btn {
			width: 32px;
			height: 32px;
		}

		.add-holon-btn svg {
			width: 16px;
			height: 16px;
		}

		.icon-btn {
			width: 32px;
			height: 32px;
		}

		.icon-btn svg {
			width: 16px;
			height: 16px;
		}

		.divider {
			display: none;
		}

		.translate-widget {
			display: none;
		}
	}

	/* Tablet adjustments */
	@media (min-width: 641px) and (max-width: 1023px) {
		.current-holon {
			max-width: 140px;
		}
	}

	/* Modal styles */
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		padding: 1rem;
	}

	.modal-content {
		background: rgb(31, 41, 55);
		border-radius: 0.75rem;
		padding: 1.5rem;
		width: 100%;
		max-width: 400px;
		border: 1px solid rgba(75, 85, 99, 0.5);
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
	}

	.modal-title {
		font-size: 1.25rem;
		font-weight: 600;
		color: white;
		margin-bottom: 1rem;
	}

	.modal-error {
		padding: 0.75rem;
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 0.5rem;
		color: #f87171;
		font-size: 0.875rem;
		margin-bottom: 1rem;
	}

	.modal-fields {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.modal-field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.modal-field label {
		font-size: 0.875rem;
		font-weight: 500;
		color: #d1d5db;
	}

	.modal-field input {
		padding: 0.625rem 0.75rem;
		background: rgb(55, 65, 81);
		border: 1px solid rgba(75, 85, 99, 0.5);
		border-radius: 0.5rem;
		color: white;
		font-size: 0.875rem;
	}

	.modal-field input::placeholder {
		color: #9ca3af;
	}

	.modal-field input:focus {
		outline: none;
		border-color: #6366f1;
		box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
	}

	.modal-hint {
		font-size: 0.75rem;
		color: #9ca3af;
		margin-top: 0.25rem;
	}

	.modal-actions {
		display: flex;
		gap: 0.75rem;
		margin-top: 1.5rem;
	}

	.modal-btn {
		flex: 1;
		padding: 0.625rem 1rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
		border: none;
	}

	.modal-btn-primary {
		background: #6366f1;
		color: white;
	}

	.modal-btn-primary:hover:not(:disabled) {
		background: #4f46e5;
	}

	.modal-btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.modal-btn-secondary {
		background: rgb(75, 85, 99);
		color: white;
	}

	.modal-btn-secondary:hover {
		background: rgb(107, 114, 128);
	}

	.input-with-button {
		display: flex;
		gap: 0.5rem;
	}

	.input-with-button input {
		flex: 1;
	}

	.qr-scan-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 42px;
		height: 42px;
		padding: 0;
		background: rgb(16, 185, 129);
		border: none;
		border-radius: 0.5rem;
		color: white;
		cursor: pointer;
		transition: all 0.15s ease;
		flex-shrink: 0;
	}

	.qr-scan-btn:hover {
		background: rgb(5, 150, 105);
	}

	.qr-scan-btn svg {
		width: 20px;
		height: 20px;
	}
</style>
