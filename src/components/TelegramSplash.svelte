<script lang="ts">
	import { onMount, createEventDispatcher } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { telegramStore, type TelegramUser } from '$lib/stores/telegram';

	const dispatch = createEventDispatcher();

	// Your Telegram Bot username (without @)
	// This needs to be configured for the Telegram Login Widget
	const TELEGRAM_BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'HolonsBot';

	let isInitializing = true;
	let showLoginWidget = false;
	let loginError: string | null = null;

	// Handle Telegram Login Widget callback
	function handleTelegramAuth(user: TelegramUser) {
		console.log('Telegram auth callback:', user);
		telegramStore.loginWithWidget(user);
	}

	// Expose the callback globally for Telegram Login Widget
	if (typeof window !== 'undefined') {
		(window as any).onTelegramAuth = handleTelegramAuth;
	}

	onMount(() => {
		// Initialize Telegram store
		telegramStore.init();

		// Wait a bit for initialization
		setTimeout(() => {
			isInitializing = false;
		}, 500);

		// Subscribe to auth state changes
		const unsubscribe = telegramStore.subscribe((state) => {
			if (!state.isLoading && state.isAuthenticated) {
				// User is authenticated, dispatch event to parent
				setTimeout(() => {
					dispatch('authenticated', { user: state.user });
				}, 300);
			} else if (!state.isLoading && !state.isAuthenticated && !state.isTelegramWebApp) {
				// Not in Telegram WebApp and not authenticated, show login widget
				showLoginWidget = true;
				loadTelegramLoginWidget();
			}
		});

		return () => {
			unsubscribe();
		};
	});

	function loadTelegramLoginWidget() {
		// Only load if not already loaded
		if (document.getElementById('telegram-login-script')) return;

		const container = document.getElementById('telegram-login-container');
		if (!container) return;

		// Create the Telegram Login Widget script
		const script = document.createElement('script');
		script.id = 'telegram-login-script';
		script.async = true;
		script.src = 'https://telegram.org/js/telegram-widget.js?22';
		script.setAttribute('data-telegram-login', TELEGRAM_BOT_USERNAME);
		script.setAttribute('data-size', 'large');
		script.setAttribute('data-radius', '12');
		script.setAttribute('data-onauth', 'onTelegramAuth(user)');
		script.setAttribute('data-request-access', 'write');

		container.appendChild(script);
	}

	function skipLogin() {
		// Allow skipping for demo/development
		dispatch('skip');
	}
</script>

<div class="splash-container" transition:fade={{ duration: 300 }}>
	<div class="splash-content" in:fly={{ y: 30, duration: 500, delay: 100 }}>
		<!-- Logo/Branding -->
		<div class="logo-container">
			<img src="/favicon.svg" alt="Harvest Logo" class="logo" />
			<h1 class="title">Harvest</h1>
			<p class="subtitle">Holonic Network Explorer</p>
		</div>

		<!-- Loading state -->
		{#if isInitializing || $telegramStore.isLoading}
			<div class="loading-container" in:fade={{ delay: 200 }}>
				<div class="spinner"></div>
				<p class="loading-text">Initializing...</p>
			</div>
		{:else if $telegramStore.isTelegramWebApp && !$telegramStore.isAuthenticated}
			<!-- In Telegram but no user data (shouldn't normally happen) -->
			<div class="error-container" in:fade>
				<i class="fas fa-exclamation-circle text-yellow-500 text-4xl mb-4"></i>
				<p class="error-text">Unable to get Telegram user data.</p>
				<p class="error-subtext">Please try reopening the app from Telegram.</p>
			</div>
		{:else if showLoginWidget}
			<!-- Telegram Login Widget for web users -->
			<div class="login-container" in:fade={{ delay: 100 }}>
				<div class="telegram-icon">
					<i class="fab fa-telegram text-5xl text-[#2AABEE]"></i>
				</div>
				<p class="login-prompt">Sign in with Telegram to continue</p>

				<!-- Telegram Login Widget Container -->
				<div id="telegram-login-container" class="widget-container"></div>

				{#if loginError}
					<p class="error-message">{loginError}</p>
				{/if}

				<!-- Skip option for development -->
				{#if import.meta.env.DEV}
					<button class="skip-button" on:click={skipLogin}>
						Skip for now (Dev only)
					</button>
				{/if}
			</div>
		{:else if $telegramStore.isAuthenticated}
			<!-- Authenticated - showing welcome briefly before transition -->
			<div class="welcome-container" in:fade>
				<div class="user-avatar">
					{#if $telegramStore.user?.photo_url}
						<img src={$telegramStore.user.photo_url} alt="Profile" class="avatar-img" />
					{:else}
						<div class="avatar-placeholder">
							<i class="fas fa-user text-2xl"></i>
						</div>
					{/if}
				</div>
				<p class="welcome-text">
					Welcome, {$telegramStore.user?.first_name || 'User'}!
				</p>
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
	}

	.splash-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2rem;
		max-width: 400px;
		width: 100%;
	}

	.logo-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}

	.logo {
		width: 80px;
		height: 80px;
		filter: drop-shadow(0 0 20px rgba(66, 153, 225, 0.3));
	}

	.title {
		font-size: 2.5rem;
		font-weight: 700;
		color: #fff;
		margin: 0;
		letter-spacing: -0.02em;
	}

	.subtitle {
		font-size: 1rem;
		color: #9ca3af;
		margin: 0;
	}

	.loading-container {
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
		width: 24px;
		height: 24px;
		border-width: 2px;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.loading-text {
		color: #9ca3af;
		font-size: 0.875rem;
	}

	.login-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.5rem;
		padding: 2rem;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 1rem;
		border: 1px solid rgba(255, 255, 255, 0.1);
		backdrop-filter: blur(10px);
	}

	.telegram-icon {
		width: 80px;
		height: 80px;
		background: rgba(42, 171, 238, 0.1);
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.login-prompt {
		color: #e5e7eb;
		font-size: 1.125rem;
		text-align: center;
		margin: 0;
	}

	.widget-container {
		min-height: 50px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.error-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 2rem;
	}

	.error-text {
		color: #e5e7eb;
		font-size: 1rem;
		margin: 0;
	}

	.error-subtext {
		color: #9ca3af;
		font-size: 0.875rem;
		margin-top: 0.5rem;
	}

	.error-message {
		color: #ef4444;
		font-size: 0.875rem;
		margin: 0;
	}

	.skip-button {
		color: #6b7280;
		font-size: 0.75rem;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.5rem 1rem;
		border-radius: 0.5rem;
		transition: all 0.2s;
	}

	.skip-button:hover {
		color: #9ca3af;
		background: rgba(255, 255, 255, 0.05);
	}

	.welcome-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}

	.user-avatar {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		overflow: hidden;
		border: 2px solid rgba(66, 153, 225, 0.5);
	}

	.avatar-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.avatar-placeholder {
		width: 100%;
		height: 100%;
		background: rgba(66, 153, 225, 0.2);
		display: flex;
		align-items: center;
		justify-content: center;
		color: #4299e1;
	}

	.welcome-text {
		color: #e5e7eb;
		font-size: 1.25rem;
		margin: 0;
	}

	.bottom-branding {
		position: absolute;
		bottom: 2rem;
		color: #4b5563;
		font-size: 0.75rem;
	}

	.bottom-branding p {
		margin: 0;
	}
</style>
