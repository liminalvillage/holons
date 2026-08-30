<script lang="ts">
	import { createEventDispatcher, type ComponentType } from 'svelte';
	import { ArrowLeft, Globe, Eye, AlertTriangle } from 'svelte-feathers';
	import ToggleChip from './ToggleChip.svelte';
	import { showFederated, showHolograms, showUnverified } from '$lib/stores/lensFilters';

	// Props
	export let title: string = '';
	export let holonName: string = '';
	/** Optional holon id; surfaced as a tooltip on the holon name so the
	 *  breadcrumb stays clean (`HolonName / Tasks`) but the id is still
	 *  one hover away. */
	export let holonId: string | null | undefined = '';
	export let showBack: boolean = false;
	export let compact: boolean = false;
	export let icon: ComponentType | null = null;
	/** Lens views opt in to render the global federation/hologram toggles.
	 *  Pages that don't fetch lens data (Settings, DB, etc.) leave it false. */
	export let showLensFilters: boolean = false;

	const dispatch = createEventDispatcher();

	function handleBack() {
		dispatch('back');
		// Default behavior: go back in history
		if (typeof window !== 'undefined') {
			window.history.back();
		}
	}

	// Tooltip on the holon name surfaces the full id without cluttering
	// the breadcrumb. Falls back to just the name if no id was supplied.
	$: holonNameTitle = holonName && holonId ? `${holonName} (${holonId})` : holonName;
</script>

<header class="title-bar" class:title-bar--compact={compact}>
	{#if showBack}
		<button class="title-bar__back" on:click={handleBack} aria-label="Go back">
			<ArrowLeft size="18" />
		</button>
	{/if}

	<div class="title-bar__content">
		{#if icon}
			<span class="title-bar__icon">
				<svelte:component this={icon} size="16" />
			</span>
		{/if}
		{#if holonName}
			<span class="title-bar__holon-name" title={holonNameTitle}>{holonName}</span>
		{/if}
		{#if holonName && title}
			<span class="title-bar__separator">/</span>
		{/if}
		{#if title}
			<span class="title-bar__page-title">{title}</span>
		{/if}
	</div>

	<div class="title-bar__actions">
		{#if showLensFilters}
			<ToggleChip
				checked={$showHolograms}
				label="Holograms"
				icon={Eye}
				tooltip="Holograms: show items this holon references from elsewhere (shared copies projected in), not just items created here. On by default."
				on:change={(e) => showHolograms.set(e.detail)}
			/>
			<ToggleChip
				checked={$showFederated}
				label="Federated"
				icon={Globe}
				tooltip="Federated: also pull in items from the holons this one is federated with. Off by default — turn on to see the wider network's data alongside your own."
				on:change={(e) => showFederated.set(e.detail)}
			/>
			<ToggleChip
				checked={$showUnverified}
				label="Show all data"
				icon={AlertTriangle}
				tooltip="Show all data: also reveal unsigned/legacy records — records signature enforcement hides, plus records still living on the legacy Gun relay — shown for inspection, NOT verified, don't trust them. Off by default."
				on:change={(e) => showUnverified.set(e.detail)}
			/>
		{/if}
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
		background: var(--color-bg-secondary, var(--color-bg-secondary));
		border-bottom: 1px solid var(--color-border, var(--color-bg-tertiary));
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
		color: var(--color-text-secondary, var(--color-text-secondary));
		cursor: pointer;
		transition: background-color 150ms ease, color 150ms ease;
	}

	.title-bar__back:hover {
		background: var(--color-bg-tertiary, var(--color-bg-tertiary));
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

	.title-bar__icon {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-accent-light, var(--color-accent-light));
		flex-shrink: 0;
	}

	.title-bar__holon-name {
		font-size: var(--font-size-sm, 0.875rem);
		font-weight: var(--font-weight-semibold, 600);
		color: var(--color-accent-light, var(--color-accent-light));
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.title-bar__separator {
		color: var(--color-text-muted, var(--color-text-muted));
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
		gap: var(--spacing-1, 0.25rem);
		margin-left: auto;
		flex-shrink: 0;
	}

	/* Compact toggle chips inside the title bar so two of them plus the
	   breadcrumb fit on a single line. The global .toggle-chip has wider
	   padding for stand-alone use; tighten it here. */
	.title-bar__actions :global(.toggle-chip) {
		padding: 0.25rem 0.5rem;
		gap: 0.3rem;
	}

	/* Responsive adjustments */
	@media (max-width: 768px) {
		.title-bar {
			height: var(--titlebar-height-compact, 32px);
			padding: 0 var(--spacing-3, 0.75rem);
			gap: var(--spacing-2, 0.5rem);
		}

		.title-bar__holon-name,
		.title-bar__page-title {
			font-size: var(--font-size-xs, 0.75rem);
		}

		/* Drop the labels: the icon + dot color carry the meaning, and the
		   tooltip-style title attribute on the chip provides the full text
		   on hover. Saves ~9rem horizontally for two chips. */
		.title-bar__actions :global(.toggle-chip__label) {
			display: none;
		}

		.title-bar__actions :global(.toggle-chip) {
			padding: 0.25rem 0.45rem;
		}
	}

	@media (max-width: 480px) {
		.title-bar__actions {
			gap: 0.2rem;
		}
	}
</style>
