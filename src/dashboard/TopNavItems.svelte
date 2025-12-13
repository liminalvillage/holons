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

<nav class="top-nav" aria-label="Main navigation">
	<div class="nav-cards">
		{#each data as item (item.title)}
			<button
				class="nav-card"
				class:nav-card--active={isActive(item.link)}
				on:click={() => navigateTo(item.link)}
				on:keydown={(e) => handleKeydown(e, item.link)}
				title={item.title}
				disabled={!currentHolonId}
			>
				<span class="nav-card__icon">
					<svelte:component this={item.icon} />
				</span>
				<span class="nav-card__label">{item.title}</span>
			</button>
		{/each}
	</div>
</nav>

<style>
	.top-nav {
		display: flex;
		align-items: center;
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.nav-cards {
		display: flex;
		align-items: center;
		gap: var(--spacing-1, 0.25rem);
		overflow-x: auto;
		scrollbar-width: none;
		-ms-overflow-style: none;
		padding: var(--spacing-1, 0.25rem) 0;
	}

	.nav-cards::-webkit-scrollbar {
		display: none;
	}

	.nav-card {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md, 0.375rem);
		color: var(--color-text-secondary, #d1d5db);
		font-size: var(--font-size-sm, 0.875rem);
		font-weight: var(--font-weight-medium, 500);
		white-space: nowrap;
		cursor: pointer;
		transition: all 150ms ease;
		flex-shrink: 0;
	}

	.nav-card:hover:not(:disabled) {
		background: var(--color-bg-secondary, #1f2937);
		border-color: var(--color-border, #374151);
		color: var(--color-text-primary, #ffffff);
	}

	.nav-card:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.nav-card--active {
		background: var(--color-accent, #4f46e5);
		border-color: var(--color-accent, #4f46e5);
		color: var(--color-text-primary, #ffffff);
	}

	.nav-card--active:hover:not(:disabled) {
		background: var(--color-accent-hover, #4338ca);
		border-color: var(--color-accent-hover, #4338ca);
	}

	.nav-card__icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		flex-shrink: 0;
	}

	.nav-card__icon :global(svg) {
		width: 100%;
		height: 100%;
	}

	.nav-card__label {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Mobile: Hide labels, show only icons */
	@media (max-width: 768px) {
		.nav-card {
			padding: var(--spacing-2, 0.5rem);
		}

		.nav-card__label {
			display: none;
		}

		.nav-card__icon {
			width: 20px;
			height: 20px;
		}
	}

	/* Tablet: Show shorter labels */
	@media (min-width: 769px) and (max-width: 1024px) {
		.nav-card {
			padding: var(--spacing-2, 0.5rem) var(--spacing-2, 0.5rem);
		}

		.nav-card__label {
			font-size: var(--font-size-xs, 0.75rem);
		}
	}
</style>
