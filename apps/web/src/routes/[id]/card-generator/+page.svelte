<script lang="ts">
	import { page } from '$app/stores';
	import { getContext } from 'svelte';
	import type { HoloSphere } from 'holosphere';
	import { parseCSV, generateSampleCSV } from '$lib/card-generator/csv-parser';
	import { generatePDF, downloadPDF, buildQRUrl, generateQRDataUrl, generateQRZip, downloadZip } from '$lib/card-generator/pdf-generator';
	import { renderCardFront, renderCardBack, renderCardBackPlaceholder, CARD_WIDTH_PX, CARD_HEIGHT_PX } from '$lib/card-generator/CardRenderer';
	import type { Card, CardType, DeckConfig, CardStyle } from '$lib/card-generator/types';
	import { CARD_TYPE_COLORS, DEFAULT_CARD_STYLE, FONT_OPTIONS } from '$lib/card-generator/types';
	import { registerDeck } from '$lib/deck-registry';
	import { nostrPrivateKey } from '$lib/stores/nostr';
	import { createQRCapability, createCapabilitiesForCards, getLensForAction } from '$lib/capabilities/qrCapability';
	import type { QRCapabilityToken, CapabilityExpiration } from '$lib/capabilities/qrCapability';
	import { loadCardsFromHolon, HOLON_SOURCES } from '$lib/card-generator/holon-source';
	import type { HolonSource } from '$lib/card-generator/holon-source';

	// Get holosphere context at component initialization (required by Svelte)
	const holosphere = getContext<HoloSphere>('holosphere');

	$: holonId = $page.params.id || '';

	// Generate unique deck ID based on timestamp
	function generateDeckId(): string {
		const now = new Date();
		const timestamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
		return `deck-${timestamp}`;
	}

	// State
	let qrBaseUrl = import.meta.env.VITE_QR_BASE_URL || 'https://dashboard.holons.io/qr';
	let capExpiration: CapabilityExpiration = 'permanent';
	let deckId = generateDeckId();
	let csvFile: File | null = null;
	let backgroundImageUrl: string | null = null;
	let foregroundImageUrl: string | null = null;
	let cards: Card[] = [];
	let parseErrors: string[] = [];
	let isGenerating = false;
	let progress = { current: 0, total: 0 };
	let pdfBlob: Blob | null = null;
	let isDragOver = false;
	let previewCardIndex = 0;
	let previewSide: 'front' | 'back' = 'front';

	// Input source: load the holon's current items, upload a CSV, or enter manually
	let inputMode: 'holon' | 'csv' | 'manual' = 'holon';

	// Load-from-holon state
	let holonSource: HolonSource = 'tasks';
	let isLoadingHolon = false;
	let holonLoadError = '';

	// Manual input state
	let manualTitle = '';
	let manualType: CardType = 'task';
	let manualDescription = '';
	let manualImageUrl = '';
	let nextManualId = 1;

	// Card style configuration
	let cardStyle: CardStyle = JSON.parse(JSON.stringify(DEFAULT_CARD_STYLE));

	// Preview state
	let previewQRDataUrl: string | null = null;

	// Generate a capability token for a card using the selected expiration
	function createCardCapability(card: Card, privKey: string | null): QRCapabilityToken | undefined {
		if (!privKey || !holonId) return undefined;
		try {
			const lens = getLensForAction(card.type);
			if (!lens) return undefined;
			return createQRCapability({
				holonId,
				issuerPrivateKey: privKey,
				allowedLenses: [lens],
				allowedActions: [card.type.toLowerCase()],
				itemId: card.title,
				expiration: capExpiration,
				metadata: { deckId, cardId: card.id, cardTitle: card.title, cardType: card.type }
			});
		} catch (e) {
			console.warn('[Card Generator] Failed to create capability:', e);
			return undefined;
		}
	}

	// Generate QR code for preview when card or config changes
	async function updatePreviewQR(privKey: string | null) {
		if (!previewCard || !deckId) {
			previewQRDataUrl = null;
			return;
		}
		const config: DeckConfig = { deckId, holonId, qrBaseUrl, cardStyle };
		const cap = createCardCapability(previewCard, privKey);
		const qrUrl = buildQRUrl(previewCard, config, cap);
		const useTransparentQR = cardStyle.qrCode.transparentBackground;
		previewQRDataUrl = await generateQRDataUrl(qrUrl, useTransparentQR);
	}

	// Reactive: regenerate QR when preview card, deck, base URL, key, expiration, or QR transparency changes
	$: if (previewCard && deckId && qrBaseUrl && cardStyle.qrCode.transparentBackground !== undefined) {
		// Reference these so Svelte tracks them as dependencies
		$nostrPrivateKey;
		capExpiration;
		updatePreviewQR($nostrPrivateKey);
	}

	// Reactive: compute the QR target URL for the clickable test link (with capability)
	$: previewQRTargetUrl = previewCard
		? buildQRUrl(previewCard, { deckId, holonId, qrBaseUrl, cardStyle }, createCardCapability(previewCard, $nostrPrivateKey))
		: '';

	// Reactive: generate preview HTML
	$: previewFrontHTML = previewCard
		? renderCardFront(previewCard, cardStyle, foregroundImageUrl || undefined)
		: '';

	$: previewBackHTML = previewQRDataUrl
		? renderCardBack(previewQRDataUrl, cardStyle, backgroundImageUrl || undefined)
		: renderCardBackPlaceholder(cardStyle, backgroundImageUrl || undefined);

	function handleCSVDrop(event: DragEvent) {
		event.preventDefault();
		isDragOver = false;
		const file = event.dataTransfer?.files[0];
		if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) {
			csvFile = file;
			parseCSVFile();
		}
	}

	function handleCSVSelect(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files?.[0]) {
			csvFile = target.files[0];
			parseCSVFile();
		}
	}

	async function parseCSVFile() {
		if (!csvFile) return;
		const text = await csvFile.text();
		const result = parseCSV(text);
		cards = result.cards;
		parseErrors = result.errors;
		pdfBlob = null;
	}

	function handleImageSelect(type: 'background' | 'foreground') {
		return (event: Event) => {
			const target = event.target as HTMLInputElement;
			const file = target.files?.[0];
			if (!file) return;
			const url = URL.createObjectURL(file);
			if (type === 'background') {
				if (backgroundImageUrl) URL.revokeObjectURL(backgroundImageUrl);
				backgroundImageUrl = url;
			} else {
				if (foregroundImageUrl) URL.revokeObjectURL(foregroundImageUrl);
				foregroundImageUrl = url;
			}
			pdfBlob = null;
		};
	}

	function clearImage(type: 'background' | 'foreground') {
		if (type === 'background') {
			if (backgroundImageUrl) URL.revokeObjectURL(backgroundImageUrl);
			backgroundImageUrl = null;
		} else {
			if (foregroundImageUrl) URL.revokeObjectURL(foregroundImageUrl);
			foregroundImageUrl = null;
		}
		pdfBlob = null;
	}

	function downloadSampleCSV() {
		const csv = generateSampleCSV();
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'sample-cards.csv';
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	}

	function addManualCard() {
		if (!manualTitle.trim() || !manualDescription.trim()) return;
		const card: Card = {
			id: `manual-${nextManualId++}`,
			title: manualTitle.trim(),
			type: manualType,
			description: manualDescription.trim(),
			imageUrl: manualImageUrl.trim() || undefined
		};
		cards = [...cards, card];
		manualTitle = '';
		manualDescription = '';
		manualImageUrl = '';
		pdfBlob = null;
	}

	function removeCard(index: number) {
		cards = cards.filter((_, i) => i !== index);
		if (previewCardIndex >= cards.length) {
			previewCardIndex = Math.max(0, cards.length - 1);
		}
		pdfBlob = null;
	}

	function switchInputMode(mode: 'holon' | 'csv' | 'manual') {
		if (mode === inputMode) return;
		inputMode = mode;
		if (mode !== 'csv') {
			csvFile = null;
		}
		cards = [];
		parseErrors = [];
		holonLoadError = '';
		pdfBlob = null;
		previewCardIndex = 0;
	}

	async function loadFromHolon() {
		if (!holosphere || !holonId || isLoadingHolon) return;
		isLoadingHolon = true;
		holonLoadError = '';
		try {
			const loaded = await loadCardsFromHolon(holosphere, holonId, holonSource);
			cards = loaded;
			previewCardIndex = 0;
			pdfBlob = null;
			if (loaded.length === 0) {
				holonLoadError = `No ${holonSource} found in this holon yet.`;
			}
		} catch (err) {
			console.error('[Card Generator] Failed to load from holon:', err);
			holonLoadError = `Failed to load ${holonSource}: ${err instanceof Error ? err.message : 'Unknown error'}`;
		} finally {
			isLoadingHolon = false;
		}
	}

	async function handleGeneratePDF() {
		if (cards.length === 0 || !deckId || isGenerating) return;
		isGenerating = true;
		progress = { current: 0, total: cards.length };

		try {
			const config: DeckConfig = {
				deckId,
				holonId,
				qrBaseUrl,
				backgroundImage: backgroundImageUrl || undefined,
				foregroundImage: foregroundImageUrl || undefined,
				cardStyle
			};

			// Register deck in global registry before generating PDF
			if (holosphere) {
				try {
					await registerDeck(holosphere, deckId, holonId, csvFile?.name);
					console.log(`[Card Generator] Registered deck ${deckId} for holon ${holonId}`);
				} catch (err) {
					console.warn('[Card Generator] Failed to register deck:', err);
					// Continue with PDF generation even if registration fails
				}
			}

			// Generate capability tokens for all cards
			let capabilities: Map<string, QRCapabilityToken> | undefined;
			if ($nostrPrivateKey) {
				capabilities = createCapabilitiesForCards(cards, holonId, $nostrPrivateKey, capExpiration, deckId);
				console.log(`[Card Generator] Generated ${capabilities.size} capabilities for PDF`);
			} else {
				console.warn('[Card Generator] No private key available — QR codes will have no capability tokens');
			}

			pdfBlob = await generatePDF({
				cards,
				config,
				capabilities,
				onProgress: (current: number, total: number) => {
					progress = { current, total };
				}
			});
		} catch (error) {
			console.error('PDF generation failed:', error);
			parseErrors = [`PDF generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`];
		} finally {
			isGenerating = false;
		}
	}

	function handleDownloadPDF() {
		if (!pdfBlob) return;
		downloadPDF(pdfBlob, `${deckId}-cards.pdf`);
	}

	let isGeneratingQRZip = false;
	let qrZipProgress = { current: 0, total: 0 };

	async function handleDownloadQRZip() {
		if (cards.length === 0 || !deckId || isGeneratingQRZip) return;
		isGeneratingQRZip = true;
		qrZipProgress = { current: 0, total: cards.length };

		try {
			const config = { deckId, holonId, qrBaseUrl, cardStyle };

			// Generate capability tokens for all cards
			let capabilities: Map<string, QRCapabilityToken> | undefined;
			if ($nostrPrivateKey) {
				capabilities = createCapabilitiesForCards(cards, holonId, $nostrPrivateKey, capExpiration, deckId);
				console.log(`[Card Generator] Generated ${capabilities.size} capabilities for QR zip`);
			} else {
				console.warn('[Card Generator] No private key available — QR codes will have no capability tokens');
			}

			const zipBlob = await generateQRZip({
				cards,
				config,
				capabilities,
				onProgress: (current: number, total: number) => {
					qrZipProgress = { current, total };
				}
			});
			downloadZip(zipBlob, `${deckId}-qrcodes.zip`);
		} catch (error) {
			console.error('QR zip generation failed:', error);
			parseErrors = [`QR zip generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`];
		} finally {
			isGeneratingQRZip = false;
		}
	}

	function nextPreviewCard() {
		if (previewCardIndex < cards.length - 1) previewCardIndex++;
	}

	function prevPreviewCard() {
		if (previewCardIndex > 0) previewCardIndex--;
	}

	function togglePreviewSide() {
		previewSide = previewSide === 'front' ? 'back' : 'front';
	}

	function resetStyles() {
		cardStyle = JSON.parse(JSON.stringify(DEFAULT_CARD_STYLE));
	}

	$: previewCard = cards[previewCardIndex] || null;
	$: canGenerate = cards.length > 0 && deckId.trim() !== '' && holonId !== '';
	$: progressPercent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
