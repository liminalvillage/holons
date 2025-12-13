<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { ArrowLeft } from 'svelte-feathers';

	// Props
	export let title: string = '';
	export let holonName: string = '';
	export let showBack: boolean = false;
	export let compact: boolean = false;

	const dispatch = createEventDispatcher();

	function handleBack() {
		dispatch('back');
		// Default behavior: go back in history
		if (typeof window !== 'undefined') {
			window.history.back();
		}
	}
</script>

<header class="title-bar" class:title-bar--compact={compact}>
	{#if showBack}
		<button class="title-bar__back" on:click={handleBack} aria-label="Go back">
			<ArrowLeft size={18} />
		</button>
	{/if}

	<div class="title-bar__content">
		{#if holonName}
			<span class="title-bar__holon-name">{holonName}</span>
		{/if}
		{#if holonName && title}
			<span class="title-bar__separator">/</span>
		{/if}
		{#if title}
			<span class="title-bar__page-title">{title}</span>
		{/if}
	</div>

	<div class="title-bar__actions">
		<slot name="actions" />
	</div>
</header>

<style>
	/* Use CSS custom properties from design system */
	.title-bar {
		display: flex;
		align-items: center;
		gap: var(--spacing-3, 0.75rem);
		height: var(--titlebar-height, 36px);
		padding: 0 var(--spacing-4, 1rem);
		background: var(--color-bg-secondary, #1f2937);
		border-bottom: 1px solid var(--color-border, #374151);
		flex-shrink: 0;
	}

	.title-bar--compact {
		height: var(--titlebar-height-compact, 32px);
		padding: 0 var(--spacing-3, 0.75rem);
	}

	.title-bar__back {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-md, 0.375rem);
		background: transparent;
		border: none;
		color: var(--color-text-secondary, #d1d5db);
		cursor: pointer;
		transition: background-color 150ms ease, color 150ms ease;
	}

	.title-bar__back:hover {
		background: var(--color-bg-tertiary, #374151);
		color: var(--color-text-primary, #ffffff);
	}

	.title-bar__content {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.title-bar__holon-name {
		font-size: var(--font-size-sm, 0.875rem);
		font-weight: var(--font-weight-semibold, 600);
		color: var(--color-accent-light, #6366f1);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.title-bar__separator {
		color: var(--color-text-muted, #6b7280);
		font-size: var(--font-size-sm, 0.875rem);
	}

	.title-bar__page-title {
		font-size: var(--font-size-sm, 0.875rem);
		font-weight: var(--font-weight-medium, 500);
		color: var(--color-text-primary, #ffffff);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.title-bar__actions {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		margin-left: auto;
	}

	/* Responsive adjustments */
	@media (max-width: 768px) {
		.title-bar {
			height: var(--titlebar-height-compact, 32px);
			padding: 0 var(--spacing-3, 0.75rem);
		}

		.title-bar__holon-name,
		.title-bar__page-title {
			font-size: var(--font-size-xs, 0.75rem);
		}
	}
</style>
