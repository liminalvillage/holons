<script lang="ts">
	// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// Consent dialog for publishing a shopping-list item as a geolocated need
	// (see @holons/core/needs). Nothing leaves the holon until the user
	// confirms; the public-map option is only offered when the holon has a
	// valid hex address in Settings.

	import { createEventDispatcher, getContext } from 'svelte';
	import type { HoloSphere } from 'holosphere';
	import Modal from './Modal.svelte';
	import { getFederationSnapshot, readSettingsHex } from '$lib/holosphere/publish';

	export let open: boolean = false;
	export let holonId: string = '';
	export let itemText: string = '';
	/** External busy/status display while the parent runs the publish. */
	export let busy: boolean = false;
	export let status: string = '';

	const holosphere = getContext('holosphere') as HoloSphere | undefined;
	const dispatch = createEventDispatcher<{
		share: { toPartners: boolean; toHex: boolean };
		close: void;
	}>();

	let toPartners = true;
	let toHex = false;
	let settingsHex: string | null = null;
	let partnerCount = 0;
	let loaded = false;

	$: if (open && !loaded) loadTargets();
	$: if (!open) {
		loaded = false;
		toPartners = true;
		toHex = false;
	}

	async function loadTargets() {
		loaded = true;
		settingsHex = null;
		partnerCount = 0;
		if (!holosphere || !holonId) return;
		try {
			const [hex, snap] = await Promise.all([
				readSettingsHex(holosphere, holonId),
				getFederationSnapshot(holosphere, holonId)
			]);
			settingsHex = hex;
			partnerCount = snap.federated.length;
		} catch (err) {
			console.warn('[ShareNeedModal] Failed to load publish targets', err);
		}
	}

	function confirm() {
		if (!toPartners && !toHex) return;
		dispatch('share', { toPartners, toHex });
	}
</script>

<Modal {open} title="Share as need nearby" size="sm" on:close={() => dispatch('close')}>
	<div class="space-y-4">
		<p class="text-sm text-gray-300">
			Publish <span class="font-semibold text-white">“{itemText}”</span> as a need —
			a commitment to buy at market price that nearby providers can respond to.
		</p>

		<label class="share-option" class:share-option--active={toPartners}>
			<input type="checkbox" bind:checked={toPartners} class="share-option__check" />
			<span class="share-option__body">
				<span class="share-option__title">Federation partners</span>
				<span class="share-option__hint">
					{partnerCount > 0
						? `Visible to ${partnerCount} federated holon${partnerCount === 1 ? '' : 's'}`
						: 'No partners federated yet — nothing will be sent'}
				</span>
			</span>
		</label>

		<label
			class="share-option"
			class:share-option--active={toHex}
			class:share-option--disabled={!settingsHex}
		>
			<input
				type="checkbox"
				bind:checked={toHex}
				disabled={!settingsHex}
				class="share-option__check"
			/>
			<span class="share-option__body">
				<span class="share-option__title">Public map (your hex)</span>
				<span class="share-option__hint">
					{settingsHex
						? `Lights the “Local Needs” layer at ${settingsHex.slice(0, 10)}…`
						: 'Set your hex address in Settings to enable'}
				</span>
			</span>
		</label>

		{#if status}
			<p class="text-xs text-gray-400">{status}</p>
		{/if}

		<div class="flex justify-end gap-3 pt-2">
			<button type="button" class="btn btn--secondary" on:click={() => dispatch('close')} disabled={busy}>
				Cancel
			</button>
			<button
				type="button"
				class="btn btn--primary"
				on:click={confirm}
				disabled={busy || (!toPartners && !toHex)}
			>
				{busy ? 'Publishing…' : 'Share need'}
			</button>
		</div>
	</div>
</Modal>

<style>
	.share-option {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.75rem;
		border-radius: 0.75rem;
		border: 1px solid var(--color-bg-tertiary, #374151);
		background: var(--color-bg-primary, #111827);
		cursor: pointer;
		transition: border-color 150ms ease;
	}
	.share-option--active {
		border-color: var(--color-accent, #6366f1);
	}
	.share-option--disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.share-option__check {
		margin-top: 0.2rem;
		width: 1rem;
		height: 1rem;
		accent-color: #6366f1;
	}
	.share-option__body {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.share-option__title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-primary, #f9fafb);
	}
	.share-option__hint {
		font-size: 0.75rem;
		color: var(--color-text-muted, #9ca3af);
	}
</style>
