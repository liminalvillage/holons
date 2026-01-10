<script lang="ts">
	import { data } from './data';
	import { page } from '$app/stores';
	import { sidebarExpanded } from '../store';
	import { nostrPublicKey } from '$lib/stores/nostr';

	const style = {
		title: `mx-2 text-sm whitespace-pre`,
		iconContainer: `w-10 h-10 flex items-center justify-center rounded-full transition-all duration-200 flex-shrink-0`,
		icon: `w-5 h-5 flex items-center justify-center`,
		active: `bg-indigo-600 text-white`,
		inactive: `hover:bg-gray-700`,
		link: `flex items-center justify-start my-0.5 p-2 w-full hover:text-white whitespace-pre transition-all duration-200 min-w-0`,
		close: `lg:duration-700 lg:ease-out lg:invisible lg:opacity-0 lg:transition-all`,
		open: `lg:duration-500 lg:ease-in lg:h-auto lg:opacity-100 lg:transition-all lg:w-auto`
	};

	// Reactive statement to ensure component updates when page changes
	$: currentPath = $page.url.pathname;
	$: holonId = $page.params.id;
	$: homeHolonId = $nostrPublicKey;

	// Check if we have a valid holon selected
	$: hasValidHolon = holonId && holonId !== 'undefined' && holonId !== 'null' && holonId.trim() !== '';

    // Filter data to only show navigation items when a holon is selected
    // But always show primary pages (standalone routes)
	$: filteredData = data.filter(item => {
        // Always show standalone routes (primary pages)
        if (item.link === '/' || item.link === '/sdgs') {
			return true;
		}
		// Only show other items when a holon is selected
		return hasValidHolon;
	});

	// Reactive active states for each item
    $: activeStates = filteredData.map(item => {
        // Handle standalone routes (primary pages) vs holon-specific routes
        const isStandaloneRoute = item.link === '/' || item.link === '/sdgs';

		// Use home holon for items marked with useHomeHolon, otherwise use current holon
		const targetHolonId = item.useHomeHolon && homeHolonId ? homeHolonId : holonId;
		const itemPath = isStandaloneRoute ? item.link : '/' + targetHolonId + item.link;
		let isActive = false;

		// Exact match
		if (currentPath === itemPath) {
			isActive = true;
		}
		// Handle dashboard as default route
		else if (item.link === '/dashboard' && currentPath === '/' + holonId) {
			isActive = true;
		}
		// Handle nested routes (e.g., /dashboard/ should match /dashboard)
        else if (!isStandaloneRoute && currentPath.startsWith(itemPath + '/')) {
			isActive = true;
		}
		// Handle exact path matches for holon-specific routes
		else if (!isStandaloneRoute && currentPath === itemPath) {
			isActive = true;
		}

		return {
			...item,
			isActive,
			isStandaloneRoute,
			targetHolonId
		};
	});
</script>

<ul class="md:pl-3 overflow-hidden">
	<li>
		{#each activeStates as item (item.title)}
            <a class={style.link} href={item.isStandaloneRoute ? item.link : '/'+$page.params.id+item.link}>
				<div class={`${style.iconContainer} ${item.isActive ? style.active : style.inactive}`}>
					<div class={style.icon}>
						<svelte:component this={item.icon} />
					</div>
				</div>
				<span class={`${style.title} ${$sidebarExpanded ? style.open : style.close} truncate`}>
					{item.title}
				</span>
			</a>
		{/each}
	</li>
</ul>
