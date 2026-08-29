<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors -->
<script lang="ts">
	// Bring-your-own Nostr key: paste an nsec (or hex), or create a fresh one
	// with a one-time backup step. Emits `login` with a ProviderLogin.
	import { createEventDispatcher } from 'svelte';
	import { fade } from 'svelte/transition';
	import { importNostrKey, generateNostrKey, previewNostrKey } from '$lib/auth/nostrKey';
	import type { ProviderLogin } from '$lib/auth/types';

	const dispatch = createEventDispatcher<{ login: ProviderLogin; back: void }>();

	type Tab = 'import' | 'create';
	let tab: Tab = 'import';

	// Import
	let input = '';
	let showInput = false;
	$: preview = input.trim() ? previewNostrKey(input) : null;
	$: importInvalid = input.trim().length > 0 && !preview;

	function submitImport() {
		try {
			dispatch('login', importNostrKey(input));
		} catch (e) {
			error = (e as Error).message;
		}
	}

	// Create
	let fresh: ReturnType<typeof generateNostrKey> | null = null;
	let saved = false;
	let copied = false;
	let error = '';

	function selectCreate() {
		tab = 'create';
		error = '';
		if (!fresh) fresh = generateNostrKey();
	}
	async function copyNsec() {
		if (!fresh) return;
		try {
			await navigator.clipboard.writeText(fresh.nsec);
			copied = true;
			setTimeout(() => (copied = false), 1800);
		} catch {
			error = 'Copy failed — select the key and copy it manually.';
		}
	}
	function submitCreate() {
		if (fresh && saved) dispatch('login', fresh);
	}
</script>

<div class="sheet" in:fade={{ duration: 200 }}>
	<div class="sheet__head">
		<button class="back" type="button" on:click={() => dispatch('back')} aria-label="Back to sign-in options">
			<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 4l-6 6 6 6" /></svg>
		</button>
		<div class="tabs" role="tablist">
			<button role="tab" aria-selected={tab === 'import'} class:active={tab === 'import'} on:click={() => { tab = 'import'; error = ''; }}>Import key</button>
			<button role="tab" aria-selected={tab === 'create'} class:active={tab === 'create'} on:click={selectCreate}>Create new</button>
		</div>
	</div>

	{#if tab === 'import'}
		<label class="field">
			<span class="field__label">Your nsec or hex secret key</span>
			<span class="field__row">
				{#if showInput}
					<input type="text" bind:value={input} placeholder="nsec1…" autocomplete="off" spellcheck="false" />
				{:else}
					<input type="password" bind:value={input} placeholder="nsec1…" autocomplete="off" />
				{/if}
				<button type="button" class="eye" on:click={() => (showInput = !showInput)} aria-label={showInput ? 'Hide key' : 'Show key'}>
					{showInput ? 'Hide' : 'Show'}
				</button>
			</span>
		</label>
		{#if preview}
			<p class="preview" transition:fade={{ duration: 150 }}>Signs in as <code>{preview.npub.slice(0, 12)}…{preview.npub.slice(-6)}</code></p>
		{:else if importInvalid}
			<p class="preview preview--bad">Not a valid nsec or 64-character hex key</p>
		{/if}
		<p class="note">Your key stays on this device. It is never sent to a server.</p>
		<button class="primary" type="button" disabled={!preview} on:click={submitImport}>Continue</button>
	{:else if fresh}
		<p class="warn">
			<strong>Save this key now.</strong> It is the only way back into this holon — there is no reset.
		</p>
		<div class="keybox">
			<code>{fresh.nsec}</code>
			<button type="button" class="copy" on:click={copyNsec}>{copied ? 'Copied' : 'Copy'}</button>
		</div>
		<label class="check">
			<input type="checkbox" bind:checked={saved} />
			<span>I've saved my key somewhere safe</span>
		</label>
		<button class="primary" type="button" disabled={!saved} on:click={submitCreate}>Continue</button>
	{/if}

	{#if error}
		<p class="error" transition:fade>{error}</p>
	{/if}
</div>

<style>
	.sheet {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		text-align: left;
	}
	.sheet__head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.back {
		display: inline-flex;
		width: 2rem;
		height: 2rem;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
	}
	.back svg {
		width: 1rem;
		height: 1rem;
	}
	.back:hover {
		color: var(--color-text-primary);
		border-color: var(--color-border-light);
	}
	.tabs {
		flex: 1;
		display: grid;
		grid-template-columns: 1fr 1fr;
		background: color-mix(in srgb, var(--color-bg-tertiary) 45%, transparent);
		border-radius: 0.625rem;
		padding: 0.1875rem;
	}
	.tabs button {
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		font-weight: 600;
		font-size: 0.8125rem;
		padding: 0.4375rem 0;
		border-radius: 0.5rem;
		cursor: pointer;
	}
	.tabs button.active {
		background: var(--color-bg-secondary);
		color: var(--color-text-primary);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.field__label {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}
	.field__row {
		display: flex;
		gap: 0.375rem;
	}
	input[type='text'],
	input[type='password'] {
		flex: 1;
		min-width: 0;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		background: var(--color-bg-primary);
		color: var(--color-text-primary);
		font-family: var(--font-family-mono);
		font-size: 0.8125rem;
	}
	input:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px var(--color-accent-subtle);
	}
	.eye,
	.copy {
		padding: 0 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
	}
	.eye:hover,
	.copy:hover {
		color: var(--color-text-primary);
	}
	.preview {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-success);
	}
	.preview code {
		font-family: var(--font-family-mono);
	}
	.preview--bad {
		color: var(--color-error);
	}
	.note {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
	.warn {
		margin: 0;
		padding: 0.625rem 0.75rem;
		border-radius: 0.5rem;
		background: var(--color-warning-bg);
		border: 1px solid color-mix(in srgb, var(--color-warning) 40%, transparent);
		color: var(--color-text-secondary);
		font-size: 0.8125rem;
	}
	.keybox {
		display: flex;
		gap: 0.375rem;
		align-items: stretch;
	}
	.keybox code {
		flex: 1;
		min-width: 0;
		padding: 0.625rem 0.75rem;
		border-radius: 0.5rem;
		background: var(--color-bg-primary);
		border: 1px solid var(--color-border);
		font-family: var(--font-family-mono);
		font-size: 0.75rem;
		word-break: break-all;
		color: var(--color-text-primary);
		user-select: all;
	}
	.check {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		cursor: pointer;
	}
	.check input {
		accent-color: var(--color-accent);
	}
	.primary {
		width: 100%;
		padding: 0.75rem 1rem;
		border: none;
		border-radius: 0.625rem;
		background: var(--color-accent);
		color: #fff;
		font-weight: 600;
		font-size: 0.9375rem;
		cursor: pointer;
		transition: background 0.15s ease, opacity 0.15s ease;
	}
	.primary:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}
	.primary:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.error {
		margin: 0;
		color: #f87171;
		font-size: 0.8125rem;
	}
</style>
