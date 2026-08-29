<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors -->
<script lang="ts">
	// One secondary sign-in option: icon, label, one-line hint. Feature-detected
	// options stay visible when unsupported (dimmed, with the reason as hint).
	export let label: string;
	export let hint: string = '';
	export let disabled = false;
	export let busy = false;
</script>

<button
	class="tile"
	class:tile--busy={busy}
	type="button"
	{disabled}
	aria-busy={busy}
	aria-disabled={disabled}
	title={disabled ? hint : undefined}
	on:click
>
	<span class="tile__icon" aria-hidden="true">
		{#if busy}
			<span class="tile__spinner"></span>
		{:else}
			<slot />
		{/if}
	</span>
	<span class="tile__label">{label}</span>
	{#if hint}
		<span class="tile__hint">{hint}</span>
	{/if}
</button>

<style>
	.tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.375rem;
		width: 100%;
		padding: 0.875rem 0.5rem 0.75rem;
		background: color-mix(in srgb, var(--color-bg-tertiary) 45%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
		border-radius: 0.875rem;
		color: var(--color-text-primary);
		cursor: pointer;
		text-align: center;
		transition:
			transform 0.15s ease,
			border-color 0.15s ease,
			background 0.15s ease,
			box-shadow 0.15s ease;
	}
	.tile:hover:not(:disabled) {
		transform: translateY(-2px);
		border-color: color-mix(in srgb, var(--color-accent) 70%, transparent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		box-shadow: 0 12px 24px -16px color-mix(in srgb, var(--color-accent) 70%, transparent);
	}
	.tile:focus-visible {
		outline: 2px solid var(--color-accent-light);
		outline-offset: 2px;
	}
	.tile:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}
	.tile--busy {
		border-color: var(--color-accent);
	}
	.tile__icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		color: var(--color-accent-light);
	}
	.tile__icon :global(svg) {
		width: 1.625rem;
		height: 1.625rem;
	}
	.tile__label {
		font-size: 0.875rem;
		font-weight: 600;
		line-height: 1.1;
	}
	.tile__hint {
		font-size: 0.6875rem;
		line-height: 1.25;
		color: var(--color-text-muted);
	}
	.tile__spinner {
		width: 1.25rem;
		height: 1.25rem;
		border: 2px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
		border-top-color: var(--color-accent-light);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
