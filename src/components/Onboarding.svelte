<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { browser } from '$app/environment';
	import { nostrPublicKey, nostrPrivateKey } from '$lib/stores/nostr';

	const dispatch = createEventDispatcher();

	// Check if user has seen onboarding
	let showOnboarding = false;
	let currentStep = 0;

	const ONBOARDING_KEY = 'harvest_onboarding_complete';

	// Steps in the onboarding flow
	const steps = [
		{
			title: 'Welcome to Harvest',
			description: 'A decentralized platform for holonic organization and collaboration.',
			icon: 'fa-seedling',
			tip: 'Holons are self-organizing units that are both whole and part of larger wholes.'
		},
		{
			title: 'Your Home Holon',
			description: 'Your personal space tied to your unique identity. All your data starts here.',
			icon: 'fa-home',
			tip: 'Click "Home" in the sidebar to always return to your personal space.'
		},
		{
			title: 'Join or Create Holons',
			description: 'Star holons to save them, or add new ones using the + button.',
			icon: 'fa-users',
			tip: 'Use QR codes to quickly add holons from others.'
		},
		{
			title: 'Navigate with Tabs',
			description: 'Use the top navigation to switch between Tasks, Schedule, Expenses, and more.',
			icon: 'fa-compass',
			tip: 'Each tab shows a different lens into your holon\'s data.'
		},
		{
			title: 'Manage Your Identity',
			description: 'Your cryptographic key is your identity. Back it up in Keys & Access!',
			icon: 'fa-key',
			tip: 'If you lose your key without a backup, your identity cannot be recovered.'
		}
	];

	$: isGuestMode = !$nostrPrivateKey;
	$: currentStepData = steps[currentStep];

	onMount(() => {
		if (browser) {
			const completed = localStorage.getItem(ONBOARDING_KEY);
			const hasPrivateKey = !!$nostrPrivateKey;

			// Show onboarding if not completed and user is logged in
			if (!completed && hasPrivateKey) {
				// Small delay to let the UI settle
				setTimeout(() => {
					showOnboarding = true;
				}, 500);
			}
		}
	});

	function nextStep() {
		if (currentStep < steps.length - 1) {
			currentStep++;
		} else {
			complete();
		}
	}

	function prevStep() {
		if (currentStep > 0) {
			currentStep--;
		}
	}

	function complete() {
		if (browser) {
			localStorage.setItem(ONBOARDING_KEY, 'true');
		}
		showOnboarding = false;
		dispatch('complete');
	}

	function skip() {
		complete();
	}
</script>

