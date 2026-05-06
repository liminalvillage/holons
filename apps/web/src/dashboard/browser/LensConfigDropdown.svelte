<script lang="ts">
	import { createEventDispatcher, onMount, onDestroy } from 'svelte';
	import { slide } from 'svelte/transition';
	import { X, Trash2 } from 'svelte-feathers';

	export let holonId: string;
	export let holonName: string;
	export let sharedLenses: string[] = [];
	export let isOpen: boolean = false;

	const dispatch = createEventDispatcher();
	const availableLenses = ['quests', 'tasks', 'calendar', 'notes', 'contacts'];

	// Local state for lens selections
	let selectedLenses: Set<string> = new Set(sharedLenses);

	// Sync props to local state when they change
	$: {
		selectedLenses = new Set(sharedLenses);
	}

	function toggleLens(lens: string) {
		if (selectedLenses.has(lens)) {
			selectedLenses.delete(lens);
		} else {
			selectedLenses.add(lens);
		}
		selectedLenses = new Set(selectedLenses);
		dispatchUpdate();
	}

	function dispatchUpdate() {
		dispatch('update', {
			holonId,
			lensConfig: {
				lenses: Array.from(selectedLenses)
			}
		});
	}

	function handleRemove() {
		dispatch('remove', { holonId });
	}

	function close() {
		dispatch('close');
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			close();
		}
	}

	function handleClickOutside(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest('.lens-dropdown')) {
			close();
		}
	}

	onMount(() => {
		if (isOpen) {
			document.addEventListener('keydown', handleKeydown);
			document.addEventListener('click', handleClickOutside, true);
		}
	});

	onDestroy(() => {
		document.removeEventListener('keydown', handleKeydown);
		document.removeEventListener('click', handleClickOutside, true);
	});

	$: if (isOpen) {
		document.addEventListener('keydown', handleKeydown);
		document.addEventListener('click', handleClickOutside, true);
	} else {
		document.removeEventListener('keydown', handleKeydown);
		document.removeEventListener('click', handleClickOutside, true);
	}
</script>

{#if isOpen}
	<div class="lens-dropdown" transition:slide={{ duration: 150 }}>
		<div class="lens-dropdown__header">
			<span class="lens-dropdown__title">Shared Lenses</span>
			<button class="lens-dropdown__close" onclick={close}>
				<X size={14} />
			</button>
		</div>

		<div class="lens-dropdown__content">
			<div class="lens-dropdown__section">
				<div class="lens-dropdown__toggles">
					{#each availableLenses as lens}
						<label class="lens-dropdown__toggle">
							<input
								type="checkbox"
								checked={selectedLenses.has(lens)}
								onchange={() => toggleLens(lens)}
							/>
							<span>{lens}</span>
						</label>
					{/each}
				</div>
			</div>
		</div>

		<div class="lens-dropdown__footer">
			<button class="lens-dropdown__remove" onclick={handleRemove}>
				<Trash2 size={14} />
				<span>Remove Federation</span>
			</button>
		</div>
	</div>
{/if}

<style>
	.lens-dropdown {
		position: absolute;
		right: 0;
		top: 100%;
		margin-top: 4px;
		min-width: 220px;
		background: var(--color-bg-secondary, #1f2937);
		border: 1px solid var(--color-border, #374151);
		border-radius: var(--radius-md, 0.375rem);
		box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
		z-index: 100;
		overflow: hidden;
	}

	.lens-dropdown__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		border-bottom: 1px solid var(--color-border, #374151);
	}

	.lens-dropdown__title {
		font-size: var(--font-size-sm, 0.875rem);
		font-weight: var(--font-weight-medium, 500);
		color: var(--color-text-primary, #ffffff);
	}

	.lens-dropdown__close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		background: transparent;
		border: none;
		color: var(--color-text-muted, #6b7280);
		cursor: pointer;
		border-radius: var(--radius-sm, 0.25rem);
	}

	.lens-dropdown__close:hover {
		background: var(--color-bg-tertiary, #374151);
		color: var(--color-text-primary, #ffffff);
	}

	.lens-dropdown__content {
		padding: var(--spacing-3, 0.75rem);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-3, 0.75rem);
	}

	.lens-dropdown__section {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-2, 0.5rem);
	}

	.lens-dropdown__toggles {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-1, 0.25rem);
	}

	.lens-dropdown__toggle {
		display: flex;
		align-items: center;
		gap: var(--spacing-1, 0.25rem);
		padding: 2px var(--spacing-2, 0.5rem);
		background: var(--color-bg-primary, #111827);
		border-radius: var(--radius-sm, 0.25rem);
		cursor: pointer;
		transition: background-color 150ms ease;
	}

	.lens-dropdown__toggle:hover {
		background: var(--color-bg-tertiary, #374151);
	}

	.lens-dropdown__toggle input[type="checkbox"] {
		width: 12px;
		height: 12px;
		accent-color: var(--color-accent, #4f46e5);
	}

	.lens-dropdown__toggle span {
		font-size: var(--font-size-xs, 0.75rem);
		color: var(--color-text-secondary, #d1d5db);
	}

	.lens-dropdown__footer {
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		border-top: 1px solid var(--color-border, #374151);
	}

	.lens-dropdown__remove {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		width: 100%;
		padding: var(--spacing-2, 0.5rem);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm, 0.25rem);
		color: var(--color-error, #ef4444);
		font-size: var(--font-size-sm, 0.875rem);
		cursor: pointer;
		transition: all 150ms ease;
	}

	.lens-dropdown__remove:hover {
		background: rgba(239, 68, 68, 0.1);
		border-color: var(--color-error, #ef4444);
	}
</style>
