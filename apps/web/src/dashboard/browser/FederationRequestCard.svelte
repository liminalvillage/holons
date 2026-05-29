<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { Check, X, RefreshCw } from 'svelte-feathers';

	export let id: string;
	export let senderPubKey: string;
	export let senderHolonName: string;
	export let type: 'federation_request' | 'lens_update' = 'federation_request';
	export let message: string = '';
	export let sharedLenses: string[] = [];
	export let isProcessing: boolean = false;

	const dispatch = createEventDispatcher();

	function handleAccept() {
		dispatch('accept', { id, senderPubKey });
	}

	function handleDecline() {
		dispatch('decline', { id, senderPubKey });
	}

	// Format public key for display
	$: displayPubKey = senderPubKey ? `${senderPubKey.slice(0, 8)}...${senderPubKey.slice(-4)}` : '';
</script>

<div class="request-card" class:request-card--update={type === 'lens_update'}>
	<!-- Header -->
	<div class="request-card__header">
		{#if type === 'lens_update'}
			<RefreshCw size="14" class="request-card__icon request-card__icon--update" />
			<span class="request-card__type">Lens Update Request</span>
		{:else}
			<span class="request-card__type">Federation Request</span>
		{/if}
	</div>

	<!-- Holon Preview (dashed border) -->
	<div class="request-card__preview">
		<div class="request-card__avatar">
			{senderHolonName.charAt(0).toUpperCase()}
		</div>
		<div class="request-card__info">
			<span class="request-card__name">{senderHolonName}</span>
			<span class="request-card__pubkey">{displayPubKey}</span>
		</div>
	</div>

	<!-- Shared Lenses -->
	<div class="request-card__exchange">
		{#if sharedLenses.length > 0}
			<div class="request-card__lenses request-card__lenses--receiving">
				<div class="request-card__lenses-header">
					<span>Shared lenses</span>
				</div>
				<div class="request-card__lens-tags">
					{#each sharedLenses as lens}
						<span class="request-card__lens-tag request-card__lens-tag--receive">{lens}</span>
					{/each}
				</div>
			</div>
		{:else}
			<div class="request-card__no-lenses">
				No specific lenses configured
			</div>
		{/if}
	</div>

	<!-- Message if present -->
	{#if message}
		<div class="request-card__message">
			<span class="request-card__message-label">Message:</span>
			<span class="request-card__message-text">{message}</span>
		</div>
	{/if}

	<!-- Actions -->
	<div class="request-card__actions">
		<button
			class="request-card__btn request-card__btn--decline"
			onclick={handleDecline}
			disabled={isProcessing}
		>
			<X size="14" />
			Decline
		</button>
		<button
			class="request-card__btn request-card__btn--accept"
			onclick={handleAccept}
			disabled={isProcessing}
		>
			{#if isProcessing}
				<span class="request-card__spinner"></span>
			{:else}
				<Check size="14" />
			{/if}
			Accept
		</button>
	</div>
</div>

<style>
	.request-card {
		background: var(--color-bg-secondary, var(--color-bg-secondary));
		border: 2px dashed var(--color-accent, var(--color-accent));
		border-radius: var(--radius-lg, 0.5rem);
		padding: var(--spacing-3, 0.75rem);
		margin: var(--spacing-2, 0.5rem);
	}

	.request-card--update {
		border-color: var(--color-warning, #f59e0b);
	}

	.request-card__header {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		margin-bottom: var(--spacing-3, 0.75rem);
	}

	.request-card__type {
		font-size: 10px;
		font-weight: var(--font-weight-semibold, 600);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-accent, var(--color-accent));
	}

	.request-card--update .request-card__type {
		color: var(--color-warning, #f59e0b);
	}


	/* Preview section with dashed appearance */
	.request-card__preview {
		display: flex;
		align-items: center;
		gap: var(--spacing-3, 0.75rem);
		padding: var(--spacing-3, 0.75rem);
		background: var(--color-bg-tertiary, var(--color-bg-tertiary));
		border-radius: var(--radius-md, 0.375rem);
		margin-bottom: var(--spacing-3, 0.75rem);
	}

	.request-card__avatar {
		width: 40px;
		height: 40px;
		border-radius: var(--radius-full, 9999px);
		background: linear-gradient(135deg, var(--color-accent, var(--color-accent)), var(--color-accent-light, #818cf8));
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: var(--font-size-lg, 1.125rem);
		font-weight: var(--font-weight-bold, 700);
		color: var(--color-text-primary);
		flex-shrink: 0;
	}

	.request-card__info {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.request-card__name {
		font-size: var(--font-size-base, 1rem);
		font-weight: var(--font-weight-semibold, 600);
		color: var(--color-text-primary, #ffffff);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.request-card__pubkey {
		font-size: 11px;
		color: var(--color-text-muted, var(--color-text-muted));
		font-family: var(--font-mono, monospace);
	}

	/* Lens exchange section */
	.request-card__exchange {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-2, 0.5rem);
		margin-bottom: var(--spacing-3, 0.75rem);
	}

	.request-card__lenses {
		padding: var(--spacing-2, 0.5rem);
		border-radius: var(--radius-sm, 0.25rem);
	}

	.request-card__lenses--receiving {
		background: rgba(34, 197, 94, 0.1);
		border-left: 3px solid var(--color-success, #22c55e);
	}

	.request-card__lenses-header {
		display: flex;
		align-items: center;
		gap: var(--spacing-1, 0.25rem);
		font-size: 11px;
		font-weight: var(--font-weight-medium, 500);
		color: var(--color-text-secondary, var(--color-text-muted));
		margin-bottom: var(--spacing-1, 0.25rem);
	}

	.request-card__lenses--receiving .request-card__lenses-header {
		color: var(--color-success, #22c55e);
	}

	.request-card__lens-tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-1, 0.25rem);
	}

	.request-card__lens-tag {
		font-size: 11px;
		padding: 2px 8px;
		border-radius: var(--radius-full, 9999px);
		font-weight: var(--font-weight-medium, 500);
	}

	.request-card__lens-tag--receive {
		background: rgba(34, 197, 94, 0.2);
		color: var(--color-success, #22c55e);
	}

	.request-card__no-lenses {
		font-size: var(--font-size-sm, 0.875rem);
		color: var(--color-text-muted, var(--color-text-muted));
		text-align: center;
		padding: var(--spacing-2, 0.5rem);
	}

	/* Message */
	.request-card__message {
		font-size: var(--font-size-sm, 0.875rem);
		padding: var(--spacing-2, 0.5rem);
		background: var(--color-bg-tertiary, var(--color-bg-tertiary));
		border-radius: var(--radius-sm, 0.25rem);
		margin-bottom: var(--spacing-3, 0.75rem);
	}

	.request-card__message-label {
		color: var(--color-text-muted, var(--color-text-muted));
		margin-right: var(--spacing-1, 0.25rem);
	}

	.request-card__message-text {
		color: var(--color-text-secondary, var(--color-text-muted));
	}

	/* Actions */
	.request-card__actions {
		display: flex;
		gap: var(--spacing-2, 0.5rem);
	}

	.request-card__btn {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-1, 0.25rem);
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		border-radius: var(--radius-md, 0.375rem);
		font-size: var(--font-size-sm, 0.875rem);
		font-weight: var(--font-weight-medium, 500);
		border: none;
		cursor: pointer;
		transition: all 150ms ease;
	}

	.request-card__btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.request-card__btn--accept {
		background: var(--color-success, #22c55e);
		color: var(--color-text-primary);
	}

	.request-card__btn--accept:hover:not(:disabled) {
		background: var(--color-success-hover, #16a34a);
	}

	.request-card__btn--decline {
		background: var(--color-bg-tertiary, var(--color-bg-tertiary));
		color: var(--color-text-secondary, var(--color-text-muted));
	}

	.request-card__btn--decline:hover:not(:disabled) {
		background: var(--color-error, #ef4444);
		color: var(--color-text-primary);
	}

	.request-card__spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: var(--color-text-primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
