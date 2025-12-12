<script lang="ts">
	import 'tailwindcss/tailwind.css';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { data } from './sidebar/data';
	import { onDestroy } from 'svelte';
	import { autoTransitionEnabled } from './store';

	import TopBar from './TopBar.svelte';
	import Overlay from './Overlay.svelte';
	import Sidebar from './sidebar/Sidebar.svelte';
	import RouteTransition from '../components/RouteTransition.svelte';

	const style = {
		container: `bg-gray-900 h-screen overflow-hidden relative flex flex-col`,
		mainContainer: `flex flex-col flex-1 pl-0 w-full lg:pl-20 lg:space-y-4 overflow-hidden`,
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
	<!-- Normal dashboard layout -->
	<div class={style.container} on:mousemove={handleMouseMove} role="presentation">
		<!-- TopBar spans full width above everything -->
		<TopBar />
		<div class="flex items-stretch dashboard-content">
			<Overlay />
			<Sidebar mobileOrientation="start" />
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
