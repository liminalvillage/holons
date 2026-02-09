<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { ID, walletAddress } from './store';
	import { onMount, onDestroy, getContext } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import type { HoloSphere } from "holosphere";
	import { addVisitedHolon, getWalletAddress, loadVisitedHolons, saveVisitedHolons, type VisitedHolon } from "../utils/localStorage";
	import { nameMap, resolveName, forceRefresh, awaitName } from '$lib/stores/nameResolver';
	import Menu from 'svelte-feather-icons/src/icons/MenuIcon.svelte';
	import VideoCall from '../components/VideoCall.svelte';
	import WidgetDashboard from '../components/WidgetDashboard.svelte';
	import TopNavItems from './TopNavItems.svelte';

	declare const __COMMIT_HASH__: string;
	const commitHash = typeof __COMMIT_HASH__ !== 'undefined' ? __COMMIT_HASH__ : 'dev';

	const dispatch = createEventDispatcher();

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

	// Resolve holon name reactively
	function updateCurrentHolonName(id: string, attempt = 0) {
		if (!isValidHolonId(id)) {
			currentHolonName = undefined;
			return;
		}

		if (attempt > 0) {
			forceRefresh(id);
		} else {
			resolveName(id);
		}

		// Update currentHolonName from store
		const name = $nameMap[id];
		currentHolonName = name || `Holon ${id}`;

		// Retry if we got a fallback and haven't exhausted attempts
		if (!name && attempt < 2) {
			setTimeout(() => updateCurrentHolonName(id, attempt + 1), 500 * (attempt + 1));
		}
	}

	// Route management - preserve lens when switching holons
	function updateRoute(id: string) {
		if (!isValidHolonId(id)) {
			if (browser && $page.url.pathname !== '/') goto('/');
			return;
		}

		const currentPath = $page.url.pathname;
		if (browser && !currentPath.startsWith(`/${id}`)) {
			const pathParts = currentPath.split('/');
			let subPath = pathParts[pathParts.length - 1];
			const protectedRoutes = ['video', 'map', 'settings', 'roles', 'offers', 'tasks', 'calendar', 'shopping', 'checklists', 'status', 'federation', 'dashboard', 'db', 'flow'];

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

	// Keep currentHolonName in sync with reactive nameMap
	$: if ($ID && $nameMap[$ID]) {
		currentHolonName = $nameMap[$ID];
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

<nav class="topbar" aria-label="Main navigation">
	<!-- Menu button to toggle sidebar -->
	<button class="topbar__menu-btn" onclick={() => dispatch('toggleBrowser')} aria-label="Toggle sidebar">
		<Menu size="20" />
	</button>

	<!-- Navigation tabs (lens switching) -->
	<div class="topbar__tabs">
		<TopNavItems />
	</div>

	<!-- Right controls -->
	<div class="topbar__controls">
		<span class="topbar__version" title="Build: {commitHash}">{commitHash}</span>
		{#if !isPrimaryPage && $ID}
			<!-- Widget Dashboard toggle -->
			<button class="topbar__icon-btn" onclick={toggleWidgetDashboard} title="Widget Dashboard">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<rect x="3" y="3" width="7" height="7" rx="1"/>
					<rect x="14" y="3" width="7" height="7" rx="1"/>
					<rect x="3" y="14" width="7" height="7" rx="1"/>
					<rect x="14" y="14" width="7" height="7" rx="1"/>
				</svg>
			</button>

			<!-- Video Call button -->
			<button class="topbar__icon-btn" onclick={startVideoCall} title="Video Call">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
				</svg>
			</button>
		{/if}

		<!-- Google Translate -->
		<div id="google_translate_element" class="topbar__translate"></div>
	</div>
</nav>

<!-- Floating components -->
<VideoCall roomId={$ID || ''} bind:show={showVideoCall} floating={true} />
<WidgetDashboard bind:isVisible={showWidgetDashboard} />

<style>
	.topbar {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		padding: 0 var(--spacing-3, 0.75rem);
		background: var(--color-bg-secondary, #1f2937);
		border-bottom: 1px solid var(--color-border, #374151);
		height: 48px;
		flex-shrink: 0;
	}

	.topbar__menu-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		padding: 0;
		color: var(--color-text-secondary, #d1d5db);
		background: transparent;
		border: none;
		border-radius: var(--radius-md, 0.375rem);
		cursor: pointer;
		transition: background-color 150ms ease, color 150ms ease;
		flex-shrink: 0;
	}

	.topbar__menu-btn:hover {
		color: var(--color-text-primary, #ffffff);
		background: var(--color-bg-tertiary, #374151);
	}

	.topbar__tabs {
		flex: 1;
		min-width: 0;
		height: 100%;
		display: flex;
		align-items: stretch;
	}

	.topbar__controls {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		flex-shrink: 0;
	}

	.topbar__icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		background: transparent;
		border: none;
		border-radius: var(--radius-md, 0.375rem);
		color: var(--color-text-muted, #6b7280);
		cursor: pointer;
		transition: background-color 150ms ease, color 150ms ease;
	}

	.topbar__icon-btn svg {
		width: 18px;
		height: 18px;
	}

	.topbar__icon-btn:hover {
		color: var(--color-text-primary, #ffffff);
		background: var(--color-bg-tertiary, #374151);
	}

	.topbar__translate {
		transform: scale(0.75);
		transform-origin: right center;
	}

	.topbar__version {
		font-size: 10px;
		font-family: monospace;
		color: var(--color-text-muted, #6b7280);
		opacity: 0.6;
		padding: 2px 6px;
		background: var(--color-bg-tertiary, #374151);
		border-radius: var(--radius-sm, 0.25rem);
		cursor: default;
	}

	/* Mobile adjustments */
	@media (max-width: 640px) {
		.topbar {
			padding: 0 var(--spacing-2, 0.5rem);
			height: 44px;
		}

		.topbar__menu-btn {
			width: 32px;
			height: 32px;
		}

		.topbar__icon-btn {
			width: 28px;
			height: 28px;
		}

		.topbar__icon-btn svg {
			width: 16px;
			height: 16px;
		}

		.topbar__translate {
			display: none;
		}
	}
</style>
