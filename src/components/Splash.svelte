<script lang="ts">
	import { onMount, createEventDispatcher } from 'svelte';
	import { fade, fly, slide } from 'svelte/transition';
	import { nostrStore } from '$lib/stores/nostr';
	import { telegramStore } from '$lib/stores/telegram';
	import { HoloSphere, nostrUtils } from 'holosphere';
	import MyHolonsIcon from '../dashboard/sidebar/icons/MyHolonsIcon.svelte';

	const { hexToNsec } = nostrUtils;

	// Props
	export let skipLoading = false; // Skip loading animation (for modal usage)
	export let isModal = false; // Display as modal overlay instead of full-screen

	const dispatch = createEventDispatcher();

	// View states
	type View = 'loading' | 'welcome' | 'create' | 'restore' | 'telegram-choice' | 'save-key';
	let view: View = skipLoading ? 'welcome' : 'loading';

	// Form state
	let holonName = '';
	let privateKeyInput = '';
	let error = '';
	let isProcessing = false;

	// Generated key state (for save-key view)
	let generatedNsec = '';
	let generatedPublicKey = '';
	let pendingHolonName = '';
	let pendingTelegramUserId: number | null = null;
	let keyCopied = false;

	// Telegram state
	let telegramUser: any = null;
	let isTelegramWebApp = false;
	let existingTelegramMapping: { publicKey: string; holonName: string } | null = null;

	// Holosphere service key from .env (for Telegram mapping lookups)
	const HOLOSPHERE_PRIVATE_KEY = import.meta.env.VITE_HOLOSPHERE_PRIVATE_KEY;

	// Check if Telegram user already has a mapped public key
	async function checkTelegramMapping(telegramUserId: number): Promise<{ publicKey: string; holonName: string } | null> {
		if (!HOLOSPHERE_PRIVATE_KEY) return null;

		try {
			const environmentName = import.meta.env.VITE_LOCAL_MODE === "development" ? "HolonsDebug" : "Holons";

			// Create a temporary HoloSphere instance to check mappings
			const tempHolosphere = new HoloSphere({
				appName: environmentName,
				privateKey: HOLOSPHERE_PRIVATE_KEY,
				// Holosphere 1.3: uses Gun server (gun.holons.io/gun) by default
				// Holosphere 2: uncomment below to use Nostr relay instead
				// backend: 'nostr',
				// nostr: {
				// 	relays: ['wss://relay.holons.io'],
				// 	persistence: true
				// }
			});

			await tempHolosphere.ready();

			// Query global telegram_mappings table for this user ID
			const mapping = await tempHolosphere.getGlobal('telegram_mappings', String(telegramUserId));

			console.log('Telegram mapping lookup for user', telegramUserId, ':', mapping);

			if (mapping && mapping.publicKey) {
				return {
					publicKey: mapping.publicKey,
					holonName: mapping.holonName || 'Your Holon'
				};
			}

			return null;
		} catch (err) {
			console.error('Failed to check Telegram mapping:', err);
			return null;
		}
	}

	onMount(async () => {
		// Initialize stores
		await nostrStore.init();
		telegramStore.init();

		// In modal mode (skipLoading), skip all auto-login logic and just show welcome
		if (skipLoading) {
			// Check Telegram context for display purposes but don't auto-login
			const telegramState = telegramStore.getState();
			isTelegramWebApp = telegramState.isTelegramWebApp;
			telegramUser = telegramState.user;
			// View is already set to 'welcome' via the initial value
			return;
		}

		// Check if user just logged out (show welcome screen to allow re-login)
		const justLoggedOut = sessionStorage.getItem('just_logged_out') === 'true';
		if (justLoggedOut) {
			// Clear the flag
			sessionStorage.removeItem('just_logged_out');
			// Show welcome screen with login options
			setTimeout(() => {
				view = 'welcome';
			}, 300);
			return;
		}

		// Check Telegram context
		const telegramState = telegramStore.getState();
		isTelegramWebApp = telegramState.isTelegramWebApp;
		telegramUser = telegramState.user;

		// Check if we have a saved private key
		const state = nostrStore.getState();

		if (state.privateKey) {
			// Returning user - key exists, proceed to app
			setTimeout(() => dispatch('authenticated', { publicKey: state.publicKey, mode: 'private' }), 300);
		} else if (telegramUser) {
			// Telegram user (Mini App or widget) - auto-login seamlessly
			isProcessing = true;
			try {
				existingTelegramMapping = await checkTelegramMapping(telegramUser.id);
				console.log('Existing mapping found:', existingTelegramMapping);
			} catch (err) {
				console.error('Error checking telegram mapping:', err);
			}

			if (existingTelegramMapping) {
				// User has existing mapping - auto-login to their holon
				console.log('Telegram: Auto-login to existing holon:', existingTelegramMapping.holonName);
				isProcessing = false;
				setTimeout(() => {
					dispatch('authenticated', {
						publicKey: existingTelegramMapping!.publicKey,
						holonName: existingTelegramMapping!.holonName,
						telegramUserId: telegramUser.id,
						mode: 'telegram-mapped'
					});
				}, 300);
			} else {
				// New Telegram user - auto-generate key silently and proceed
				console.log('Telegram: New user, auto-generating identity for', telegramUser.first_name);
				try {
					const name = telegramUser.username
						? `@${telegramUser.username}'s Holon`
						: `${telegramUser.first_name}'s Holon`;

					const result = await nostrStore.generateKey();
					if (result) {
						isProcessing = false;
						dispatch('authenticated', {
							publicKey: result.publicKey,
							holonName: name,
							telegramUserId: telegramUser.id,
							mode: 'private'
						});
					} else {
						isProcessing = false;
						view = 'welcome';
					}
				} catch (err) {
					console.error('Telegram auto-create failed:', err);
					isProcessing = false;
					view = 'welcome';
				}
			}
		} else {
			// No key, no telegram - show welcome screen
			setTimeout(() => {
				view = 'welcome';
			}, 500);
		}
	});

	// Handle Telegram create new identity
	async function handleTelegramCreate() {
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
				// Store pending data and show save-key view
				generatedNsec = hexToNsec(result.privateKey);
				generatedPublicKey = result.publicKey;
				pendingHolonName = name;
				pendingTelegramUserId = telegramUser.id;
				keyCopied = false;
				view = 'save-key';
			}
		} catch (err: any) {
			console.error('Telegram create failed:', err);
			error = err.message || 'Failed to create holon';
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
				// Store pending data and show save-key view
				generatedNsec = hexToNsec(result.privateKey);
				generatedPublicKey = result.publicKey;
				pendingHolonName = holonName.trim();
				pendingTelegramUserId = null;
				keyCopied = false;
				view = 'save-key';
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

		isProcessing = true;
		error = '';

		try {
			// Import the key (nostrStore.importKey accepts nsec or hex)
			const result = await nostrStore.importKey(privateKeyInput.trim());

			if (result) {
				// Check if this matches expected public key for Telegram user
				if (existingTelegramMapping && result.publicKey !== existingTelegramMapping.publicKey) {
					// Key doesn't match the mapping - warn user but allow anyway
					console.warn('Imported key does not match existing Telegram mapping. Will create new mapping.');
				}

				// Dispatch authenticated - include telegram user ID if available for mapping
				dispatch('authenticated', {
					publicKey: result.publicKey,
					telegramUserId: telegramUser?.id,
					mode: 'private'
				});
			}
		} catch (err: any) {
			error = err.message || 'Failed to restore holon';
		} finally {
			isProcessing = false;
		}
	}

	// Handle Telegram restore (from telegram-choice screen)
	function goToTelegramRestore() {
		view = 'restore';
	}

	// Handle key input (allow nsec or hex format)
	function handleKeyInput(event: Event) {
		const input = event.target as HTMLInputElement;
		privateKeyInput = input.value.trim();
	}

	// Copy nsec to clipboard
	async function copyNsec() {
		try {
			await navigator.clipboard.writeText(generatedNsec);
			keyCopied = true;
		} catch (err) {
			console.error('Failed to copy:', err);
		}
	}

	// Proceed after saving key
	function proceedAfterSave() {
		dispatch('authenticated', {
			publicKey: generatedPublicKey,
			holonName: pendingHolonName,
			telegramUserId: pendingTelegramUserId,
			mode: 'private'
		});
	}

	// Go back to welcome screen
	function goBack() {
		if (isModal) {
			// In modal mode, going back from create/restore closes the modal
			dispatch('close');
		} else {
			view = 'welcome';
		}
		error = '';
		holonName = '';
		privateKeyInput = '';
	}

	// Handle closing the modal (only in modal mode)
	function handleClose() {
		if (isModal) {
			dispatch('close');
		}
	}

	// Handle backdrop click
	function handleBackdropClick(event: MouseEvent) {
		if (isModal && event.target === event.currentTarget) {
			dispatch('close');
		}
	}

	// Handle escape key
	function handleKeydown(event: KeyboardEvent) {
		if (isModal && event.key === 'Escape') {
			dispatch('close');
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />

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
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="splash-container"
		class:splash-container--modal={isModal}
		transition:fade={{ duration: 300 }}
		on:click={handleBackdropClick}
	>
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

{:else if view === 'telegram-choice'}
	<!-- Telegram User Choice View -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="splash-container"
		class:splash-container--modal={isModal}
		transition:fade={{ duration: 300 }}
		on:click={handleBackdropClick}
	>
		<div class="onboarding-card" in:fly={{ y: 30, duration: 400 }}>
			<!-- Logo -->
			<div class="logo-small">
				<MyHolonsIcon />
			</div>

			<!-- Telegram User Greeting -->
			<div class="telegram-greeting">
				{#if telegramUser?.photo_url}
					<img src={telegramUser.photo_url} alt="Profile" class="telegram-avatar" />
				{:else}
					<div class="telegram-avatar-placeholder">
						<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
						</svg>
					</div>
				{/if}
				<span class="telegram-name">
					{telegramUser?.first_name || 'User'}{telegramUser?.last_name ? ` ${telegramUser.last_name}` : ''}
					<span class="telegram-id">ID: {String(telegramUser?.id || '')}</span>
				</span>
			</div>

			<h1 class="title">Welcome from Telegram!</h1>

			{#if existingTelegramMapping}
				<!-- User has existing mapping -->
				<p class="subtitle">
					We found an existing identity linked to your Telegram account
					<span class="holon-name-badge">{existingTelegramMapping.holonName}</span>
				</p>
				<p class="info-text highlight">
					Enter your private key to restore access, or create a new identity.
				</p>
			{:else}
				<!-- New Telegram user -->
				<p class="subtitle">
					Set up your decentralized identity to get started
				</p>
			{/if}

			{#if error}
				<p class="error-message" transition:slide>{error}</p>
			{/if}

			<!-- Options -->
			<div class="options">
				{#if existingTelegramMapping}
					<!-- Restore existing is primary when mapping exists -->
					<button
						class="option-button primary"
						on:click={goToTelegramRestore}
						disabled={isProcessing}
					>
						<div class="option-icon">
							<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
							</svg>
						</div>
						<div class="option-text">
							<span class="option-title">Restore Identity</span>
							<span class="option-desc">Enter your private key</span>
						</div>
					</button>

					<button
						class="option-button secondary"
						on:click={handleTelegramCreate}
						disabled={isProcessing}
					>
						<div class="option-icon">
							<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
							</svg>
						</div>
						<div class="option-text">
							<span class="option-title">Create New Identity</span>
							<span class="option-desc">Start fresh (replaces existing link)</span>
						</div>
					</button>
				{:else}
					<!-- Create is primary for new users -->
					<button
						class="option-button primary"
						on:click={handleTelegramCreate}
						disabled={isProcessing}
					>
						<div class="option-icon">
							{#if isProcessing}
								<svg class="spinner" viewBox="0 0 24 24">
									<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="30 70" />
								</svg>
							{:else}
								<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
								</svg>
							{/if}
						</div>
						<div class="option-text">
							<span class="option-title">Create New Identity</span>
							<span class="option-desc">Generate a new key pair</span>
						</div>
					</button>

					<button
						class="option-button secondary"
						on:click={goToTelegramRestore}
						disabled={isProcessing}
					>
						<div class="option-icon">
							<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
							</svg>
						</div>
						<div class="option-text">
							<span class="option-title">Import Existing Key</span>
							<span class="option-desc">I already have a private key</span>
						</div>
					</button>
				{/if}
			</div>

			<p class="info-text">
				Your identity will be linked to your Telegram account for easy access.
			</p>
		</div>

		<div class="bottom-branding">
			<p>powered by HoloSphere</p>
		</div>
	</div>

{:else if view === 'create'}
	<!-- Create View -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="splash-container"
		class:splash-container--modal={isModal}
		transition:fade={{ duration: 300 }}
		on:click={handleBackdropClick}
	>
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
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="splash-container"
		class:splash-container--modal={isModal}
		transition:fade={{ duration: 300 }}
		on:click={handleBackdropClick}
	>
		<div class="onboarding-card" in:fly={{ y: 30, duration: 400 }}>
			<button class="back-button" on:click={goBack}>
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
				</svg>
				Back
			</button>

			<h1 class="title">Restore Your Holon</h1>
			<p class="subtitle">Enter your nsec or hex private key</p>

			<div class="form-group">
				<input
					type="password"
					bind:value={privateKeyInput}
					on:input={handleKeyInput}
					placeholder="nsec1... or hex key"
					class="text-input mono"
					class:error={error}
					disabled={isProcessing}
					on:keydown={(e) => e.key === 'Enter' && handleRestore()}
				/>

				{#if error}
					<p class="error-message" transition:slide>{error}</p>
				{/if}
			</div>

			<button
				class="submit-button"
				on:click={handleRestore}
				disabled={isProcessing || !privateKeyInput.trim()}
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

{:else if view === 'save-key'}
	<!-- Save Key View -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="splash-container"
		class:splash-container--modal={isModal}
		transition:fade={{ duration: 300 }}
		on:click={handleBackdropClick}
	>
		<div class="onboarding-card" in:fly={{ y: 30, duration: 400 }}>
			<div class="logo-small">
				<MyHolonsIcon />
			</div>

			<h1 class="title">Save Your Secret Key</h1>
			<p class="subtitle warning">
				This is your only way to recover your identity. Save it somewhere safe!
			</p>

			<div class="key-display">
				<div class="key-label">Your nsec (private key)</div>
				<div class="key-value">{generatedNsec}</div>
				<button class="copy-button" on:click={copyNsec}>
					{#if keyCopied}
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
						</svg>
						Copied!
					{:else}
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
						</svg>
						Copy to Clipboard
					{/if}
				</button>
			</div>

			<div class="warning-box">
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
				</svg>
				<span>If you lose this key, you cannot recover your holon or data.</span>
			</div>

			<button
				class="submit-button"
				on:click={proceedAfterSave}
				disabled={!keyCopied}
			>
				{#if keyCopied}
					I've Saved My Key - Continue
				{:else}
					Copy Key First to Continue
				{/if}
			</button>
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

	/* Modal variant - displays as overlay with backdrop */
	.splash-container--modal {
		background: rgba(0, 0, 0, 0.7);
		z-index: 100;
	}

	.splash-container--modal .bottom-branding {
		display: none;
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
	.w-8 { width: 2rem; }
	.h-8 { height: 2rem; }

	/* Telegram User Greeting */
	.telegram-greeting {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
		padding: 0.75rem;
		background: rgba(0, 136, 204, 0.1);
		border: 1px solid rgba(0, 136, 204, 0.2);
		border-radius: 0.75rem;
	}

	.telegram-avatar {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		border: 2px solid rgba(0, 136, 204, 0.5);
	}

	.telegram-avatar-placeholder {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: rgba(0, 136, 204, 0.2);
		display: flex;
		align-items: center;
		justify-content: center;
		color: #0088cc;
	}

	.telegram-name {
		color: white;
		font-weight: 600;
		font-size: 1rem;
		display: flex;
		flex-direction: column;
	}

	.telegram-username {
		color: #0088cc;
		font-size: 0.85rem;
		font-weight: 400;
	}

	.telegram-id {
		color: #64748b;
		font-size: 0.75rem;
		font-weight: 400;
		font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
	}

	.holon-name-badge {
		display: inline-block;
		background: rgba(79, 70, 229, 0.2);
		border: 1px solid rgba(79, 70, 229, 0.4);
		color: #a5b4fc;
		padding: 0.25rem 0.5rem;
		border-radius: 0.375rem;
		font-size: 0.85rem;
		font-weight: 500;
		margin-left: 0.25rem;
	}

	.info-text.highlight {
		color: #fbbf24;
		font-size: 0.85rem;
	}

	/* Save Key View */
	.subtitle.warning {
		color: #fbbf24;
		font-weight: 500;
	}

	.key-display {
		background: rgba(15, 23, 42, 0.8);
		border: 1px solid rgba(100, 116, 139, 0.3);
		border-radius: 0.75rem;
		padding: 1rem;
		margin-bottom: 1rem;
	}

	.key-label {
		color: #94a3b8;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.5rem;
	}

	.key-value {
		color: #a5b4fc;
		font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
		font-size: 0.85rem;
		word-break: break-all;
		line-height: 1.5;
		margin-bottom: 0.75rem;
	}

	.copy-button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.625rem 1rem;
		background: rgba(79, 70, 229, 0.2);
		border: 1px solid rgba(79, 70, 229, 0.4);
		border-radius: 0.5rem;
		color: #a5b4fc;
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.copy-button:hover {
		background: rgba(79, 70, 229, 0.3);
		border-color: rgba(79, 70, 229, 0.6);
	}

	.warning-box {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.875rem;
		background: rgba(251, 191, 36, 0.1);
		border: 1px solid rgba(251, 191, 36, 0.3);
		border-radius: 0.5rem;
		margin-bottom: 1.5rem;
	}

	.warning-box svg {
		color: #fbbf24;
		flex-shrink: 0;
		margin-top: 0.125rem;
	}

	.warning-box span {
		color: #fcd34d;
		font-size: 0.85rem;
		line-height: 1.4;
	}

</style>
