<script lang="ts">
	import { onMount, createEventDispatcher } from 'svelte';
	import { fade, fly, slide } from 'svelte/transition';
	import { nostrStore, hasNostrKey, isNewNostrKey, nostrPublicKey, nostrPrivateKey } from '$lib/stores/nostr';
	import { telegramStore, type TelegramUser } from '$lib/stores/telegram';
	import { schnorr } from '@noble/curves/secp256k1';
	import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
	import MyHolonsIcon from '../dashboard/sidebar/icons/MyHolonsIcon.svelte';

	const dispatch = createEventDispatcher();

	// Holosphere public key from .env (for public space)
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

	// Telegram Bot username for sending key backup
	const TELEGRAM_BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'HolonsBot';

	// UI State
	type Step = 'loading' | 'choose-mode' | 'telegram-login' | 'nostr-setup' | 'import-key' | 'key-ready' | 'telegram-backup' | 'complete';
	let currentStep: Step = 'loading';

	let importKeyInput = '';
	let importError = '';
	let isProcessing = false;
	let showPrivateKey = false;
	let keyCopied = false;
	let backupSent = false;
	let backupError = '';

	// Handle Telegram Login Widget callback
	function handleTelegramAuth(user: TelegramUser) {
		console.log('Telegram auth callback:', user);
		telegramStore.loginWithWidget(user);
		// After Telegram auth, generate a key and proceed
		handleTelegramLoginComplete();
	}

	async function handleTelegramLoginComplete() {
		isProcessing = true;
		try {
			// Generate a new key for this Telegram user
			await nostrStore.generateKey();
			currentStep = 'telegram-backup';
		} catch (error) {
			console.error('Error generating key after Telegram login:', error);
		} finally {
			isProcessing = false;
		}
	}

	// Expose callback globally for Telegram widget
	if (typeof window !== 'undefined') {
		(window as any).onTelegramAuth = handleTelegramAuth;
	}

	onMount(async () => {
		// Initialize stores
		await nostrStore.init();
		telegramStore.init();

		// Check if we have a saved private key
		const state = nostrStore.getState();
		if (state.privateKey) {
			if (state.isNewKey) {
				// New key needs backup prompt
				currentStep = 'key-ready';
			} else {
				// Key exists and is backed up, proceed with private mode
				currentStep = 'complete';
				setTimeout(() => dispatch('authenticated', { publicKey: state.publicKey }), 300);
			}
		} else {
			// No key saved - go directly to public mode (user can login via KeyManager in TopBar)
			currentStep = 'complete';
			const holospherePublicKey = getHolospherePublicKey();
			setTimeout(() => dispatch('authenticated', { publicKey: holospherePublicKey, mode: 'public' }), 300);
		}
	});

	function enterPublicSpace() {
		// Use public space with the holosphere key from .env
		const holospherePublicKey = getHolospherePublicKey();
		dispatch('authenticated', { publicKey: holospherePublicKey, mode: 'public' });
	}

	async function generateNewKey() {
		isProcessing = true;
		try {
			await nostrStore.generateKey();
			currentStep = 'key-ready';
		} catch (error) {
			console.error('Error generating key:', error);
		} finally {
			isProcessing = false;
		}
	}

	function showImportKey() {
		currentStep = 'import-key';
		importError = '';
		importKeyInput = '';
	}

	async function importKey() {
		importError = '';
		isProcessing = true;
		try {
			await nostrStore.importKey(importKeyInput.trim());
			currentStep = 'complete';
			const state = nostrStore.getState();
			setTimeout(() => dispatch('authenticated', { publicKey: state.publicKey }), 500);
		} catch (error: any) {
			importError = error.message || 'Invalid key format';
		} finally {
			isProcessing = false;
		}
	}

	function backToSetup() {
		currentStep = 'nostr-setup';
		importKeyInput = '';
		importError = '';
	}

	async function copyPrivateKey() {
		const state = nostrStore.getState();
		if (state.privateKey) {
			await navigator.clipboard.writeText(state.privateKey);
			keyCopied = true;
			setTimeout(() => keyCopied = false, 2000);
		}
	}

	function proceedWithoutBackup() {
		nostrStore.markBackedUp();
		currentStep = 'complete';
		const state = nostrStore.getState();
		dispatch('authenticated', { publicKey: state.publicKey });
	}

	function showTelegramBackup() {
		currentStep = 'telegram-backup';
	}

	// Svelte action for Telegram widget
	function initTelegramWidget(node: HTMLElement) {
		if (document.getElementById('telegram-login-script')) return;

		const script = document.createElement('script');
		script.id = 'telegram-login-script';
		script.async = true;
		script.src = 'https://telegram.org/js/telegram-widget.js?22';
		script.setAttribute('data-telegram-login', TELEGRAM_BOT_USERNAME);
		script.setAttribute('data-size', 'large');
		script.setAttribute('data-radius', '12');
		script.setAttribute('data-onauth', 'onTelegramAuth(user)');
		script.setAttribute('data-request-access', 'write');

		node.appendChild(script);

		return { destroy() {} };
	}

	// Send key to user via Telegram bot
	async function sendKeyViaTelegram() {
		backupError = '';
		isProcessing = true;

		try {
			const telegramState = telegramStore.getState();
			const nostrState = nostrStore.getState();

			if (!telegramState.user?.id || !nostrState.privateKey) {
				throw new Error('Missing user or key data');
			}

			// Send to bot API
			const response = await fetch('/api/telegram/send-key', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					telegramUserId: telegramState.user.id,
					privateKey: nostrState.privateKey,
					publicKey: nostrState.publicKey
				})
			});

			if (!response.ok) {
				throw new Error('Failed to send key');
			}

			backupSent = true;
			nostrStore.markBackedUp();

			// Proceed after a short delay
			setTimeout(() => {
				currentStep = 'complete';
				dispatch('authenticated', { publicKey: nostrState.publicKey });
			}, 2000);
		} catch (error: any) {
			console.error('Error sending key via Telegram:', error);
			backupError = 'Could not send key. Please copy it manually.';
		} finally {
			isProcessing = false;
		}
	}

	// Watch for Telegram auth changes
	$: if (currentStep === 'telegram-backup' && $telegramStore.isAuthenticated && !backupSent) {
		// User just authenticated, send the key
		sendKeyViaTelegram();
	}

	function isLocalhost(): boolean {
		if (typeof window === 'undefined') return false;
		return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
	}
