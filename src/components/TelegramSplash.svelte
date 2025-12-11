<script lang="ts">
	import { onMount, createEventDispatcher } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { nostrStore } from '$lib/stores/nostr';
	import { telegramStore } from '$lib/stores/telegram';
	import { schnorr } from '@noble/curves/secp256k1';
	import { bytesToHex } from '@noble/hashes/utils';
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

	onMount(async () => {
		// Initialize stores
		await nostrStore.init();
		telegramStore.init();

		// Check if we have a saved private key
		const state = nostrStore.getState();
		if (state.privateKey) {
			// Key exists, proceed with private mode
			setTimeout(() => dispatch('authenticated', { publicKey: state.publicKey }), 300);
		} else {
			// No key saved - go directly to public mode (user can login via KeyManager in TopBar)
			const holospherePublicKey = getHolospherePublicKey();
			setTimeout(() => dispatch('authenticated', { publicKey: holospherePublicKey, mode: 'public' }), 300);
		}
	});
</script>

<div class="splash-container" transition:fade={{ duration: 300 }}>
	<!-- Big centered logo -->
	<div class="logo-container" in:fly={{ y: 30, duration: 500, delay: 100 }}>
		<div class="logo-icon">
			<MyHolonsIcon />
		</div>
	</div>

	<!-- Bottom branding -->
	<div class="bottom-branding" in:fade={{ delay: 400 }}>
		<p>powered by HoloSphere</p>
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
		filter: drop-shadow(0 0 60px rgba(66, 153, 225, 0.5));
		animation: pulse-glow 3s ease-in-out infinite;
	}

	@keyframes pulse-glow {
		0%, 100% { filter: drop-shadow(0 0 60px rgba(66, 153, 225, 0.5)); }
		50% { filter: drop-shadow(0 0 100px rgba(66, 153, 225, 0.7)); }
	}

	/* Bottom branding */
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
</style>
