<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { ID } from './store';
	import { data } from './sidebar/data';

	// Get current holon ID
	$: currentHolonId = $ID;

	// Get current path to highlight active item
	$: currentPath = $page.url.pathname;

	// Check if a nav item is active
	function isActive(link: string): boolean {
		if (!currentHolonId) return false;
		const fullPath = `/${currentHolonId}${link}`;
		return currentPath === fullPath || currentPath.startsWith(fullPath + '/');
	}

	// Navigate to a page
	function navigateTo(link: string) {
		if (currentHolonId) {
			goto(`/${currentHolonId}${link}`);
		}
	}

	// Handle keyboard navigation
	function handleKeydown(event: KeyboardEvent, link: string) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			navigateTo(link);
		}
	}

	// Group navigation items for better organization
	const primaryNav = data.slice(0, 6);  // Dashboard, Tasks, Schedule, Expenses, Roles, Map
	const secondaryNav = data.slice(6);   // Rest of the items

	// The tab strip scrolls horizontally when the lenses don't fit (always, on a
	// phone). Without an affordance it just looks like the page is cut off at the
	// edge, so fade whichever side still has tabs beyond it.
	let listEl: HTMLDivElement | undefined;
	let atStart = true;
	let atEnd = true;

	function updateEdges() {
		if (!listEl) return;
		const max = listEl.scrollWidth - listEl.clientWidth;
		atStart = listEl.scrollLeft <= 1;
		// `max <= 1` → nothing to scroll: both fades stay off.
		atEnd = listEl.scrollLeft >= max - 1;
	}

	onMount(() => {
		updateEdges();
		// The strip's own box changes with the window; its *content* width changes
		// when the labels drop out at the mobile breakpoint, which the reactive
		// statement below picks up.
		const ro = new ResizeObserver(updateEdges);
		if (listEl) ro.observe(listEl);
		return () => ro.disconnect();
	});

	// Re-measure after a navigation (active tab styling can change widths) and
	// once the holon id arrives (tabs go from disabled to live).
	$: if (listEl && (currentPath || currentHolonId)) tick().then(updateEdges);
</script>

<nav
	class="tabs"
	class:tabs--fade-start={!atStart}
	class:tabs--fade-end={!atEnd}
	aria-label="Main navigation"
>
	<div class="tabs__list" role="tablist" bind:this={listEl} on:scroll={updateEdges}>
		{#each data as item (item.title)}
			<button
				class="tab"
				class:tab--active={isActive(item.link)}
				on:click={() => navigateTo(item.link)}
				on:keydown={(e) => handleKeydown(e, item.link)}
				title={item.title}
				disabled={!currentHolonId}
				role="tab"
				aria-selected={isActive(item.link)}
			>
				<span class="tab__icon">
					<svelte:component this={item.icon} />
				</span>
				<span class="tab__label">{item.title}</span>
			</button>
		{/each}
	</div>
</nav>

<style>
	.tabs {
		display: flex;
		align-items: stretch;
		flex: 1;
		min-width: 0;
		height: 100%;
		position: relative;
	}

	/* Scroll affordance: a short wash of the topbar's own background over
	   whichever end still has tabs past it. Purely decorative — never eats a
	   tap meant for the tab underneath. */
	.tabs::before,
	.tabs::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1.5rem;
		pointer-events: none;
		opacity: 0;
		transition: opacity 150ms ease;
		z-index: 1;
	}

	.tabs::before {
		left: 0;
		background: linear-gradient(
			to right,
			var(--color-bg-secondary) 15%,
			transparent
		);
	}

	.tabs::after {
		right: 0;
		background: linear-gradient(
			to left,
			var(--color-bg-secondary) 15%,
			transparent
		);
	}

	.tabs--fade-start::before,
	.tabs--fade-end::after {
		opacity: 1;
	}

	@media (prefers-reduced-motion: reduce) {
		.tabs::before,
		.tabs::after {
			transition: none;
		}
	}

	.tabs__list {
		display: flex;
		align-items: stretch;
		gap: 0;
		overflow-x: auto;
		scrollbar-width: none;
		-ms-overflow-style: none;
		-webkit-overflow-scrolling: touch;
	}

	.tabs__list::-webkit-scrollbar {
		display: none;
	}

	.tab {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-2, 0.5rem);
		padding: 0 var(--spacing-4, 1rem);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--color-text-muted, var(--color-text-muted));
		font-size: var(--font-size-sm, 0.875rem);
		font-weight: var(--font-weight-medium, 500);
		white-space: nowrap;
		cursor: pointer;
		transition: color 150ms ease, border-color 150ms ease, background-color 150ms ease;
		flex-shrink: 0;
		position: relative;
	}

	.tab:hover:not(:disabled) {
		color: var(--color-text-secondary, var(--color-text-secondary));
		background: var(--color-bg-tertiary, var(--color-bg-tertiary));
	}

	.tab:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.tab--active {
		color: var(--color-text-primary, #ffffff);
		border-bottom-color: var(--color-accent, var(--color-accent));
		background: var(--color-bg-tertiary, var(--color-bg-tertiary));
	}

	.tab--active:hover:not(:disabled) {
		color: var(--color-text-primary, #ffffff);
		border-bottom-color: var(--color-accent-light, var(--color-accent-light));
	}

	.tab__icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}

	.tab__icon :global(svg) {
		width: 100%;
		height: 100%;
	}

	.tab__label {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Mobile: Compact tabs with icons only */
	@media (max-width: 640px) {
		.tab {
			padding: 0 var(--spacing-3, 0.75rem);
		}

		.tab__label {
			display: none;
		}

		.tab__icon {
			width: 18px;
			height: 18px;
		}
	}

	/* Tablet: Slightly more compact */
	@media (min-width: 641px) and (max-width: 1024px) {
		.tab {
			padding: 0 var(--spacing-3, 0.75rem);
		}

		.tab__label {
			font-size: var(--font-size-xs, 0.75rem);
		}
	}

	/* Large screens: More spacious tabs */
	@media (min-width: 1280px) {
		.tab {
			padding: 0 var(--spacing-5, 1.25rem);
		}
	}
</style>
