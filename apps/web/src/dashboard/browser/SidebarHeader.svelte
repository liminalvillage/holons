<script lang="ts">
	import { createEventDispatcher, getContext } from 'svelte';
	import { Copy, Check, Grid } from 'svelte-feathers';
	import { ID } from '../store';
	import { nameMap, resolveName } from '$lib/stores/nameResolver';

	const dispatch = createEventDispatcher();
	let idCopied: boolean = false;
	let showQRModal: boolean = false;

	// Current holon from store
	$: currentHolonId = $ID;
	// Only shorten ID if longer than 20 characters
	$: displayId = currentHolonId
		? (currentHolonId.length > 20
			? `${currentHolonId.slice(0, 8)}...${currentHolonId.slice(-6)}`
			: currentHolonId)
		: '';

	// Resolve holon name reactively
	$: if (currentHolonId) resolveName(currentHolonId);
	$: holonName = currentHolonId ? ($nameMap[currentHolonId] || 'Unnamed Holon') : 'No Holon Selected';

	async function copyHolonId() {
		if (currentHolonId) {
			await navigator.clipboard.writeText(currentHolonId);
			idCopied = true;
			setTimeout(() => idCopied = false, 2000);
		}
	}

	function toggleQRModal() {
		showQRModal = !showQRModal;
		dispatch('qrcode', { show: showQRModal, holonId: currentHolonId });
	}
</script>

