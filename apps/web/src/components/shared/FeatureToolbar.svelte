<script lang="ts">
	import { createEventDispatcher, type ComponentType } from 'svelte';
	import { Plus, Search, Globe, Eye, Download } from 'svelte-feathers';
	import ToggleChip from './ToggleChip.svelte';

	type ViewMode = { value: string; icon?: ComponentType; label: string };

	// Add button — hidden if onAdd is null.
	export let onAdd: (() => void) | null = null;
	export let addLabel: string = 'Add';
	export let addDisabled: boolean = false;

	// Import button — hidden if onImport is null. Sits next to the Add button.
	export let onImport: (() => void) | null = null;
	export let importLabel: string = 'Import';
	export let importDisabled: boolean = false;

	// Search input — hidden if undefined (pass an empty string to show it).
	export let searchQuery: string | undefined = undefined;
	export let searchPlaceholder: string = 'Search…';

	// View mode toggle — hidden when viewModes is empty.
	export let viewMode: string = '';
	export let viewModes: ViewMode[] = [];

	// Federation + hologram toggles — hidden when undefined. Pass `false`/`true`
	// to display the toggle. This lets features opt in without always-on chips.
	export let showFederated: boolean | undefined = undefined;
	export let federatedLoading: boolean = false;
	export let showHolograms: boolean | undefined = undefined;

	const dispatch = createEventDispatcher<{
		add: void;
		import: void;
		search: string;
		viewChange: string;
		federatedChange: boolean;
		hologramsChange: boolean;
	}>();

	function handleAdd() {
		if (onAdd) onAdd();
		dispatch('add');
	}

	function handleImport() {
		if (onImport) onImport();
		dispatch('import');
	}

	function handleSearchInput(event: Event) {
		searchQuery = (event.target as HTMLInputElement).value;
		dispatch('search', searchQuery);
	}

	function selectView(mode: string) {
		viewMode = mode;
		dispatch('viewChange', mode);
	}

	function handleFederatedChange(event: CustomEvent<boolean>) {
		showFederated = event.detail;
		dispatch('federatedChange', event.detail);
	}

	function handleHologramsChange(event: CustomEvent<boolean>) {
		showHolograms = event.detail;
		dispatch('hologramsChange', event.detail);
	}
</script>

<div class="feature-toolbar controls-row">
	<div class="controls-row__left">
		{#if onAdd}
			<button
				type="button"
				class="add-btn"
				on:click={handleAdd}
				disabled={addDisabled}
				aria-label={addLabel}
				title={addLabel}
			>
				<svelte:component this={Plus} size="16" />
				<span class="feature-toolbar__add-label">{addLabel}</span>
			</button>
		{/if}

		{#if onImport}
			<button
				type="button"
				class="import-btn"
				on:click={handleImport}
				disabled={importDisabled}
				aria-label={importLabel}
				title={importLabel}
			>
				<svelte:component this={Download} size="16" />
			</button>
		{/if}

		{#if searchQuery !== undefined}
			<div class="feature-toolbar__search">
				<span class="feature-toolbar__search-icon" aria-hidden="true">
					<svelte:component this={Search} size="14" />
				</span>
				<input
					type="search"
					class="feature-toolbar__search-input"
					placeholder={searchPlaceholder}
					value={searchQuery}
					on:input={handleSearchInput}
				/>
			</div>
		{/if}

		<slot name="filters" />
	</div>

	<div class="controls-row__right">
		<slot name="actions" />

		{#if showHolograms !== undefined}
			<ToggleChip
				checked={showHolograms}
				label="Holograms"
				icon={Eye}
				on:change={handleHologramsChange}
			/>
		{/if}

		{#if showFederated !== undefined}
			<ToggleChip
				checked={showFederated}
				label="Federated"
				icon={Globe}
				loading={federatedLoading}
				on:change={handleFederatedChange}
			/>
		{/if}

		{#if viewModes.length > 0}
			<div class="view-toggle" role="tablist" aria-label="View mode">
				{#each viewModes as mode}
					<button
						type="button"
						class="view-toggle__btn"
						class:view-toggle__btn--active={viewMode === mode.value}
						role="tab"
						aria-selected={viewMode === mode.value}
						aria-label={mode.label}
						title={mode.label}
						on:click={() => selectView(mode.value)}
					>
						{#if mode.icon}
							<svelte:component this={mode.icon} size="16" />
						{:else}
							<span class="feature-toolbar__view-text">{mode.label}</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.feature-toolbar {
		padding: 0.5rem 0;
		max-width: 100%;
	}

	/* Allow the inner sections to wrap so nothing forces horizontal scroll. */
	.feature-toolbar :global(.controls-row__left),
	.feature-toolbar :global(.controls-row__right) {
		flex-wrap: wrap;
		min-width: 0;
	}

	/* Collapse the Add label on narrow viewports; the icon + title carry the meaning. */
	@media (max-width: 640px) {
		.feature-toolbar__add-label {
			display: none;
		}
	}

	.import-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		padding: 0;
		background: #374151;
		border: 1px solid #4b5563;
		border-radius: 0.5rem;
		color: #e5e7eb;
		cursor: pointer;
		flex-shrink: 0;
		transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;
	}

	.import-btn:hover:not(:disabled) {
		background: #4b5563;
		color: #fff;
	}

	.import-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.feature-toolbar__search {
		position: relative;
		display: flex;
		align-items: center;
		flex: 1 1 12rem;
		min-width: 8rem;
		max-width: 20rem;
	}

	@media (max-width: 640px) {
		.feature-toolbar__search {
			flex-basis: 100%;
			max-width: none;
		}
	}

	.feature-toolbar__search-icon {
		position: absolute;
		left: 0.625rem;
		top: 50%;
		transform: translateY(-50%);
		color: #9ca3af;
		pointer-events: none;
	}

	.feature-toolbar__search-input {
		width: 100%;
		background: #374151;
		border: 1px solid #4b5563;
		border-radius: 0.5rem;
		color: #fff;
		font-size: 0.875rem;
		padding: 0.5rem 0.75rem 0.5rem 2rem;
		transition: border-color 150ms ease;
	}

	.feature-toolbar__search-input:focus {
		outline: none;
		border-color: #3b82f6;
	}

	.feature-toolbar__search-input::placeholder {
		color: #6b7280;
	}

	.feature-toolbar__view-text {
		font-size: 0.75rem;
		font-weight: 500;
	}
</style>
