<script lang="ts">
	import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import { browser } from '$app/environment';
	import { nostrPrivateKey } from '$lib/stores/nostr';

	const dispatch = createEventDispatcher();

	const ONBOARDING_KEY = 'harvest_onboarding_complete';
	const PADDING = 8;
	const TOOLTIP_WIDTH = 280;
	const TOOLTIP_GAP = 14;

	interface Step {
		target: string;
		text: string;
	}

	const steps: Step[] = [
		{ target: '[data-tour="menu"]', text: 'Open the holon browser to switch between communities or join new ones.' },
		{ target: '[data-tour="calendar"]', text: 'Schedule — your default view for what\'s coming up.' },
		{ target: '[data-tour="tasks"]', text: 'Tasks — create, assign, and track work.' },
		{ target: '[data-tour="map"]', text: 'Map — pin yourself so other holons can find you.' },
		{ target: '[data-tour="federation"]', text: 'Federation — discover and connect with other holons.' },
		{ target: '[data-tour="settings"]', text: 'Settings — name your holon and describe its purpose.' }
	];

	let showOnboarding = false;
	let currentStep = 0;
	let rect: { top: number; left: number; width: number; height: number } | null = null;
	let resizeRaf = 0;

	$: stepData = steps[currentStep];
	$: progress = ((currentStep + 1) / steps.length) * 100;

	$: tooltipStyle = computeTooltipStyle(rect);
	$: arrowStyle = computeArrowStyle(rect);

	function computeTooltipStyle(r: typeof rect): string {
		if (!r) return 'top: 50%; left: 50%; transform: translate(-50%, -50%);';
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const spaceRight = vw - (r.left + r.width);
		const placeRight = spaceRight >= TOOLTIP_WIDTH + TOOLTIP_GAP + 16;
		let left: number;
		let top = r.top + r.height / 2;
		if (placeRight) {
			left = r.left + r.width + TOOLTIP_GAP;
		} else {
			left = Math.max(16, r.left - TOOLTIP_WIDTH - TOOLTIP_GAP);
		}
		// Clamp vertically
		top = Math.max(16, Math.min(vh - 16, top));
		return `top: ${top}px; left: ${left}px; transform: translateY(-50%); width: ${TOOLTIP_WIDTH}px;`;
	}

	function computeArrowStyle(r: typeof rect): string {
		if (!r) return 'display: none;';
		const vw = window.innerWidth;
		const spaceRight = vw - (r.left + r.width);
		const placeRight = spaceRight >= TOOLTIP_WIDTH + TOOLTIP_GAP + 16;
		const top = r.top + r.height / 2;
		if (placeRight) {
			return `top: ${top}px; left: ${r.left + r.width + 4}px; transform: translateY(-50%); border-width: 7px 9px 7px 0; border-color: transparent var(--color-bg-secondary, #1f2937) transparent transparent;`;
		}
		return `top: ${top}px; left: ${r.left - 13}px; transform: translateY(-50%); border-width: 7px 0 7px 9px; border-color: transparent transparent transparent var(--color-bg-secondary, #1f2937);`;
	}

	async function measureTarget() {
		await tick();
		if (!browser) return;
		const el = document.querySelector(stepData.target) as HTMLElement | null;
		if (!el) {
			rect = null;
			return;
		}
		el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' as ScrollBehavior });
		const r = el.getBoundingClientRect();
		rect = {
			top: r.top - PADDING,
			left: r.left - PADDING,
			width: r.width + PADDING * 2,
			height: r.height + PADDING * 2
		};
	}

	function onResize() {
		if (resizeRaf) cancelAnimationFrame(resizeRaf);
		resizeRaf = requestAnimationFrame(() => measureTarget());
	}

	$: if (showOnboarding && browser) {
		// Re-measure whenever the step changes
		currentStep, measureTarget();
	}

	onMount(() => {
		if (!browser) return;
		const completed = localStorage.getItem(ONBOARDING_KEY);
		const hasPrivateKey = !!$nostrPrivateKey;
		if (!completed && hasPrivateKey) {
			setTimeout(() => {
				showOnboarding = true;
				measureTarget();
			}, 500);
		}
		window.addEventListener('resize', onResize);
		window.addEventListener('scroll', onResize, true);
	});

	onDestroy(() => {
		if (!browser) return;
		window.removeEventListener('resize', onResize);
		window.removeEventListener('scroll', onResize, true);
	});

	function nextStep() {
		if (currentStep < steps.length - 1) {
			currentStep++;
		} else {
			complete();
		}
	}

	function prevStep() {
		if (currentStep > 0) currentStep--;
	}

	function complete() {
		if (browser) localStorage.setItem(ONBOARDING_KEY, 'true');
		showOnboarding = false;
		dispatch('complete');
	}

	function skip() {
		complete();
	}
