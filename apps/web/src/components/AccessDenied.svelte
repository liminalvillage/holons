<script lang="ts">
	import { goto } from '$app/navigation';
	import { ShieldOff, Home, ArrowLeft } from 'svelte-feathers';
	import { getContext } from 'svelte';
	import type { HoloSphere } from 'holosphere';

	export let holonId: string = '';
	export let holonName: string = '';

	const holosphere = getContext('holosphere') as HoloSphere;

	function goToMyHolon() {
		if (holosphere?.client?.publicKey) {
			goto(`/${holosphere.client.publicKey}/dashboard`);
		} else {
			goto('/');
		}
	}

	function goBack() {
		history.back();
	}
</script>

<div class="access-denied">
	<div class="access-denied__card">
		<div class="access-denied__icon">
			<ShieldOff size={48} />
		</div>

		<h1 class="access-denied__title">Access Denied</h1>

		<p class="access-denied__message">
			You don't have permission to view this holon
			{#if holonName}
				<span class="access-denied__holon-name">"{holonName}"</span>
			{:else if holonId}
				<span class="access-denied__holon-id">({holonId.slice(0, 8)}...)</span>
			{/if}
		</p>

		<p class="access-denied__hint">
			To access this holon, the owner needs to grant you federation access.
		</p>

		<div class="access-denied__actions">
			<button class="access-denied__btn access-denied__btn--primary" on:click={goToMyHolon}>
				<Home size={18} />
				Go to My Holon
			</button>
			<button class="access-denied__btn access-denied__btn--secondary" on:click={goBack}>
				<ArrowLeft size={18} />
				Go Back
			</button>
		</div>
	</div>
</div>

<style>
	.access-denied {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 80vh;
		padding: var(--spacing-4, 1rem);
	}

	.access-denied__card {
		background: var(--color-bg-secondary, #1f2937);
		border-radius: var(--radius-xl, 1rem);
		padding: var(--spacing-8, 2rem);
		max-width: 420px;
		width: 100%;
		text-align: center;
		border: 1px solid var(--color-border, #374151);
	}

	.access-denied__icon {
		color: var(--color-warning, #f59e0b);
		margin-bottom: var(--spacing-4, 1rem);
		display: flex;
		justify-content: center;
	}

	.access-denied__title {
		font-size: var(--font-size-2xl, 1.5rem);
		font-weight: 700;
		color: var(--color-text-primary, #f9fafb);
		margin: 0 0 var(--spacing-3, 0.75rem) 0;
	}

	.access-denied__message {
		font-size: var(--font-size-base, 1rem);
		color: var(--color-text-secondary, #d1d5db);
		margin: 0 0 var(--spacing-2, 0.5rem) 0;
		line-height: 1.5;
	}

	.access-denied__holon-name {
		color: var(--color-text-primary, #f9fafb);
		font-weight: 500;
	}

	.access-denied__holon-id {
		color: var(--color-text-muted, #9ca3af);
		font-family: monospace;
		font-size: var(--font-size-sm, 0.875rem);
	}

	.access-denied__hint {
		font-size: var(--font-size-sm, 0.875rem);
		color: var(--color-text-muted, #9ca3af);
		margin: 0 0 var(--spacing-6, 1.5rem) 0;
	}

	.access-denied__actions {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-3, 0.75rem);
	}

	.access-denied__btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-2, 0.5rem);
		padding: var(--spacing-3, 0.75rem) var(--spacing-4, 1rem);
		border-radius: var(--radius-lg, 0.5rem);
		font-size: var(--font-size-base, 1rem);
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s ease;
		border: none;
	}

	.access-denied__btn--primary {
		background: var(--color-primary, #3b82f6);
		color: white;
	}

	.access-denied__btn--primary:hover {
		background: var(--color-primary-hover, #2563eb);
	}

	.access-denied__btn--secondary {
		background: var(--color-bg-tertiary, #374151);
		color: var(--color-text-secondary, #d1d5db);
	}

	.access-denied__btn--secondary:hover {
		background: var(--color-bg-hover, #4b5563);
	}
</style>
