<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import { getContext } from 'svelte';
	import type { HoloSphere } from 'holosphere';
	import {
		publishToFederation,
		getFederationSnapshot,
		readSettingsHex,
		type PublishTarget,
		type PublishOutcome
	} from '$lib/holosphere/publish';
	import { awaitName } from '$lib/stores/nameResolver';
	import Modal from './Modal.svelte';
	// HexPicker pulls in mapbox-gl (~1.9 MB). It's only shown when the user
	// opens the picker, so load it lazily (see the {#await} in the markup) to
	// keep mapbox out of the initial bundle this button is statically reachable from.
	// @ts-ignore — h3-js has no published types in this repo's tsconfig
	import * as h3 from 'h3-js';

	export let holonId: string;
	export let lens: string;
	/** Item must carry a string `id`. For tuple-based stores ([key, value]),
	 *  callers should pass `{ ...value, id: value.id ?? key }`. */
	export let item: { id: string; [k: string]: any };
	/** Per-row icon-only mode. Always opens the picker; never auto-publishes. */
	export let compact: boolean = false;
	export let label: string = 'Publish to Federation';
	export let disabled: boolean = false;
	export let onPublished: ((outcome: PublishOutcome) => void) | null = null;

	const holosphere = getContext('holosphere') as HoloSphere | undefined;

	type Phase = 'idle' | 'publishing' | 'success' | 'error';
	let phase: Phase = 'idle';
	let statusMessage = '';
	let outcome: PublishOutcome | null = null;

	let popoverOpen = false;
	// When publishing to a picked location, also propagate the hologram up the
	// parent chain so it surfaces at wider zoom levels (not just the exact spot).
	let upcastOnPublish = true;
	let popoverEl: HTMLDivElement | null = null;
	let buttonWrapperEl: HTMLDivElement | null = null;
	let popoverStyle = '';
	let hexPickerOpen = false;

	let federationLoaded = false;
	let partners: Array<{ id: string; name: string }> = [];
	let settingsHex: string | null = null;

	$: isHologramItem = !!item?._hologram?.isHologram;
	$: effectiveDisabled = disabled || !holosphere || !holonId;
	$: alreadyPublished = !!item?.published;

	async function loadFederation() {
		if (!holosphere || !holonId) {
			federationLoaded = true;
			return;
		}
		try {
			const [snap, hex] = await Promise.all([
				getFederationSnapshot(holosphere, holonId),
				readSettingsHex(holosphere, holonId)
			]);
			settingsHex = hex;
			const list: Array<{ id: string; name: string }> = [];
			for (const id of snap.federated) {
				let name = await awaitName(id);
				if (!name || name.startsWith('Holon ')) {
					const stored = snap.partnerNames?.[id];
					if (stored && stored !== id) name = stored;
				}
				list.push({ id, name: name || `Holon ${id.slice(0, 8)}…` });
			}
			partners = list;
		} catch (err) {
			console.warn('[PublishButton] Failed to load federation', err);
			partners = [];
			settingsHex = null;
		} finally {
			federationLoaded = true;
		}
	}

	onMount(() => {
		loadFederation();
	});

	// Recompute the popover's viewport-fixed position from the trigger's
	// bounding rect. Using `position: fixed` (instead of absolute-in-wrapper)
	// lets the popover escape any ancestor `overflow: hidden` — the publish
	// button lives in dense task rows inside scrollable containers where an
	// absolute popover would otherwise be clipped at the row/card edge.
	//
	// We anchor with `left`/`top` (not `right`) and clamp BOTH axes against
	// the viewport so the popover stays fully onscreen even when the trigger
	// is near a corner. max-height is also clamped to the chosen side so the
	// popover never overflows past the viewport edge (the footer-mounted
	// trigger in TaskModal often has < 400px both above and below it).
	function repositionPopover() {
		if (!popoverOpen || !buttonWrapperEl || !popoverEl) return;
		const trigger = buttonWrapperEl.getBoundingClientRect();
		const popW = popoverEl.offsetWidth || 280;
		// scrollHeight reflects the content's natural height regardless of
		// any current max-height — needed so we know whether the desired
		// size fits before deciding which side to drop on.
		const desiredH = popoverEl.scrollHeight || 320;
		const margin = 6;
		const vpEdge = 8;
		const minH = 120;
		const vpW = window.innerWidth;
		const vpH = window.innerHeight;

		// --- vertical: prefer below; flip above only when below can't fit. ---
		const spaceBelow = vpH - trigger.bottom - margin - vpEdge;
		const spaceAbove = trigger.top - margin - vpEdge;
		let top: number;
		let maxH: number;
		if (spaceBelow >= desiredH || spaceBelow >= spaceAbove) {
			maxH = Math.max(minH, spaceBelow);
			top = trigger.bottom + margin;
		} else {
			maxH = Math.max(minH, spaceAbove);
			top = trigger.top - margin - Math.min(desiredH, maxH);
		}
		// Final safety: keep at least `minH` of the popover visible.
		const topMax = Math.max(vpEdge, vpH - vpEdge - minH);
		top = Math.max(vpEdge, Math.min(topMax, top));

		// --- horizontal: anchor the popover's right edge to the trigger's
		// right edge, then clamp into the viewport. Using `left` (not `right`)
		// avoids negative-right values that push the popover offscreen when
		// the trigger sits past the viewport edge in a scrolled container. ---
		let left = trigger.right - popW;
		const leftMax = Math.max(vpEdge, vpW - vpEdge - popW);
		left = Math.max(vpEdge, Math.min(leftMax, left));

		popoverStyle = `position: fixed; top: ${top}px; left: ${left}px; max-height: ${maxH}px;`;
	}

	async function openPicker() {
		if (effectiveDisabled) return;
		if (!federationLoaded) await loadFederation();
		popoverOpen = true;
		await tick();
		repositionPopover();
		document.addEventListener('click', handleOutsideClick, { capture: true });
		document.addEventListener('keydown', handleEsc);
		window.addEventListener('resize', repositionPopover);
		// Capture scrolls on any ancestor (the bubble-phase only fires on the
		// scrolling element itself; capture catches scrolls in containing scroll
		// parents so the popover stays pinned to the trigger).
		window.addEventListener('scroll', repositionPopover, { capture: true });
	}

	function closePicker() {
		popoverOpen = false;
		document.removeEventListener('click', handleOutsideClick, { capture: true });
		document.removeEventListener('keydown', handleEsc);
		window.removeEventListener('resize', repositionPopover);
		window.removeEventListener('scroll', repositionPopover, { capture: true } as any);
	}

	function handleOutsideClick(e: MouseEvent) {
		if (!popoverEl || !buttonWrapperEl) return;
		const t = e.target as Node;
		if (!popoverEl.contains(t) && !buttonWrapperEl.contains(t)) closePicker();
	}

	function handleEsc(e: KeyboardEvent) {
		if (e.key === 'Escape') closePicker();
	}

	/** The "primary" click in big mode runs the smart logic; in compact mode
	 *  it always opens the picker (rows are dense, no auto-publish). */
	async function handlePrimary() {
		if (effectiveDisabled) return;
		if (compact) {
			openPicker();
			return;
		}
		if (!federationLoaded) await loadFederation();

		const partnerCount = partners.length;
		if (partnerCount === 0 && !settingsHex) {
			openPicker();
			return;
		}
		if (partnerCount === 0 && settingsHex) {
			runPublish({ kind: 'all' });
			return;
		}
		if (partnerCount === 1) {
			runPublish({ kind: 'partner', holonId: partners[0].id });
			return;
		}
		openPicker();
	}

	async function runPublish(
		target: PublishTarget,
		extraOpts: { upcast?: boolean; upcastLevels?: number } = {}
	) {
		if (!holosphere) return;
		closePicker();
		phase = 'publishing';
		statusMessage = 'Publishing…';
		try {
			const result = await publishToFederation(
				{ holosphere, holonId, lens, item },
				target,
				// Federation holograms are opt-in; this is a manual "publish as
				// hologram" action, so keep that behavior.
				{ ...extraOpts, useHolograms: true }
			);
			outcome = result;
			if (result.publishedTo > 0) {
				phase = 'success';
				statusMessage = result.errors.length
					? `Published to ${result.publishedTo} location(s) (with some errors)`
					: `Published to ${result.publishedTo} location(s)`;
				if (result.errors.length) console.warn('[PublishButton] partial errors', result.errors);
				onPublished?.(result);
			} else {
				phase = 'error';
				statusMessage =
					result.errors.length === 0
						? 'No federated targets available'
						: `Failed: ${result.errors.join('; ')}`;
				console.error('[PublishButton] publish failed', result.errors);
			}
		} catch (err: any) {
			phase = 'error';
			statusMessage = `Error: ${err?.message ?? 'Unknown error'}`;
			console.error('[PublishButton] error', err);
		}
		setTimeout(() => {
			if (phase === 'success' || phase === 'error') {
				phase = 'idle';
				statusMessage = '';
			}
		}, phase === 'success' ? 3000 : 5000);
	}

	function pickAll() {
		runPublish({ kind: 'all' });
	}
	function pickPartner(holonId: string) {
		runPublish({ kind: 'partner', holonId });
	}
	function openHexPicker() {
		closePicker();
		hexPickerOpen = true;
	}
	function onHexSelect(e: CustomEvent<{ hex: string }>) {
		hexPickerOpen = false;
		const cell = e.detail.hex;
		// Climb every level above the picked cell so it shows at all zooms.
		let upcastLevels: number | undefined;
		try { upcastLevels = h3.getResolution(cell); } catch { /* leave default */ }
		runPublish({ kind: 'hex', cell }, { upcast: upcastOnPublish, upcastLevels });
	}
	function onHexCancel() {
		hexPickerOpen = false;
	}

	/**
	 * Move the popover element to `document.body` so it escapes any ancestor
	 * that establishes a containing block for `position: fixed` (transform,
	 * container-type, filter, etc.). The publish button is rendered inside
	 * task rows (`animate:flip` sets a transient transform during reorder)
	 * and TaskCardShell sets `container-type: inline-size` — without the
	 * portal, `position: fixed` would resolve against those ancestors and
	 * the popover would land far from where its `left`/`top` math expects.
	 */
	function portalToBody(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				if (node.parentNode === document.body) {
					document.body.removeChild(node);
				}
			},
		};
	}

	function tooltipText(): string {
		if (!holosphere || !holonId) return 'Holosphere not ready';
		if (isHologramItem) {
			return 'Forward this hologram — the original holon stays the source';
		}
		if (alreadyPublished && item.publishedAt) {
			const when = new Date(item.publishedAt).toLocaleString();
			return `Published to ${item.publishedTo ?? '?'} location(s) on ${when} — click to publish again`;
		}
		return label;
	}
