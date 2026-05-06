<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { slide } from 'svelte/transition';
	import { Check, X, ChevronDown, RefreshCw } from 'svelte-feathers';
	import { nameMap, resolvedInitials } from '$lib/stores/nameResolver';

	export let id: string;
	export let senderPubKey: string;
	export let senderHolonName: string;
	export let sharedLenses: string[] = [];
	export let message: string = '';
	export let isProcessing: boolean = false;

	const dispatch = createEventDispatcher();

	let expanded = false;

	function handleAccept(event: MouseEvent) {
		event.stopPropagation();
		dispatch('accept', { id, senderPubKey });
	}

	function handleDecline(event: MouseEvent) {
		event.stopPropagation();
		dispatch('decline', { id, senderPubKey });
	}

	function toggleExpand(event: MouseEvent) {
		event.stopPropagation();
		expanded = !expanded;
	}

	// Generate deterministic color
	function getAvatarColor(id: string): string {
		const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899'];
		let hash = 0;
		for (let i = 0; i < id.length; i++) {
			hash = id.charCodeAt(i) + ((hash << 5) - hash);
		}
		return colors[Math.abs(hash) % colors.length];
	}

	$: initials = resolvedInitials(senderPubKey, $nameMap);
	$: avatarColor = getAvatarColor(senderPubKey);
</script>

<div class="lens-update" class:lens-update--expanded={expanded}>
	<div class="lens-update__row" on:click={toggleExpand} role="button" tabindex="0" on:keydown={(e) => e.key === 'Enter' && toggleExpand(e)}>
		<!-- Avatar -->
		<div class="lens-update__avatar" style="background-color: {avatarColor}">
			{initials}
		</div>

		<!-- Content -->
		<div class="lens-update__content">
			<span class="lens-update__name">{senderHolonName}</span>
			<span class="lens-update__badge">
				<RefreshCw size={9} />
				Lens Update
			</span>
		</div>

		<!-- Actions -->
		<div class="lens-update__actions">
			<button
				class="lens-update__btn lens-update__btn--decline"
				on:click={handleDecline}
				disabled={isProcessing}
				title="Decline"
			>
				<X size={14} />
			</button>
			<button
				class="lens-update__btn lens-update__btn--accept"
				on:click={handleAccept}
				disabled={isProcessing}
				title="Accept"
			>
				{#if isProcessing}
					<span class="lens-update__spinner"></span>
				{:else}
					<Check size={14} />
				{/if}
			</button>
			<button
				class="lens-update__btn lens-update__btn--expand"
				on:click={toggleExpand}
				title={expanded ? 'Hide details' : 'Show details'}
			>
				<ChevronDown size={14} class={expanded ? 'rotated' : ''} />
			</button>
		</div>
	</div>

	<!-- Expandable Details -->
	{#if expanded}
		<div class="lens-update__details" transition:slide={{ duration: 150 }}>
			{#if sharedLenses.length > 0}
				<div class="lens-update__lens-row">
					<span class="lens-update__lens-label lens-update__lens-label--receive">Shared lenses:</span>
					<span class="lens-update__lens-list">{sharedLenses.join(', ')}</span>
				</div>
			{:else}
				<div class="lens-update__lens-row">
					<span class="lens-update__lens-list lens-update__lens-list--empty">No lenses configured</span>
				</div>
			{/if}
			{#if message}
				<div class="lens-update__message">{message}</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.lens-update {
		margin: 0 var(--spacing-2, 0.5rem);
		border: 1px dashed var(--color-warning, #f59e0b);
		border-radius: var(--radius-md, 0.375rem);
		background: rgba(245, 158, 11, 0.05);
		margin-bottom: var(--spacing-1, 0.25rem);
	}

	.lens-update--expanded {
		background: var(--color-bg-secondary, #1f2937);
	}

	.lens-update__row {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		cursor: pointer;
		transition: background-color 150ms ease;
	}

	.lens-update__row:hover {
		background: rgba(245, 158, 11, 0.1);
	}

	.lens-update__avatar {
		width: 32px;
		height: 32px;
		border-radius: var(--radius-md, 0.375rem);
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		font-weight: var(--font-weight-semibold, 600);
		font-size: var(--font-size-xs, 0.75rem);
		flex-shrink: 0;
	}

	.lens-update__content {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
	}

	.lens-update__name {
		font-size: var(--font-size-sm, 0.875rem);
		font-weight: var(--font-weight-medium, 500);
		color: var(--color-text-primary, #ffffff);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.lens-update__badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 9px;
		font-weight: var(--font-weight-semibold, 600);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 2px 6px;
		border-radius: var(--radius-full, 9999px);
		background: rgba(245, 158, 11, 0.2);
		color: var(--color-warning, #f59e0b);
		flex-shrink: 0;
	}

	.lens-update__actions {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.lens-update__btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		padding: 0;
		background: transparent;
		border: none;
		color: var(--color-text-muted, #6b7280);
		cursor: pointer;
		border-radius: var(--radius-sm, 0.25rem);
		transition: all 150ms ease;
	}

	.lens-update__btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.lens-update__btn--decline:hover:not(:disabled) {
		background: rgba(239, 68, 68, 0.2);
		color: #ef4444;
	}

	.lens-update__btn--accept:hover:not(:disabled) {
		background: rgba(34, 197, 94, 0.2);
		color: #22c55e;
	}

	.lens-update__btn--expand:hover {
		background: var(--color-bg-tertiary, #374151);
		color: var(--color-text-primary, #ffffff);
	}

	.lens-update__btn--expand :global(.rotated) {
		transform: rotate(180deg);
	}

	.lens-update__spinner {
		width: 12px;
		height: 12px;
		border: 2px solid rgba(34, 197, 94, 0.3);
		border-top-color: #22c55e;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* Expandable details */
	.lens-update__details {
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		padding-top: 0;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-1, 0.25rem);
		border-top: 1px solid var(--color-border, #374151);
	}

	.lens-update__lens-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		font-size: 11px;
	}

	.lens-update__lens-label {
		font-weight: var(--font-weight-medium, 500);
		flex-shrink: 0;
	}

	.lens-update__lens-label--receive {
		color: var(--color-success, #22c55e);
	}

	.lens-update__lens-label--share {
		color: var(--color-info, #3b82f6);
	}

	.lens-update__lens-list {
		color: var(--color-text-secondary, #d1d5db);
	}

	.lens-update__lens-list--empty {
		color: var(--color-text-muted, #6b7280);
		font-style: italic;
	}

	.lens-update__message {
		font-size: 11px;
		color: var(--color-text-muted, #6b7280);
		padding: var(--spacing-1, 0.25rem) var(--spacing-2, 0.5rem);
		background: var(--color-bg-primary, #111827);
		border-radius: var(--radius-sm, 0.25rem);
		margin-top: var(--spacing-1, 0.25rem);
	}
</style>