</script>

<div class="splash-container" transition:fade={{ duration: 300 }}>
	<div class="splash-content" in:fly={{ y: 30, duration: 500, delay: 100 }}>
		<!-- Logo/Branding -->
		<div class="logo-container">
			<div class="logo-icon">
				<MyHolonsIcon />
			</div>
			<h1 class="title">Harvest</h1>
			<p class="subtitle">Holonic Network Explorer</p>
		</div>

		<!-- Loading State -->
		{#if currentStep === 'loading'}
			<div class="loading-container" in:fade={{ delay: 200 }}>
				<div class="spinner"></div>
				<p class="loading-text">Initializing...</p>
			</div>

		<!-- Choose Mode: Telegram, Private Key, or Public -->
		{:else if currentStep === 'choose-mode'}
			<div class="setup-container" in:fade={{ delay: 100 }}>
				<h2 class="setup-title">Welcome to Harvest</h2>
				<p class="setup-description">
					Choose how you'd like to use the network
				</p>

				<div class="mode-cards">
					<!-- Telegram Login -->
					<button class="mode-card telegram" on:click={() => currentStep = 'telegram-login'}>
						<div class="mode-icon telegram-bg">
							<i class="fab fa-telegram text-2xl"></i>
						</div>
						<div class="mode-info">
							<h3>Login with Telegram</h3>
							<p>Quick & secure. Your key is backed up automatically.</p>
						</div>
						<i class="fas fa-chevron-right mode-arrow"></i>
					</button>

					<!-- Private Key Setup -->
					<button class="mode-card private" on:click={() => currentStep = 'nostr-setup'}>
						<div class="mode-icon private-bg">
							<i class="fas fa-key text-2xl"></i>
						</div>
						<div class="mode-info">
							<h3>Setup Private Key</h3>
							<p>Create your personal holon with full control.</p>
						</div>
						<i class="fas fa-chevron-right mode-arrow"></i>
					</button>

					<!-- Public Space -->
					<button class="mode-card public" on:click={enterPublicSpace}>
						<div class="mode-icon public-bg">
							<i class="fas fa-globe text-2xl"></i>
						</div>
						<div class="mode-info">
							<h3>Explore Public Space</h3>
							<p>Browse without an account. Limited features.</p>
						</div>
						<i class="fas fa-chevron-right mode-arrow"></i>
					</button>
				</div>
			</div>

		<!-- Telegram Login Screen -->
		{:else if currentStep === 'telegram-login'}
			<div class="setup-container" in:fade={{ delay: 100 }}>
				<button class="back-button" on:click={() => currentStep = 'choose-mode'}>
					<i class="fas fa-arrow-left mr-2"></i> Back
				</button>

				<div class="mode-icon telegram-bg large">
					<i class="fab fa-telegram text-4xl"></i>
				</div>
				<h2 class="setup-title">Login with Telegram</h2>
				<p class="setup-description">
					Authenticate with Telegram to create your secure identity
				</p>

				<div class="telegram-widget-container" use:initTelegramWidget></div>

				{#if isLocalhost()}
					<p class="localhost-note">
						Telegram widget doesn't work on localhost.
						<button class="link-button" on:click={() => currentStep = 'nostr-setup'}>
							Use private key instead
						</button>
					</p>
				{/if}
			</div>

		<!-- Nostr Setup: Generate or Import -->
		{:else if currentStep === 'nostr-setup'}
			<div class="setup-container" in:fade={{ delay: 100 }}>
				<button class="back-button" on:click={() => currentStep = 'choose-mode'}>
					<i class="fas fa-arrow-left mr-2"></i> Back
				</button>

				<div class="mode-icon private-bg large">
					<i class="fas fa-key text-4xl"></i>
				</div>
				<h2 class="setup-title">Setup Your Identity</h2>
				<p class="setup-description">
					Your identity is secured by a cryptographic key. Generate a new one or import an existing key.
				</p>

				<div class="button-group">
					<button
						class="primary-button"
						on:click={generateNewKey}
						disabled={isProcessing}
					>
						{#if isProcessing}
							<div class="spinner small"></div>
						{:else}
							<i class="fas fa-plus-circle mr-2"></i>
							Generate New Key
						{/if}
					</button>

					<button
						class="secondary-button"
						on:click={showImportKey}
						disabled={isProcessing}
					>
						<i class="fas fa-file-import mr-2"></i>
						Import Existing Key
					</button>
				</div>
			</div>

		<!-- Import Key Screen -->
		{:else if currentStep === 'import-key'}
			<div class="import-container" in:fade={{ delay: 100 }}>
				<button class="back-button" on:click={backToSetup}>
					<i class="fas fa-arrow-left mr-2"></i> Back
				</button>

				<h2 class="setup-title">Import Your Key</h2>
				<p class="setup-description">
					Enter your 64-character hex private key
				</p>

				<div class="input-group">
					<input
						type="password"
						bind:value={importKeyInput}
						placeholder="Enter private key (64 hex characters)"
						class="key-input"
						class:error={importError}
					/>
					{#if importError}
						<p class="error-text" transition:slide>{importError}</p>
					{/if}
				</div>

				<button
					class="primary-button"
					on:click={importKey}
					disabled={isProcessing || importKeyInput.length !== 64}
				>
					{#if isProcessing}
						<div class="spinner small"></div>
					{:else}
						<i class="fas fa-check mr-2"></i>
						Import Key
					{/if}
				</button>
			</div>

		<!-- Key Ready: Show key and backup options -->
		{:else if currentStep === 'key-ready'}
			<div class="key-ready-container" in:fade={{ delay: 100 }}>
				<div class="success-icon">
					<i class="fas fa-check-circle text-4xl text-green-400"></i>
				</div>
				<h2 class="setup-title">Key Generated!</h2>
				<p class="setup-description warning">
					<i class="fas fa-exclamation-triangle text-amber-400 mr-1"></i>
					Save your private key! You won't be able to recover it if lost.
				</p>

				<!-- Private Key Display -->
				<div class="key-display">
					<div class="key-header">
						<span class="key-label">Private Key</span>
						<button class="toggle-visibility" on:click={() => showPrivateKey = !showPrivateKey}>
							<i class="fas {showPrivateKey ? 'fa-eye-slash' : 'fa-eye'}"></i>
						</button>
					</div>
					<div class="key-value" class:hidden={!showPrivateKey}>
						{showPrivateKey ? $nostrPrivateKey : '••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••'}
					</div>
					<button class="copy-button" on:click={copyPrivateKey}>
						<i class="fas {keyCopied ? 'fa-check' : 'fa-copy'} mr-1"></i>
						{keyCopied ? 'Copied!' : 'Copy Key'}
					</button>
				</div>

				<!-- Public Key Display -->
				<div class="key-display public">
					<div class="key-header">
						<span class="key-label">Public Key</span>
					</div>
					<div class="key-value small">{$nostrPublicKey}</div>
				</div>

				<div class="button-group">
					<button class="primary-button telegram" on:click={showTelegramBackup}>
						<i class="fab fa-telegram mr-2"></i>
						Backup via Telegram
					</button>

					<button class="secondary-button" on:click={proceedWithoutBackup}>
						I've saved my key, continue
					</button>
				</div>
			</div>

		<!-- Telegram Backup Screen -->
		{:else if currentStep === 'telegram-backup'}
			<div class="telegram-backup-container" in:fade={{ delay: 100 }}>
				<button class="back-button" on:click={() => currentStep = 'key-ready'}>
					<i class="fas fa-arrow-left mr-2"></i> Back
				</button>

				{#if backupSent}
					<div class="success-message" in:fade>
						<i class="fas fa-check-circle text-5xl text-green-400 mb-4"></i>
						<h2 class="setup-title">Key Sent!</h2>
						<p class="setup-description">
							Your private key has been sent to your Telegram. Check your messages from @{TELEGRAM_BOT_USERNAME}
						</p>
					</div>
				{:else if $telegramStore.isAuthenticated}
					<div class="sending-message" in:fade>
						<div class="spinner"></div>
						<p class="loading-text">Sending key to Telegram...</p>
					</div>
				{:else}
					<h2 class="setup-title">Backup via Telegram</h2>
					<p class="setup-description">
						Login with Telegram to receive your private key securely
					</p>

					<div class="telegram-widget-container" use:initTelegramWidget></div>

					{#if backupError}
						<p class="error-text">{backupError}</p>
					{/if}

					{#if isLocalhost()}
						<p class="localhost-note">
							Telegram widget doesn't work on localhost.
							<button class="link-button" on:click={() => currentStep = 'key-ready'}>
								Go back and copy your key manually
							</button>
						</p>
					{/if}
				{/if}
			</div>

		<!-- Complete -->
		{:else if currentStep === 'complete'}
			<div class="complete-container" in:fade>
				<div class="success-icon">
					<i class="fas fa-rocket text-4xl text-blue-400"></i>
				</div>
				<p class="loading-text">Launching Harvest...</p>
				<div class="spinner small"></div>
			</div>
		{/if}
	</div>

	<!-- Bottom branding -->
	<div class="bottom-branding" in:fade={{ delay: 400 }}>
		<p>Powered by Holosphere</p>
	</div>
</div>

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
		padding: 2rem;
		overflow-y: auto;
	}

	.splash-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.5rem;
		max-width: 450px;
		width: 100%;
	}

	.logo-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}

	.logo-icon {
		width: 200px;
		height: 200px;
		filter: drop-shadow(0 0 40px rgba(66, 153, 225, 0.4));
		animation: pulse-glow 3s ease-in-out infinite;
	}

	@keyframes pulse-glow {
		0%, 100% { filter: drop-shadow(0 0 40px rgba(66, 153, 225, 0.4)); }
		50% { filter: drop-shadow(0 0 60px rgba(66, 153, 225, 0.6)); }
	}

	.title {
		font-size: 2rem;
		font-weight: 700;
		color: #fff;
		margin: 0;
		letter-spacing: -0.02em;
	}

	.subtitle {
		font-size: 0.875rem;
		color: #9ca3af;
		margin: 0;
	}

	.loading-container, .complete-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 3px solid rgba(66, 153, 225, 0.2);
		border-top-color: #4299e1;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	.spinner.small {
		width: 20px;
		height: 20px;
		border-width: 2px;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.loading-text {
		color: #9ca3af;
		font-size: 0.875rem;
	}

	/* Setup containers */
	.setup-container, .import-container, .key-ready-container, .telegram-backup-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		padding: 1.5rem;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 1rem;
		border: 1px solid rgba(255, 255, 255, 0.1);
		backdrop-filter: blur(10px);
		width: 100%;
	}

	/* Mode selection cards */
	.mode-cards {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 100%;
		margin-top: 0.5rem;
	}

	.mode-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		width: 100%;
		padding: 1rem;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 0.75rem;
		cursor: pointer;
		transition: all 0.2s;
		text-align: left;
	}

	.mode-card:hover {
		background: rgba(255, 255, 255, 0.08);
		border-color: rgba(255, 255, 255, 0.2);
		transform: translateX(4px);
	}

	.mode-card.telegram:hover {
		border-color: rgba(0, 136, 204, 0.4);
		background: rgba(0, 136, 204, 0.1);
	}

	.mode-card.private:hover {
		border-color: rgba(251, 191, 36, 0.4);
		background: rgba(251, 191, 36, 0.1);
	}

	.mode-card.public:hover {
		border-color: rgba(52, 211, 153, 0.4);
		background: rgba(52, 211, 153, 0.1);
	}

	.mode-icon {
		width: 48px;
		height: 48px;
		border-radius: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		color: white;
	}

	.mode-icon.large {
		width: 70px;
		height: 70px;
		border-radius: 50%;
	}

	.telegram-bg {
		background: linear-gradient(135deg, #0088cc 0%, #0077b3 100%);
	}

	.private-bg {
		background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
	}

	.public-bg {
		background: linear-gradient(135deg, #10b981 0%, #059669 100%);
	}

	.mode-info {
		flex: 1;
	}

	.mode-info h3 {
		font-size: 1rem;
		font-weight: 600;
		color: #fff;
		margin: 0 0 0.25rem 0;
	}

	.mode-info p {
		font-size: 0.75rem;
		color: #9ca3af;
		margin: 0;
		line-height: 1.4;
	}

	.mode-arrow {
		color: #6b7280;
		transition: transform 0.2s;
	}

	.mode-card:hover .mode-arrow {
		transform: translateX(4px);
		color: #9ca3af;
	}

	.key-icon, .success-icon {
		width: 70px;
		height: 70px;
		background: rgba(251, 191, 36, 0.1);
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.success-icon {
		background: rgba(52, 211, 153, 0.1);
	}

	.setup-title {
		font-size: 1.25rem;
		font-weight: 600;
		color: #fff;
		margin: 0;
		text-align: center;
	}

	.setup-description {
		color: #9ca3af;
		font-size: 0.875rem;
		text-align: center;
		margin: 0;
		line-height: 1.5;
	}

	.setup-description.warning {
		color: #fbbf24;
		background: rgba(251, 191, 36, 0.1);
		padding: 0.75rem;
		border-radius: 0.5rem;
		border: 1px solid rgba(251, 191, 36, 0.2);
	}

	.button-group {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 100%;
		margin-top: 0.5rem;
	}

	.primary-button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		background: linear-gradient(135deg, #4299e1 0%, #3182ce 100%);
		color: white;
		border: none;
		padding: 0.875rem 1.5rem;
		border-radius: 0.75rem;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		width: 100%;
	}

	.primary-button:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 4px 15px rgba(66, 153, 225, 0.4);
	}

	.primary-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.primary-button.telegram {
		background: linear-gradient(135deg, #0088cc 0%, #0077b3 100%);
	}

	.secondary-button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		background: rgba(255, 255, 255, 0.05);
		color: #e5e7eb;
		border: 1px solid rgba(255, 255, 255, 0.1);
		padding: 0.875rem 1.5rem;
		border-radius: 0.75rem;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		width: 100%;
	}

	.secondary-button:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.1);
	}

	.back-button {
		align-self: flex-start;
		background: none;
		border: none;
		color: #9ca3af;
		font-size: 0.875rem;
		cursor: pointer;
		padding: 0.25rem 0;
		transition: color 0.2s;
	}

	.back-button:hover {
		color: #e5e7eb;
	}

	/* Key display */
	.key-display {
		width: 100%;
		background: rgba(0, 0, 0, 0.3);
		border-radius: 0.5rem;
		padding: 0.75rem;
		border: 1px solid rgba(255, 255, 255, 0.1);
	}

	.key-display.public {
		background: rgba(66, 153, 225, 0.1);
		border-color: rgba(66, 153, 225, 0.2);
	}

	.key-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.key-label {
		font-size: 0.75rem;
		color: #9ca3af;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.toggle-visibility {
		background: none;
		border: none;
		color: #9ca3af;
		cursor: pointer;
		padding: 0.25rem;
		transition: color 0.2s;
	}

	.toggle-visibility:hover {
		color: #e5e7eb;
	}

	.key-value {
		font-family: monospace;
		font-size: 0.75rem;
		color: #e5e7eb;
		word-break: break-all;
		line-height: 1.4;
	}

	.key-value.small {
		font-size: 0.65rem;
		color: #9ca3af;
	}

	.key-value.hidden {
		color: #6b7280;
	}

	.copy-button {
		margin-top: 0.5rem;
		background: rgba(255, 255, 255, 0.1);
		border: none;
		color: #e5e7eb;
		padding: 0.5rem 1rem;
		border-radius: 0.375rem;
		font-size: 0.75rem;
		cursor: pointer;
		transition: all 0.2s;
	}

	.copy-button:hover {
		background: rgba(255, 255, 255, 0.15);
	}

	/* Input */
	.input-group {
		width: 100%;
	}

	.key-input {
		width: 100%;
		background: rgba(0, 0, 0, 0.3);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 0.5rem;
		padding: 0.875rem;
		color: #e5e7eb;
		font-family: monospace;
		font-size: 0.875rem;
		transition: border-color 0.2s;
	}

	.key-input:focus {
		outline: none;
		border-color: #4299e1;
	}

	.key-input.error {
		border-color: #ef4444;
	}

	.key-input::placeholder {
		color: #6b7280;
	}

	.error-text {
		color: #ef4444;
		font-size: 0.75rem;
		margin-top: 0.5rem;
	}

	/* Telegram widget */
	.telegram-widget-container {
		min-height: 50px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.localhost-note {
		color: #9ca3af;
		font-size: 0.75rem;
		text-align: center;
	}

	.link-button {
		background: none;
		border: none;
		color: #4299e1;
		cursor: pointer;
		text-decoration: underline;
		font-size: inherit;
	}

	.success-message, .sending-message {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		text-align: center;
	}

	/* Bottom branding */
	.bottom-branding {
		position: absolute;
		bottom: 2rem;
		color: #4b5563;
		font-size: 0.75rem;
	}

	.bottom-branding p {
		margin: 0;
	}

	/* Utilities */
	.mr-1 { margin-right: 0.25rem; }
	.mr-2 { margin-right: 0.5rem; }
	.mb-4 { margin-bottom: 1rem; }
</style>