</script>

<div class="ptf-wrapper" bind:this={buttonWrapperEl}>
	{#if compact}
		<button
			type="button"
			class="ptf-compact"
			class:ptf-compact--published={alreadyPublished}
			class:ptf-compact--busy={phase === 'publishing'}
			disabled={effectiveDisabled || phase === 'publishing'}
			aria-label={label}
			title={tooltipText()}
			on:click={handlePrimary}
		>
			{#if phase === 'publishing'}
				<svg class="ptf-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
			{:else if phase === 'success'}
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
			{:else if phase === 'error'}
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
			{:else}
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg>
			{/if}
		</button>
	{:else}
		<div class="ptf-split" class:ptf-split--disabled={effectiveDisabled}>
			<button
				type="button"
				class="ptf-primary"
				disabled={effectiveDisabled || phase === 'publishing'}
				aria-label={label}
				title={tooltipText()}
				on:click={handlePrimary}
			>
				{#if phase === 'publishing'}
					<svg class="ptf-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
				{:else if phase === 'success'}
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
				{:else}
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg>
				{/if}
				<span>{label}</span>
			</button>
			<button
				type="button"
				class="ptf-chevron"
				disabled={effectiveDisabled || phase === 'publishing'}
				aria-label="Choose publish target"
				title="Choose publish target"
				on:click={openPicker}
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
			</button>
		</div>
	{/if}

	{#if popoverOpen}
		<div
			class="ptf-popover"
			use:portalToBody
			bind:this={popoverEl}
			style={popoverStyle}
			role="menu"
			transition:fade={{ duration: 100 }}
		>
			<div class="ptf-popover__title">Publish to…</div>
			{#if partners.length > 1}
				<button class="ptf-row" type="button" on:click={pickAll}>
					<span class="ptf-row__icon">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064"/></svg>
					</span>
					<span class="ptf-row__label">All federated partners ({partners.length})</span>
				</button>
				<div class="ptf-divider"></div>
			{/if}
			{#if partners.length === 0}
				<div class="ptf-empty">
					No federated partners.<br />
					<span class="ptf-empty__hint">Pick a location below, or set up federation in Settings.</span>
				</div>
			{:else}
				{#each partners as p (p.id)}
					<button class="ptf-row" type="button" on:click={() => pickPartner(p.id)}>
						<span class="ptf-row__icon">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
						</span>
						<span class="ptf-row__label">{p.name}</span>
					</button>
				{/each}
				<div class="ptf-divider"></div>
			{/if}
			<button class="ptf-row" type="button" on:click={openHexPicker}>
				<span class="ptf-row__icon">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
				</span>
				<span class="ptf-row__label">Pick a location…</span>
			</button>
			<!-- Applies to a location publish: also propagate up so it shows at
			     wider zoom levels. The label sits inside the popover, so the
			     outside-click handler leaves the menu open while toggling. -->
			<label class="ptf-toggle-row">
				<input type="checkbox" bind:checked={upcastOnPublish} />
				<span class="ptf-toggle-row__label">Upcast — show at wider zoom levels</span>
			</label>
		</div>
	{/if}

	{#if statusMessage && !compact}
		<div class="ptf-status ptf-status--{phase}">{statusMessage}</div>
	{/if}
</div>

<Modal open={hexPickerOpen} title="Publish to a location" size="lg" on:close={onHexCancel}>
	{#if hexPickerOpen}
		<label class="ptf-upcast">
			<input type="checkbox" bind:checked={upcastOnPublish} />
			<span class="ptf-upcast__text">
				<span class="ptf-upcast__title">Upcast</span>
				<span class="ptf-upcast__hint">Also surface this at wider zoom levels, not only at the exact spot.</span>
			</span>
		</label>
		{#await import('./HexPicker.svelte') then { default: HexPicker }}
			<HexPicker on:select={onHexSelect} on:cancel={onHexCancel} />
		{/await}
	{/if}
</Modal>

<style>
	.ptf-wrapper {
		position: relative;
		display: inline-block;
	}

	/* Compact (per-row) icon button */
	.ptf-compact {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--color-text-muted); /* gray-500 */
		border: none;
		cursor: pointer;
		transition: background 120ms ease, color 120ms ease;
	}
	.ptf-compact:hover:not(:disabled) {
		color: #60a5fa; /* blue-400 */
		background: rgba(96, 165, 250, 0.08);
	}
	.ptf-compact:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.ptf-compact--published:not(:disabled) {
		color: #4ade80; /* green-400 */
	}
	.ptf-compact--busy {
		color: #60a5fa;
	}

	/* Big split button (modal footer) */
	.ptf-split {
		display: inline-flex;
		align-items: stretch;
		border: 1px solid rgba(168, 85, 247, 0.3);
		border-radius: 0.375rem;
		overflow: hidden;
		background: rgba(168, 85, 247, 0.1);
	}
	.ptf-split--disabled {
		opacity: 0.5;
	}
	.ptf-primary,
	.ptf-chevron {
		background: transparent;
		border: none;
		color: #c084fc; /* purple-400 */
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		transition: background 120ms ease;
	}
	.ptf-primary {
		padding: 0.5rem 1rem;
	}
	.ptf-chevron {
		padding: 0.5rem 0.625rem;
		border-left: 1px solid rgba(168, 85, 247, 0.3);
	}
	.ptf-primary:hover:not(:disabled),
	.ptf-chevron:hover:not(:disabled) {
		background: rgba(168, 85, 247, 0.2);
	}
	.ptf-primary:disabled,
	.ptf-chevron:disabled {
		cursor: not-allowed;
	}

	.ptf-spin {
		animation: ptf-rotate 1s linear infinite;
	}
	@keyframes ptf-rotate {
		from { transform: rotate(0deg); }
		to   { transform: rotate(360deg); }
	}

	/* Popover — positioned via inline `popoverStyle` (position: fixed) so it
	   escapes ancestor `overflow: hidden`. Width/appearance live here; viewport
	   coords come from repositionPopover(). */
	.ptf-popover {
		min-width: 240px;
		max-width: 320px;
		max-height: min(60vh, 400px);
		overflow-y: auto;
		background: var(--color-bg-secondary); /* gray-800 */
		border: 1px solid var(--color-bg-tertiary); /* gray-700 */
		border-radius: 0.5rem;
		box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
		padding: 0.375rem;
		z-index: 60;
	}
	.ptf-popover__title {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		padding: 0.375rem 0.625rem 0.5rem;
	}
	.ptf-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		width: 100%;
		padding: 0.5rem 0.625rem;
		background: transparent;
		border: none;
		color: var(--color-text-secondary);
		font-size: 0.875rem;
		text-align: left;
		border-radius: 0.375rem;
		cursor: pointer;
		transition: background 100ms ease;
	}
	.ptf-row:hover {
		background: var(--color-bg-tertiary);
	}
	.ptf-row__icon {
		display: inline-flex;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}
	.ptf-row__label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ptf-divider {
		height: 1px;
		background: var(--color-bg-tertiary);
		margin: 0.25rem 0.25rem;
	}
	.ptf-empty {
		padding: 0.625rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		text-align: center;
	}
	.ptf-empty__hint {
		display: inline-block;
		margin-top: 0.25rem;
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}

	.ptf-toggle-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.625rem;
		margin-top: 0.125rem;
		cursor: pointer;
		border-radius: 0.375rem;
	}
	.ptf-toggle-row:hover {
		background: var(--color-bg-tertiary, rgba(255, 255, 255, 0.05));
	}
	.ptf-toggle-row input {
		flex-shrink: 0;
	}
	.ptf-toggle-row__label {
		font-size: 0.8125rem;
		color: var(--color-text-secondary, var(--color-text-secondary));
	}

	.ptf-upcast {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--color-border, var(--color-bg-tertiary));
		border-radius: 0.5rem;
		background: var(--color-bg-primary, rgba(0, 0, 0, 0.15));
		cursor: pointer;
	}
	.ptf-upcast input {
		margin-top: 0.15rem;
		flex-shrink: 0;
	}
	.ptf-upcast__text {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}
	.ptf-upcast__title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-primary, #fff);
	}
	.ptf-upcast__hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.ptf-status {
		margin-top: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
		font-size: 0.8125rem;
	}
	.ptf-status--success {
		color: #4ade80;
		background: rgba(74, 222, 128, 0.1);
		border: 1px solid rgba(74, 222, 128, 0.3);
	}
	.ptf-status--error {
		color: #f87171;
		background: rgba(248, 113, 113, 0.1);
		border: 1px solid rgba(248, 113, 113, 0.3);
	}
	.ptf-status--publishing {
		color: #60a5fa;
		background: rgba(96, 165, 250, 0.1);
		border: 1px solid rgba(96, 165, 250, 0.3);
	}
	.ptf-status--idle {
		display: none;
	}
</style>
