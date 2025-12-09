<script lang="ts">
	import { openSidebar, ID } from './store';
	import { onMount, onDestroy, getContext } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import type { HoloSphere } from "holosphere";
	import { addVisitedHolon, getWalletAddress } from "../utils/localStorage";
	import { fetchHolonName, clearHolonNameCache } from "../utils/holonNames";
	import MyHolonsIcon from './sidebar/icons/MyHolonsIcon.svelte';
	import Menu from 'svelte-feather-icons/src/icons/MenuIcon.svelte';
	import VideoCall from '../components/VideoCall.svelte';
	import WidgetDashboard from '../components/WidgetDashboard.svelte';
	import KeyManager from '../components/KeyManager.svelte';

	export let toggleMyHolons: () => void;

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

	// Refresh holon names when opening MyHolons
	function handleToggleMyHolons() {
		if (browser) {
			window.dispatchEvent(new CustomEvent('refreshAllHolonNames', { detail: { timestamp: Date.now() } }));
		}
		if (isValidHolonId($ID)) {
			updateCurrentHolonName($ID);
		}
		toggleMyHolons();
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

	onMount(async () => {
		isInitialized = true;
		const initialId = $page.params.id;

		if (isValidHolonId(initialId)) {
			ID.set(initialId);
			processedHolonId = initialId;
			updateCurrentHolonName(initialId);
		}

		// Event listeners
		window.addEventListener('toggleWidgetDashboard', toggleWidgetDashboard);
		window.addEventListener('holonNameUpdated', handleHolonNameUpdated as EventListener);
		window.addEventListener('holonNavigated', handleHolonNavigated as EventListener);
	});

	onDestroy(() => {
		if (browser) {
			window.removeEventListener('toggleWidgetDashboard', toggleWidgetDashboard);
			window.removeEventListener('holonNameUpdated', handleHolonNameUpdated as EventListener);
			window.removeEventListener('holonNavigated', handleHolonNavigated as EventListener);
		}
	});
</script>

<div class="topbar">
	<!-- Mobile menu button -->
	<button class="menu-btn lg:hidden" on:click={openSidebar} aria-label="Open menu">
		<Menu size="22" />
	</button>

	{#if !isPrimaryPage}
		<!-- Holon info section -->
		<button class="holon-btn" on:click={handleToggleMyHolons} title="Open My Holons">
			<div class="holon-icon">
				<MyHolonsIcon />
			</div>
			<div class="holon-info">
				<span class="holon-name">
					{currentHolonName || ($ID ? `Holon ${$ID}` : 'Loading...')}
				</span>
				{#if $ID}
					<span class="holon-id">{$ID.length > 16 ? `${$ID.slice(0, 8)}...${$ID.slice(-6)}` : $ID}</span>
				{/if}
			</div>
			<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M6 9l6 6 6-6"/>
			</svg>
		</button>

		<!-- Copy ID button -->
		{#if $ID}
			<button class="icon-btn copy-btn" on:click|stopPropagation={copyHolonId} title="Copy Holon ID">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
					<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
				</svg>
			</button>
		{/if}
	{:else}
		<!-- Root page - centered logo -->
		<button class="logo-btn" on:click={handleToggleMyHolons} title="Open My Holons">
			<div class="logo-icon">
				<MyHolonsIcon />
			</div>
		</button>
	{/if}

	<!-- Spacer -->
	<div class="spacer"></div>

	<!-- Right controls -->
	<div class="controls">
		{#if !isPrimaryPage && $ID}
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
<VideoCall roomId={$ID} bind:show={showVideoCall} floating={true} />
<WidgetDashboard bind:isVisible={showWidgetDashboard} />

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
	}

	.menu-btn:hover {
		color: white;
		background: rgba(55, 65, 81, 0.5);
	}

	.holon-btn {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.375rem 0.75rem;
		background: rgba(31, 41, 55, 0.8);
		border: 1px solid rgba(75, 85, 99, 0.4);
		border-radius: 0.75rem;
		cursor: pointer;
		transition: all 0.2s ease;
		max-width: 320px;
	}

	.holon-btn:hover {
		background: rgba(55, 65, 81, 0.8);
		border-color: rgba(96, 165, 250, 0.4);
		transform: translateY(-1px);
	}

	.holon-icon {
		width: 36px;
		height: 36px;
		flex-shrink: 0;
	}

	.holon-info {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		min-width: 0;
		flex: 1;
	}

	.holon-name {
		font-size: 0.875rem;
		font-weight: 600;
		color: white;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 180px;
	}

	.holon-id {
		font-size: 0.625rem;
		font-family: ui-monospace, monospace;
		color: #6b7280;
		letter-spacing: 0.02em;
	}

	.chevron {
		width: 16px;
		height: 16px;
		color: #6b7280;
		flex-shrink: 0;
		transition: transform 0.2s ease;
	}

	.holon-btn:hover .chevron {
		color: #9ca3af;
	}

	.logo-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem;
		background: transparent;
		border: 2px solid transparent;
		border-radius: 50%;
		cursor: pointer;
		transition: all 0.3s ease;
		margin: 0 auto;
	}

	.logo-btn:hover {
		border-color: rgba(96, 165, 250, 0.5);
		box-shadow: 0 0 20px rgba(96, 165, 250, 0.2);
	}

	.logo-icon {
		width: 48px;
		height: 48px;
	}

	.spacer {
		flex: 1;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
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

	.copy-btn {
		margin-left: -0.25rem;
	}

	.copy-btn:hover {
		color: #60a5fa;
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

		.holon-btn {
			padding: 0.25rem 0.5rem;
			max-width: 200px;
		}

		.holon-icon {
			width: 28px;
			height: 28px;
		}

		.holon-name {
			font-size: 0.8125rem;
			max-width: 120px;
		}

		.holon-id {
			display: none;
		}

		.chevron {
			display: none;
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

		.copy-btn {
			display: none;
		}
	}

	/* Large screens */
	@media (min-width: 1024px) {
		.holon-btn {
			max-width: 400px;
		}

		.holon-name {
			max-width: 280px;
		}
	}
</style>
