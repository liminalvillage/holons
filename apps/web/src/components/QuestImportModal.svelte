<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { writable } from 'svelte/store';
	import type { ResolvedHologramMeta } from 'holosphere';

	const dispatch = createEventDispatcher();

	interface Quest {
		id: string;
		title: string;
		description?: string;
		date?: string;
		when?: string;
		status: 'ongoing' | 'completed' | 'recurring' | 'repeating';
		category?: string;
		participants: Array<{ 
			id: string; 
			username: string;
			firstName?: string;
			lastName?: string;
		}>;
		appreciation: string[];
		location?: string;
		ends?: string;
		type?: 'task' | 'quest' | 'event' | 'recurring';
		orderIndex?: number;
		position?: { x: number; y: number };
		dependencies?: string[];
		initiator?: {
			id: string;
			username: string;
			firstName?: string;
			lastName?: string;
		};
		created?: string;
		_hologram?: ResolvedHologramMeta;
	}

	// State variables
	let activeTab: 'file' | 'clipboard' | 'library' = 'file';
	let isDragOver = false;
	let selectedFile: File | null = null;
	let fileContent = '';
	let parsedQuests: Quest[] = [];
	let searchQuery = '';
	let selectedLibraryQuests: Quest[] = [];
	let isLoading = false;
	let errorMessage = '';
	let clipboardContent = '';
	let clipboardFormat: 'json' | 'text' = 'json';

	// Concrete example shown under "Example JSON" so users see the expected shape.
	const sampleJson = `[
  {
    "title": "Project planning meeting",
    "description": "Kick-off with stakeholders",
    "category": "Planning",
    "status": "ongoing",
    "type": "task"
  },
  {
    "title": "Weekly team sync",
    "type": "event",
    "status": "recurring",
    "category": "Meetings"
  },
  {
    "title": "Research market trends",
    "description": "Competitor analysis and opportunity sizing",
    "type": "quest",
    "status": "ongoing",
    "category": "Research"
  }
]`;

	function useSampleJson() {
		clipboardFormat = 'json';
		clipboardContent = sampleJson;
		parseClipboardContent();
	}

	// Sample quest library - you can expand this with more quests
	const questLibrary = [
		{
			id: 'sample-1',
			title: 'Project Planning Meeting',
			description: 'Organize and conduct initial project planning meeting with stakeholders',
			category: 'Planning',
			status: 'ongoing' as const,
			type: 'task' as const,
			participants: [],
			appreciation: []
		},
		{
			id: 'sample-2',
			title: 'Research Market Trends',
			description: 'Conduct comprehensive research on current market trends and competitor analysis',
			category: 'Research',
			status: 'ongoing' as const,
			type: 'quest' as const,
			participants: [],
			appreciation: []
		},
		{
			id: 'sample-3',
			title: 'Weekly Team Sync',
			description: 'Regular weekly team synchronization meeting',
			category: 'Meetings',
			status: 'recurring' as const,
			type: 'event' as const,
			participants: [],
			appreciation: []
		},
		{
			id: 'sample-4',
			title: 'Documentation Review',
			description: 'Review and update project documentation',
			category: 'Documentation',
			status: 'ongoing' as const,
			type: 'task' as const,
			participants: [],
			appreciation: []
		},
		{
			id: 'sample-5',
			title: 'Client Presentation',
			description: 'Prepare and deliver presentation to client',
			category: 'Client',
			status: 'ongoing' as const,
			type: 'quest' as const,
			participants: [],
			appreciation: []
		},
		{
			id: 'sample-6',
			title: 'Onboarding Checklist',
			description: 'Walk a new member through accounts, repos, and team rituals',
			category: 'Onboarding',
			status: 'ongoing' as const,
			type: 'task' as const,
			participants: [],
			appreciation: []
		},
		{
			id: 'sample-7',
			title: 'Quarterly Retrospective',
			description: 'Reflect on the past quarter and capture lessons learned',
			category: 'Meetings',
			status: 'recurring' as const,
			type: 'event' as const,
			participants: [],
			appreciation: []
		},
		{
			id: 'sample-8',
			title: 'Bug Triage',
			description: 'Review the open bug queue and assign priorities',
			category: 'Engineering',
			status: 'recurring' as const,
			type: 'task' as const,
			participants: [],
			appreciation: []
		}
	];

	// Computed values
	$: filteredLibraryQuests = questLibrary.filter(quest =>
		quest.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
		quest.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
		quest.category?.toLowerCase().includes(searchQuery.toLowerCase())
	);

	// File handling functions
	function handleFileSelect(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files[0]) {
			selectedFile = target.files[0];
			parseFile();
		}
	}

	// Clipboard handling functions
	function handleClipboardTab() {
		activeTab = 'clipboard';
		// Reset other import methods
		selectedFile = null;
		parsedQuests = [];
		fileContent = '';
		errorMessage = '';
	}

	async function parseClipboardContent() {
		if (!clipboardContent.trim()) {
			errorMessage = clipboardFormat === 'json' ? 'Please paste some JSON content' : 'Please paste some text content';
			return;
		}

		try {
			isLoading = true;
			errorMessage = '';
			
			if (clipboardFormat === 'json') {
				// Parse JSON
				const data = JSON.parse(clipboardContent);
				
				// Handle different JSON formats (same logic as file parsing)
				if (Array.isArray(data)) {
					parsedQuests = data;
				} else if (data.quests && Array.isArray(data.quests)) {
					parsedQuests = data.quests;
				} else if (data.tasks && Array.isArray(data.tasks)) {
					parsedQuests = data.tasks;
				} else if (typeof data === 'object') {
					// If it's an object with quest IDs as keys
					parsedQuests = Object.values(data);
				} else {
					throw new Error('Invalid JSON format');
				}

				// Validate quest structure
				parsedQuests = parsedQuests.filter(quest => 
					quest && typeof quest === 'object' && quest.title
				);

				if (parsedQuests.length === 0) {
					errorMessage = 'No valid quests found in the JSON content';
				}
			} else {
				// Parse simple text format
				parsedQuests = parseSimpleTextFormat(clipboardContent);
				
				if (parsedQuests.length === 0) {
					errorMessage = 'No valid tasks found in the text content';
				}
			}

		} catch (error) {
			console.error('Error parsing clipboard content:', error);
			if (clipboardFormat === 'json') {
				errorMessage = 'Error parsing JSON content. Please check the format.';
			} else {
				errorMessage = 'Error parsing text content. Please check the format.';
			}
			parsedQuests = [];
		} finally {
			isLoading = false;
		}
	}

	function parseSimpleTextFormat(text: string): Quest[] {
		const lines = text.split('\n').filter(line => line.trim());
		const quests: Quest[] = [];
		
		for (const line of lines) {
			const trimmedLine = line.trim();
			if (!trimmedLine) continue;
			
			// Check if it's comma-separated
			if (trimmedLine.includes(',')) {
				const items = trimmedLine.split(',').map(item => item.trim()).filter(item => item);
				for (const item of items) {
					if (item) {
						quests.push({
							id: `temp_${Date.now()}_${Math.random()}`,
							title: item,
							status: 'ongoing',
							type: 'task',
							participants: [],
							appreciation: []
						});
					}
				}
			} else {
				// Single line item
				quests.push({
					id: `temp_${Date.now()}_${Math.random()}`,
					title: trimmedLine,
					status: 'ongoing',
					type: 'task',
					participants: [],
					appreciation: []
				});
			}
		}
		
		return quests;
	}

	function autoDetectFormat(content: string): 'json' | 'text' {
		if (!content.trim()) return 'json';
		
		// Try to detect if it's JSON
		try {
			JSON.parse(content);
			return 'json';
		} catch {
			// Not valid JSON, treat as text
			return 'text';
		}
	}

	function handleClipboardPaste() {
		// Auto-detect format when content changes
		if (clipboardContent.trim()) {
			const detectedFormat = autoDetectFormat(clipboardContent);
			if (detectedFormat !== clipboardFormat) {
				clipboardFormat = detectedFormat;
			}
		}
	}

	async function pasteFromClipboard() {
		try {
			const text = await navigator.clipboard.readText();
			clipboardContent = text;
			// Auto-detect format after pasting
			handleClipboardPaste();
		} catch (error) {
			console.error('Failed to read clipboard:', error);
			errorMessage = 'Failed to read clipboard. Please paste manually.';
		}
	}

	function clearClipboardInput() {
		clipboardContent = '';
		parsedQuests = [];
		errorMessage = '';
		clipboardFormat = 'json';
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
			selectedFile = event.dataTransfer.files[0];
			parseFile();
		}
	}

	async function parseFile() {
		if (!selectedFile) return;

		try {
			isLoading = true;
			errorMessage = '';
			
			// Check file type
			if (!selectedFile.name.endsWith('.json')) {
				errorMessage = 'Please select a JSON file';
				return;
			}

			// Read file content
			const text = await selectedFile.text();
			fileContent = text;

			// Parse JSON
			const data = JSON.parse(text);
			
			// Handle different JSON formats
			if (Array.isArray(data)) {
				parsedQuests = data;
			} else if (data.quests && Array.isArray(data.quests)) {
				parsedQuests = data.quests;
			} else if (data.tasks && Array.isArray(data.tasks)) {
				parsedQuests = data.tasks;
			} else if (typeof data === 'object') {
				// If it's an object with quest IDs as keys
				parsedQuests = Object.values(data);
			} else {
				throw new Error('Invalid JSON format');
			}

			// Validate quest structure
			parsedQuests = parsedQuests.filter(quest => 
				quest && typeof quest === 'object' && quest.title
			);

			if (parsedQuests.length === 0) {
				errorMessage = 'No valid quests found in the file';
			}

		} catch (error) {
			console.error('Error parsing file:', error);
			errorMessage = 'Error parsing JSON file. Please check the file format.';
			parsedQuests = [];
		} finally {
			isLoading = false;
		}
	}

	// Library functions
	function toggleQuestSelection(quest: Quest) {
		const index = selectedLibraryQuests.findIndex(q => q.id === quest.id);
		if (index >= 0) {
			selectedLibraryQuests = selectedLibraryQuests.filter(q => q.id !== quest.id);
		} else {
			selectedLibraryQuests = [...selectedLibraryQuests, quest];
		}
	}

	function selectAllQuests() {
		selectedLibraryQuests = [...filteredLibraryQuests];
	}

	function clearSelection() {
		selectedLibraryQuests = [];
	}

	// Import functions
	function importSelectedQuests() {
		let questsToImport: Quest[];
		
		if (activeTab === 'file' || activeTab === 'clipboard') {
			questsToImport = parsedQuests;
		} else {
			questsToImport = selectedLibraryQuests;
		}
		
		if (questsToImport.length === 0) {
			errorMessage = 'No quests selected for import';
			return;
		}

		// Clean up quests for import (remove IDs, timestamps, etc.)
		const cleanQuests = questsToImport.map(quest => ({
			...quest,
			id: undefined, // Will be generated during import
			created: undefined, // Will be generated during import
			orderIndex: undefined // Will be generated during import
		}));

		dispatch('import', cleanQuests);
	}

	function closeModal() {
		dispatch('close');
		// Reset state
		selectedFile = null;
		fileContent = '';
		parsedQuests = [];
		searchQuery = '';
		selectedLibraryQuests = [];
		errorMessage = '';
		activeTab = 'file';
		clipboardContent = '';
		clipboardFormat = 'json';
	}

	// Keyboard shortcuts
	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			closeModal();
		}
	}