{#if showOnboarding}
	<div class="onboarding-backdrop" transition:fade={{ duration: 200 }}>
		<div class="onboarding-modal" transition:fly={{ y: 20, duration: 300 }}>
			<!-- Progress indicator -->
			<div class="onboarding-progress">
				{#each steps as _, i}
					<div
						class="onboarding-progress__dot"
						class:onboarding-progress__dot--active={i === currentStep}
						class:onboarding-progress__dot--completed={i < currentStep}
					></div>
				{/each}
			</div>

			<!-- Content -->
			<div class="onboarding-content">
				<div class="onboarding-icon">
					<i class="fas {currentStepData.icon}"></i>
				</div>

				<h2 class="onboarding-title">{currentStepData.title}</h2>
				<p class="onboarding-description">{currentStepData.description}</p>

				<div class="onboarding-tip">
					<i class="fas fa-lightbulb"></i>
					<span>{currentStepData.tip}</span>
				</div>
			</div>

			<!-- Actions -->
			<div class="onboarding-actions">
				<button class="onboarding-btn onboarding-btn--secondary" on:click={skip}>
					Skip Tour
				</button>

				<div class="onboarding-nav">
					{#if currentStep > 0}
						<button class="onboarding-btn onboarding-btn--nav" on:click={prevStep}>
							<i class="fas fa-arrow-left"></i>
						</button>
					{/if}

					<button class="onboarding-btn onboarding-btn--primary" on:click={nextStep}>
						{currentStep < steps.length - 1 ? 'Next' : 'Get Started'}
						{#if currentStep < steps.length - 1}
							<i class="fas fa-arrow-right"></i>
						{/if}
					</button>
				</div>
			</div>

			<!-- Step counter -->
			<div class="onboarding-counter">
				Step {currentStep + 1} of {steps.length}
			</div>
		</div>
	</div>
{/if}

<style>
	.onboarding-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.8);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: var(--spacing-4, 1rem);
	}

	.onboarding-modal {
		background: var(--color-bg-secondary, #1f2937);
		border-radius: var(--radius-xl, 1rem);
		padding: var(--spacing-6, 1.5rem);
		max-width: 440px;
		width: 100%;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
		border: 1px solid var(--color-border, #374151);
	}

	.onboarding-progress {
		display: flex;
		justify-content: center;
		gap: var(--spacing-2, 0.5rem);
		margin-bottom: var(--spacing-6, 1.5rem);
	}

	.onboarding-progress__dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-bg-tertiary, #374151);
		transition: all 200ms ease;
	}

	.onboarding-progress__dot--active {
		background: var(--color-accent, #4f46e5);
		transform: scale(1.25);
	}

	.onboarding-progress__dot--completed {
		background: var(--color-accent-light, #818cf8);
	}

	.onboarding-content {
		text-align: center;
		margin-bottom: var(--spacing-6, 1.5rem);
	}

	.onboarding-icon {
		width: 64px;
		height: 64px;
		border-radius: var(--radius-lg, 0.5rem);
		background: linear-gradient(135deg, var(--color-accent, #4f46e5), var(--color-accent-light, #6366f1));
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0 auto var(--spacing-4, 1rem);
		font-size: 1.5rem;
		color: white;
	}

	.onboarding-title {
		font-size: var(--font-size-xl, 1.25rem);
		font-weight: var(--font-weight-bold, 700);
		color: var(--color-text-primary, #ffffff);
		margin: 0 0 var(--spacing-2, 0.5rem);
	}

	.onboarding-description {
		font-size: var(--font-size-base, 1rem);
		color: var(--color-text-secondary, #d1d5db);
		margin: 0 0 var(--spacing-4, 1rem);
		line-height: 1.5;
	}

	.onboarding-tip {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		background: rgba(251, 191, 36, 0.1);
		border: 1px solid rgba(251, 191, 36, 0.3);
		border-radius: var(--radius-md, 0.375rem);
		font-size: var(--font-size-sm, 0.875rem);
		color: #fbbf24;
	}

	.onboarding-tip i {
		flex-shrink: 0;
	}

	.onboarding-actions {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--spacing-3, 0.75rem);
		margin-bottom: var(--spacing-4, 1rem);
	}

	.onboarding-nav {
		display: flex;
		gap: var(--spacing-2, 0.5rem);
	}

	.onboarding-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-2, 0.5rem);
		padding: var(--spacing-2, 0.5rem) var(--spacing-4, 1rem);
		border-radius: var(--radius-md, 0.375rem);
		font-size: var(--font-size-sm, 0.875rem);
		font-weight: var(--font-weight-medium, 500);
		cursor: pointer;
		transition: all 150ms ease;
		border: none;
	}

	.onboarding-btn--primary {
		background: var(--color-accent, #4f46e5);
		color: white;
	}

	.onboarding-btn--primary:hover {
		background: var(--color-accent-dark, #4338ca);
	}

	.onboarding-btn--secondary {
		background: transparent;
		color: var(--color-text-muted, #6b7280);
	}

	.onboarding-btn--secondary:hover {
		color: var(--color-text-primary, #ffffff);
		background: var(--color-bg-tertiary, #374151);
	}

	.onboarding-btn--nav {
		width: 36px;
		height: 36px;
		padding: 0;
		background: var(--color-bg-tertiary, #374151);
		color: var(--color-text-secondary, #d1d5db);
	}

	.onboarding-btn--nav:hover {
		background: var(--color-bg-primary, #111827);
		color: var(--color-text-primary, #ffffff);
	}

	.onboarding-counter {
		text-align: center;
		font-size: var(--font-size-xs, 0.75rem);
		color: var(--color-text-muted, #6b7280);
	}

	@media (max-width: 480px) {
		.onboarding-modal {
			padding: var(--spacing-4, 1rem);
		}

		.onboarding-actions {
			flex-direction: column-reverse;
			gap: var(--spacing-2, 0.5rem);
		}

		.onboarding-nav {
			width: 100%;
			justify-content: space-between;
		}

		.onboarding-btn--primary {
			flex: 1;
		}
	}
</style>
