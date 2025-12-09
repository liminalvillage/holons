<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade, slide } from 'svelte/transition';
	import { nostrStore, nostrPublicKey, nostrPrivateKey } from '$lib/stores/nostr';
	import { schnorr } from '@noble/curves/secp256k1';
	import { bytesToHex } from '@noble/hashes/utils';

	const dispatch = createEventDispatcher();

	// Telegram Bot username
	const TELEGRAM_BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'HolonsBot';

	// UI State
	let isOpen = false;
	let currentView: 'menu' | 'import' | 'telegram' = 'menu';
	let importKeyInput = '';
	let importError = '';
	let isProcessing = false;
	let keyCopied = false;
	let showPrivateKey = false;

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

	$: holospherePublicKey = getHolospherePublicKey();
	$: isPublicMode = $nostrPublicKey === holospherePublicKey || !$nostrPrivateKey;
	$: shortenedKey = $nostrPublicKey ? `${$nostrPublicKey.slice(0, 8)}...${$nostrPublicKey.slice(-8)}` : 'Not set';

	function toggleDropdown() {
		isOpen = !isOpen;
		if (!isOpen) {
			currentView = 'menu';
			importKeyInput = '';
			importError = '';
		}
	}

	function closeDropdown() {
		isOpen = false;
		currentView = 'menu';
		importKeyInput = '';
		importError = '';
	}

	async function generateNewKey() {
		isProcessing = true;
		try {
			await nostrStore.generateKey();
			dispatch('keyChanged', { action: 'generate' });
			closeDropdown();
			// Reload to apply the new key
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
			closeDropdown();
			// Reload to apply the new key
			window.location.reload();
		} catch (error: any) {
			importError = error.message || 'Invalid key format';
		} finally {
			isProcessing = false;
		}
	}

	async function copyPublicKey() {
		if ($nostrPublicKey) {
			await navigator.clipboard.writeText($nostrPublicKey);
			keyCopied = true;
			setTimeout(() => keyCopied = false, 2000);
		}
	}

	async function copyPrivateKey() {
		if ($nostrPrivateKey) {
			await navigator.clipboard.writeText($nostrPrivateKey);
			keyCopied = true;
			setTimeout(() => keyCopied = false, 2000);
		}
	}

	function exitToPublic() {
		// Set flag to enter public mode on reload
		localStorage.setItem('enter_public_mode', 'true');
		// Clear the stored key and reload
		nostrStore.clearKey();
		dispatch('keyChanged', { action: 'exit' });
		window.location.reload();
	}

	// Handle Telegram Login Widget callback
	function handleTelegramAuth(user: any) {
		console.log('Telegram auth callback:', user);
		// Generate a new key and reload
		nostrStore.generateKey().then(() => {
			dispatch('keyChanged', { action: 'telegram' });
			window.location.reload();
		});
	}

	// Expose callback globally for Telegram widget
	if (typeof window !== 'undefined') {
		(window as any).onKeyManagerTelegramAuth = handleTelegramAuth;
	}

	// Svelte action for Telegram widget
	function initTelegramWidget(node: HTMLElement) {
		const existingScript = node.querySelector('#telegram-login-script-keymanager');
		if (existingScript) return;

		const script = document.createElement('script');
		script.id = 'telegram-login-script-keymanager';
		script.async = true;
		script.src = 'https://telegram.org/js/telegram-widget.js?22';
		script.setAttribute('data-telegram-login', TELEGRAM_BOT_USERNAME);
		script.setAttribute('data-size', 'medium');
		script.setAttribute('data-radius', '8');
		script.setAttribute('data-onauth', 'onKeyManagerTelegramAuth(user)');
		script.setAttribute('data-request-access', 'write');

		node.appendChild(script);

		return { destroy() { script.remove(); } };
	}

	function isLocalhost(): boolean {
		if (typeof window === 'undefined') return false;
		return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
	}

	// Close dropdown when clicking outside
	function handleClickOutside(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest('.key-manager-container')) {
			closeDropdown();
		}
	}
</script>

<svelte:window on:click={handleClickOutside} />

