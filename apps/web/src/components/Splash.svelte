<script lang="ts">
	import { onMount, createEventDispatcher } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { telegramStore, type TelegramUser } from '$lib/stores/telegram';
	import MyHolonsIcon from '../dashboard/sidebar/icons/MyHolonsIcon.svelte';

	// Props
	export let skipLoading = false; // Skip loading animation (for modal usage)
	export let isModal = false; // Display as modal overlay instead of full-screen

	const dispatch = createEventDispatcher();

	// View states — Telegram OIDC is the sole login path.
	type View = 'loading' | 'welcome';
	let view: View = skipLoading ? 'welcome' : 'loading';

	let error = '';

	onMount(async () => {
		// In modal mode (skipLoading), skip auto-login logic and just show welcome.
		if (skipLoading) {
			view = 'welcome';
			return;
		}

		// Show the welcome screen after an explicit logout instead of re-logging in.
		const justLoggedOut = sessionStorage.getItem('just_logged_out') === 'true';
		if (justLoggedOut) {
			sessionStorage.removeItem('just_logged_out');
			view = 'welcome';
			return;
		}

		// Restore an existing session (the OIDC callback set the cookie before
		// redirecting here; in dev the server mints a session automatically).
		const restored = await telegramStore.init();
		const state = telegramStore.getState();

		if (restored?.user || state.user) {
			handleTelegramUser((restored?.user as TelegramUser) ?? state.user!);
		} else {
			view = 'welcome';
		}
	});

	// Hand a verified Telegram user to the layout, which owns HoloSphere init,
	// the telegram_mappings write, and routing. The signing key is already in
	// nostrStore (set by telegramStore from the verified session).
	function handleTelegramUser(user: TelegramUser) {
		const state = telegramStore.getState();
		const name = user.username
			? `@${user.username}'s Holon`
			: `${user.first_name}'s Holon`;
		dispatch('authenticated', {
			publicKey: state.nostrPublicKey ?? String(user.id),
			holonName: name,
			telegramUserId: user.id,
			mode: 'telegram'
		});
	}

	// Kick off the OIDC redirect flow.
	function signIn() {
		error = '';
		telegramStore.login();
	}

	function handleBackdropClick(event: MouseEvent) {
		if (isModal && event.target === event.currentTarget) {
			dispatch('close');
		}
	}

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
			<p class="subtitle">Sign in with Telegram to get started</p>

			<button class="telegram-button" on:click={signIn}>
				<svg class="tg-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
				</svg>
				<span>Log in with Telegram</span>
			</button>

			{#if error}
				<p class="error-message" transition:fade>{error}</p>
			{/if}
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
		background: var(--color-bg-primary);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		z-index: 9999;
		padding: 1rem;
	}

	.splash-container--modal {
		background: rgba(0, 0, 0, 0.7);
		z-index: 100;
	}

	.splash-container--modal .bottom-branding {
		display: none;
	}

	.logo-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
	}

	.logo-icon {
		width: 300px;
		height: 300px;
		filter:
			drop-shadow(0 0 40px var(--color-accent))
			drop-shadow(0 0 110px color-mix(in srgb, var(--color-accent) 95%, transparent))
			drop-shadow(0 0 240px color-mix(in srgb, var(--color-accent) 80%, transparent));
		animation: pulse-glow 2.4s ease-in-out infinite;
	}

	@keyframes pulse-glow {
		0%, 100% {
			filter:
				drop-shadow(0 0 40px var(--color-accent))
				drop-shadow(0 0 110px color-mix(in srgb, var(--color-accent) 95%, transparent))
				drop-shadow(0 0 240px color-mix(in srgb, var(--color-accent) 80%, transparent));
		}
		50% {
			filter:
				drop-shadow(0 0 70px var(--color-accent))
				drop-shadow(0 0 170px color-mix(in srgb, var(--color-accent) 100%, transparent))
				drop-shadow(0 0 340px color-mix(in srgb, var(--color-accent) 90%, transparent));
		}
	}

	.onboarding-card {
		background: rgba(30, 41, 59, 0.9);
		border: 1px solid rgba(100, 116, 139, 0.3);
		border-radius: 1rem;
		padding: 2rem;
		max-width: 400px;
		width: 100%;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
		text-align: center;
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
		color: var(--color-text-primary);
		margin-bottom: 0.5rem;
	}

	.subtitle {
		color: #94a3b8;
		margin-bottom: 1.5rem;
		font-size: 0.95rem;
	}

	.telegram-button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.625rem;
		width: 100%;
		padding: 0.875rem 1rem;
		background: #2aabee;
		border: none;
		border-radius: 0.5rem;
		color: #fff;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.telegram-button:hover {
		background: #1d97d8;
		transform: translateY(-1px);
		box-shadow: 0 10px 20px -10px rgba(42, 171, 238, 0.6);
	}

	.tg-icon {
		width: 1.375rem;
		height: 1.375rem;
	}

	.error-message {
		color: #f87171;
		font-size: 0.85rem;
		margin-top: 0.75rem;
	}

	.bottom-branding {
		position: absolute;
		bottom: 2rem;
		color: var(--color-text-muted);
		font-size: 0.875rem;
		font-weight: 400;
		letter-spacing: 0.05em;
	}

	.bottom-branding p {
		margin: 0;
	}
</style>
