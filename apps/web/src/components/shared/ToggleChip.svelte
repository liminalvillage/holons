<script lang="ts">
	import { createEventDispatcher, type ComponentType } from 'svelte';

	export let checked: boolean = false;
	export let label: string;
	export let icon: ComponentType | null = null;
	export let loading: boolean = false;
	export let disabled: boolean = false;

	const dispatch = createEventDispatcher<{ change: boolean }>();

	function handleChange(event: Event) {
		const target = event.target as HTMLInputElement;
		checked = target.checked;
		dispatch('change', checked);
	}
</script>

<label
	class="toggle-chip"
	class:toggle-chip--disabled={disabled}
	class:toggle-chip--loading={loading}
	title={label}
	aria-label={label}
>
	<input
		type="checkbox"
		class="sr-only"
		{checked}
		{disabled}
		on:change={handleChange}
	/>
	<span class="toggle-chip__dot" class:toggle-chip__dot--active={checked}></span>
	{#if icon}
		<span class="toggle-chip__icon">
			<svelte:component this={icon} size="14" />
		</span>
	{/if}
	<span class="toggle-chip__label">{label}</span>
	{#if loading}
		<span class="toggle-chip__spinner" aria-hidden="true"></span>
	{/if}
</label>

<style>
	.toggle-chip--disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.toggle-chip__icon {
		display: flex;
		align-items: center;
		color: var(--color-text-muted);
	}

	.toggle-chip__spinner {
		width: 0.75rem;
		height: 0.75rem;
		border: 2px solid rgba(156, 163, 175, 0.3);
		border-top-color: #6b7280;
		border-radius: 50%;
		animation: toggle-chip-spin 0.8s linear infinite;
	}

	@keyframes toggle-chip-spin {
		to { transform: rotate(360deg); }
	}
</style>