<div class="sidebar-header">
	<!-- Current Holon with Logo -->
	{#if currentHolonId}
		<div class="sidebar-header__holon">
			<div class="sidebar-header__holon-header">
				<svg class="sidebar-header__logo" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
					<circle cx="9" cy="12" r="6" fill="transparent" stroke="currentColor" stroke-width="2"/>
					<circle cx="15" cy="12" r="6" fill="transparent" stroke="currentColor" stroke-width="2"/>
				</svg>
				<div class="sidebar-header__holon-name" title={holonName}>
					{holonName}
				</div>
			</div>
			<div class="sidebar-header__holon-id">
				<span class="sidebar-header__holon-id-text" title={currentHolonId}>
					{displayId}
				</span>
				<div class="sidebar-header__holon-actions">
					<button
						class="sidebar-header__action-btn"
						onclick={copyHolonId}
						title="Copy Holon ID"
					>
						{#if idCopied}
							<Check size="14" />
						{:else}
							<Copy size="14" />
						{/if}
					</button>
					<button
						class="sidebar-header__action-btn"
						onclick={toggleQRModal}
						title="Show QR Code"
					>
						<Grid size="14" />
					</button>
				</div>
			</div>
		</div>
	{:else}
		<div class="sidebar-header__holon sidebar-header__holon--empty">
			<div class="sidebar-header__holon-header">
				<svg class="sidebar-header__logo" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
					<circle cx="9" cy="12" r="6" fill="transparent" stroke="currentColor" stroke-width="2"/>
					<circle cx="15" cy="12" r="6" fill="transparent" stroke="currentColor" stroke-width="2"/>
				</svg>
				<div class="sidebar-header__holon-name">Select a holon</div>
			</div>
			<div class="sidebar-header__holon-id">
				<span class="sidebar-header__holon-id-text">Browse below to get started</span>
			</div>
		</div>
	{/if}
</div>

<!-- QR Modal -->
{#if showQRModal && currentHolonId}
	<div class="qr-modal-backdrop" onclick={toggleQRModal} onkeydown={(e) => e.key === 'Escape' && toggleQRModal()} role="button" tabindex="0">
		<div class="qr-modal" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
			<div class="qr-modal__header">
				<h3>Holon QR Code</h3>
				<button class="qr-modal__close" onclick={toggleQRModal} aria-label="Close">×</button>
			</div>
			<div class="qr-modal__content">
				<!-- QR Code placeholder - can be replaced with actual QR library -->
				<div class="qr-modal__qr">
					<img
						src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data={encodeURIComponent(currentHolonId)}"
						alt="QR Code for {holonName}"
					/>
				</div>
				<p class="qr-modal__id">{currentHolonId}</p>
			</div>
		</div>
	</div>
{/if}

<style>
	.sidebar-header {
		padding: var(--spacing-4, 1rem);
		border-bottom: 1px solid var(--color-border, var(--color-bg-tertiary));
		background: var(--color-bg-secondary, var(--color-bg-secondary));
	}

	.sidebar-header__holon {
		background: var(--color-bg-primary, var(--color-bg-primary));
		border-radius: var(--radius-lg, 0.5rem);
		padding: var(--spacing-3, 0.75rem);
	}

	.sidebar-header__holon-header {
		display: flex;
		align-items: center;
		gap: var(--spacing-3, 0.75rem);
		margin-bottom: var(--spacing-2, 0.5rem);
	}

	.sidebar-header__logo {
		width: 28px;
		height: 28px;
		flex-shrink: 0;
		color: var(--color-accent-light, var(--color-accent-light));
	}

	.sidebar-header__holon--empty {
		opacity: 0.6;
	}

	.sidebar-header__holon-name {
		font-size: var(--font-size-base, 1rem);
		font-weight: var(--font-weight-semibold, 600);
		color: var(--color-text-primary, #ffffff);
		margin-bottom: var(--spacing-1, 0.25rem);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.sidebar-header__holon-id {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-2, 0.5rem);
	}

	.sidebar-header__holon-id-text {
		font-size: var(--font-size-xs, 0.75rem);
		font-family: monospace;
		color: var(--color-text-muted, var(--color-text-muted));
	}

	.sidebar-header__holon-actions {
		display: flex;
		gap: var(--spacing-1, 0.25rem);
	}

	.sidebar-header__action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-md, 0.375rem);
		background: var(--color-bg-tertiary, var(--color-bg-tertiary));
		border: none;
		color: var(--color-text-secondary, var(--color-text-secondary));
		cursor: pointer;
		transition: background-color 150ms ease, color 150ms ease;
	}

	.sidebar-header__action-btn:hover {
		background: var(--color-accent, var(--color-accent));
		color: var(--color-text-primary, #ffffff);
	}

	/* QR Modal */
	.qr-modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		cursor: pointer;
	}

	.qr-modal {
		background: var(--color-bg-secondary, var(--color-bg-secondary));
		border-radius: var(--radius-xl, 1rem);
		padding: var(--spacing-4, 1rem);
		max-width: 320px;
		width: 90%;
		box-shadow: var(--shadow-xl);
		cursor: default;
		border: 1px solid var(--color-border, var(--color-bg-tertiary));
	}

	.qr-modal__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--spacing-4, 1rem);
	}

	.qr-modal__header h3 {
		font-size: var(--font-size-lg, 1.125rem);
		font-weight: var(--font-weight-semibold, 600);
		color: var(--color-text-primary, #ffffff);
		margin: 0;
	}

	.qr-modal__close {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: var(--color-text-muted, var(--color-text-muted));
		font-size: 1.5rem;
		cursor: pointer;
		border-radius: var(--radius-md, 0.375rem);
	}

	.qr-modal__close:hover {
		background: var(--color-bg-tertiary, var(--color-bg-tertiary));
		color: var(--color-text-primary, #ffffff);
	}

	.qr-modal__content {
		text-align: center;
	}

	.qr-modal__qr {
		background: white;
		padding: var(--spacing-4, 1rem);
		border-radius: var(--radius-lg, 0.5rem);
		display: inline-block;
		margin-bottom: var(--spacing-3, 0.75rem);
	}

	.qr-modal__qr img {
		display: block;
		width: 200px;
		height: 200px;
	}

	.qr-modal__id {
		font-size: var(--font-size-xs, 0.75rem);
		font-family: monospace;
		color: var(--color-text-muted, var(--color-text-muted));
		word-break: break-all;
		margin: 0;
	}
</style>
