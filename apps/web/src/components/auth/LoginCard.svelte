<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors -->
<script lang="ts">
	// The sign-in card. Telegram is the suggested path; passkey, your own Nostr
	// key and an Ethereum wallet are equal secondary options. Every option ends
	// in a `login` event carrying a ProviderLogin (a usable Nostr key) — except
	// Telegram, which is a full-page OIDC redirect (`telegram` event).
	import { createEventDispatcher, onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import MyHolonsIcon from '../../dashboard/sidebar/icons/MyHolonsIcon.svelte';
	import ProviderTile from './ProviderTile.svelte';
	import NostrKeySheet from './NostrKeySheet.svelte';
	import { isPasskeySupported, signInWithPasskey } from '$lib/auth/passkey';
	import { isWalletAvailable, signInWithEthereum } from '$lib/auth/ethereum';
	import { AuthUiError, type ProviderLogin } from '$lib/auth/types';

	const dispatch = createEventDispatcher<{ login: ProviderLogin; telegram: void }>();

	type Busy = null | 'passkey' | 'ethereum' | 'nostr';
	let busy: Busy = null;
	let error = '';
	let errorSoft = false;
	let sheet: 'none' | 'nostr' = 'none';
	let offerCreatePasskey = false;

	let passkeyOk = false;
	let walletOk = false;
	onMount(() => {
		passkeyOk = isPasskeySupported();
		walletOk = isWalletAvailable();
	});

	async function run(kind: Exclude<Busy, null>, fn: () => Promise<ProviderLogin>) {
		if (busy) return;
		busy = kind;
		error = '';
		try {
			const login = await fn();
			dispatch('login', login);
		} catch (e) {
			const err = e instanceof AuthUiError ? e : new AuthUiError((e as Error)?.message || 'Sign-in failed.');
			error = err.message;
			errorSoft = err.kind === 'cancelled';
			if (kind === 'passkey' && err.kind !== 'unsupported') offerCreatePasskey = true;
		} finally {
			busy = null;
		}
	}

	const passkey = (create = false) => run('passkey', () => signInWithPasskey({ create }));
	const ethereum = () => run('ethereum', signInWithEthereum);

	function onNostrLogin(e: CustomEvent<ProviderLogin>) {
		error = '';
		dispatch('login', e.detail);
	}
</script>

<div class="card" in:fly={{ y: 24, duration: 400 }}>
	<div class="logo" aria-hidden="true"><MyHolonsIcon /></div>
	<h1 class="title">Welcome to Holons</h1>

	{#if sheet === 'nostr'}
		<NostrKeySheet on:login={onNostrLogin} on:back={() => { sheet = 'none'; error = ''; }} />
	{:else}
		<p class="subtitle">Your holon, your key. Pick how you'd like to sign in.</p>

		<button class="telegram" type="button" disabled={!!busy} on:click={() => dispatch('telegram')}>
			<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
			</svg>
			<span>Continue with Telegram</span>
			<span class="pill">Recommended</span>
		</button>

		<div class="divider" role="separator"><span>or use your own key</span></div>

		<div class="tiles">
			<ProviderTile
				label="Passkey"
				hint={passkeyOk ? 'Face ID, Touch ID or security key' : 'Not available in this browser'}
				disabled={!passkeyOk || (!!busy && busy !== 'passkey')}
				busy={busy === 'passkey'}
				on:click={() => passkey(false)}
			>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6 1.4 0 2.6.3 3.6.9" /><circle cx="17.5" cy="13.5" r="2.5" /><path d="M17.5 16v5l1.5-1.2M17.5 18.5l1.5 1" />
				</svg>
			</ProviderTile>
			<ProviderTile
				label="Nostr key"
				hint="Paste an nsec or create one"
				disabled={!!busy}
				on:click={() => { sheet = 'nostr'; error = ''; }}
			>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="8" cy="15" r="4.5" /><path d="M11.2 11.8 20 3M16 7l2.5 2.5M13.5 9.5 16 12" />
				</svg>
			</ProviderTile>
			<ProviderTile
				label="Ethereum"
				hint={walletOk ? 'MetaMask, Rabby, Brave…' : 'No wallet detected'}
				disabled={!walletOk || (!!busy && busy !== 'ethereum')}
				busy={busy === 'ethereum'}
				on:click={ethereum}
			>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
					<path d="M12 2.5 5.5 12.4 12 16.2l6.5-3.8L12 2.5Z" /><path d="m5.5 13.9 6.5 8.6 6.5-8.6L12 17.7l-6.5-3.8Z" />
				</svg>
			</ProviderTile>
		</div>

		{#if offerCreatePasskey && passkeyOk}
			<button class="link" type="button" disabled={!!busy} on:click={() => passkey(true)} transition:fade={{ duration: 150 }}>
				No passkey yet? Create one for this device
			</button>
		{/if}
	{/if}

	{#if error}
		<p class="error" class:error--soft={errorSoft} transition:fade={{ duration: 150 }} role="alert">{error}</p>
	{/if}
</div>

<style>
	.card {
		position: relative;
		width: 100%;
		max-width: 420px;
		padding: 2rem 1.75rem 1.5rem;
		border-radius: 1.25rem;
		background: color-mix(in srgb, var(--color-bg-secondary) 88%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
		box-shadow:
			0 30px 60px -20px rgba(0, 0, 0, 0.6),
			0 0 0 1px color-mix(in srgb, var(--color-accent) 12%, transparent) inset;
		backdrop-filter: blur(14px);
		text-align: center;
	}
	.logo {
		width: 72px;
		height: 72px;
		margin: 0 auto 1rem;
		filter: drop-shadow(0 0 22px color-mix(in srgb, var(--color-accent) 55%, transparent));
	}
	.title {
		margin: 0 0 0.375rem;
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: -0.01em;
		color: var(--color-text-primary);
	}
	.subtitle {
		margin: 0 0 1.25rem;
		font-size: 0.9375rem;
		color: var(--color-text-secondary);
	}
	.telegram {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.625rem;
		width: 100%;
		padding: 0.875rem 1rem;
		border: none;
		border-radius: 0.75rem;
		background: #2aabee;
		color: #fff;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.2s, transform 0.2s, box-shadow 0.2s;
	}
	.telegram svg {
		width: 1.375rem;
		height: 1.375rem;
	}
	.telegram:hover:not(:disabled) {
		background: #1d97d8;
		transform: translateY(-1px);
		box-shadow: 0 12px 24px -12px rgba(42, 171, 238, 0.7);
	}
	.telegram:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.telegram:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 2px;
	}
	.pill {
		position: absolute;
		top: -0.625rem;
		right: 0.75rem;
		padding: 0.125rem 0.5rem;
		border-radius: 999px;
		background: var(--color-bg-primary);
		border: 1px solid rgba(42, 171, 238, 0.6);
		color: #7cc9f5;
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.divider {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin: 1.25rem 0 0.875rem;
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}
	.divider::before,
	.divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--color-border);
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.5rem;
	}
	@media (max-width: 380px) {
		.tiles {
			grid-template-columns: 1fr;
		}
	}
	.link {
		margin-top: 0.75rem;
		border: none;
		background: none;
		color: var(--color-accent-light);
		font-size: 0.8125rem;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.error {
		margin: 0.875rem 0 0;
		font-size: 0.8125rem;
		color: #f87171;
	}
	.error--soft {
		color: var(--color-text-secondary);
	}
</style>
