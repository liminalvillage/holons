<script lang="ts">
	import { createEventDispatcher, getContext } from 'svelte';
	import { goto } from '$app/navigation';
	import { slide } from 'svelte/transition';
	import { Settings, LogOut, LogIn, Copy, Check, Home, Key, Plus, Upload, Eye, EyeOff, ChevronDown } from 'svelte-feathers';
	import { nostrStore, nostrPublicKey, nostrPrivateKey } from '$lib/stores/nostr';
	import { fetchHolonName } from '../../utils/holonNames';
	import { ID } from '../store';
	import type { HoloSphere } from 'holosphere';
	import { schnorr } from '@noble/curves/secp256k1';
	import { bytesToHex } from '@noble/hashes/utils';

	const dispatch = createEventDispatcher();
	const holosphere = getContext<HoloSphere>('holosphere');

	// Check if using public/holosphere key
	const HOLOSPHERE_PRIVATE_KEY = import.meta.env.VITE_HOLOSPHERE_PRIVATE_KEY;

	function getHolospherePublicKey(): string | null {
		if (!HOLOSPHERE_PRIVATE_KEY) return null;
		try {
			const pubKeyBytes = schnorr.getPublicKey(HOLOSPHERE_PRIVATE_KEY);
			return bytesToHex(pubKeyBytes);
		} catch {
			return null;
		}
	}

	// State
	let holonName: string = 'Loading...';
	let idCopied: boolean = false;
	let showDropdown: boolean = false;
	let showPrivateKey: boolean = false;
	let showImportModal: boolean = false;
	let importKeyInput: string = '';
	let importError: string = '';
	let isProcessing: boolean = false;

	// Reactive computations
	$: holospherePublicKey = getHolospherePublicKey();
	$: isLoggedIn = $nostrPublicKey && $nostrPublicKey !== holospherePublicKey && !!$nostrPrivateKey;
	$: homeHolonId = $nostrPublicKey;
	$: displayId = homeHolonId
		? (homeHolonId.length > 16
			? `${homeHolonId.slice(0, 6)}...${homeHolonId.slice(-4)}`
			: homeHolonId)
		: '';

	// Fetch holon name when home holon ID changes
	$: if (homeHolonId && holosphere) {
		fetchHolonName(holosphere, homeHolonId).then(name => {
			holonName = name || 'My Holon';
		});
	} else if (!homeHolonId) {
		holonName = 'Guest';
	}

	async function copyHolonId() {
		if (homeHolonId) {
			await navigator.clipboard.writeText(homeHolonId);
			idCopied = true;
			setTimeout(() => idCopied = false, 2000);
		}
	}

	function navigateHome() {
		if (homeHolonId) {
			ID.set(homeHolonId);
			goto(`/${homeHolonId}/dashboard`);
		}
	}

	function navigateToSettings() {
		if (homeHolonId) {
			goto(`/${homeHolonId}/settings`);
		}
		showDropdown = false;
	}

	function handleLogout() {
		localStorage.setItem('enter_public_mode', 'true');
		nostrStore.clearKey();
		window.location.reload();
	}

	async function handleCreateNew() {
		isProcessing = true;
		try {
			await nostrStore.generateKey();
			window.location.reload();
		} catch (error) {
			console.error('Error generating key:', error);
		} finally {
			isProcessing = false;
		}
	}

	function openImportModal() {
		showDropdown = false;
		showImportModal = true;
		importKeyInput = '';
		importError = '';
	}

	function closeImportModal() {
		showImportModal = false;
		importKeyInput = '';
		importError = '';
	}

	async function handleImportKey() {
		if (!importKeyInput.trim()) {
			importError = 'Please enter a private key';
			return;
		}

		const key = importKeyInput.trim().toLowerCase();
		if (!/^[0-9a-f]{64}$/.test(key)) {
			importError = 'Invalid key format. Must be 64 hex characters.';
			return;
		}

		isProcessing = true;
		importError = '';

		try {
			await nostrStore.importKey(key);
			window.location.reload();
		} catch (error: any) {
			importError = error.message || 'Failed to import key';
		} finally {
			isProcessing = false;
		}
	}

	function toggleDropdown() {
		showDropdown = !showDropdown;
		if (!showDropdown) {
			showPrivateKey = false;
		}
	}

	function closeDropdown() {
		showDropdown = false;
		showPrivateKey = false;
	}

	// Handle key input formatting
	function handleKeyInput(event: Event) {
		const input = event.target as HTMLInputElement;
		importKeyInput = input.value.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
	}
