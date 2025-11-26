<script lang="ts">
	// @ts-nocheck
	import { onMount, getContext } from "svelte";
	import { ID } from "../dashboard/store";
	import { browser } from '$app/environment';

	import TreeView from "./TreeView.svelte";
	import type { HoloSphere } from "holosphere";

	let holosphere = getContext("holosphere") as HoloSphere;

	let tree = {
		label: "Tags",
		children: [],
	};

	/**
	 * @type {string | any[]}
	 */
	let store = {};
	let holonID: string = '';
	let isLoading = true;
	let connectionReady = false;
	let error = '';
	let unsubscribe: (() => void) | null = null;

	$: tags = Object.entries(store);
	$: totalContent = tags.reduce((acc, [_, tagData]) => acc + (tagData.content?.length || 0), 0);

	let viewMode = 'grid'; // 'grid' or 'list'

	// Wait for holosphere to be ready and load initial data
	async function waitForHolosphere(): Promise<boolean> {
		if (holosphere) {
			return true;
		}
		
		let retries = 0;
		const maxRetries = 10;
		
		while (retries < maxRetries) {
			await new Promise(resolve => setTimeout(resolve, 200));
			try {
				holosphere = getContext("holosphere");
				if (holosphere) {
					return true;
				}
			} catch (error) {
				// Silently handle context errors
			}
			retries++;
		}
		
		return false;
	}

	// Load initial data and subscribe to changes
	async function loadTagsData() {
		if (!holonID || !holosphere) {
			isLoading = false;
			return;
		}

		isLoading = true;
		error = '';
		store = {};

		try {
			// Load initial tags data
			const initialTagsData = await holosphere.getAll(holonID, "tags");
			if (initialTagsData && typeof initialTagsData === 'object') {
				store = initialTagsData;
			}

			// Subscribe to tag updates
			unsubscribe = holosphere.subscribe(holonID, "tags", (tag, key) => {
				if (tag) {
					store = { ...store, [key]: tag };
				} else {
					const { [key]: _, ...rest } = store;
					store = rest;
				}
			});

			console.log(`Successfully loaded tags for holon ${holonID}:`, Object.keys(store).length, 'tags');

		} catch (err) {
			console.error('Error loading tags data:', err);
			error = 'Failed to load tags. Please try again.';
		} finally {
			isLoading = false;
		}
	}

	onMount(async () => {
		// Wait for holosphere to be ready
		const holosphereAvailable = await waitForHolosphere();
		if (!holosphereAvailable) {
			error = 'Connection not available. Please refresh the page.';
			isLoading = false;
			return;
		}

		connectionReady = true;

		// Set up ID subscription
		const idUnsubscribe = ID.subscribe(async (value) => {
			if (value && value !== holonID) {
				holonID = value;
				// Clean up previous subscription
				if (unsubscribe) {
					unsubscribe();
					unsubscribe = null;
				}
				await loadTagsData();
			}
		});

		// Initial load if we have an ID
		if ($ID) {
			holonID = $ID;
			await loadTagsData();
		}

		// Cleanup on unmount
		return () => {
			idUnsubscribe();
			if (unsubscribe) {
				unsubscribe();
			}
		};
	});

	// Function to handle tag selection
	function handleTagClick(tagName) {
		// Handle tag click - could navigate to a tag-specific view
		console.log("Selected tag:", tagName);
		// Example: navigate to tag view
		// goto(`/tags/${tagName}`);
	}

	// Function to check if text contains a URL
	function extractUrl(text) {
		const urlRegex = /(https?:\/\/[^\s]+)/g;
		const match = text.match(urlRegex);
		return match ? match[0] : null;
	}

	// Function to handle content item clicks
	function handleContentClick(content, event) {
		event.preventDefault();
		const url = extractUrl(content.messageContent) || content.link || content.url;
		if (url) {
			window.open(url, "_blank");
		}
	}

	// Function to check if content is a link
	function isLink(content) {
		return extractUrl(content.messageContent) || content.link || content.url;
	}

	// Function to truncate text if needed
	function truncateText(text, maxLength = 150) {
		if (text.length <= maxLength) return text;
		return text.substring(0, maxLength) + '...';
	}
</script>

