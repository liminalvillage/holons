<script lang="ts">
	import { onMount, createEventDispatcher } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { telegramStore, type TelegramUser } from '$lib/stores/telegram';
	import { authStore } from '$lib/stores/auth';
	import { nostrStore } from '$lib/stores/nostr';
	import { npubLabel } from '$lib/auth/nostrKey';
	import type { ProviderLogin } from '$lib/auth/types';
	import type { AuthIdentity } from '@holons/core/auth';
	import MyHolonsIcon from '../dashboard/sidebar/icons/MyHolonsIcon.svelte';
	import LoginCard from './auth/LoginCard.svelte';

	// Props
	export let skipLoading = false; // Skip loading animation (for modal usage)
	export let isModal = false; // Display as modal overlay instead of full-screen

	const dispatch = createEventDispatcher();

	// View states — loading (restoring a session) or the sign-in card.
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

		// Key-based sessions (passkey / Nostr key / wallet) restore from local
		// state alone — no network. Telegram restores via the session cookie
		// (the OIDC callback set it; in dev the server mints one automatically).
		// Splash mounts before the layout's own nostrStore.init() (children
		// mount first), so hydrate the cached key here — init is idempotent.
		await nostrStore.init();
		const local = authStore.restore();
		if (local) {
			handleKeyIdentity(local);
			return;
		}
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
		authStore.markTelegram({
			provider: 'telegram',
			pubkey: state.nostrPublicKey ?? '',
			subject: String(user.id),
			label: user.username ? `@${user.username}` : user.first_name
		});
		dispatch('authenticated', {
			publicKey: state.nostrPublicKey ?? String(user.id),
			holonName: name,
			telegramUserId: user.id,
			mode: 'telegram'
		});
	}

	// Key-based identities: the holon id IS the pubkey, so no telegramUserId.
	function handleKeyIdentity(identity: AuthIdentity) {
		const who = identity.label && identity.provider !== 'passkey' ? identity.label : npubLabel(identity.pubkey);
		dispatch('authenticated', {
			publicKey: identity.pubkey,
			holonName: `${who}'s Holon`,
			mode: identity.provider
		});
	}

	async function onProviderLogin(e: CustomEvent<ProviderLogin>) {
		error = '';
		await authStore.completeLogin(e.detail);
		handleKeyIdentity(e.detail.identity);
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
		<div class="card-slot">
			<LoginCard on:telegram={signIn} on:login={onProviderLogin} />
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

	.card-slot {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
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
