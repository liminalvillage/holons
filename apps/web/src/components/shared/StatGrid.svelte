<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	// Props
	export let collapsible: boolean = false;
	export let collapsed: boolean = false;
	export let title: string = 'Statistics';

	const dispatch = createEventDispatcher();

	function toggleCollapsed() {
		collapsed = !collapsed;
		dispatch('toggle', { collapsed });
	}
</script>

<section class="stats-section" class:stats-section--expanded={!collapsed}>
	{#if collapsible}
		<button class="stats-section__toggle" on:click={toggleCollapsed}>
			<span>{collapsed ? 'Show' : 'Hide'} {title}</span>
			<svg
				class="stats-section__chevron"
				class:stats-section__chevron--up={!collapsed}
				width="16"
				height="16"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
			>
				<path d="M4 6l4 4 4-4" />
			</svg>
		</button>
	{/if}

	<div class="stats-section__content">
		<div class="stat-grid">
			<slot />
		</div>
	</div>
</section>

<style>
	.stats-section {
		position: relative;
	}

	.stats-section__toggle {
		display: none;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-2, 0.5rem);
		width: 100%;
		padding: var(--spacing-2, 0.5rem);
		background: var(--color-bg-secondary, var(--color-bg-secondary));
		border: 1px solid var(--color-border, var(--color-bg-tertiary));
		border-radius: var(--radius-md, 0.375rem);
		color: var(--color-text-secondary, var(--color-text-secondary));
		font-size: var(--font-size-sm, 0.875rem);
		cursor: pointer;
		transition: background-color 150ms ease, color 150ms ease;
	}

	.stats-section__toggle:hover {
		background: var(--color-bg-tertiary, var(--color-bg-tertiary));
		color: var(--color-text-primary, #ffffff);
	}

	.stats-section__chevron {
		transition: transform 200ms ease;
	}

	.stats-section__chevron--up {
		transform: rotate(180deg);
	}

	.stats-section__content {
		transition: max-height 350ms ease, opacity 200ms ease;
	}

	.stat-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: var(--spacing-4, 1rem);
	}

	/* Responsive grid */
	@media (max-width: 1200px) {
		.stat-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}

	@media (max-width: 900px) {
		.stat-grid {
			grid-template-columns: repeat(2, 1fr);
			gap: var(--spacing-3, 0.75rem);
		}
	}

	@media (max-width: 600px) {
		.stats-section__toggle {
			display: flex;
			margin-bottom: var(--spacing-3, 0.75rem);
		}

		.stats-section__content {
			max-height: 500px;
			overflow: hidden;
		}

		.stats-section:not(.stats-section--expanded) .stats-section__content {
			max-height: 0;
			opacity: 0;
		}

		.stats-section:not(.stats-section--expanded) .stats-section__toggle {
			margin-bottom: 0;
		}

		.stat-grid {
			grid-template-columns: repeat(2, 1fr);
			gap: var(--spacing-2, 0.5rem);
		}
	}
</style>