<div class="space-y-8">
	<!-- Header Section -->
	<div class="bg-gradient-to-r from-gray-800 to-gray-700 py-8 px-8 rounded-3xl shadow-2xl">
		<div class="flex flex-col md:flex-row justify-between items-center">
			<div class="text-center md:text-left mb-4 md:mb-0">
				<h1 class="text-4xl font-bold text-white mb-2">Knowledge Base</h1>
				<p class="text-gray-300 text-lg">{new Date().toDateString()}</p>
			</div>
			<div class="flex items-center gap-3">
				<button 
					class="p-2 rounded-lg transition-colors {viewMode === 'list' ? 'bg-gray-600 text-white' : 'bg-transparent text-gray-400 hover:text-white'}"
					on:click={() => viewMode = 'list'}
					title="List View"
					aria-label="Switch to list view"
				>
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
					</svg>
				</button>
				<button
					class="p-2 rounded-lg transition-colors {viewMode === 'grid' ? 'bg-gray-600 text-white' : 'bg-transparent text-gray-400 hover:text-white'}"
					on:click={() => viewMode = 'grid'}
					title="Grid View"
					aria-label="Switch to grid view"
				>
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/>
					</svg>
				</button>
			</div>
		</div>
	</div>

	<!-- Main Content Container -->
	<div class="bg-gray-800 rounded-3xl shadow-xl min-h-[600px]">
		<div class="p-8">
			<!-- Loading State -->
			{#if isLoading}
				<div class="flex items-center justify-center py-12">
					<div class="text-center">
						<div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
						<p class="text-gray-400">Loading tags...</p>
					</div>
				</div>
			{:else if error}
				<!-- Error State -->
				<div class="text-center py-12">
					<div class="w-16 h-16 mx-auto mb-4 bg-red-700/20 rounded-full flex items-center justify-center">
						<svg class="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
						</svg>
					</div>
					<h3 class="text-lg font-medium text-white mb-2">Error Loading Tags</h3>
					<p class="text-gray-400 mb-4">{error}</p>
					<button 
						class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
						on:click={() => loadTagsData()}
					>
						Try Again
					</button>
				</div>
			{:else}
				<!-- Stats Section -->
				<div class="grid grid-cols-2 gap-4 mb-8">
					<div class="bg-gray-700/50 rounded-2xl p-4 text-center">
						<div class="text-2xl font-bold text-white mb-1">{tags.length}</div>
						<div class="text-sm text-gray-400">Tags</div>
					</div>
					<div class="bg-gray-700/50 rounded-2xl p-4 text-center">
						<div class="text-2xl font-bold text-white mb-1">{totalContent}</div>
						<div class="text-sm text-gray-400">Total Items</div>
					</div>
				</div>

				<!-- Tags Content -->
				{#if viewMode === 'grid'}
					<!-- Grid View -->
					<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
						{#each tags as [tagName, tagData]}
							<div class="bg-gray-700/30 rounded-2xl p-6 border border-gray-600/50 hover:border-gray-500/50 transition-all duration-200">
								<div class="mb-4">
									<button
										class="text-xl font-bold text-white hover:text-blue-400 cursor-pointer transition-colors w-full text-left flex items-center gap-2"
										on:click={() => handleTagClick(tagName)}
									>
										<span class="text-blue-400">#</span>
										<span class="truncate">{tagName}</span>
									</button>
									<div class="text-sm text-gray-400 mt-1">
										{tagData.content?.length || 0} items
									</div>
								</div>
								
								<div class="space-y-3 max-h-64 overflow-y-auto">
									{#each (tagData.content || []) as content}
										{#if isLink(content)}
											<a
												href={extractUrl(content.messageContent) || content.url || content.link}
												target="_blank"
												rel="noopener noreferrer"
												class="block text-blue-400 hover:text-blue-300 text-sm bg-gray-800/50 p-3 rounded-lg hover:bg-gray-600/50 transition-all duration-200 border border-transparent hover:border-blue-500/30"
												on:click={(e) => handleContentClick(content, e)}
											>
												<div class="break-words whitespace-pre-wrap">
													{truncateText(content.messageContent)}
												</div>
												{#if content.messageContent.length > 150}
													<div class="text-xs text-gray-500 mt-1">Click to read more...</div>
												{/if}
											</a>
										{:else}
											<div class="text-gray-300 text-sm bg-gray-800/30 p-3 rounded-lg border border-gray-600/30">
												<div class="break-words whitespace-pre-wrap">
													{content.messageContent}
												</div>
											</div>
										{/if}
									{/each}
									
									{#if !tagData.content || tagData.content.length === 0}
										<div class="text-center py-4 text-gray-500 text-sm">
											No content available
										</div>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<!-- List View -->
					<div class="space-y-4">
						{#each tags as [tagName, tagData]}
							<div class="bg-gray-700/30 rounded-xl p-6 border border-gray-600/50 hover:border-gray-500/50 transition-all duration-200">
								<div class="flex items-center justify-between mb-4">
									<button
										class="text-xl font-bold text-white hover:text-blue-400 cursor-pointer transition-colors flex items-center gap-2"
										on:click={() => handleTagClick(tagName)}
									>
										<span class="text-blue-400">#</span>
										<span>{tagName}</span>
									</button>
									<div class="text-sm text-gray-400">
										{tagData.content?.length || 0} items
									</div>
								</div>
								
								<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
									{#each (tagData.content || []) as content}
										{#if isLink(content)}
											<a
												href={extractUrl(content.messageContent) || content.url || content.link}
												target="_blank"
												rel="noopener noreferrer"
												class="block text-blue-400 hover:text-blue-300 text-sm bg-gray-800/50 p-3 rounded-lg hover:bg-gray-600/50 transition-all duration-200 border border-transparent hover:border-blue-500/30"
												on:click={(e) => handleContentClick(content, e)}
											>
												<div class="break-words whitespace-pre-wrap">
													{truncateText(content.messageContent)}
												</div>
												{#if content.messageContent.length > 150}
													<div class="text-xs text-gray-500 mt-1">Click to read more...</div>
												{/if}
											</a>
										{:else}
											<div class="text-gray-300 text-sm bg-gray-800/30 p-3 rounded-lg border border-gray-600/30">
												<div class="break-words whitespace-pre-wrap">
													{content.messageContent}
												</div>
											</div>
										{/if}
									{/each}
									
									{#if !tagData.content || tagData.content.length === 0}
										<div class="col-span-full text-center py-4 text-gray-500 text-sm">
											No content available
										</div>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}

				{#if tags.length === 0}
					<div class="text-center py-12">
						<div class="w-16 h-16 mx-auto mb-4 bg-gray-700 rounded-full flex items-center justify-center">
							<svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"/>
							</svg>
						</div>
						<h3 class="text-lg font-medium text-white mb-2">No tags found</h3>
						<p class="text-gray-400">Tags will appear here once content is tagged</p>
					</div>
				{/if}
			{/if}
		</div>
	</div>
</div>
