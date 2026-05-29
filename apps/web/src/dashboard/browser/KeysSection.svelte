<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { slide } from 'svelte/transition';
	import { Key, ChevronDown, Copy, Check, LogOut } from 'svelte-feathers';
	import { nostrStore, nostrPublicKey, nostrPrivateKey } from '$lib/stores/nostr';
	import { nostrUtils } from 'holosphere';

	const { hexToNsec } = nostrUtils;
	const dispatch = createEventDispatcher();

	// UI State
	let isExpanded: boolean = false;
	let currentView: 'main' | 'import' = 'main';
	let importKeyInput: string = '';
	let importError: string = '';
	let isProcessing: boolean = false;
	let keyCopied: boolean = false;
	let showPrivateKey: boolean = false;

	$: shortenedPubKey = $nostrPublicKey ? `${$nostrPublicKey.slice(0, 8)}...${$nostrPublicKey.slice(-6)}` : 'Not set';
	$: displayNsec = $nostrPrivateKey ? hexToNsec($nostrPrivateKey) : '';

	// Load collapse state from localStorage
	if (typeof window !== 'undefined') {
		const saved = localStorage.getItem('sidebar_keys_expanded');
		isExpanded = saved === 'true';
	}

	function toggleExpanded() {
		isExpanded = !isExpanded;
		if (typeof window !== 'undefined') {
			localStorage.setItem('sidebar_keys_expanded', String(isExpanded));
		}
	}

	async function copyPublicKey() {
		if ($nostrPublicKey) {
			await navigator.clipboard.writeText($nostrPublicKey);
			keyCopied = true;
			setTimeout(() => keyCopied = false, 2000);
		}
	}

	async function generateNewKey() {
		isProcessing = true;
		try {
			await nostrStore.generateKey();
			dispatch('keyChanged', { action: 'generate' });
			window.location.reload();
		} catch (error) {
			console.error('Error generating key:', error);
		} finally {
			isProcessing = false;
		}
	}

	async function importKey() {
		importError = '';
		isProcessing = true;
		try {
			await nostrStore.importKey(importKeyInput.trim());
			dispatch('keyChanged', { action: 'import' });
			window.location.reload();
		} catch (error: any) {
			importError = error.message || 'Invalid key format';
		} finally {
			isProcessing = false;
		}
	}

	function logout() {
		sessionStorage.setItem('just_logged_out', 'true');
		nostrStore.clearKey();
		dispatch('keyChanged', { action: 'exit' });
		window.location.reload();
	}

	function resetView() {
		currentView = 'main';
		importKeyInput = '';
		importError = '';
	}
</script>

