<script lang="ts">
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
</script>

<nav class="tabs" aria-label="Main navigation">
	<div class="tabs__list" role="tablist">
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
		color: var(--color-text-muted, #6b7280);
		font-size: var(--font-size-sm, 0.875rem);
		font-weight: var(--font-weight-medium, 500);
		white-space: nowrap;
		cursor: pointer;
		transition: color 150ms ease, border-color 150ms ease, background-color 150ms ease;
		flex-shrink: 0;
		position: relative;
	}

	.tab:hover:not(:disabled) {
		color: var(--color-text-secondary, #d1d5db);
		background: var(--color-bg-tertiary, #374151);
	}

	.tab:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.tab--active {
		color: var(--color-text-primary, #ffffff);
		border-bottom-color: var(--color-accent, #4f46e5);
		background: var(--color-bg-tertiary, #374151);
	}

	.tab--active:hover:not(:disabled) {
		color: var(--color-text-primary, #ffffff);
		border-bottom-color: var(--color-accent-light, #6366f1);
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
