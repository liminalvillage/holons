<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { nostrPrivateKey } from '$lib/stores/nostr';
	import { ID } from '../dashboard/store';

	const dispatch = createEventDispatcher();

	let showOnboarding = false;
	let currentStep = 0;
	let direction = 1; // 1 = forward, -1 = backward

	const ONBOARDING_KEY = 'harvest_onboarding_complete';

	interface Step {
		title: string;
		subtitle: string;
		description: string;
		icon: string;
		gradient: string;
		action?: { label: string; route: string };
		features?: { icon: string; label: string }[];
		tip: string;
	}

	const steps: Step[] = [
		{
			title: 'Welcome to Harvest',
			subtitle: 'Your home base',
			description: 'This is your holon — a self-organizing space for you and your community. Give it a name and purpose to get started.',
			icon: 'fa-seedling',
			gradient: 'linear-gradient(135deg, #10b981, #059669)',
			action: { label: 'Set Up Your Holon', route: '/settings' },
			tip: 'Head to Settings to name your holon and describe its purpose.'
		},
		{
			title: 'Your Toolkit',
			subtitle: 'Everything you need, in the sidebar',
			description: 'Each icon in the sidebar is a tool for your community. Here are some highlights:',
			icon: 'fa-th-large',
			gradient: 'linear-gradient(135deg, #6366f1, #4f46e5)',
			features: [
				{ icon: 'fa-tasks', label: 'Tasks — organize what needs doing' },
				{ icon: 'fa-calendar-alt', label: 'Schedule — plan your time' },
				{ icon: 'fa-globe-americas', label: 'Map — see holons in space' },
				{ icon: 'fa-wallet', label: 'Expenses — track spending' },
				{ icon: 'fa-exchange-alt', label: 'Offers & Requests — trade and share' },
				{ icon: 'fa-book', label: 'Library — shared documents' }
			],
			tip: 'Explore the sidebar to discover all the tools available to your holon.'
		},
		{
			title: 'Create Your First Task',
			subtitle: 'Even a small task gets things moving',
			description: 'Your task board is where work happens. Add a task — it can be anything from "buy supplies" to "plan the next gathering".',
			icon: 'fa-check-circle',
			gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
			action: { label: 'Open Tasks', route: '/tasks' },
			tip: 'Find Tasks in the sidebar to create, assign, and track work.'
		},
		{
			title: 'Pin Yourself on the Map',
			subtitle: 'Holons exist in space — claim yours',
			description: 'Set your location so other holons can find you. The map shows the whole network — zoom in to discover neighbors.',
			icon: 'fa-map-marker-alt',
			gradient: 'linear-gradient(135deg, #ec4899, #db2777)',
			action: { label: 'Open Map', route: '/map' },
			tip: 'Go to Map in the sidebar to set your location and explore nearby holons.'
		},
		{
			title: 'Connect with Others',
			subtitle: "You're not alone",
			description: 'Star a holon to save it, scan a QR code to join one, or create a new community. Holons can nest inside each other to form larger networks.',
			icon: 'fa-users',
			gradient: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
			action: { label: 'Browse Holons', route: '/federation' },
			tip: 'Use the browser panel on the left to find and star holons, or scan QR codes to join.'
		}
	];

	$: currentStepData = steps[currentStep];

	onMount(() => {
		if (browser) {
			const completed = localStorage.getItem(ONBOARDING_KEY);
			const hasPrivateKey = !!$nostrPrivateKey;
			if (!completed && hasPrivateKey) {
				setTimeout(() => {
					showOnboarding = true;
				}, 500);
			}
		}
	});

	function nextStep() {
		if (currentStep < steps.length - 1) {
			direction = 1;
			currentStep++;
		} else {
			complete();
		}
	}

	function prevStep() {
		if (currentStep > 0) {
			direction = -1;
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

	function tryAction() {
		const action = currentStepData.action;
		if (action && $ID) {
			complete();
			goto(`/${$ID}${action.route}`);
		}
	}

	function skip() {
		complete();
	}
</script>

{#if showOnboarding}
	<div class="onboarding-backdrop" transition:fade={{ duration: 200 }}>
		<div class="onboarding-modal" transition:fly={{ y: 20, duration: 300 }}>
			<!-- Progress bar -->
			<div class="onboarding-progress-bar">
				<div
					class="onboarding-progress-bar__fill"
					style="width: {((currentStep + 1) / steps.length) * 100}%"
				></div>
			</div>

			<!-- Step indicator -->
			<div class="onboarding-step-label">
				{currentStep + 1} / {steps.length}
			</div>

			<!-- Content -->
			{#key currentStep}
				<div
					class="onboarding-content"
					in:fly={{ x: 60 * direction, duration: 250, delay: 100 }}
					out:fly={{ x: -60 * direction, duration: 150 }}
				>
					<div class="onboarding-icon" style="background: {currentStepData.gradient}">
						<i class="fas {currentStepData.icon}"></i>
					</div>

					<h2 class="onboarding-title">{currentStepData.title}</h2>
					<p class="onboarding-subtitle">{currentStepData.subtitle}</p>
					<p class="onboarding-description">{currentStepData.description}</p>

					<!-- Feature grid for step 2 -->
					{#if currentStepData.features}
						<div class="onboarding-features">
							{#each currentStepData.features as feature}
								<div class="onboarding-feature">
									<i class="fas {feature.icon}"></i>
									<span>{feature.label}</span>
								</div>
							{/each}
						</div>
					{/if}

					<!-- Tip -->
					<div class="onboarding-tip">
						<i class="fas fa-hand-point-right"></i>
						<span>{currentStepData.tip}</span>
					</div>
				</div>
			{/key}

			<!-- Actions -->
			<div class="onboarding-actions">
				<button class="onboarding-btn onboarding-btn--skip" on:click={skip}>
					Skip Tour
				</button>

				<div class="onboarding-nav">
					{#if currentStep > 0}
						<button class="onboarding-btn onboarding-btn--nav" on:click={prevStep} aria-label="Previous step">
							<i class="fas fa-arrow-left"></i>
						</button>
					{/if}

					{#if currentStepData.action && $ID}
						<button class="onboarding-btn onboarding-btn--try" on:click={tryAction}>
							<i class="fas fa-external-link-alt"></i>
							{currentStepData.action.label}
						</button>
					{/if}

					<button class="onboarding-btn onboarding-btn--primary" on:click={nextStep}>
						{currentStep < steps.length - 1 ? 'Next' : 'Get Started!'}
						{#if currentStep < steps.length - 1}
							<i class="fas fa-arrow-right"></i>
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.onboarding-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.85);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: var(--spacing-4, 1rem);
	}

	.onboarding-modal {
		background: var(--color-bg-secondary, #1f2937);
		border-radius: var(--radius-xl, 1rem);
		padding: 0;
		max-width: 480px;
		width: 100%;
		box-shadow: 0 25px 60px -12px rgba(0, 0, 0, 0.6);
		border: 1px solid var(--color-border, #374151);
		overflow: hidden;
	}

	/* Progress bar */
	.onboarding-progress-bar {
		height: 3px;
		background: var(--color-bg-tertiary, #374151);
	}

	.onboarding-progress-bar__fill {
		height: 100%;
		background: linear-gradient(90deg, #6366f1, #8b5cf6);
		transition: width 300ms ease;
		border-radius: 0 2px 2px 0;
	}

	.onboarding-step-label {
		text-align: right;
		padding: 0.75rem 1.25rem 0;
		font-size: 0.7rem;
		color: var(--color-text-muted, #6b7280);
		letter-spacing: 0.05em;
		font-weight: 500;
	}

	/* Content */
	.onboarding-content {
		text-align: center;
		padding: 0.5rem 1.5rem 1.25rem;
	}

	.onboarding-icon {
		width: 72px;
		height: 72px;
		border-radius: 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0 auto 1rem;
		font-size: 1.75rem;
		color: white;
		box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.3);
	}

	.onboarding-title {
		font-size: 1.35rem;
		font-weight: 700;
		color: var(--color-text-primary, #ffffff);
		margin: 0 0 0.25rem;
	}

	.onboarding-subtitle {
		font-size: 0.9rem;
		color: var(--color-accent-light, #818cf8);
		margin: 0 0 0.75rem;
		font-weight: 500;
	}

	.onboarding-description {
		font-size: 0.95rem;
		color: var(--color-text-secondary, #d1d5db);
		margin: 0 0 1rem;
		line-height: 1.6;
	}

	/* Feature grid */
	.onboarding-features {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		margin-bottom: 1rem;
		text-align: left;
	}

	.onboarding-feature {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.6rem;
		background: var(--color-bg-tertiary, #374151);
		border-radius: 0.5rem;
		font-size: 0.8rem;
		color: var(--color-text-secondary, #d1d5db);
	}

	.onboarding-feature i {
		color: var(--color-accent-light, #818cf8);
		width: 16px;
		text-align: center;
		flex-shrink: 0;
	}

	/* Tip */
	.onboarding-tip {
		display: inline-flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.6rem 0.85rem;
		background: rgba(99, 102, 241, 0.1);
		border: 1px solid rgba(99, 102, 241, 0.25);
		border-radius: 0.5rem;
		font-size: 0.8rem;
		color: #a5b4fc;
		text-align: left;
	}

	.onboarding-tip i {
		flex-shrink: 0;
		margin-top: 0.1rem;
	}

	/* Actions */
	.onboarding-actions {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		padding: 1rem 1.5rem 1.25rem;
		border-top: 1px solid var(--color-border, #374151);
		background: rgba(0, 0, 0, 0.15);
	}

	.onboarding-nav {
		display: flex;
		gap: 0.4rem;
	}

	.onboarding-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.5rem 1rem;
		border-radius: 0.5rem;
		font-size: 0.85rem;
		font-weight: 500;
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
		transform: translateY(-1px);
	}

	.onboarding-btn--try {
		background: rgba(99, 102, 241, 0.15);
		color: #a5b4fc;
		border: 1px solid rgba(99, 102, 241, 0.3);
		font-size: 0.8rem;
		padding: 0.4rem 0.75rem;
	}

	.onboarding-btn--try:hover {
		background: rgba(99, 102, 241, 0.25);
		color: white;
	}

	.onboarding-btn--skip {
		background: transparent;
		color: var(--color-text-muted, #6b7280);
		font-size: 0.8rem;
		padding: 0.4rem 0.6rem;
	}

	.onboarding-btn--skip:hover {
		color: var(--color-text-primary, #ffffff);
	}

	.onboarding-btn--nav {
		width: 34px;
		height: 34px;
		padding: 0;
		background: var(--color-bg-tertiary, #374151);
		color: var(--color-text-secondary, #d1d5db);
	}

	.onboarding-btn--nav:hover {
		background: var(--color-bg-primary, #111827);
		color: var(--color-text-primary, #ffffff);
	}

	@media (max-width: 480px) {
		.onboarding-content {
			padding: 0.5rem 1rem 1rem;
		}

		.onboarding-actions {
			flex-direction: column-reverse;
			gap: 0.5rem;
			padding: 0.75rem 1rem 1rem;
		}

		.onboarding-nav {
			width: 100%;
			justify-content: flex-end;
		}

		.onboarding-btn--primary {
			flex: 1;
		}

		.onboarding-features {
			grid-template-columns: 1fr;
		}
	}
</style>