<div class="keys-section">
	<button
		class="keys-section__header"
		on:click={toggleExpanded}
		aria-expanded={isExpanded}
	>
		<div class="keys-section__header-left">
			<div class="keys-section__icon">
				<Key size="16" />
			</div>
			<div class="keys-section__header-info">
				<span class="keys-section__header-title">Identity</span>
				<span class="keys-section__header-subtitle">
					{shortenedPubKey}
				</span>
			</div>
		</div>
		<div class="keys-section__header-right">
			<span class="keys-section__status">
				Private
			</span>
			<ChevronDown size="16" class="keys-section__chevron {isExpanded ? 'keys-section__chevron--up' : ''}" />
		</div>
	</button>

	{#if isExpanded}
		<div class="keys-section__content" transition:slide={{ duration: 200 }}>
			{#if currentView === 'main'}
				<!-- Identity Status -->
				<div class="keys-section__identity">
					<div class="keys-section__identity-icon">
						<i class="fas fa-user"></i>
					</div>
					<div class="keys-section__identity-info">
						<div class="keys-section__identity-mode">
							Private Identity
						</div>
						{#if $nostrPublicKey}
							<div class="keys-section__identity-key">
								{shortenedPubKey}
								<button
									class="keys-section__copy-btn"
									on:click={copyPublicKey}
									title="Copy public key"
								>
									{#if keyCopied}
										<Check size="12" />
									{:else}
										<Copy size="12" />
									{/if}
								</button>
							</div>
						{/if}
					</div>
				</div>

				<!-- Actions -->
				<div class="keys-section__actions">
					<button class="keys-section__action" on:click={() => showPrivateKey = !showPrivateKey}>
						<i class="fas {showPrivateKey ? 'fa-eye-slash' : 'fa-eye'}"></i>
						<span>{showPrivateKey ? 'Hide Key' : 'Export Key'}</span>
					</button>

					{#if showPrivateKey}
						<div class="keys-section__private-key" transition:slide>
							<p class="keys-section__private-key-label">nsec (keep secret!)</p>
							<code class="keys-section__private-key-value">{displayNsec}</code>
						</div>
					{/if}

					<button class="keys-section__action" on:click={() => currentView = 'import'}>
						<i class="fas fa-exchange-alt"></i>
						<span>Switch Identity</span>
					</button>
					<button class="keys-section__action keys-section__action--danger" on:click={logout}>
						<LogOut size="14" />
						<span>Logout</span>
					</button>
				</div>

			{:else if currentView === 'import'}
				<!-- Import View -->
				<div class="keys-section__import">
					<button class="keys-section__back" on:click={resetView}>
						<i class="fas fa-arrow-left"></i> Back
					</button>

					<p class="keys-section__import-label">Enter your nsec or hex private key</p>

					<input
						type="password"
						bind:value={importKeyInput}
						placeholder="nsec1... or hex key"
						class="keys-section__import-input"
						class:keys-section__import-input--error={importError}
					/>

					{#if importError}
						<p class="keys-section__import-error">{importError}</p>
					{/if}

					<button
						class="keys-section__import-btn"
						on:click={importKey}
						disabled={isProcessing || !importKeyInput.trim()}
					>
						{#if isProcessing}
							<i class="fas fa-spinner fa-spin"></i>
						{/if}
						Import Key
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.keys-section {
		border-bottom: 1px solid var(--color-border, var(--color-bg-tertiary));
		background: var(--color-bg-primary, var(--color-bg-primary));
	}

	.keys-section__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: var(--spacing-3, 0.75rem) var(--spacing-4, 1rem);
		background: transparent;
		border: none;
		color: var(--color-text-secondary, var(--color-text-secondary));
		cursor: pointer;
		transition: background-color 150ms ease;
	}

	.keys-section__header:hover {
		background: var(--color-bg-secondary, var(--color-bg-secondary));
	}

	.keys-section__header-left {
		display: flex;
		align-items: center;
		gap: var(--spacing-3, 0.75rem);
	}

	.keys-section__icon {
		width: 36px;
		height: 36px;
		border-radius: var(--radius-md, 0.375rem);
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-accent-subtle, rgba(79, 70, 229, 0.2));
		color: var(--color-accent-light, #818cf8);
		flex-shrink: 0;
	}

	.keys-section__header-info {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
	}

	.keys-section__header-title {
		font-size: var(--font-size-sm, 0.875rem);
		font-weight: var(--font-weight-semibold, 600);
		color: var(--color-text-primary, #ffffff);
	}

	.keys-section__header-subtitle {
		font-size: var(--font-size-xs, 0.75rem);
		color: var(--color-text-muted, var(--color-text-muted));
		font-family: monospace;
	}

	.keys-section__header-right {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
	}

	.keys-section__status {
		font-size: var(--font-size-xs, 0.75rem);
		padding: 2px 8px;
		border-radius: var(--radius-full, 9999px);
		background: var(--color-accent, var(--color-accent));
		color: var(--color-text-primary);
	}

	.keys-section__content {
		padding: var(--spacing-3, 0.75rem) var(--spacing-4, 1rem);
		background: var(--color-bg-secondary, var(--color-bg-secondary));
	}

	.keys-section__identity {
		display: flex;
		align-items: center;
		gap: var(--spacing-3, 0.75rem);
		margin-bottom: var(--spacing-3, 0.75rem);
		padding: var(--spacing-2, 0.5rem);
		background: var(--color-bg-primary, var(--color-bg-primary));
		border-radius: var(--radius-md, 0.375rem);
	}

	.keys-section__identity-icon {
		width: 36px;
		height: 36px;
		border-radius: var(--radius-full, 9999px);
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-accent, var(--color-accent));
		color: var(--color-text-primary);
		font-size: 0.875rem;
	}

	.keys-section__identity-info {
		flex: 1;
		min-width: 0;
	}

	.keys-section__identity-mode {
		font-size: var(--font-size-sm, 0.875rem);
		font-weight: var(--font-weight-medium, 500);
		color: var(--color-text-primary, #ffffff);
	}

	.keys-section__identity-key {
		display: flex;
		align-items: center;
		gap: var(--spacing-1, 0.25rem);
		font-size: var(--font-size-xs, 0.75rem);
		font-family: monospace;
		color: var(--color-text-muted, var(--color-text-muted));
	}

	.keys-section__copy-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		background: transparent;
		border: none;
		color: var(--color-text-muted, var(--color-text-muted));
		cursor: pointer;
		border-radius: var(--radius-sm, 0.25rem);
	}

	.keys-section__copy-btn:hover {
		color: var(--color-accent-light, var(--color-accent-light));
		background: var(--color-bg-tertiary, var(--color-bg-tertiary));
	}

	.keys-section__actions {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-1, 0.25rem);
	}

	.keys-section__action {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		width: 100%;
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		background: var(--color-bg-primary, var(--color-bg-primary));
		border: none;
		border-radius: var(--radius-md, 0.375rem);
		color: var(--color-text-secondary, var(--color-text-secondary));
		font-size: var(--font-size-sm, 0.875rem);
		cursor: pointer;
		transition: background-color 150ms ease;
		text-align: left;
	}

	.keys-section__action:hover {
		background: var(--color-bg-tertiary, var(--color-bg-tertiary));
	}

	.keys-section__action:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.keys-section__action--danger {
		color: #ef4444;
	}

	.keys-section__action--danger:hover {
		background: rgba(239, 68, 68, 0.1);
	}


	.keys-section__private-key {
		padding: var(--spacing-2, 0.5rem);
		background: var(--color-bg-primary, var(--color-bg-primary));
		border-radius: var(--radius-md, 0.375rem);
		margin-bottom: var(--spacing-1, 0.25rem);
	}

	.keys-section__private-key-label {
		font-size: var(--font-size-xs, 0.75rem);
		color: #fbbf24;
		margin: 0 0 var(--spacing-1, 0.25rem) 0;
	}

	.keys-section__private-key-value {
		font-size: var(--font-size-xs, 0.75rem);
		font-family: monospace;
		color: var(--color-text-muted, var(--color-text-muted));
		word-break: break-all;
		display: block;
	}

	/* Import View */
	.keys-section__import {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-2, 0.5rem);
	}

	.keys-section__back {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		background: transparent;
		border: none;
		color: var(--color-text-muted, var(--color-text-muted));
		font-size: var(--font-size-sm, 0.875rem);
		cursor: pointer;
		padding: 0;
		margin-bottom: var(--spacing-2, 0.5rem);
	}

	.keys-section__back:hover {
		color: var(--color-text-primary, #ffffff);
	}

	.keys-section__import-label {
		font-size: var(--font-size-xs, 0.75rem);
		color: var(--color-text-muted, var(--color-text-muted));
		margin: 0;
	}

	.keys-section__import-input {
		width: 100%;
		padding: var(--spacing-2, 0.5rem);
		background: var(--color-bg-primary, var(--color-bg-primary));
		border: 1px solid var(--color-border, var(--color-bg-tertiary));
		border-radius: var(--radius-md, 0.375rem);
		color: var(--color-text-primary, #ffffff);
		font-size: var(--font-size-sm, 0.875rem);
		font-family: monospace;
	}

	.keys-section__import-input:focus {
		outline: none;
		border-color: var(--color-accent, var(--color-accent));
	}

	.keys-section__import-input--error {
		border-color: #ef4444;
	}

	.keys-section__import-error {
		font-size: var(--font-size-xs, 0.75rem);
		color: #ef4444;
		margin: 0;
	}

	.keys-section__import-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-2, 0.5rem);
		padding: var(--spacing-2, 0.5rem) var(--spacing-4, 1rem);
		background: var(--color-accent, var(--color-accent));
		border: none;
		border-radius: var(--radius-md, 0.375rem);
		color: var(--color-text-primary);
		font-size: var(--font-size-sm, 0.875rem);
		font-weight: var(--font-weight-medium, 500);
		cursor: pointer;
		transition: background-color 150ms ease;
	}

	.keys-section__import-btn:hover:not(:disabled) {
		background: var(--color-accent-dark, var(--color-accent-hover));
	}

	.keys-section__import-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