<div class="key-manager-container relative">
	<!-- Trigger Button -->
	<button
		on:click|stopPropagation={toggleDropdown}
		class="flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200
			   {isPublicMode ? 'bg-green-600/20 hover:bg-green-600/30 text-green-400' : 'bg-blue-600/20 hover:bg-blue-600/30 text-blue-400'}"
		title={isPublicMode ? 'Public Mode - Click to manage identity' : 'Private Mode - Click to manage identity'}
	>
		<i class="fas {isPublicMode ? 'fa-globe' : 'fa-key'} text-sm"></i>
		<span class="text-xs font-medium hidden sm:inline">
			{isPublicMode ? 'Public' : shortenedKey}
		</span>
		<i class="fas fa-chevron-down text-xs transition-transform {isOpen ? 'rotate-180' : ''}"></i>
	</button>

	<!-- Dropdown Panel -->
	{#if isOpen}
		<div
			class="absolute right-0 top-full mt-2 w-80 bg-gray-800 rounded-xl shadow-2xl border border-gray-700 overflow-hidden z-50"
			transition:slide={{ duration: 200 }}
			on:click|stopPropagation
			on:keydown|stopPropagation
			role="menu"
		>
			<!-- Header -->
			<div class="px-4 py-3 bg-gray-900/50 border-b border-gray-700">
				<div class="flex items-center justify-between">
					<h3 class="text-sm font-semibold text-white">Identity Manager</h3>
					<button on:click={closeDropdown} class="text-gray-400 hover:text-white" aria-label="Close menu">
						<i class="fas fa-times"></i>
					</button>
				</div>
			</div>

			{#if currentView === 'menu'}
				<!-- Current Identity Status -->
				<div class="p-4 border-b border-gray-700">
					<div class="flex items-center gap-3 mb-3">
						<div class="w-10 h-10 rounded-full flex items-center justify-center
									{isPublicMode ? 'bg-green-600/20' : 'bg-blue-600/20'}">
							<i class="fas {isPublicMode ? 'fa-globe' : 'fa-user'}
								  {isPublicMode ? 'text-green-400' : 'text-blue-400'}"></i>
						</div>
						<div class="flex-1 min-w-0">
							<div class="text-sm font-medium text-white">
								{isPublicMode ? 'Public Space' : 'Private Identity'}
							</div>
							<div class="text-xs text-gray-400 truncate font-mono">
								{$nostrPublicKey || 'No key'}
							</div>
						</div>
					</div>

					{#if !isPublicMode && $nostrPublicKey}
						<div class="flex gap-2">
							<button
								on:click={copyPublicKey}
								class="flex-1 text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-300 transition-colors"
							>
								<i class="fas {keyCopied ? 'fa-check' : 'fa-copy'} mr-1"></i>
								{keyCopied ? 'Copied!' : 'Copy Public Key'}
							</button>
						</div>
					{/if}
				</div>

				<!-- Actions -->
				<div class="p-2">
					{#if isPublicMode}
						<!-- Options when in public mode -->
						<button
							on:click={generateNewKey}
							disabled={isProcessing}
							class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-700 transition-colors text-left"
						>
							<div class="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center">
								<i class="fas fa-plus text-blue-400"></i>
							</div>
							<div>
								<div class="text-sm font-medium text-white">Create New Identity</div>
								<div class="text-xs text-gray-400">Generate a new private key</div>
							</div>
						</button>

						<button
							on:click={() => currentView = 'import'}
							class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-700 transition-colors text-left"
						>
							<div class="w-8 h-8 rounded-lg bg-amber-600/20 flex items-center justify-center">
								<i class="fas fa-file-import text-amber-400"></i>
							</div>
							<div>
								<div class="text-sm font-medium text-white">Import Key</div>
								<div class="text-xs text-gray-400">Use an existing private key</div>
							</div>
						</button>

						<button
							on:click={() => currentView = 'telegram'}
							class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-700 transition-colors text-left"
						>
							<div class="w-8 h-8 rounded-lg bg-sky-600/20 flex items-center justify-center">
								<i class="fab fa-telegram text-sky-400"></i>
							</div>
							<div>
								<div class="text-sm font-medium text-white">Login with Telegram</div>
								<div class="text-xs text-gray-400">Authenticate via Telegram</div>
							</div>
						</button>
					{:else}
						<!-- Options when logged in with private key -->
						<button
							on:click={() => showPrivateKey = !showPrivateKey}
							class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-700 transition-colors text-left"
						>
							<div class="w-8 h-8 rounded-lg bg-amber-600/20 flex items-center justify-center">
								<i class="fas {showPrivateKey ? 'fa-eye-slash' : 'fa-eye'} text-amber-400"></i>
							</div>
							<div>
								<div class="text-sm font-medium text-white">
									{showPrivateKey ? 'Hide Private Key' : 'Show Private Key'}
								</div>
								<div class="text-xs text-gray-400">View your secret key</div>
							</div>
						</button>

						{#if showPrivateKey}
							<div class="mx-3 my-2 p-2 bg-gray-900 rounded-lg" transition:slide>
								<div class="text-xs text-gray-400 mb-1">Private Key (keep secret!)</div>
								<div class="text-xs font-mono text-amber-400 break-all">{$nostrPrivateKey}</div>
								<button
									on:click={copyPrivateKey}
									class="mt-2 text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
								>
									<i class="fas fa-copy mr-1"></i> Copy
								</button>
							</div>
						{/if}

						<button
							on:click={() => currentView = 'import'}
							class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-700 transition-colors text-left"
						>
							<div class="w-8 h-8 rounded-lg bg-purple-600/20 flex items-center justify-center">
								<i class="fas fa-exchange-alt text-purple-400"></i>
							</div>
							<div>
								<div class="text-sm font-medium text-white">Switch Identity</div>
								<div class="text-xs text-gray-400">Import a different key</div>
							</div>
						</button>

						<div class="border-t border-gray-700 mt-2 pt-2">
							<button
								on:click={exitToPublic}
								class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-red-900/30 transition-colors text-left"
							>
								<div class="w-8 h-8 rounded-lg bg-red-600/20 flex items-center justify-center">
									<i class="fas fa-sign-out-alt text-red-400"></i>
								</div>
								<div>
									<div class="text-sm font-medium text-red-400">Exit to Public Space</div>
									<div class="text-xs text-gray-400">Browse anonymously</div>
								</div>
							</button>
						</div>
					{/if}
				</div>

			{:else if currentView === 'import'}
				<!-- Import Key View -->
				<div class="p-4">
					<button
						on:click={() => currentView = 'menu'}
						class="text-sm text-gray-400 hover:text-white mb-3"
					>
						<i class="fas fa-arrow-left mr-2"></i> Back
					</button>

					<h4 class="text-sm font-medium text-white mb-2">Import Private Key</h4>
					<p class="text-xs text-gray-400 mb-3">Enter your 64-character hex private key</p>

					<input
						type="password"
						bind:value={importKeyInput}
						placeholder="Enter private key..."
						class="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm font-mono
							   focus:border-blue-500 focus:outline-none
							   {importError ? 'border-red-500' : ''}"
					/>

					{#if importError}
						<p class="text-xs text-red-400 mt-1">{importError}</p>
					{/if}

					<button
						on:click={importKey}
						disabled={isProcessing || importKeyInput.length !== 64}
						class="w-full mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed
							   rounded-lg text-white text-sm font-medium transition-colors"
					>
						{#if isProcessing}
							<i class="fas fa-spinner fa-spin mr-2"></i>
						{/if}
						Import Key
					</button>
				</div>

			{:else if currentView === 'telegram'}
				<!-- Telegram Login View -->
				<div class="p-4">
					<button
						on:click={() => currentView = 'menu'}
						class="text-sm text-gray-400 hover:text-white mb-3"
					>
						<i class="fas fa-arrow-left mr-2"></i> Back
					</button>

					<h4 class="text-sm font-medium text-white mb-2">Login with Telegram</h4>
					<p class="text-xs text-gray-400 mb-4">Authenticate to create your identity</p>

					<div class="flex justify-center" use:initTelegramWidget></div>

					{#if isLocalhost()}
						<p class="text-xs text-gray-400 mt-3 text-center">
							Telegram widget doesn't work on localhost.
							<button
								on:click={() => currentView = 'menu'}
								class="text-blue-400 hover:underline"
							>
								Use another method
							</button>
						</p>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.key-manager-container {
		font-family: system-ui, -apple-system, sans-serif;
	}
</style>
