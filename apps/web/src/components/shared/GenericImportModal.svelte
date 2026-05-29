<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import Modal from './Modal.svelte';

	export let open: boolean = false;
	export let title: string = 'Import';
	export let itemNoun: string = 'items';
	// Optional helper text shown above the textarea (e.g. expected schema sample).
	export let helpText: string = '';
	// Optional concrete JSON example showing the expected fields. Rendered as a
	// collapsible block plus a "Use sample" button that fills the paste area.
	export let sampleJson: string = '';
	// Optional accept hint for file picker.
	export let accept: string = '.json';

	const dispatch = createEventDispatcher<{
		import: any[];
		close: void;
	}>();

	let mode: 'paste' | 'file' = 'paste';
	let pasted: string = '';
	let fileName: string = '';
	let parsed: any[] = [];
	let errorMessage: string = '';
	let isDragOver = false;

	$: if (!open) {
		// Reset when closed.
		pasted = '';
		fileName = '';
		parsed = [];
		errorMessage = '';
		mode = 'paste';
		isDragOver = false;
	}

	function extractArray(data: any): any[] {
		if (Array.isArray(data)) return data;
		if (data && typeof data === 'object') {
			// Common wrappers.
			for (const key of ['items', 'data', 'records', 'rows', 'entries']) {
				if (Array.isArray(data[key])) return data[key];
			}
			// Object map keyed by id.
			const values = Object.values(data);
			if (values.length > 0 && values.every(v => v && typeof v === 'object')) {
				return values as any[];
			}
		}
		return [];
	}

	function parseText(text: string): any[] {
		const trimmed = text.trim();
		if (!trimmed) return [];
		try {
			const data = JSON.parse(trimmed);
			const arr = extractArray(data);
			if (arr.length === 0) {
				throw new Error('No items found in the JSON.');
			}
			return arr;
		} catch (jsonErr) {
			// Fall back to one item per non-empty line.
			const lines = trimmed
				.split('\n')
				.map(l => l.trim())
				.filter(Boolean);
			if (lines.length === 0) {
				throw new Error('Could not parse content.');
			}
			return lines.map(line => ({ text: line, title: line, name: line, description: line }));
		}
	}

	function handleParse() {
		errorMessage = '';
		try {
			parsed = parseText(pasted);
		} catch (err: any) {
			parsed = [];
			errorMessage = err?.message ?? 'Could not parse content.';
		}
	}

	async function handleFile(file: File) {
		errorMessage = '';
		fileName = file.name;
		try {
			const text = await file.text();
			pasted = text;
			parsed = parseText(text);
		} catch (err: any) {
			parsed = [];
			errorMessage = err?.message ?? 'Could not read file.';
		}
	}

	function handleFileInput(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files[0]) {
			handleFile(target.files[0]);
		}
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		isDragOver = true;
	}

	function handleDragLeave(event: DragEvent) {
		event.preventDefault();
		isDragOver = false;
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		isDragOver = false;
		if (event.dataTransfer?.files && event.dataTransfer.files[0]) {
			handleFile(event.dataTransfer.files[0]);
		}
	}

	function previewLabel(item: any, index: number): string {
		if (!item || typeof item !== 'object') return String(item);
		return (
			item.title ??
			item.name ??
			item.description ??
			item.text ??
			item.id ??
			`Item ${index + 1}`
		);
	}

	function handleImport() {
		if (parsed.length === 0) {
			errorMessage = `No ${itemNoun} to import.`;
			return;
		}
		dispatch('import', parsed);
	}

	function handleClose() {
		dispatch('close');
	}

	function useSample() {
		if (!sampleJson) return;
		pasted = sampleJson;
		mode = 'paste';
		handleParse();
	}
</script>

