<script lang="ts">
	import { page } from '$app/stores';
	import { parseCSV, generateSampleCSV } from '$lib/card-generator/csv-parser';
	import { generatePDF, downloadPDF, buildQRUrl, generateQRDataUrl } from '$lib/card-generator/pdf-generator';
	import { renderCardFront, renderCardBack, renderCardBackPlaceholder, CARD_WIDTH_PX, CARD_HEIGHT_PX } from '$lib/card-generator/CardRenderer';
	import type { Card, DeckConfig, CardStyle } from '$lib/card-generator/types';
	import { CARD_TYPE_COLORS, DEFAULT_CARD_STYLE, FONT_OPTIONS } from '$lib/card-generator/types';

	$: holonId = $page.params.id || '';

	// State
	let deckId = '';
	let csvFile: File | null = null;
	let backgroundImageFile: File | null = null;
	let foregroundImageFile: File | null = null;
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

	// Card style configuration
	let cardStyle: CardStyle = JSON.parse(JSON.stringify(DEFAULT_CARD_STYLE));

	// Preview state
	let previewQRDataUrl: string | null = null;

	// Generate QR code for preview when card or config changes
	async function updatePreviewQR() {
		if (!previewCard || !deckId) {
			previewQRDataUrl = null;
			return;
		}
		const config: DeckConfig = { deckId, holonId, cardStyle };
		const qrUrl = buildQRUrl(previewCard, config);
		previewQRDataUrl = await generateQRDataUrl(qrUrl);
	}

	// Reactive: regenerate QR when preview card or deck changes
	$: if (previewCard && deckId) {
		updatePreviewQR();
	}

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
				backgroundImageFile = file;
				backgroundImageUrl = url;
			} else {
				if (foregroundImageUrl) URL.revokeObjectURL(foregroundImageUrl);
				foregroundImageFile = file;
				foregroundImageUrl = url;
			}
			pdfBlob = null;
		};
	}

	function clearImage(type: 'background' | 'foreground') {
		if (type === 'background') {
			if (backgroundImageUrl) URL.revokeObjectURL(backgroundImageUrl);
			backgroundImageFile = null;
			backgroundImageUrl = null;
		} else {
			if (foregroundImageUrl) URL.revokeObjectURL(foregroundImageUrl);
			foregroundImageFile = null;
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

	async function handleGeneratePDF() {
		if (cards.length === 0 || !deckId || isGenerating) return;
		isGenerating = true;
		progress = { current: 0, total: cards.length };

		try {
			const config: DeckConfig = {
				deckId,
				holonId,
				backgroundImage: backgroundImageUrl || undefined,
				foregroundImage: foregroundImageUrl || undefined,
				cardStyle
			};

			pdfBlob = await generatePDF({
				cards,
				config,
				onProgress: (current, total) => {
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
						<label class="block text-sm text-gray-300 mb-1">Holon ID</label>
						<input type="text" value={holonId} disabled class="w-full px-3 py-2 rounded-lg bg-gray-700 text-gray-400 border border-gray-600 text-sm" />
					</div>
					<div>
						<label class="block text-sm text-gray-300 mb-1">Deck ID *</label>
						<input type="text" bind:value={deckId} placeholder="e.g., main-deck" class="w-full px-3 py-2 rounded-lg bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none text-sm" />
					</div>
				</div>
			</div>

			<!-- CSV Upload -->
			<div class="bg-gray-800 rounded-xl p-4 border border-gray-700">
				<div class="flex items-center justify-between mb-3">
					<h2 class="text-lg font-semibold">Cards CSV</h2>
					<button on:click={downloadSampleCSV} class="text-xs text-blue-400 hover:text-blue-300">Sample CSV</button>
				</div>
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
							<button on:click={() => { csvFile = null; cards = []; }} class="text-gray-400 hover:text-red-400 ml-2">
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
				{#if parseErrors.length > 0}
					<div class="mt-2 text-red-400 text-xs">{parseErrors[0]}</div>
				{/if}
			</div>

			<!-- Images -->
			<div class="bg-gray-800 rounded-xl p-4 border border-gray-700">
				<h2 class="text-lg font-semibold mb-3">Card Images</h2>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label class="block text-xs text-gray-400 mb-1">Back (QR side)</label>
						{#if backgroundImageUrl}
							<div class="relative">
								<img src={backgroundImageUrl} alt="Back" class="w-full h-16 object-cover rounded-lg" />
								<button on:click={() => clearImage('background')} class="absolute top-0 right-0 p-1 bg-red-500 rounded-full text-white text-xs">×</button>
							</div>
						{:else}
							<label class="cursor-pointer block border border-dashed border-gray-600 rounded-lg p-3 text-center hover:border-gray-500">
								<input type="file" accept="image/*" class="hidden" on:change={handleImageSelect('background')} />
								<span class="text-gray-500 text-xs">Upload</span>
							</label>
						{/if}
					</div>
					<div>
						<label class="block text-xs text-gray-400 mb-1">Front (text side)</label>
						{#if foregroundImageUrl}
							<div class="relative">
								<img src={foregroundImageUrl} alt="Front" class="w-full h-16 object-cover rounded-lg" />
								<button on:click={() => clearImage('foreground')} class="absolute top-0 right-0 p-1 bg-red-500 rounded-full text-white text-xs">×</button>
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
							<button on:click={prevPreviewCard} disabled={previewCardIndex === 0} class="p-1 rounded hover:bg-gray-700 disabled:opacity-50">
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
							</button>
							<span class="text-xs text-gray-400">{previewCardIndex + 1}/{cards.length}</span>
							<button on:click={nextPreviewCard} disabled={previewCardIndex >= cards.length - 1} class="p-1 rounded hover:bg-gray-700 disabled:opacity-50">
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
				{:else}
					<div class="flex items-center justify-center h-48 text-gray-500 text-sm">
						Upload CSV to preview
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
							<label class="text-xs text-gray-400 w-24">Content Margin</label>
							<input type="range" min="10" max="40" bind:value={cardStyle.margin} class="flex-1 accent-blue-500" />
							<span class="text-xs text-gray-400 w-12 text-right">{cardStyle.margin}px</span>
						</div>
					</div>

					<!-- Type Badge -->
					<div class="border-b border-gray-700 pb-4">
						<h4 class="text-sm font-medium text-gray-300 mb-2">Type Badge</h4>
						<div class="space-y-2">
							<div class="flex items-center gap-3">
								<label class="text-xs text-gray-400 w-24">Font Size</label>
								<input type="range" min="8" max="32" bind:value={cardStyle.typeBadge.fontSize} class="flex-1 accent-blue-500" />
								<span class="text-xs text-gray-400 w-12 text-right">{cardStyle.typeBadge.fontSize}px</span>
							</div>
							<div class="flex items-center gap-3">
								<label class="text-xs text-gray-400 w-24">Top Position</label>
								<input type="range" min="2" max="40" bind:value={cardStyle.typeBadge.top} class="flex-1 accent-blue-500" />
								<span class="text-xs text-gray-400 w-12 text-right">{cardStyle.typeBadge.top}%</span>
							</div>
							<div class="flex items-center gap-3">
								<label class="text-xs text-gray-400 w-24">Font</label>
								<select bind:value={cardStyle.typeBadge.fontFamily} class="flex-1 px-2 py-1 bg-gray-700 rounded text-sm border border-gray-600">
									{#each FONT_OPTIONS as font}
										<option value={font}>{font.split(',')[0]}</option>
									{/each}
								</select>
							</div>
							<div class="flex items-center gap-3">
								<label class="text-xs text-gray-400 w-24">Text Color</label>
								<input type="color" bind:value={cardStyle.typeBadge.color} class="w-10 h-8 bg-gray-700 rounded border border-gray-600 cursor-pointer" />
								<span class="text-xs text-gray-500">(empty = use type color)</span>
							</div>
							<div class="flex items-center gap-3">
								<label class="text-xs text-gray-400 w-24">Background</label>
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
								<label class="text-xs text-gray-400 w-24">Font Size</label>
								<input type="range" min="10" max="48" bind:value={cardStyle.title.fontSize} class="flex-1 accent-blue-500" />
								<span class="text-xs text-gray-400 w-12 text-right">{cardStyle.title.fontSize}px</span>
							</div>
							<div class="flex items-center gap-3">
								<label class="text-xs text-gray-400 w-24">Top Position</label>
								<input type="range" min="40" max="95" bind:value={cardStyle.title.top} class="flex-1 accent-blue-500" />
								<span class="text-xs text-gray-400 w-12 text-right">{cardStyle.title.top}%</span>
							</div>
							<div class="flex items-center gap-3">
								<label class="text-xs text-gray-400 w-24">Font</label>
								<select bind:value={cardStyle.title.fontFamily} class="flex-1 px-2 py-1 bg-gray-700 rounded text-sm border border-gray-600">
									{#each FONT_OPTIONS as font}
										<option value={font}>{font.split(',')[0]}</option>
									{/each}
								</select>
							</div>
							<div class="flex items-center gap-3">
								<label class="text-xs text-gray-400 w-24">Color</label>
								<input type="color" bind:value={cardStyle.title.color} class="w-10 h-8 bg-gray-700 rounded border border-gray-600 cursor-pointer" />
							</div>
						</div>
					</div>

					<!-- Description -->
					<div class="border-b border-gray-700 pb-4">
						<h4 class="text-sm font-medium text-gray-300 mb-2">Description</h4>
						<div class="space-y-2">
							<div class="flex items-center gap-3">
								<label class="text-xs text-gray-400 w-24">Font Size</label>
								<input type="range" min="8" max="24" bind:value={cardStyle.description.fontSize} class="flex-1 accent-blue-500" />
								<span class="text-xs text-gray-400 w-12 text-right">{cardStyle.description.fontSize}px</span>
							</div>
							<div class="flex items-center gap-3">
								<label class="text-xs text-gray-400 w-24">Top Position</label>
								<input type="range" min="50" max="98" bind:value={cardStyle.description.top} class="flex-1 accent-blue-500" />
								<span class="text-xs text-gray-400 w-12 text-right">{cardStyle.description.top}%</span>
							</div>
							<div class="flex items-center gap-3">
								<label class="text-xs text-gray-400 w-24">Font</label>
								<select bind:value={cardStyle.description.fontFamily} class="flex-1 px-2 py-1 bg-gray-700 rounded text-sm border border-gray-600">
									{#each FONT_OPTIONS as font}
										<option value={font}>{font.split(',')[0]}</option>
									{/each}
								</select>
							</div>
							<div class="flex items-center gap-3">
								<label class="text-xs text-gray-400 w-24">Color</label>
								<input type="color" bind:value={cardStyle.description.color} class="w-10 h-8 bg-gray-700 rounded border border-gray-600 cursor-pointer" />
							</div>
						</div>
					</div>

					<!-- QR Code -->
					<div>
						<h4 class="text-sm font-medium text-gray-300 mb-2">QR Code</h4>
						<div class="space-y-2">
							<div class="flex items-center gap-3">
								<label class="text-xs text-gray-400 w-24">Size</label>
								<input type="range" min="30" max="80" bind:value={cardStyle.qrCode.size} class="flex-1 accent-blue-500" />
								<span class="text-xs text-gray-400 w-12 text-right">{cardStyle.qrCode.size}%</span>
							</div>
							<div class="flex items-center gap-3">
								<label class="text-xs text-gray-400 w-24">Top Position</label>
								<input type="range" min="20" max="80" bind:value={cardStyle.qrCode.top} class="flex-1 accent-blue-500" />
								<span class="text-xs text-gray-400 w-12 text-right">{cardStyle.qrCode.top}%</span>
							</div>
							<div class="flex items-center gap-3">
								<label class="text-xs text-gray-400 w-24">Transparent</label>
								<label class="relative inline-flex items-center cursor-pointer">
									<input type="checkbox" bind:checked={cardStyle.qrCode.transparentBackground} class="sr-only peer" />
									<div class="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"></div>
								</label>
								<span class="text-xs text-gray-500">Hide white background</span>
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
								<span>Generating...</span>
								<span>{Math.round(progressPercent)}%</span>
							</div>
							<div class="h-2 bg-gray-700 rounded-full overflow-hidden">
								<div class="h-full bg-blue-500 transition-all" style="width: {progressPercent}%"></div>
							</div>
						</div>
					{:else}
						<button
							on:click={handleGeneratePDF}
							disabled={!canGenerate || isGenerating}
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

						{#if !canGenerate}
							<span class="text-xs text-gray-500">
								{#if !deckId.trim()}Enter Deck ID{:else if cards.length === 0}Upload CSV{/if}
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
							<button
								class="flex-shrink-0 flex items-center gap-2 p-2 rounded-lg text-left text-sm {index === previewCardIndex ? 'bg-blue-600/30 border border-blue-500' : 'bg-gray-700 hover:bg-gray-600'}"
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