</script>

<svelte:window on:click={(e) => {
	const target = e.target as HTMLElement;
	if (!target.closest('.home-header__dropdown-container')) {
		showDropdown = false;
		showPrivateKey = false;
	}
}} />

<div class="home-header">
	<div class="home-header__holon" class:home-header__holon--guest={!isLoggedIn}>
		<!-- Home icon and holon info -->
		<button class="home-header__main" onclick={navigateHome} title="Go to your holon">
			<div class="home-header__icon">
				<Home size="18" />
			</div>
			<div class="home-header__info">
				<div class="home-header__name" title={holonName}>
					{holonName}
				</div>
				{#if homeHolonId && isLoggedIn}
					<div class="home-header__id">
						<span title={homeHolonId}>{displayId}</span>
						<button
							class="home-header__copy-btn"
							onclick={(e) => { e.stopPropagation(); copyHolonId(); }}
							title="Copy ID"
						>
							{#if idCopied}
								<Check size="12" />
							{:else}
								<Copy size="12" />
							{/if}
						</button>
					</div>
				{/if}
			</div>
		</button>

		<!-- Dropdown trigger -->
		<div class="home-header__dropdown-container">
			<button
				class="home-header__dropdown-btn"
				class:home-header__dropdown-btn--active={showDropdown}
				onclick={toggleDropdown}
				title="Account options"
			>
				<Key size="16" />
				<span class="chevron" class:chevron--up={showDropdown}>
					<ChevronDown size="14" />
				</span>
			</button>

			<!-- Dropdown menu -->
			{#if showDropdown}
				<div class="home-header__dropdown" transition:slide={{ duration: 150 }}>
					{#if isLoggedIn}
						<!-- Logged in options -->
						<button class="dropdown-item" onclick={navigateToSettings}>
							<Settings size="14" />
							<span>Settings</span>
						</button>

						<button class="dropdown-item" onclick={() => showPrivateKey = !showPrivateKey}>
							{#if showPrivateKey}
								<EyeOff size="14" />
								<span>Hide Key</span>
							{:else}
								<Eye size="14" />
								<span>Export Key</span>
							{/if}
						</button>

						{#if showPrivateKey}
							<div class="dropdown-key" transition:slide={{ duration: 150 }}>
								<p class="dropdown-key__label">Private Key (keep secret!)</p>
								<code class="dropdown-key__value">{$nostrPrivateKey}</code>
							</div>
						{/if}

						<button class="dropdown-item" onclick={openImportModal}>
							<Upload size="14" />
							<span>Switch Identity</span>
						</button>

						<div class="dropdown-divider"></div>

						<button class="dropdown-item dropdown-item--danger" onclick={handleLogout}>
							<LogOut size="14" />
							<span>Logout</span>
						</button>
					{:else}
						<!-- Guest options -->
						<button class="dropdown-item dropdown-item--primary" onclick={handleCreateNew} disabled={isProcessing}>
							<Plus size="14" />
							<span>Create New Identity</span>
						</button>

						<button class="dropdown-item" onclick={openImportModal}>
							<Upload size="14" />
							<span>Import Key</span>
						</button>
					{/if}
				</div>
			{/if}
		</div>
	</div>

	<!-- Status badge -->
	<div class="home-header__status" class:home-header__status--guest={!isLoggedIn}>
		{isLoggedIn ? 'Private' : 'Guest'}
	</div>
</div>

<!-- Import Key Modal -->
{#if showImportModal}
	<div
		class="modal-backdrop"
		onclick={closeImportModal}
		onkeydown={(e) => e.key === 'Escape' && closeImportModal()}
		role="button"
		tabindex="0"
	>
		<div
			class="modal"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<div class="modal__header">
				<h3>{isLoggedIn ? 'Switch Identity' : 'Import Key'}</h3>
				<button class="modal__close" onclick={closeImportModal} aria-label="Close">×</button>
			</div>

			<div class="modal__content">
				<p class="modal__label">Enter your 64-character hex private key</p>

				<input
					type="password"
					value={importKeyInput}
					oninput={handleKeyInput}
					placeholder="Private key..."
					class="modal__input"
					class:modal__input--error={importError}
					disabled={isProcessing}
					onkeydown={(e) => e.key === 'Enter' && handleImportKey()}
				/>

				<p class="modal__key-length">{importKeyInput.length}/64 characters</p>

				{#if importError}
					<p class="modal__error" transition:slide>{importError}</p>
				{/if}
			</div>

			<div class="modal__actions">
				<button
					class="btn btn--primary"
					onclick={handleImportKey}
					disabled={isProcessing || importKeyInput.length !== 64}
				>
					{#if isProcessing}
						Importing...
					{:else}
						Import Key
					{/if}
				</button>
				<button class="btn btn--secondary" onclick={closeImportModal}>Cancel</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.home-header {
		padding: var(--spacing-3, 0.75rem) var(--spacing-4, 1rem);
		border-bottom: 1px solid var(--color-border, #374151);
		background: var(--color-bg-secondary, #1f2937);
		position: relative;
	}

	.home-header__holon {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-2, 0.5rem);
		background: var(--color-bg-primary, #111827);
		border-radius: var(--radius-lg, 0.5rem);
		padding: var(--spacing-2, 0.5rem);
		border: 1px solid var(--color-accent, #4f46e5);
	}

	.home-header__holon--guest {
		border-color: var(--color-success, #10b981);
	}

	.home-header__main {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
		padding: var(--spacing-1, 0.25rem);
		border-radius: var(--radius-md, 0.375rem);
		transition: background-color 150ms ease;
	}

	.home-header__main:hover {
		background: var(--color-bg-tertiary, #374151);
	}

	.home-header__icon {
		width: 32px;
		height: 32px;
		border-radius: var(--radius-full, 9999px);
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-accent, #4f46e5);
		color: white;
		flex-shrink: 0;
	}

	.home-header__holon--guest .home-header__icon {
		background: var(--color-success, #10b981);
	}

	.home-header__info {
		flex: 1;
		min-width: 0;
	}

	.home-header__name {
		font-size: var(--font-size-sm, 0.875rem);
		font-weight: var(--font-weight-semibold, 600);
		color: var(--color-text-primary, #ffffff);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.home-header__id {
		display: flex;
		align-items: center;
		gap: var(--spacing-1, 0.25rem);
		font-size: var(--font-size-xs, 0.75rem);
		font-family: monospace;
		color: var(--color-text-muted, #6b7280);
	}

	.home-header__copy-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		background: transparent;
		border: none;
		color: var(--color-text-muted, #6b7280);
		cursor: pointer;
		border-radius: var(--radius-sm, 0.25rem);
		padding: 0;
	}

	.home-header__copy-btn:hover {
		color: var(--color-accent-light, #6366f1);
		background: var(--color-bg-tertiary, #374151);
	}

	/* Dropdown container */
	.home-header__dropdown-container {
		position: relative;
	}

	.home-header__dropdown-btn {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: var(--spacing-1, 0.25rem) var(--spacing-2, 0.5rem);
		border-radius: var(--radius-md, 0.375rem);
		background: var(--color-bg-tertiary, #374151);
		border: none;
		color: var(--color-text-secondary, #d1d5db);
		cursor: pointer;
		transition: background-color 150ms ease, color 150ms ease;
	}

	.home-header__dropdown-btn:hover,
	.home-header__dropdown-btn--active {
		background: var(--color-accent, #4f46e5);
		color: white;
	}

	.chevron {
		display: flex;
		transition: transform 150ms ease;
	}

	.chevron--up {
		transform: rotate(180deg);
	}

	.home-header__dropdown {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: var(--spacing-1, 0.25rem);
		min-width: 180px;
		background: var(--color-bg-secondary, #1f2937);
		border: 1px solid var(--color-border, #374151);
		border-radius: var(--radius-lg, 0.5rem);
		box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
		z-index: 50;
		overflow: hidden;
	}

	.dropdown-item {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		width: 100%;
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		background: transparent;
		border: none;
		color: var(--color-text-secondary, #d1d5db);
		font-size: var(--font-size-sm, 0.875rem);
		cursor: pointer;
		transition: background-color 150ms ease;
		text-align: left;
	}

	.dropdown-item:hover {
		background: var(--color-bg-tertiary, #374151);
	}

	.dropdown-item:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.dropdown-item--primary {
		color: var(--color-accent-light, #6366f1);
	}

	.dropdown-item--primary:hover {
		background: rgba(79, 70, 229, 0.1);
	}

	.dropdown-item--danger {
		color: var(--color-error, #ef4444);
	}

	.dropdown-item--danger:hover {
		background: rgba(239, 68, 68, 0.1);
	}

	.dropdown-divider {
		height: 1px;
		background: var(--color-border, #374151);
		margin: var(--spacing-1, 0.25rem) 0;
	}

	.dropdown-key {
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		background: var(--color-bg-primary, #111827);
	}

	.dropdown-key__label {
		font-size: var(--font-size-xs, 0.75rem);
		color: #fbbf24;
		margin: 0 0 var(--spacing-1, 0.25rem) 0;
	}

	.dropdown-key__value {
		font-size: 10px;
		font-family: monospace;
		color: var(--color-text-muted, #6b7280);
		word-break: break-all;
		display: block;
		line-height: 1.4;
	}

	.home-header__status {
		position: absolute;
		top: var(--spacing-2, 0.5rem);
		right: var(--spacing-3, 0.75rem);
		font-size: 10px;
		padding: 2px 6px;
		border-radius: var(--radius-full, 9999px);
		background: var(--color-accent, #4f46e5);
		color: white;
		font-weight: var(--font-weight-medium, 500);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.home-header__status--guest {
		background: var(--color-success, #10b981);
	}

	/* Modal styles */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}

	.modal {
		background: var(--color-bg-secondary, #1f2937);
		border-radius: var(--radius-xl, 1rem);
		padding: var(--spacing-5, 1.25rem);
		max-width: 400px;
		width: 90%;
		box-shadow: var(--shadow-xl);
		border: 1px solid var(--color-border, #374151);
	}

	.modal__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--spacing-4, 1rem);
	}

	.modal__header h3 {
		font-size: var(--font-size-lg, 1.125rem);
		font-weight: var(--font-weight-semibold, 600);
		color: var(--color-text-primary, #ffffff);
		margin: 0;
	}

	.modal__close {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: var(--color-text-muted, #6b7280);
		font-size: 1.5rem;
		cursor: pointer;
		border-radius: var(--radius-md, 0.375rem);
	}

	.modal__close:hover {
		background: var(--color-bg-tertiary, #374151);
		color: var(--color-text-primary, #ffffff);
	}

	.modal__content {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-2, 0.5rem);
	}

	.modal__label {
		font-size: var(--font-size-sm, 0.875rem);
		color: var(--color-text-muted, #6b7280);
		margin: 0;
	}

	.modal__input {
		width: 100%;
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		background: var(--color-bg-primary, #111827);
		border: 1px solid var(--color-border, #374151);
		border-radius: var(--radius-md, 0.375rem);
		color: var(--color-text-primary, #ffffff);
		font-size: var(--font-size-sm, 0.875rem);
		font-family: monospace;
	}

	.modal__input:focus {
		outline: none;
		border-color: var(--color-accent, #4f46e5);
		box-shadow: 0 0 0 2px var(--color-accent-subtle, rgba(79, 70, 229, 0.1));
	}

	.modal__input--error {
		border-color: var(--color-error, #ef4444);
	}

	.modal__key-length {
		font-size: var(--font-size-xs, 0.75rem);
		color: var(--color-text-muted, #6b7280);
		text-align: right;
		margin: 0;
	}

	.modal__error {
		font-size: var(--font-size-sm, 0.875rem);
		color: var(--color-error, #ef4444);
		margin: 0;
	}

	.modal__actions {
		display: flex;
		gap: var(--spacing-3, 0.75rem);
		margin-top: var(--spacing-4, 1rem);
	}

	.modal__actions .btn {
		flex: 1;
		padding: var(--spacing-2, 0.5rem) var(--spacing-4, 1rem);
		border: none;
		border-radius: var(--radius-md, 0.375rem);
		font-size: var(--font-size-sm, 0.875rem);
		font-weight: var(--font-weight-medium, 500);
		cursor: pointer;
		transition: background-color 150ms ease;
	}

	.btn--primary {
		background: var(--color-accent, #4f46e5);
		color: white;
	}

	.btn--primary:hover:not(:disabled) {
		background: var(--color-accent-dark, #4338ca);
	}

	.btn--primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn--secondary {
		background: var(--color-bg-tertiary, #374151);
		color: var(--color-text-secondary, #d1d5db);
	}

	.btn--secondary:hover {
		background: var(--color-bg-primary, #111827);
	}

	</style>