<Modal {open} {title} size="lg" on:close={handleClose}>
	<div class="import-tabs">
		<button
			type="button"
			class="import-tabs__btn"
			class:import-tabs__btn--active={mode === 'paste'}
			on:click={() => (mode = 'paste')}
		>
			Paste
		</button>
		<button
			type="button"
			class="import-tabs__btn"
			class:import-tabs__btn--active={mode === 'file'}
			on:click={() => (mode = 'file')}
		>
			File
		</button>
	</div>

	{#if helpText}
		<p class="import-help">{helpText}</p>
	{/if}

	{#if sampleJson}
		<details class="import-sample">
			<summary class="import-sample__summary">
				Example JSON
				<button type="button" class="import-sample__use" on:click|stopPropagation|preventDefault={useSample}>
					Use sample
				</button>
			</summary>
			<pre class="import-sample__code">{sampleJson}</pre>
		</details>
	{/if}

	{#if mode === 'paste'}
		<textarea
			class="import-textarea"
			placeholder={`Paste JSON array, JSON object, or one ${itemNoun.replace(/s$/, '')} per line…`}
			bind:value={pasted}
			on:blur={handleParse}
		></textarea>
		<div class="import-actions-row">
			<button type="button" class="btn btn--secondary" on:click={handleParse}>
				Parse
			</button>
			<span class="import-count">
				{parsed.length}
				{parsed.length === 1 ? itemNoun.replace(/s$/, '') : itemNoun} ready
			</span>
		</div>
	{:else}
		<label
			class="import-dropzone"
			class:import-dropzone--over={isDragOver}
			on:dragover={handleDragOver}
			on:dragleave={handleDragLeave}
			on:drop={handleDrop}
		>
			<input type="file" {accept} on:change={handleFileInput} />
			<span class="import-dropzone__text">
				{fileName ? fileName : `Drop a file here or click to choose (${accept})`}
			</span>
		</label>
		{#if parsed.length > 0}
			<p class="import-count">
				{parsed.length}
				{parsed.length === 1 ? itemNoun.replace(/s$/, '') : itemNoun} ready
			</p>
		{/if}
	{/if}

	{#if errorMessage}
		<p class="import-error">{errorMessage}</p>
	{/if}

	{#if parsed.length > 0}
		<div class="import-preview">
			<h4 class="import-preview__title">Preview</h4>
			<ul class="import-preview__list">
				{#each parsed.slice(0, 8) as item, i}
					<li class="import-preview__item">{previewLabel(item, i)}</li>
				{/each}
				{#if parsed.length > 8}
					<li class="import-preview__more">…and {parsed.length - 8} more</li>
				{/if}
			</ul>
		</div>
	{/if}

	<svelte:fragment slot="footer">
		<button type="button" class="btn btn--secondary" on:click={handleClose}>Cancel</button>
		<button
			type="button"
			class="btn btn--primary"
			disabled={parsed.length === 0}
			on:click={handleImport}
		>
			Import {parsed.length || ''}
		</button>
	</svelte:fragment>
</Modal>

<style>
	.import-tabs {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		padding: 0.25rem;
		background: var(--color-bg-primary);
		border-radius: 0.5rem;
		margin-bottom: 0.75rem;
		max-width: 100%;
	}

	.import-tabs__btn {
		padding: 0.375rem 0.875rem;
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		font-size: 0.875rem;
		font-weight: 500;
		border-radius: 0.375rem;
		cursor: pointer;
		transition: background 150ms ease, color 150ms ease;
	}

	.import-tabs__btn--active {
		background: var(--color-bg-tertiary);
		color: var(--color-text-primary);
	}

	.import-help {
		color: var(--color-text-muted);
		font-size: 0.8125rem;
		margin: 0 0 0.5rem;
		word-break: break-word;
	}

	.import-sample {
		margin: 0 0 0.625rem;
		background: var(--color-bg-primary);
		border: 1px solid var(--color-bg-tertiary);
		border-radius: 0.5rem;
		overflow: hidden;
	}

	.import-sample__summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		cursor: pointer;
		list-style: none;
	}

	.import-sample__summary::-webkit-details-marker {
		display: none;
	}

	.import-sample__summary::before {
		content: '▸';
		color: var(--color-text-muted);
		font-size: 0.75rem;
		transition: transform 150ms ease;
	}

	.import-sample[open] .import-sample__summary::before {
		transform: rotate(90deg);
		display: inline-block;
	}

	.import-sample__use {
		margin-left: auto;
		padding: 0.25rem 0.625rem;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-light);
		border-radius: 0.375rem;
		color: var(--color-text-secondary);
		font-size: 0.75rem;
		cursor: pointer;
	}

	.import-sample__use:hover {
		background: var(--color-border-light);
	}

	.import-sample__code {
		margin: 0;
		padding: 0.625rem 0.75rem;
		background: #0b1220;
		color: var(--color-text-secondary);
		font-family: ui-monospace, SFMono-Regular, monospace;
		font-size: 0.75rem;
		line-height: 1.45;
		white-space: pre;
		overflow-x: auto;
		border-top: 1px solid var(--color-bg-tertiary);
	}

	.import-textarea {
		width: 100%;
		min-height: 10rem;
		padding: 0.625rem 0.75rem;
		background: var(--color-bg-primary);
		border: 1px solid var(--color-bg-tertiary);
		border-radius: 0.5rem;
		color: var(--color-text-secondary);
		font-family: ui-monospace, SFMono-Regular, monospace;
		font-size: 0.8125rem;
		resize: vertical;
		box-sizing: border-box;
	}

	.import-textarea:focus {
		outline: none;
		border-color: #3b82f6;
	}

	.import-actions-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.5rem;
	}

	.import-count {
		color: var(--color-text-muted);
		font-size: 0.8125rem;
	}

	.import-dropzone {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 7rem;
		padding: 1rem;
		background: var(--color-bg-primary);
		border: 2px dashed var(--color-bg-tertiary);
		border-radius: 0.5rem;
		color: var(--color-text-muted);
		text-align: center;
		cursor: pointer;
		transition: border-color 150ms ease, background 150ms ease;
		word-break: break-word;
	}

	.import-dropzone--over {
		border-color: #3b82f6;
		background: rgba(59, 130, 246, 0.08);
	}

	.import-dropzone input[type='file'] {
		display: none;
	}

	.import-dropzone__text {
		font-size: 0.875rem;
	}

	.import-error {
		color: #f87171;
		background: rgba(248, 113, 113, 0.1);
		border: 1px solid rgba(248, 113, 113, 0.3);
		padding: 0.5rem 0.75rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		margin-top: 0.75rem;
	}

	.import-preview {
		margin-top: 0.75rem;
		padding: 0.625rem 0.75rem;
		background: var(--color-bg-primary);
		border: 1px solid var(--color-bg-tertiary);
		border-radius: 0.5rem;
	}

	.import-preview__title {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		margin: 0 0 0.375rem;
	}

	.import-preview__list {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 8rem;
		overflow-y: auto;
	}

	.import-preview__item {
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		padding: 0.125rem 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.import-preview__more {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		padding-top: 0.25rem;
		font-style: italic;
	}
</style>
