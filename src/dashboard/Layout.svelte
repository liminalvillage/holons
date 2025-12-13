<script lang="ts">
	import 'tailwindcss/tailwind.css';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { data } from './sidebar/data';
	import { onDestroy } from 'svelte';
	import { autoTransitionEnabled, sidebarExpanded } from './store';

	import TopBar from './TopBar.svelte';
	import Overlay from './Overlay.svelte';
	import BrowserPanel from './browser/BrowserPanel.svelte';
	import RouteTransition from '../components/RouteTransition.svelte';

	// Browser panel state (replaces sidebar for holon browsing)
	let browserOpen = false;

	// Open browser panel
	function openBrowser() {
		browserOpen = true;
	}

	// Close browser panel
	function closeBrowser() {
		browserOpen = false;
	}

	// Toggle browser panel
	function toggleBrowser() {
		browserOpen = !browserOpen;
	}

	// Handle add holon from browser panel
	function handleAddHolon() {
		// Dispatch event to TopBar to open the add holon modal
		window.dispatchEvent(new CustomEvent('openAddHolonModal'));
	}

	const style = {
		container: `bg-gray-900 h-screen overflow-hidden relative flex flex-col`,
		// Updated: removed left padding since browser panel handles its own width
		mainContainer: `flex flex-col flex-1 w-full overflow-hidden`,
		main: `flex-1 overflow-auto pb-8 pt-2 px-2 md:pb-8 md:pt-2 lg:pt-2 lg:px-4`,
		rootContainer: `bg-gray-900 h-screen overflow-hidden relative`,
		rootMain: `h-screen overflow-auto p-4`
	};

	let lastMouseMove = Date.now();
	let currentRouteIndex = 0;

	// Check if we're on a QR route
	$: isQrRoute = $page.url.pathname.includes('/qr');

	// Define the allowed routes for auto-switching
	const allowedRoutes = data.filter(item => 
		['/tasks', '/schedule', '/roles', '/offers', '/status'].includes(item.link)
	);

	// Handle mouse movement
	function handleMouseMove() {
		lastMouseMove = Date.now();
	}

	// Toggle overlay dashboard
	function toggleOverlayDashboard() {
		window.dispatchEvent(new CustomEvent('toggleWidgetDashboard'));
	}

	// Handle global keyboard shortcuts
	function handleGlobalKeydown(event: KeyboardEvent) {
		// Toggle overlay dashboard with Ctrl+Shift+Z or Cmd+Shift+Z
		if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'Z') {
			event.preventDefault();
			toggleOverlayDashboard();
		}
	}

	// Set up auto-switching if in browser
	if (browser) {
		// Set up mouse move listener
		window.addEventListener('mousemove', handleMouseMove);

		// Set up custom event listener for Overlay dashboard
		window.addEventListener('toggleOverlayDashboard', () => {
			// Dispatch the event to TopBar instead
			window.dispatchEvent(new CustomEvent('toggleWidgetDashboard'));
		});

		// Auto-switching is disabled by default - removed timer logic
		// Users can manually enable it if needed through the store

		// Cleanup on component destroy
		onDestroy(() => {
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('toggleOverlayDashboard', () => {
				toggleOverlayDashboard();
			});
		});
	}

	</script>

<svelte:window on:keydown={handleGlobalKeydown} />

{#if isQrRoute}
	<!-- QR route layout: Clean view without topbar/sidebar -->
	<div class={style.rootContainer}>
		<main class={style.rootMain}>
			<RouteTransition pathname={$page.url.pathname}>
				<slot />
			</RouteTransition>
		</main>
	</div>
{:else}
	<!-- Normal dashboard layout with flipped structure -->
	<!-- Left: Holon Browser, Top: Navigation Cards, Right: Content -->
	<div class={style.container} on:mousemove={handleMouseMove} role="presentation">
		<!-- TopBar spans full width above everything - now contains navigation cards -->
		<TopBar on:toggleBrowser={toggleBrowser} />

		<div class="flex items-stretch dashboard-content">
			<Overlay />

			<!-- Browser Panel (left side) - for browsing holons -->
			<BrowserPanel
				isOpen={browserOpen}
				on:close={closeBrowser}
				on:add={handleAddHolon}
			/>

			<!-- Mobile overlay backdrop -->
			{#if browserOpen}
				<button
					class="browser-backdrop"
					on:click={closeBrowser}
					aria-label="Close browser panel"
				></button>
			{/if}

			<!-- Main content area -->
			<div class={style.mainContainer}>
				<main class={style.main}>
					<RouteTransition pathname={$page.url.pathname}>
						<slot />
					</RouteTransition>
				</main>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Dashboard content takes remaining height */
	.dashboard-content {
		flex: 1;
		overflow: hidden;
		min-height: 0; /* Important for flex scroll containers */
		position: relative;
	}

	/* Browser panel backdrop for mobile */
	.browser-backdrop {
		display: none;
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: var(--z-overlay, 40);
		border: none;
		cursor: pointer;
	}

	@media (max-width: 1024px) {
		.browser-backdrop {
			display: block;
		}
	}

	/* Hide scrollbars while keeping scroll functionality */
	:global(html) {
		/* Firefox */
		scrollbar-width: none;
	}

	:global(body) {
		/* Firefox */
		scrollbar-width: none;
	}

	/* Webkit browsers (Chrome, Safari, Edge) */
	:global(*::-webkit-scrollbar) {
		display: none;
		width: 0;
		height: 0;
	}

	:global(*::-webkit-scrollbar-track) {
		display: none;
	}

	:global(*::-webkit-scrollbar-thumb) {
		display: none;
	}

	:global(*::-webkit-scrollbar-corner) {
		display: none;
	}

	/* Ensure scrolling still works */
	:global(*) {
		-ms-overflow-style: none; /* Internet Explorer 10+ */
	}
</style>
