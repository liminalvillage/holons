<script lang="ts">
	import { onMount, createEventDispatcher } from 'svelte';
	import { fade, fly, slide } from 'svelte/transition';
	import { nostrStore } from '$lib/stores/nostr';
	import { telegramStore } from '$lib/stores/telegram';
	import { schnorr } from '@noble/curves/secp256k1';
	import { bytesToHex } from '@noble/hashes/utils';
	import MyHolonsIcon from '../dashboard/sidebar/icons/MyHolonsIcon.svelte';

	const dispatch = createEventDispatcher();

	// View states
	type View = 'loading' | 'welcome' | 'create' | 'restore';
	let view: View = 'loading';

	// Form state
	let holonName = '';
	let privateKeyInput = '';
	let error = '';
	let isProcessing = false;

	// Telegram state
	let telegramUser: any = null;
	let isTelegramWebApp = false;

	// Holosphere public key from .env (for public space fallback)
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

	onMount(async () => {
		// Initialize stores
		await nostrStore.init();
		telegramStore.init();

		// Check Telegram context
		const telegramState = telegramStore.getState();
		isTelegramWebApp = telegramState.isTelegramWebApp;
		telegramUser = telegramState.user;

		// Check if we have a saved private key
		const state = nostrStore.getState();

		if (state.privateKey) {
			// Returning user - key exists, proceed to app
			setTimeout(() => dispatch('authenticated', { publicKey: state.publicKey }), 300);
		} else if (isTelegramWebApp && telegramUser) {
			// Telegram Mini App - auto-create flow
			await handleTelegramAutoCreate();
		} else {
			// First-time user - show welcome screen
			setTimeout(() => {
				view = 'welcome';
			}, 500);
		}
	});

	// Handle Telegram auto-create flow
	async function handleTelegramAutoCreate() {
		isProcessing = true;
		error = '';

		try {
			// Use Telegram username or first name as holon name
			const name = telegramUser.username
				? `@${telegramUser.username}'s Holon`
				: `${telegramUser.first_name}'s Holon`;

			// Generate new key
			const result = await nostrStore.generateKey();

			if (result) {
				// Dispatch authenticated with holon name for creation
				dispatch('authenticated', {
					publicKey: result.publicKey,
					holonName: name,
					telegramUserId: telegramUser.id,
					mode: 'private'
				});
			}
		} catch (err: any) {
			console.error('Telegram auto-create failed:', err);
			error = err.message || 'Failed to create holon';
			// Fall back to welcome screen
			view = 'welcome';
		} finally {
			isProcessing = false;
		}
	}

	// Handle create new holon
	async function handleCreate() {
		if (!holonName.trim()) {
			error = 'Please enter a name for your holon';
			return;
		}

		isProcessing = true;
		error = '';

		try {
			// Generate new key
			const result = await nostrStore.generateKey();

			if (result) {
				// Dispatch authenticated with holon name for creation
				dispatch('authenticated', {
					publicKey: result.publicKey,
					holonName: holonName.trim(),
					mode: 'private'
				});
			}
		} catch (err: any) {
			error = err.message || 'Failed to create holon';
		} finally {
			isProcessing = false;
		}
	}

	// Handle restore existing holon
	async function handleRestore() {
		if (!privateKeyInput.trim()) {
			error = 'Please enter your private key';
			return;
		}

		// Validate key format
		const key = privateKeyInput.trim().toLowerCase();
		if (!/^[0-9a-f]{64}$/.test(key)) {
			error = 'Invalid key format. Must be 64 hex characters.';
			return;
		}

		isProcessing = true;
		error = '';

		try {
			// Import the key
			const result = await nostrStore.importKey(key);

			if (result) {
				// Dispatch authenticated - will load existing holon settings
				dispatch('authenticated', {
					publicKey: result.publicKey,
					mode: 'private'
				});
			}
		} catch (err: any) {
			error = err.message || 'Failed to restore holon';
		} finally {
			isProcessing = false;
		}
	}

	// Handle key input formatting
	function handleKeyInput(event: Event) {
		const input = event.target as HTMLInputElement;
		// Remove non-hex characters and convert to lowercase
		privateKeyInput = input.value.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
	}

	// Go back to welcome screen
	function goBack() {
		view = 'welcome';
		error = '';
		holonName = '';
		privateKeyInput = '';
	}
</script>