</script>

<div 
	class="fixed inset-0 z-50 overflow-auto bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
	on:click|self={closeModal}
	on:keydown={handleKeydown}
	role="dialog"
	aria-modal="true"
	tabindex="-1"
>
	<div 
		class="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden border border-gray-700 flex flex-col"
		aria-labelledby="quest-import-title"
	>
		<!-- Header -->
		<div class="p-6 border-b border-gray-700">
			<div class="flex items-center justify-between">
				<h3 id="quest-import-title" class="text-white text-2xl font-bold">Import Quests</h3>
				<button
					on:click={closeModal}
					class="text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-gray-700"
					aria-label="Close import modal"
				>
					<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
					</svg>
				</button>
			</div>
		</div>

		<!-- Content -->
		<div class="p-6 overflow-y-auto flex-1 modal-content">
			<!-- Tab Navigation -->
			<div class="flex space-x-1 mb-6 bg-gray-700 rounded-xl p-1">
				<button
					class="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors {activeTab === 'file' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}"
					on:click={() => activeTab = 'file'}
				>
					📁 File Upload
				</button>
				<button
					class="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors {activeTab === 'clipboard' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}"
					on:click={() => activeTab = 'clipboard'}
				>
					📋 Clipboard
				</button>
				<button
					class="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors {activeTab === 'library' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}"
					on:click={() => activeTab = 'library'}
				>
					📚 Quest Library
				</button>
			</div>

			{#if activeTab === 'file'}
				<!-- File Upload Tab -->
				<div class="space-y-6">
					<!-- File Drop Zone -->
					<div
						class="border-2 border-dashed rounded-xl p-8 text-center transition-colors {isDragOver ? 'border-blue-500 bg-blue-500/10' : 'border-gray-600 hover:border-gray-500'}"
						on:dragover={handleDragOver}
						on:dragleave={handleDragLeave}
						on:drop={handleDrop}
						role="button"
						tabindex="0"
						aria-label="File drop zone"
					>
						<svg class="mx-auto h-12 w-12 text-gray-400 mb-4" stroke="currentColor" fill="none" viewBox="0 0 48 48">
							<path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
						<div class="text-gray-400 mb-4">
							<p class="text-lg font-medium">Drop your JSON file here</p>
							<p class="text-sm">or</p>
						</div>
						<label class="cursor-pointer">
							<input
								type="file"
								accept=".json"
								class="hidden"
								on:change={handleFileSelect}
							/>
							<span class="inline-flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors">
								Choose File
							</span>
						</label>
						<p class="text-xs text-gray-500 mt-2">Supports JSON files with quest arrays or objects</p>
					</div>

					<!-- File Info -->
					{#if selectedFile}
						<div class="bg-gray-700 rounded-lg p-4">
							<div class="flex items-center justify-between">
								<div>
									<p class="text-white font-medium">{selectedFile.name}</p>
									<p class="text-gray-400 text-sm">{(selectedFile.size / 1024).toFixed(1)} KB</p>
								</div>
								<button
									on:click={() => { selectedFile = null; parsedQuests = []; fileContent = ''; }}
									class="text-gray-400 hover:text-red-400 transition-colors"
									aria-label="Remove selected file"
								>
									<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
									</svg>
								</button>
							</div>
						</div>
					{/if}

					<!-- Parsed Quests Preview -->
					{#if parsedQuests.length > 0}
						<div class="bg-gray-700 rounded-lg p-4">
							<h4 class="text-white font-medium mb-3">Found {parsedQuests.length} quests:</h4>
							<div class="space-y-2 max-h-40 overflow-y-auto">
								{#each parsedQuests as quest, index}
									<div class="flex items-center gap-3 p-2 bg-gray-600 rounded">
										<span class="text-gray-400 text-sm w-8">{index + 1}</span>
										<div class="flex-1 min-w-0">
											<p class="text-white font-medium truncate">{quest.title}</p>
											{#if quest.category}
												<p class="text-gray-400 text-xs">{quest.category}</p>
											{/if}
										</div>
									</div>
								{/each}
							</div>
							<div class="mt-4 text-center">
								<button
									on:click={importSelectedQuests}
									class="px-6 py-2.5 text-sm font-medium rounded-xl bg-green-600 text-white hover:bg-green-700 transition-colors shadow-lg"
								>
									Import {parsedQuests.length} Quest{parsedQuests.length !== 1 ? 's' : ''}
								</button>
							</div>
						</div>
					{/if}
				</div>

			{:else if activeTab === 'clipboard'}
				<!-- Clipboard Tab -->
				<div class="space-y-6">
					<!-- Format Selector -->
					<div class="bg-gray-700 rounded-xl p-4">
						<h4 class="text-white font-medium mb-3">Import Format</h4>
						<div class="flex space-x-1 bg-gray-600 rounded-lg p-1">
							<button
								class="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors {clipboardFormat === 'json' ? 'bg-gray-500 text-white' : 'text-gray-400 hover:text-white'}"
								on:click={() => clipboardFormat = 'json'}
							>
								📄 JSON
							</button>
							<button
								class="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors {clipboardFormat === 'text' ? 'bg-gray-500 text-white' : 'text-gray-400 hover:text-white'}"
								on:click={() => clipboardFormat = 'text'}
							>
								📝 Simple Text
							</button>
						</div>
					</div>

					<div class="bg-gray-700 rounded-xl p-6">
						<h4 class="text-white font-medium mb-3">
							{clipboardFormat === 'json' ? 'Paste JSON Content' : 'Paste Simple Text'}
						</h4>

						{#if clipboardFormat === 'json'}
							<details class="quest-sample mb-4">
								<summary class="quest-sample__summary">
									<span>Example JSON</span>
									<button
										type="button"
										class="quest-sample__use"
										on:click|stopPropagation|preventDefault={useSampleJson}
									>
										Use sample
									</button>
								</summary>
								<pre class="quest-sample__code">{sampleJson}</pre>
							</details>
						{/if}

						{#if clipboardFormat === 'text'}
							<div class="bg-blue-500/20 border border-blue-500/50 rounded-lg p-3 mb-4">
								<div class="text-blue-300 text-sm">
									<strong>Supported formats:</strong>
									<ul class="list-disc list-inside mt-2 space-y-1">
										<li>One task per line</li>
										<li>Comma-separated tasks on a single line</li>
										<li>Mixed format (some lines with commas, some without)</li>
									</ul>
									<p class="mt-2 text-xs">Example: "Task 1, Task 2" or "Task 1\nTask 2"</p>
								</div>
							</div>
						{/if}
						
						<textarea
							bind:value={clipboardContent}
							on:input={handleClipboardPaste}
							placeholder={clipboardFormat === 'json' ? 'Paste your JSON content here...' : 'Paste your task list here...\n\nExamples:\nTask 1, Task 2, Task 3\n\nOr:\nTask 1\nTask 2\nTask 3'}
							class="w-full h-48 px-4 py-3 rounded-xl bg-gray-600 text-white placeholder-gray-400 border border-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors resize-none font-mono text-sm"
						></textarea>
						<div class="flex items-center justify-between mt-3">
							<div class="flex gap-2">
								<button
									on:click={pasteFromClipboard}
									class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm"
									title="Paste content from clipboard"
								>
									📋 Paste from Clipboard
								</button>
								<button
									on:click={clearClipboardInput}
									class="px-4 py-2 text-gray-400 hover:text-white transition-colors text-sm"
								>
									Clear
								</button>
							</div>
							<div class="flex gap-2">
								<button
									on:click={parseClipboardContent}
									class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
									disabled={!clipboardContent.trim()}
								>
									Parse {clipboardFormat === 'json' ? 'JSON' : 'Text'}
								</button>
								<button
									on:click={importSelectedQuests}
									class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
									disabled={parsedQuests.length === 0}
								>
									Import {parsedQuests.length} Quest{parsedQuests.length !== 1 ? 's' : ''}
								</button>
							</div>
						</div>
					</div>

					<!-- Parsed Quests Preview -->
					{#if parsedQuests.length > 0}
						<div class="bg-gray-700 rounded-lg p-4">
							<h4 class="text-white font-medium mb-3">Found {parsedQuests.length} quests:</h4>
							<div class="space-y-2 max-h-40 overflow-y-auto">
								{#each parsedQuests as quest, index}
									<div class="flex items-center gap-3 p-2 bg-gray-600 rounded">
										<span class="text-gray-400 text-sm w-8">{index + 1}</span>
										<div class="flex-1 min-w-0">
											<p class="text-white font-medium truncate">{quest.title}</p>
											{#if quest.category}
												<p class="text-gray-400 text-xs">{quest.category}</p>
											{/if}
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{:else}
				<!-- Library Tab -->
				<div class="space-y-6">
					<!-- Search -->
					<div class="relative">
						<input
							type="text"
							bind:value={searchQuery}
							placeholder="Search quests by title, description, or category..."
							class="w-full px-4 py-3 pl-10 rounded-xl bg-gray-700 text-white placeholder-gray-400 border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors"
						/>
						<svg class="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
						</svg>
					</div>

					<!-- Selection Controls -->
					<div class="flex items-center gap-3">
						<button
							on:click={selectAllQuests}
							class="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white rounded-lg text-sm transition-colors"
						>
							Select All
						</button>
						<button
							on:click={clearSelection}
							class="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white rounded-lg text-sm transition-colors"
						>
							Clear Selection
						</button>
						<span class="text-gray-400 text-sm">
							{selectedLibraryQuests.length} of {filteredLibraryQuests.length} selected
						</span>
					</div>

					<!-- Quest List -->
					<div class="space-y-2 max-h-60 overflow-y-auto">
						{#each filteredLibraryQuests as quest}
							<div class="flex items-center gap-3 p-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors">
								<input
									type="checkbox"
									checked={selectedLibraryQuests.some(q => q.id === quest.id)}
									on:change={() => toggleQuestSelection(quest)}
									class="w-4 h-4 text-blue-600 bg-gray-600 border-gray-500 rounded focus:ring-blue-500 focus:ring-2"
								/>
								<div class="flex-1 min-w-0">
									<p class="text-white font-medium">{quest.title}</p>
									{#if quest.description}
										<p class="text-gray-400 text-sm truncate">{quest.description}</p>
									{/if}
									<div class="flex items-center gap-2 mt-1">
										{#if quest.category}
											<span class="inline-block px-2 py-1 bg-gray-600 text-gray-300 text-xs rounded">{quest.category}</span>
										{/if}
										<span class="inline-block px-2 py-1 bg-gray-600 text-gray-300 text-xs rounded">{quest.type}</span>
									</div>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Error Message -->
			{#if errorMessage}
				<div class="bg-red-500/20 border border-red-500/50 rounded-lg p-4 text-red-400 text-sm">
					{errorMessage}
				</div>
			{/if}
		</div>

		<!-- Footer -->
		<div class="p-6 border-t border-gray-700 bg-gray-800/50 flex-shrink-0">
			<div class="flex justify-end gap-3">
				<button
					on:click={closeModal}
					class="px-6 py-2.5 text-sm font-medium rounded-xl bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
				>
					Cancel
				</button>
				{#if activeTab === 'library'}
					<button
						on:click={importSelectedQuests}
						class="px-6 py-2.5 text-sm font-medium rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg"
						disabled={selectedLibraryQuests.length === 0}
					>
						{isLoading ? 'Processing...' : `Import ${selectedLibraryQuests.length} Quest${selectedLibraryQuests.length !== 1 ? 's' : ''}`}
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.quest-sample {
		background: var(--color-bg-primary);
		border: 1px solid var(--color-bg-tertiary);
		border-radius: 0.5rem;
		overflow: hidden;
	}

	.quest-sample__summary {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		cursor: pointer;
		list-style: none;
	}

	.quest-sample__summary::-webkit-details-marker {
		display: none;
	}

	.quest-sample__summary::before {
		content: '▸';
		color: var(--color-text-muted);
		font-size: 0.75rem;
		display: inline-block;
		transition: transform 150ms ease;
	}

	.quest-sample[open] .quest-sample__summary::before {
		transform: rotate(90deg);
	}

	.quest-sample__use {
		margin-left: auto;
		padding: 0.25rem 0.625rem;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-light);
		border-radius: 0.375rem;
		color: var(--color-text-secondary);
		font-size: 0.75rem;
		cursor: pointer;
	}

	.quest-sample__use:hover {
		background: var(--color-border-light);
	}

	.quest-sample__code {
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

	/* Custom scrollbar for webkit browsers */
	::-webkit-scrollbar {
		width: 6px;
	}
	
	::-webkit-scrollbar-track {
		background: var(--color-bg-tertiary);
		border-radius: 3px;
	}
	
	::-webkit-scrollbar-thumb {
		background: #6b7280;
		border-radius: 3px;
	}
	
	::-webkit-scrollbar-thumb:hover {
		background: #6b7280;
	}

	/* Modal scrollbar styling */
	.modal-content::-webkit-scrollbar {
		width: 8px;
	}
	
	.modal-content::-webkit-scrollbar-track {
		background: var(--color-bg-tertiary);
		border-radius: 4px;
	}
	
	.modal-content::-webkit-scrollbar-thumb {
		background: #6b7280;
		border-radius: 4px;
	}
	
	.modal-content::-webkit-scrollbar-thumb:hover {
		background: #6b7280;
	}
</style>
