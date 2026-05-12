<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { Search, Plus, X } from 'svelte-feathers';

	export let searchQuery: string = '';

	const dispatch = createEventDispatcher();

	function handleClose() {
		dispatch('close');
	}

	function handleAdd() {
		dispatch('add');
	}

	function clearSearch() {
		searchQuery = '';
	}
</script>

<header class="browser-header">
	<div class="browser-header__search">
		<Search size="16" class="browser-header__search-icon" />
		<input
			type="text"
			class="browser-header__search-input"
			placeholder="Search holons..."
			bind:value={searchQuery}
		/>
		{#if searchQuery}
			<button class="browser-header__clear" on:click={clearSearch} aria-label="Clear search">
				<X size="14" />
			</button>
		{/if}
	</div>

	<button class="browser-header__add" on:click={handleAdd} aria-label="Add holon">
		<Plus size="18" />
	</button>

	<button class="browser-header__close" on:click={handleClose} aria-label="Close browser">
		<X size="18" />
	</button>
</header>

<style>
	.browser-header {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		padding: var(--spacing-3, 0.75rem);
		border-bottom: 1px solid var(--color-border, #374151);
		flex-shrink: 0;
	}

	.browser-header__search {
		flex: 1;
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		background: var(--color-bg-secondary, #1f2937);
		border: 1px solid var(--color-border, #374151);
		border-radius: var(--radius-md, 0.375rem);
		transition: border-color 150ms ease, box-shadow 150ms ease;
	}

	.browser-header__search:focus-within {
		border-color: var(--color-accent, #4f46e5);
		box-shadow: 0 0 0 2px var(--color-accent-subtle, rgba(79, 70, 229, 0.1));
	}

	.browser-header__search :global(.browser-header__search-icon) {
		color: var(--color-text-muted, #6b7280);
		flex-shrink: 0;
	}

	.browser-header__search-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: var(--color-text-primary, #ffffff);
		font-size: var(--font-size-sm, 0.875rem);
		min-width: 0;
	}

	.browser-header__search-input::placeholder {
		color: var(--color-text-muted, #6b7280);
	}

	.browser-header__clear {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-1, 0.25rem);
		background: transparent;
		border: none;
		color: var(--color-text-muted, #6b7280);
		cursor: pointer;
		border-radius: var(--radius-sm, 0.25rem);
		transition: color 150ms ease, background-color 150ms ease;
	}

	.browser-header__clear:hover {
		color: var(--color-text-primary, #ffffff);
		background: var(--color-bg-tertiary, #374151);
	}

	.browser-header__add,
	.browser-header__close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		background: transparent;
		border: none;
		color: var(--color-text-secondary, #d1d5db);
		cursor: pointer;
		border-radius: var(--radius-md, 0.375rem);
		transition: color 150ms ease, background-color 150ms ease;
	}

	.browser-header__add:hover,
	.browser-header__close:hover {
		color: var(--color-text-primary, #ffffff);
		background: var(--color-bg-tertiary, #374151);
	}

	.browser-header__add {
		color: var(--color-accent-light, #6366f1);
	}

	.browser-header__add:hover {
		background: var(--color-accent-subtle, rgba(79, 70, 229, 0.1));
		color: var(--color-accent, #4f46e5);
	}

	/* Hide close button on desktop */
	@media (min-width: 1024px) {
		.browser-header__close {
			display: none;
		}
	}
</style>