{#if view === 'loading'}
	<!-- Loading View -->
	<div class="splash-container" transition:fade={{ duration: 300 }}>
		<div class="logo-container" in:fly={{ y: 30, duration: 500, delay: 100 }}>
			<div class="logo-icon">
				<MyHolonsIcon />
			</div>
		</div>
		<div class="bottom-branding" in:fade={{ delay: 400 }}>
			<p>powered by HoloSphere</p>
		</div>
	</div>

{:else if view === 'welcome'}
	<!-- Welcome View -->
	<div class="splash-container" transition:fade={{ duration: 300 }}>
		<div class="onboarding-card" in:fly={{ y: 30, duration: 400 }}>
			<!-- Logo -->
			<div class="logo-small">
				<MyHolonsIcon />
			</div>

			<h1 class="title">Welcome to Holons</h1>
			<p class="subtitle">Your decentralized collaboration space</p>

			<!-- Options -->
			<div class="options">
				<button
					class="option-button primary"
					on:click={() => view = 'create'}
				>
					<div class="option-icon">
						<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
						</svg>
					</div>
					<div class="option-text">
						<span class="option-title">Create New Holon</span>
						<span class="option-desc">Start fresh with a new identity</span>
					</div>
				</button>

				<button
					class="option-button secondary"
					on:click={() => view = 'restore'}
				>
					<div class="option-icon">
						<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
						</svg>
					</div>
					<div class="option-text">
						<span class="option-title">Restore Existing</span>
						<span class="option-desc">Import your private key</span>
					</div>
				</button>
			</div>
		</div>

		<div class="bottom-branding">
			<p>powered by HoloSphere</p>
		</div>
	</div>

{:else if view === 'create'}
	<!-- Create View -->
	<div class="splash-container" transition:fade={{ duration: 300 }}>
		<div class="onboarding-card" in:fly={{ y: 30, duration: 400 }}>
			<button class="back-button" on:click={goBack}>
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
				</svg>
				Back
			</button>

			<h1 class="title">Name Your Holon</h1>
			<p class="subtitle">A unique identity will be generated for your holon</p>

			<div class="form-group">
				<input
					type="text"
					bind:value={holonName}
					placeholder="Enter holon name..."
					class="text-input"
					class:error={error && !holonName.trim()}
					disabled={isProcessing}
					on:keydown={(e) => e.key === 'Enter' && handleCreate()}
				/>

				{#if error}
					<p class="error-message" transition:slide>{error}</p>
				{/if}
			</div>

			<button
				class="submit-button"
				on:click={handleCreate}
				disabled={isProcessing || !holonName.trim()}
			>
				{#if isProcessing}
					<svg class="spinner" viewBox="0 0 24 24">
						<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="30 70" />
					</svg>
					Creating...
				{:else}
					Create Holon
				{/if}
			</button>

			<p class="info-text">
				Your private key will be saved locally. Make sure to back it up after creation.
			</p>
		</div>

		<div class="bottom-branding">
			<p>powered by HoloSphere</p>
		</div>
	</div>

{:else if view === 'restore'}
	<!-- Restore View -->
	<div class="splash-container" transition:fade={{ duration: 300 }}>
		<div class="onboarding-card" in:fly={{ y: 30, duration: 400 }}>
			<button class="back-button" on:click={goBack}>
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
				</svg>
				Back
			</button>

			<h1 class="title">Restore Your Holon</h1>
			<p class="subtitle">Enter your 64-character private key</p>

			<div class="form-group">
				<input
					type="password"
					value={privateKeyInput}
					on:input={handleKeyInput}
					placeholder="Enter private key..."
					class="text-input mono"
					class:error={error}
					disabled={isProcessing}
					on:keydown={(e) => e.key === 'Enter' && handleRestore()}
				/>

				<p class="key-length">{privateKeyInput.length}/64 characters</p>

				{#if error}
					<p class="error-message" transition:slide>{error}</p>
				{/if}
			</div>

			<button
				class="submit-button"
				on:click={handleRestore}
				disabled={isProcessing || privateKeyInput.length !== 64}
			>
				{#if isProcessing}
					<svg class="spinner" viewBox="0 0 24 24">
						<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="30 70" />
					</svg>
					Restoring...
				{:else}
					Restore Holon
				{/if}
			</button>

			<p class="info-text">
				Your private key is stored only on this device and never sent to any server.
			</p>
		</div>

		<div class="bottom-branding">
			<p>powered by HoloSphere</p>
		</div>
	</div>
{/if}

<style>
	.splash-container {
		position: fixed;
		inset: 0;
		background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f0f1e 100%);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		z-index: 9999;
		padding: 1rem;
	}

	/* Loading View */
	.logo-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
	}

	.logo-icon {
		width: 300px;
		height: 300px;
		filter: drop-shadow(0 0 60px rgba(66, 153, 225, 0.5));
		animation: pulse-glow 3s ease-in-out infinite;
	}

	@keyframes pulse-glow {
		0%, 100% { filter: drop-shadow(0 0 60px rgba(66, 153, 225, 0.5)); }
		50% { filter: drop-shadow(0 0 100px rgba(66, 153, 225, 0.7)); }
	}

	/* Onboarding Card */
	.onboarding-card {
		background: rgba(30, 41, 59, 0.9);
		border: 1px solid rgba(100, 116, 139, 0.3);
		border-radius: 1rem;
		padding: 2rem;
		max-width: 400px;
		width: 100%;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
	}

	.logo-small {
		width: 80px;
		height: 80px;
		margin: 0 auto 1.5rem;
		filter: drop-shadow(0 0 20px rgba(66, 153, 225, 0.4));
	}

	.title {
		font-size: 1.5rem;
		font-weight: 700;
		color: white;
		text-align: center;
		margin-bottom: 0.5rem;
	}

	.subtitle {
		color: #94a3b8;
		text-align: center;
		margin-bottom: 1.5rem;
		font-size: 0.95rem;
	}

	/* Options */
	.options {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.option-button {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem;
		border-radius: 0.75rem;
		border: 1px solid transparent;
		cursor: pointer;
		transition: all 0.2s ease;
		text-align: left;
		width: 100%;
	}

	.option-button.primary {
		background: rgba(79, 70, 229, 0.2);
		border-color: rgba(79, 70, 229, 0.4);
	}

	.option-button.primary:hover {
		background: rgba(79, 70, 229, 0.3);
		border-color: rgba(79, 70, 229, 0.6);
	}

	.option-button.secondary {
		background: rgba(100, 116, 139, 0.15);
		border-color: rgba(100, 116, 139, 0.3);
	}

	.option-button.secondary:hover {
		background: rgba(100, 116, 139, 0.25);
		border-color: rgba(100, 116, 139, 0.5);
	}

	.option-icon {
		width: 40px;
		height: 40px;
		border-radius: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.option-button.primary .option-icon {
		background: rgba(79, 70, 229, 0.3);
		color: #a5b4fc;
	}

	.option-button.secondary .option-icon {
		background: rgba(100, 116, 139, 0.3);
		color: #cbd5e1;
	}

	.option-text {
		display: flex;
		flex-direction: column;
	}

	.option-title {
		color: white;
		font-weight: 600;
		font-size: 1rem;
	}

	.option-desc {
		color: #94a3b8;
		font-size: 0.85rem;
	}

	/* Back Button */
	.back-button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: #94a3b8;
		background: none;
		border: none;
		cursor: pointer;
		font-size: 0.9rem;
		padding: 0;
		margin-bottom: 1.5rem;
		transition: color 0.2s;
	}

	.back-button:hover {
		color: white;
	}

	.back-button svg {
		width: 1.25rem;
		height: 1.25rem;
	}

	/* Form */
	.form-group {
		margin-bottom: 1.5rem;
	}

	.text-input {
		width: 100%;
		padding: 0.875rem 1rem;
		background: rgba(15, 23, 42, 0.8);
		border: 1px solid rgba(100, 116, 139, 0.3);
		border-radius: 0.5rem;
		color: white;
		font-size: 1rem;
		transition: all 0.2s;
	}

	.text-input.mono {
		font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
		font-size: 0.9rem;
	}

	.text-input::placeholder {
		color: #64748b;
	}

	.text-input:focus {
		outline: none;
		border-color: rgba(79, 70, 229, 0.6);
		box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
	}

	.text-input.error {
		border-color: #ef4444;
	}

	.text-input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.key-length {
		color: #64748b;
		font-size: 0.8rem;
		margin-top: 0.5rem;
		text-align: right;
	}

	.error-message {
		color: #f87171;
		font-size: 0.85rem;
		margin-top: 0.5rem;
	}

	/* Submit Button */
	.submit-button {
		width: 100%;
		padding: 0.875rem 1rem;
		background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
		border: none;
		border-radius: 0.5rem;
		color: white;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
	}

	.submit-button:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 10px 20px -10px rgba(79, 70, 229, 0.5);
	}

	.submit-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
	}

	.spinner {
		width: 1.25rem;
		height: 1.25rem;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	.info-text {
		color: #64748b;
		font-size: 0.8rem;
		text-align: center;
		margin-top: 1rem;
	}

	/* Bottom Branding */
	.bottom-branding {
		position: absolute;
		bottom: 2rem;
		color: #6b7280;
		font-size: 0.875rem;
		font-weight: 400;
		letter-spacing: 0.05em;
	}

	.bottom-branding p {
		margin: 0;
	}

	/* SVG sizing */
	.w-5 { width: 1.25rem; }
	.h-5 { height: 1.25rem; }
	.w-6 { width: 1.5rem; }
	.h-6 { height: 1.5rem; }
</style>