</script>

{#if showOnboarding}
	<div class="tour-root" transition:fade={{ duration: 150 }}>
		{#if rect}
			<div
				class="tour-spotlight"
				style="top: {rect.top}px; left: {rect.left}px; width: {rect.width}px; height: {rect.height}px;"
			></div>
			<div class="tour-arrow" style={arrowStyle}></div>
		{:else}
			<div class="tour-dim"></div>
		{/if}

		<div class="tour-tooltip" style={tooltipStyle} role="dialog" aria-live="polite">
			<div class="tour-tooltip__progress">
				<div class="tour-tooltip__progress-fill" style="width: {progress}%"></div>
			</div>
			<div class="tour-tooltip__body">
				<p class="tour-tooltip__text">{stepData.text}</p>
			</div>
			<div class="tour-tooltip__actions">
				<button type="button" class="tour-btn tour-btn--ghost" on:click={skip}>Skip</button>
				<div class="tour-tooltip__nav">
					<span class="tour-tooltip__counter">{currentStep + 1} / {steps.length}</span>
					{#if currentStep > 0}
						<button type="button" class="tour-btn tour-btn--nav" on:click={prevStep} aria-label="Previous">
							<i class="fas fa-arrow-left"></i>
						</button>
					{/if}
					<button type="button" class="tour-btn tour-btn--primary" on:click={nextStep}>
						{currentStep < steps.length - 1 ? 'Next' : 'Done'}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.tour-root {
		position: fixed;
		inset: 0;
		z-index: 1000;
		pointer-events: none;
	}

	.tour-dim {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		pointer-events: auto;
	}

	.tour-spotlight {
		position: absolute;
		border-radius: 12px;
		box-shadow:
			0 0 0 9999px rgba(0, 0, 0, 0.7),
			0 0 0 2px var(--color-accent-light, #818cf8),
			0 0 24px 4px rgba(129, 140, 248, 0.45);
		transition: top 200ms ease, left 200ms ease, width 200ms ease, height 200ms ease;
		pointer-events: none;
	}

	.tour-arrow {
		position: absolute;
		width: 0;
		height: 0;
		border-style: solid;
		filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3));
		transition: top 200ms ease, left 200ms ease;
	}

	.tour-tooltip {
		position: absolute;
		background: var(--color-bg-secondary, #1f2937);
		border: 1px solid var(--color-border, #374151);
		border-radius: 12px;
		box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.6);
		overflow: hidden;
		pointer-events: auto;
		transition: top 200ms ease, left 200ms ease;
	}

	.tour-tooltip__progress {
		height: 3px;
		background: var(--color-bg-tertiary, #374151);
	}

	.tour-tooltip__progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #6366f1, #8b5cf6);
		transition: width 250ms ease;
	}

	.tour-tooltip__body {
		padding: 0.85rem 1rem 0.6rem;
	}

	.tour-tooltip__text {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.45;
		color: var(--color-text-primary, #ffffff);
	}

	.tour-tooltip__actions {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem 0.65rem;
		border-top: 1px solid var(--color-border, #374151);
		background: rgba(0, 0, 0, 0.15);
	}

	.tour-tooltip__nav {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.tour-tooltip__counter {
		font-size: 0.7rem;
		color: var(--color-text-muted, #9ca3af);
		letter-spacing: 0.05em;
		margin-right: 0.25rem;
	}

	.tour-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		padding: 0.4rem 0.8rem;
		border-radius: 0.45rem;
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 120ms ease;
		border: none;
		font-family: inherit;
	}

	.tour-btn--primary {
		background: var(--color-accent, #4f46e5);
		color: white;
	}

	.tour-btn--primary:hover {
		background: var(--color-accent-dark, #4338ca);
	}

	.tour-btn--ghost {
		background: transparent;
		color: var(--color-text-muted, #9ca3af);
	}

	.tour-btn--ghost:hover {
		color: var(--color-text-primary, #ffffff);
	}

	.tour-btn--nav {
		width: 30px;
		height: 30px;
		padding: 0;
		background: var(--color-bg-tertiary, #374151);
		color: var(--color-text-secondary, #d1d5db);
	}

	.tour-btn--nav:hover {
		background: var(--color-bg-primary, #111827);
		color: var(--color-text-primary, #ffffff);
	}

	@media (max-width: 480px) {
		.tour-tooltip {
			width: calc(100vw - 32px) !important;
			left: 16px !important;
			right: 16px;
			top: auto !important;
			bottom: 16px !important;
			transform: none !important;
		}

		.tour-arrow {
			display: none;
		}
	}
</style>
