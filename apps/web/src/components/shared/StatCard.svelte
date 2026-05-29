<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	// Props
	export let label: string;
	export let value: number | string;
	export let icon: any = null;
	export let trend: 'up' | 'down' | 'neutral' = 'neutral';
	export let trendValue: string = '';
	export let compact: boolean = false;
	export let clickable: boolean = false;
	export let progress: number | null = null; // Optional progress bar (0-100)
	export let subtext: string = ''; // Optional subtext like "5/10 completed"

	const dispatch = createEventDispatcher();

	function handleClick() {
		if (clickable) {
			dispatch('click');
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (clickable && (event.key === 'Enter' || event.key === ' ')) {
			event.preventDefault();
			dispatch('click');
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="stat-card"
	class:stat-card--compact={compact}
	class:stat-card--clickable={clickable}
	role={clickable ? 'button' : undefined}
	tabindex={clickable ? 0 : undefined}
	on:click={handleClick}
	on:keydown={handleKeydown}
>
	{#if icon}
		<div class="stat-card__icon">
			<svelte:component this={icon} size={compact ? 16 : 20} />
		</div>
	{/if}

	<div class="stat-card__content">
		<div class="stat-card__top">
			<span class="stat-card__value">{value}</span>
			{#if trendValue && trend !== 'neutral'}
				<span class="stat-card__trend stat-card__trend--{trend}">
					{#if trend === 'up'}+{/if}{trendValue}
				</span>
			{/if}
		</div>
		<span class="stat-card__label">{label}</span>
		{#if subtext}
			<span class="stat-card__subtext">{subtext}</span>
		{/if}
		{#if progress !== null}
			<div class="stat-card__progress">
				<div class="stat-card__progress-bar" style="width: {Math.min(100, Math.max(0, progress))}%"></div>
			</div>
		{/if}
	</div>
</div>

<style>
	.stat-card {
		display: flex;
		align-items: flex-start;
		gap: var(--spacing-3, 0.75rem);
		padding: var(--spacing-4, 1rem);
		background: var(--color-bg-secondary, var(--color-bg-secondary));
		border-radius: var(--radius-lg, 0.5rem);
		border: 1px solid var(--color-border, var(--color-bg-tertiary));
		transition: all 250ms ease;
	}

	.stat-card:hover {
		border-color: var(--color-border-light, var(--color-border-light));
	}

	.stat-card--compact {
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		gap: var(--spacing-2, 0.5rem);
	}

	.stat-card--clickable {
		cursor: pointer;
	}

	.stat-card--clickable:hover {
		background: var(--color-bg-tertiary, var(--color-bg-tertiary));
		transform: translateY(-1px);
	}

	.stat-card--clickable:active {
		transform: translateY(0);
	}

	.stat-card__icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: var(--radius-md, 0.375rem);
		background: var(--color-accent-subtle, rgba(79, 70, 229, 0.1));
		color: var(--color-accent-light, var(--color-accent-light));
		flex-shrink: 0;
	}

	.stat-card--compact .stat-card__icon {
		width: 32px;
		height: 32px;
	}

	.stat-card__content {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-1, 0.25rem);
		min-width: 0;
		flex: 1;
	}

	.stat-card__top {
		display: flex;
		align-items: baseline;
		gap: var(--spacing-2, 0.5rem);
	}

	.stat-card__value {
		font-size: var(--font-size-2xl, 1.5rem);
		font-weight: var(--font-weight-bold, 700);
		color: var(--color-text-primary, #ffffff);
		line-height: 1.2;
	}

	.stat-card--compact .stat-card__value {
		font-size: var(--font-size-lg, 1.125rem);
	}

	.stat-card__label {
		font-size: var(--font-size-sm, 0.875rem);
		color: var(--color-text-muted, var(--color-text-muted));
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.stat-card--compact .stat-card__label {
		font-size: var(--font-size-xs, 0.75rem);
	}

	.stat-card__subtext {
		font-size: var(--font-size-xs, 0.75rem);
		color: var(--color-text-muted, var(--color-text-muted));
	}

	.stat-card__trend {
		font-size: var(--font-size-xs, 0.75rem);
		font-weight: var(--font-weight-medium, 500);
	}

	.stat-card__trend--up {
		color: var(--color-success, #10b981);
	}

	.stat-card__trend--down {
		color: var(--color-error, #ef4444);
	}

	.stat-card__trend--neutral {
		color: var(--color-text-muted, var(--color-text-muted));
	}

	.stat-card__progress {
		width: 100%;
		height: 4px;
		background: var(--color-bg-primary, var(--color-bg-primary));
		border-radius: var(--radius-full, 9999px);
		overflow: hidden;
		margin-top: var(--spacing-1, 0.25rem);
	}

	.stat-card__progress-bar {
		height: 100%;
		background: var(--color-accent, var(--color-accent));
		border-radius: var(--radius-full, 9999px);
		transition: width 300ms ease;
	}

	/* Mobile responsive */
	@media (max-width: 600px) {
		.stat-card {
			padding: var(--spacing-3, 0.75rem);
		}

		.stat-card__icon {
			display: none;
		}

		.stat-card__value {
			font-size: var(--font-size-lg, 1.125rem);
		}

		.stat-card__label {
			font-size: var(--font-size-xs, 0.75rem);
		}
	}
</style>