</script>

<svelte:head>
	<title>Card Generator | Holons</title>
</svelte:head>

<div class="min-h-screen bg-gray-900 text-white p-6">
	<div class="max-w-7xl mx-auto">
		<div class="mb-6">
			<h1 class="text-3xl font-bold mb-2">Card Generator</h1>
			<p class="text-gray-400">Generate printable card decks with QR codes</p>
		</div>

		<!-- Row 1: Settings (full width, horizontal) -->
		<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
			<!-- Deck Config -->
			<div class="bg-gray-800 rounded-xl p-4 border border-gray-700">
				<h2 class="text-lg font-semibold mb-3">Deck Config</h2>
				<div class="space-y-3">
					<div>
						<label for="holon-id" class="block text-sm text-gray-300 mb-1">Holon ID</label>
						<input id="holon-id" type="text" value={holonId} disabled class="w-full px-3 py-2 rounded-lg bg-gray-700 text-gray-400 border border-gray-600 text-sm" />
					</div>
					<div>
						<label for="deck-id" class="block text-sm text-gray-300 mb-1">Deck ID</label>
						<input id="deck-id" type="text" bind:value={deckId} placeholder="Auto-generated" class="w-full px-3 py-2 rounded-lg bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none text-sm" />
					</div>
					<div>
						<label for="qr-base-url" class="block text-sm text-gray-300 mb-1">QR Base URL</label>
						<input id="qr-base-url" type="text" bind:value={qrBaseUrl} placeholder="https://example.com/qr" class="w-full px-3 py-2 rounded-lg bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none text-sm" />
						<p class="text-xs text-gray-500 mt-1">Where the QR codes will link to</p>
					</div>
					<div>
						<label for="cap-expiration" class="block text-sm text-gray-300 mb-1">Card Validity</label>
						<select id="cap-expiration" bind:value={capExpiration} class="w-full px-3 py-2 rounded-lg bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none text-sm">
							<option value="permanent">Unlimited</option>
							<option value="1year">1 Year</option>
							<option value="30d">30 Days</option>
							<option value="7d">7 Days</option>
							<option value="24h">24 Hours</option>
						</select>
						<p class="text-xs text-gray-500 mt-1">How long the QR codes remain valid</p>
					</div>
				</div>
			</div>

			<!-- Cards Input (From Holon, CSV, or Manual) -->
			<div class="bg-gray-800 rounded-xl p-4 border border-gray-700">
				<!-- Tab switcher -->
				<div class="flex items-center gap-1 mb-3">
					<button
						on:click={() => switchInputMode('holon')}
						class="px-3 py-1 rounded-lg text-sm font-medium transition-colors {inputMode === 'holon' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'}"
					>From Holon</button>
					<button
						on:click={() => switchInputMode('csv')}
						class="px-3 py-1 rounded-lg text-sm font-medium transition-colors {inputMode === 'csv' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'}"
					>CSV Upload</button>
					<button
						on:click={() => switchInputMode('manual')}
						class="px-3 py-1 rounded-lg text-sm font-medium transition-colors {inputMode === 'manual' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'}"
					>Manual Input</button>
					{#if inputMode === 'csv'}
						<button on:click={downloadSampleCSV} class="ml-auto text-xs text-blue-400 hover:text-blue-300">Sample CSV</button>
					{/if}
				</div>

				{#if inputMode === 'holon'}
					<!-- Load current items from the holon -->
					<div class="space-y-2">
						<div class="flex items-center gap-2">
							<select bind:value={holonSource} class="px-2 py-1.5 rounded-lg bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none text-sm">
								{#each HOLON_SOURCES as src}
									<option value={src.value}>{src.label}</option>
								{/each}
							</select>
							<button
								on:click={loadFromHolon}
								disabled={isLoadingHolon || !holonId}
								class="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium"
							>{isLoadingHolon ? 'Loading…' : 'Load'}</button>
							{#if cards.length > 0}
								<span class="text-xs text-gray-400">{cards.length} card{cards.length !== 1 ? 's' : ''}</span>
								<button on:click={() => { cards = []; pdfBlob = null; previewCardIndex = 0; }} class="ml-auto text-xs text-red-400 hover:text-red-300">Clear</button>
							{/if}
						</div>
						<p class="text-xs text-gray-500">Pulls the holon's current {holonSource}. Scanning a card adds the signed-in user to that specific item.</p>
						{#if holonLoadError}
							<div class="text-amber-400 text-xs">{holonLoadError}</div>
						{/if}
					</div>
				{:else if inputMode === 'csv'}
					<!-- CSV Upload -->
					<div
						class="border-2 border-dashed rounded-lg p-4 text-center transition-colors {isDragOver ? 'border-blue-500 bg-blue-500/10' : 'border-gray-600'}"
						on:dragover|preventDefault={() => (isDragOver = true)}
						on:dragleave|preventDefault={() => (isDragOver = false)}
						on:drop={handleCSVDrop}
						role="button"
						tabindex="0"
					>
						{#if csvFile}
							<div class="flex items-center justify-center gap-2">
								<span class="text-green-400 text-sm">{csvFile.name}</span>
								<span class="text-gray-400 text-xs">({cards.length} cards)</span>
								<button on:click={() => { csvFile = null; cards = []; }} class="text-gray-400 hover:text-red-400 ml-2" aria-label="Remove CSV file">
									<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
								</button>
							</div>
						{:else}
							<label class="cursor-pointer">
								<input type="file" accept=".csv" class="hidden" on:change={handleCSVSelect} />
								<span class="text-gray-400 text-sm">Drop CSV or click to upload</span>
							</label>
						{/if}
					</div>
				{:else}
					<!-- Manual Input Form -->
					<div class="space-y-2">
						<div class="grid grid-cols-2 gap-2">
							<div>
								<label for="manual-title" class="block text-xs text-gray-400 mb-1">Title *</label>
								<input id="manual-title" type="text" bind:value={manualTitle} placeholder="Card title" class="w-full px-2 py-1.5 rounded-lg bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none text-sm" />
							</div>
							<div>
								<label for="manual-type" class="block text-xs text-gray-400 mb-1">Type *</label>
								<select id="manual-type" bind:value={manualType} class="w-full px-2 py-1.5 rounded-lg bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none text-sm">
									<option value="task">Task</option>
									<option value="action">Action</option>
									<option value="event">Event</option>
									<option value="role">Role</option>
									<option value="badge">Badge</option>
									<option value="resource">Resource</option>
									<option value="vibe">Vibe</option>
								</select>
							</div>
						</div>
						<div>
							<label for="manual-desc" class="block text-xs text-gray-400 mb-1">Description *</label>
							<textarea id="manual-desc" bind:value={manualDescription} placeholder="Card description" rows="2" class="w-full px-2 py-1.5 rounded-lg bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none text-sm resize-none"></textarea>
						</div>
						<div>
							<label for="manual-image" class="block text-xs text-gray-400 mb-1">Image URL</label>
							<input id="manual-image" type="text" bind:value={manualImageUrl} placeholder="https://... (optional)" class="w-full px-2 py-1.5 rounded-lg bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none text-sm" />
						</div>
						<div class="flex items-center gap-2 pt-1">
							<button
								on:click={addManualCard}
								disabled={!manualTitle.trim() || !manualDescription.trim()}
								class="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium"
							>Add Card</button>
							{#if cards.length > 0}
								<span class="text-xs text-gray-400">{cards.length} card{cards.length !== 1 ? 's' : ''}</span>
								<button on:click={() => { cards = []; pdfBlob = null; previewCardIndex = 0; }} class="ml-auto text-xs text-red-400 hover:text-red-300">Clear All</button>
							{/if}
						</div>
					</div>
				{/if}
				{#if parseErrors.length > 0}
					<div class="mt-2 text-red-400 text-xs">{parseErrors[0]}</div>
				{/if}
			</div>

			<!-- Images -->
			<div class="bg-gray-800 rounded-xl p-4 border border-gray-700">
				<h2 class="text-lg font-semibold mb-3">Card Images</h2>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<span class="block text-xs text-gray-400 mb-1">Back (QR side)</span>
						{#if backgroundImageUrl}
							<div class="relative">
								<img src={backgroundImageUrl} alt="Back" class="w-full h-16 object-cover rounded-lg" />
								<button on:click={() => clearImage('background')} class="absolute top-0 right-0 p-1 bg-red-500 rounded-full text-white text-xs" aria-label="Remove background image">×</button>
							</div>
						{:else}
							<label class="cursor-pointer block border border-dashed border-gray-600 rounded-lg p-3 text-center hover:border-gray-500">
								<input type="file" accept="image/*" class="hidden" on:change={handleImageSelect('background')} />
								<span class="text-gray-500 text-xs">Upload</span>
							</label>
						{/if}
					</div>
					<div>
						<span class="block text-xs text-gray-400 mb-1">Front (text side)</span>
						{#if foregroundImageUrl}
							<div class="relative">
								<img src={foregroundImageUrl} alt="Front" class="w-full h-16 object-cover rounded-lg" />
								<button on:click={() => clearImage('foreground')} class="absolute top-0 right-0 p-1 bg-red-500 rounded-full text-white text-xs" aria-label="Remove foreground image">×</button>
							</div>
						{:else}
							<label class="cursor-pointer block border border-dashed border-gray-600 rounded-lg p-3 text-center hover:border-gray-500">
								<input type="file" accept="image/*" class="hidden" on:change={handleImageSelect('foreground')} />
								<span class="text-gray-500 text-xs">Upload</span>
							</label>
						{/if}
					</div>
				</div>
			</div>
		</div>

		<!-- Row 2: Preview + Style Editor (side by side) -->
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
			<!-- Left: Preview (scrollable container) -->
			<div class="bg-gray-800 rounded-xl p-4 border border-gray-700">
				<div class="flex items-center justify-between mb-3">
					<h2 class="text-lg font-semibold">Preview</h2>
					{#if cards.length > 0}
						<div class="flex items-center gap-2">
							<button on:click={prevPreviewCard} disabled={previewCardIndex === 0} class="p-1 rounded hover:bg-gray-700 disabled:opacity-50" aria-label="Previous card">
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
							</button>
							<span class="text-xs text-gray-400">{previewCardIndex + 1}/{cards.length}</span>
							<button on:click={nextPreviewCard} disabled={previewCardIndex >= cards.length - 1} class="p-1 rounded hover:bg-gray-700 disabled:opacity-50" aria-label="Next card">
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
							</button>
						</div>
					{/if}
				</div>

				{#if previewCard}
					<div class="flex justify-center mb-3">
						<button on:click={togglePreviewSide} class="px-3 py-1 bg-gray-700 rounded text-xs hover:bg-gray-600">
							{previewSide === 'front' ? 'Front' : 'Back'} (click to flip)
						</button>
					</div>

					<!-- Scrollable container at actual card dimensions -->
					<div class="overflow-auto max-w-full max-h-96 border border-gray-600 rounded-xl mx-auto" style="max-width: {CARD_WIDTH_PX + 4}px;">
						<div class="inline-block">
							{#if previewSide === 'back'}
								{@html previewBackHTML}
							{:else}
								{@html previewFrontHTML}
							{/if}
						</div>
					</div>
					<p class="text-xs text-gray-500 text-center mt-2">Actual size: {CARD_WIDTH_PX}×{CARD_HEIGHT_PX}px (scroll to see full card)</p>
					{#if previewQRTargetUrl}
						<a
							href={previewQRTargetUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="block text-center mt-2 text-xs text-blue-400 hover:text-blue-300 underline truncate"
							title={previewQRTargetUrl}
						>Test scan: {previewQRTargetUrl}</a>
					{/if}
				{:else}
					<div class="flex items-center justify-center h-48 text-gray-500 text-sm">
						Load items from the holon, upload a CSV, or add cards manually to preview
					</div>
				{/if}
			</div>

			<!-- Right: Style Editor -->
			<div class="bg-gray-800 rounded-xl p-4 border border-gray-700 max-h-[500px] overflow-y-auto">
				<div class="flex items-center justify-between mb-4">
					<h2 class="text-lg font-semibold">Style Editor</h2>
					<button on:click={resetStyles} class="text-xs text-blue-400 hover:text-blue-300">Reset to Default</button>
				</div>

				<div class="space-y-4">
					<!-- Margins -->
					<div class="border-b border-gray-700 pb-4">
						<h4 class="text-sm font-medium text-gray-300 mb-2">Margins</h4>
						<div class="flex items-center gap-3">
							<span class="text-xs text-gray-400 w-24">Content Margin</span>
							<input type="range" min="10" max="40" bind:value={cardStyle.margin} class="flex-1 accent-blue-500" />
							<span class="text-xs text-gray-400 w-12 text-right">{cardStyle.margin}px</span>
						</div>
					</div>

					<!-- Type Badge -->
					<div class="border-b border-gray-700 pb-4">
						<h4 class="text-sm font-medium text-gray-300 mb-2">Type Badge</h4>
						<div class="space-y-2">
							<div class="flex items-center gap-3">
								<span class="text-xs text-gray-400 w-24">Font Size</span>
								<input type="range" min="8" max="32" bind:value={cardStyle.typeBadge.fontSize} class="flex-1 accent-blue-500" />
								<span class="text-xs text-gray-400 w-12 text-right">{cardStyle.typeBadge.fontSize}px</span>
							</div>
							<div class="flex items-center gap-3">
								<span class="text-xs text-gray-400 w-24">Top Position</span>
								<input type="range" min="2" max="40" bind:value={cardStyle.typeBadge.top} class="flex-1 accent-blue-500" />
								<span class="text-xs text-gray-400 w-12 text-right">{cardStyle.typeBadge.top}%</span>
							</div>
							<div class="flex items-center gap-3">
								<span class="text-xs text-gray-400 w-24">Font</span>
								<select bind:value={cardStyle.typeBadge.fontFamily} class="flex-1 px-2 py-1 bg-gray-700 rounded text-sm border border-gray-600">
									{#each FONT_OPTIONS as font}
										<option value={font}>{font.split(',')[0]}</option>
									{/each}
								</select>
							</div>
							<div class="flex items-center gap-3">
								<span class="text-xs text-gray-400 w-24">Text Color</span>
								<input type="color" bind:value={cardStyle.typeBadge.color} class="w-10 h-8 bg-gray-700 rounded border border-gray-600 cursor-pointer" />
								<span class="text-xs text-gray-500">(empty = use type color)</span>
							</div>
							<div class="flex items-center gap-3">
								<span class="text-xs text-gray-400 w-24">Background</span>
								<input type="color" bind:value={cardStyle.typeBadge.backgroundColor} class="w-10 h-8 bg-gray-700 rounded border border-gray-600 cursor-pointer" />
								<span class="text-xs text-gray-500">(empty = use type color)</span>
								{#if cardStyle.typeBadge.backgroundColor}
									<button on:click={() => cardStyle.typeBadge.backgroundColor = ''} class="text-xs text-red-400 hover:text-red-300">Clear</button>
								{/if}
							</div>
						</div>
					</div>

					<!-- Title -->
					<div class="border-b border-gray-700 pb-4">
						<h4 class="text-sm font-medium text-gray-300 mb-2">Title</h4>
						<div class="space-y-2">
							<div class="flex items-center gap-3">
								<span class="text-xs text-gray-400 w-24">Font Size</span>
								<input type="range" min="10" max="48" bind:value={cardStyle.title.fontSize} class="flex-1 accent-blue-500" />
								<span class="text-xs text-gray-400 w-12 text-right">{cardStyle.title.fontSize}px</span>
							</div>
							<div class="flex items-center gap-3">
								<span class="text-xs text-gray-400 w-24">Top Position</span>
								<input type="range" min="40" max="95" bind:value={cardStyle.title.top} class="flex-1 accent-blue-500" />
								<span class="text-xs text-gray-400 w-12 text-right">{cardStyle.title.top}%</span>
							</div>
							<div class="flex items-center gap-3">
								<span class="text-xs text-gray-400 w-24">Font</span>
								<select bind:value={cardStyle.title.fontFamily} class="flex-1 px-2 py-1 bg-gray-700 rounded text-sm border border-gray-600">
									{#each FONT_OPTIONS as font}
										<option value={font}>{font.split(',')[0]}</option>
									{/each}
								</select>
							</div>
							<div class="flex items-center gap-3">
								<span class="text-xs text-gray-400 w-24">Color</span>
								<input type="color" bind:value={cardStyle.title.color} class="w-10 h-8 bg-gray-700 rounded border border-gray-600 cursor-pointer" />
							</div>
						</div>
					</div>

					<!-- Description -->
					<div class="border-b border-gray-700 pb-4">
						<h4 class="text-sm font-medium text-gray-300 mb-2">Description</h4>
						<div class="space-y-2">
							<div class="flex items-center gap-3">
								<span class="text-xs text-gray-400 w-24">Font Size</span>
								<input type="range" min="8" max="24" bind:value={cardStyle.description.fontSize} class="flex-1 accent-blue-500" />
								<span class="text-xs text-gray-400 w-12 text-right">{cardStyle.description.fontSize}px</span>
							</div>
							<div class="flex items-center gap-3">
								<span class="text-xs text-gray-400 w-24">Top Position</span>
								<input type="range" min="50" max="98" bind:value={cardStyle.description.top} class="flex-1 accent-blue-500" />
								<span class="text-xs text-gray-400 w-12 text-right">{cardStyle.description.top}%</span>
							</div>
							<div class="flex items-center gap-3">
								<span class="text-xs text-gray-400 w-24">Font</span>
								<select bind:value={cardStyle.description.fontFamily} class="flex-1 px-2 py-1 bg-gray-700 rounded text-sm border border-gray-600">
									{#each FONT_OPTIONS as font}
										<option value={font}>{font.split(',')[0]}</option>
									{/each}
								</select>
							</div>
							<div class="flex items-center gap-3">
								<span class="text-xs text-gray-400 w-24">Color</span>
								<input type="color" bind:value={cardStyle.description.color} class="w-10 h-8 bg-gray-700 rounded border border-gray-600 cursor-pointer" />
							</div>
						</div>
					</div>

					<!-- QR Code -->
					<div>
						<h4 class="text-sm font-medium text-gray-300 mb-2">QR Code</h4>
						<div class="space-y-2">
							<div class="flex items-center gap-3">
								<span class="text-xs text-gray-400 w-24">Size</span>
								<input type="range" min="30" max="80" bind:value={cardStyle.qrCode.size} class="flex-1 accent-blue-500" />
								<span class="text-xs text-gray-400 w-12 text-right">{cardStyle.qrCode.size}%</span>
							</div>
							<div class="flex items-center gap-3">
								<span class="text-xs text-gray-400 w-24">Top Position</span>
								<input type="range" min="20" max="80" bind:value={cardStyle.qrCode.top} class="flex-1 accent-blue-500" />
								<span class="text-xs text-gray-400 w-12 text-right">{cardStyle.qrCode.top}%</span>
							</div>
							<div class="flex items-center gap-3">
								<span class="text-xs text-gray-400 w-24">Transparent</span>
								<label class="relative inline-flex items-center cursor-pointer">
									<input type="checkbox" bind:checked={cardStyle.qrCode.transparentBackground} class="sr-only peer" />
									<div class="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"></div>
								</label>
								<span class="text-xs text-gray-500">Hide white background</span>
							</div>
						</div>
					</div>

					<!-- Card Image -->
					<div>
						<h4 class="text-sm font-medium text-gray-300 mb-2">Card Image</h4>
						<p class="text-xs text-gray-500 mb-2">Position of imageUrl from CSV</p>
						<div class="space-y-2">
							<div class="flex items-center gap-3">
								<span class="text-xs text-gray-400 w-24">Size</span>
								<input type="range" min="20" max="100" bind:value={cardStyle.cardImage.size} class="flex-1 accent-blue-500" />
								<span class="text-xs text-gray-400 w-12 text-right">{cardStyle.cardImage.size}%</span>
							</div>
							<div class="flex items-center gap-3">
								<span class="text-xs text-gray-400 w-24">Top Position</span>
								<input type="range" min="0" max="100" bind:value={cardStyle.cardImage.top} class="flex-1 accent-blue-500" />
								<span class="text-xs text-gray-400 w-12 text-right">{cardStyle.cardImage.top}%</span>
							</div>
							<div class="flex items-center gap-3">
								<span class="text-xs text-gray-400 w-24">Left Position</span>
								<input type="range" min="0" max="100" bind:value={cardStyle.cardImage.left} class="flex-1 accent-blue-500" />
								<span class="text-xs text-gray-400 w-12 text-right">{cardStyle.cardImage.left}%</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>

		<!-- Row 3: Generate + Cards + Instructions -->
		<div class="space-y-4">
			<!-- Generate Section -->
			<div class="bg-gray-800 rounded-xl p-4 border border-gray-700">
				<div class="flex flex-wrap items-center gap-4">
					{#if isGenerating}
						<div class="flex-1 min-w-48">
							<div class="flex justify-between text-xs text-gray-400 mb-1">
								<span>Generating PDF...</span>
								<span>{Math.round(progressPercent)}%</span>
							</div>
							<div class="h-2 bg-gray-700 rounded-full overflow-hidden">
								<div class="h-full bg-blue-500 transition-all" style="width: {progressPercent}%"></div>
							</div>
						</div>
					{:else if isGeneratingQRZip}
						<div class="flex-1 min-w-48">
							<div class="flex justify-between text-xs text-gray-400 mb-1">
								<span>Generating QR codes...</span>
								<span>{qrZipProgress.current}/{qrZipProgress.total}</span>
							</div>
							<div class="h-2 bg-gray-700 rounded-full overflow-hidden">
								<div class="h-full bg-purple-500 transition-all" style="width: {qrZipProgress.total > 0 ? (qrZipProgress.current / qrZipProgress.total) * 100 : 0}%"></div>
							</div>
						</div>
					{:else}
						<button
							on:click={handleGeneratePDF}
							disabled={!canGenerate || isGenerating || isGeneratingQRZip}
							class="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium"
						>
							Generate PDF
						</button>

						{#if pdfBlob}
							<button
								on:click={handleDownloadPDF}
								class="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium flex items-center gap-1"
							>
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
								</svg>
								Download PDF
							</button>
						{/if}

						<button
							on:click={handleDownloadQRZip}
							disabled={!canGenerate || isGenerating || isGeneratingQRZip}
							class="px-6 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium flex items-center gap-1"
						>
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
							</svg>
							Download QR Codes
						</button>

						{#if !canGenerate}
							<span class="text-xs text-gray-500">
								{#if !deckId.trim()}Enter Deck ID{:else if cards.length === 0}Load items, upload a CSV, or add cards manually{/if}
							</span>
						{/if}
					{/if}
				</div>
			</div>

			<!-- Cards List (horizontal) -->
			{#if cards.length > 0}
				<div class="bg-gray-800 rounded-xl p-4 border border-gray-700">
					<h2 class="text-lg font-semibold mb-3">Cards ({cards.length})</h2>
					<div class="flex gap-2 overflow-x-auto pb-2">
						{#each cards as card, index}
							<div class="flex-shrink-0 flex items-center gap-1 rounded-lg text-sm {index === previewCardIndex ? 'bg-blue-600/30 border border-blue-500' : 'bg-gray-700'}">
								<button
									class="flex items-center gap-2 p-2 text-left hover:opacity-80"
									on:click={() => { previewCardIndex = index; previewSide = 'front'; }}
								>
									<span
										class="w-6 h-6 rounded flex items-center justify-center text-xs font-bold shrink-0"
										style="background: {CARD_TYPE_COLORS[card.type].bg}; color: {CARD_TYPE_COLORS[card.type].text}"
									>
										{card.type.charAt(0).toUpperCase()}
									</span>
									<div class="min-w-0 max-w-24">
										<p class="font-medium truncate text-xs">{card.title}</p>
									</div>
								</button>
								<button
									on:click|stopPropagation={() => removeCard(index)}
									class="pr-2 text-gray-500 hover:text-red-400"
									aria-label="Remove card {card.title}"
								>
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
								</button>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Print Instructions -->
			<div class="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
				<h3 class="font-semibold mb-2 text-sm">Print Instructions</h3>
				<ol class="text-xs text-gray-400 space-y-1 list-decimal list-inside">
					<li>Generate and download PDF</li>
					<li>Print double-sided (flip on short edge)</li>
					<li>Cut along dashed lines</li>
				</ol>
			</div>
		</div>
	</div>
</div>
