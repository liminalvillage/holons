<script lang="ts">
	import 'tailwindcss/tailwind.css';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { data } from './sidebar/data';
	import { onDestroy, onMount, setContext } from 'svelte';
	import { autoTransitionEnabled } from './store';
	import { fade, slide } from 'svelte/transition';

	import TopBar from './TopBar.svelte';
	import Overlay from './Overlay.svelte';
	import Sidebar from './sidebar/Sidebar.svelte';
	import MyHolons from '../components/MyHolons.svelte';
	import RouteTransition from '../components/RouteTransition.svelte';

	const style = {
		container: `bg-gray-900 h-screen overflow-hidden relative`,
		mainContainer: `flex flex-col h-screen pl-0 w-full lg:pl-20 lg:space-y-4`,
		main: `h-screen overflow-auto pb-8 pt-4 px-2 md:pb-8 md:pt-4 lg:pt-0 lg:px-4`,
		rootContainer: `bg-gray-900 h-screen overflow-hidden relative`,
		rootMain: `h-screen overflow-auto p-4`
	};

	let lastMouseMove = Date.now();
	let currentRouteIndex = 0;
	let showMyHolons = false;

	// Check if we're on the root route
	$: isRootRoute = $page.url.pathname === '/';
	
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

	// Handler for the custom toggleOverlayDashboard event (stored reference for cleanup)
	function handleToggleOverlayDashboard() {
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

	function toggleMyHolons() {
		showMyHolons = !showMyHolons;
	}


	// Set up auto-switching if in browser
	if (browser) {
		// Set up mouse move listener
		window.addEventListener('mousemove', handleMouseMove);

		// Set up custom event listener for Overlay dashboard
		window.addEventListener('toggleOverlayDashboard', handleToggleOverlayDashboard);

		// Auto-switching is disabled by default - removed timer logic
		// Users can manually enable it if needed through the store

		// Cleanup on component destroy
		onDestroy(() => {
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('toggleOverlayDashboard', handleToggleOverlayDashboard);
		});
	}

	// Close drawer when a holon is selected (ID changes)
	page.subscribe((val) => {
		if (showMyHolons) {
			showMyHolons = false;
		}
	});

</script>

<svelte:window on:keydown={handleGlobalKeydown} />

{#if isRootRoute}
	<!-- Root route layout: Clean MyHolons view -->
	<div class={style.rootContainer}>
		<main class={style.rootMain}>
			<MyHolons />
		</main>
	</div>
{:else if isQrRoute}
	<!-- QR route layout: Clean view without topbar/sidebar -->
	<div class={style.rootContainer}>
		<main class={style.rootMain}>
			<RouteTransition pathname={$page.url.pathname}>
				<slot />
			</RouteTransition>
		</main>
	</div>
{:else}
	<!-- Normal dashboard layout -->
	<div class={style.container} on:mousemove={handleMouseMove} role="presentation">
		<div class="flex items-start">
			<Overlay />
			<Sidebar mobileOrientation="start" />
			<div class={style.mainContainer}>
				<TopBar {toggleMyHolons} />
				<main class={style.main}>
					<RouteTransition pathname={$page.url.pathname}>
						<slot />
					</RouteTransition>
				</main>
			</div>
		</div>

		{#if showMyHolons}
			<div
				class="absolute inset-0 z-40"
				on:click|self={() => showMyHolons = false}
				role="presentation"
				transition:fade
			>
				<div class="absolute top-0 left-4 right-4" transition:slide>
					<div class="bg-gray-900/90 backdrop-blur-sm max-h-[80vh] overflow-y-auto rounded-b-xl">
						<MyHolons />
					</div>
				</div>
			</div>
		{/if}

	</div>
{/if}

<style>
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
