<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';

	// localStorage flag — once the user clicks "Got it" we don't show the
	// banner again on this device. New devices / cleared storage will see
	// it again, which is the desired behavior for a beta-software warning.
	const STORAGE_KEY = 'harvest.betaDisclaimerDismissed';

	let dismissed = true; // start hidden so SSR / pre-mount doesn't flash the banner

	onMount(() => {
		if (!browser) return;
		try {
			dismissed = localStorage.getItem(STORAGE_KEY) === '1';
		} catch {
			dismissed = false;
		}
	});

	function dismiss() {
		dismissed = true;
		try {
			localStorage.setItem(STORAGE_KEY, '1');
		} catch {}
	}
</script>

{#if !dismissed}
	<div class="beta-disclaimer" role="alert">
		<span class="beta-disclaimer__badge">BETA</span>
		<p class="beta-disclaimer__text">
			This software is under active development. All data is public and may be
			erased without notice. Don't store anything you can't afford to lose.
		</p>
		<button type="button" class="beta-disclaimer__dismiss" on:click={dismiss}>
			Got it
		</button>
	</div>
{/if}

<style>
	.beta-disclaimer {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 1rem;
		background: linear-gradient(90deg, #7c2d12 0%, #b45309 100%); /* orange-900 → amber-700 */
		color: #fff7ed; /* orange-50 */
		font-size: 0.8125rem;
		line-height: 1.3;
		border-bottom: 1px solid #92400e; /* amber-800 */
	}

	.beta-disclaimer__badge {
		flex-shrink: 0;
		padding: 0.125rem 0.5rem;
		background: rgba(0, 0, 0, 0.25);
		border-radius: 9999px;
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.05em;
	}

	.beta-disclaimer__text {
		flex: 1;
		margin: 0;
	}

	.beta-disclaimer__dismiss {
		flex-shrink: 0;
		padding: 0.25rem 0.75rem;
		background: rgba(255, 255, 255, 0.15);
		color: #fff7ed;
		border: 1px solid rgba(255, 255, 255, 0.25);
		border-radius: 0.375rem;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.beta-disclaimer__dismiss:hover {
		background: rgba(255, 255, 255, 0.25);
	}

	@media (max-width: 640px) {
		.beta-disclaimer {
			flex-wrap: wrap;
			padding: 0.5rem 0.75rem;
			gap: 0.5rem;
		}

		.beta-disclaimer__text {
			font-size: 0.75rem;
			line-height: 1.25;
			flex-basis: 100%;
			order: 3;
		}

		.beta-disclaimer__badge {
			order: 1;
		}

		.beta-disclaimer__dismiss {
			order: 2;
			margin-left: auto;
		}
	}
</style>
