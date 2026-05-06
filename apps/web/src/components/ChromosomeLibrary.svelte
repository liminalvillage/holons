<script lang="ts">
  // ChromosomeLibrary component - Library browser with categories
  // Feature: 001-holon-dna-editor

  import type { Chromosome, ChromosomeType } from '$lib/dna/types';
  import ChromosomeCard from './ChromosomeCard.svelte';

  interface Props {
    library: Chromosome[];
    selectedChromosomeIds: string[];
    onSelectChromosome: (id: string) => void;
    onDeleteChromosome?: (id: string) => void;
    isLoading?: boolean;
  }

  let {
    library,
    selectedChromosomeIds,
    onSelectChromosome,
    onDeleteChromosome,
    isLoading = false
  }: Props = $props();

  let selectedCategory = $state<ChromosomeType | null>(null);

  // Debug logging
  $effect(() => {
    console.log('[ChromosomeLibrary] Received library:', library, 'length:', library.length);
    console.log('[ChromosomeLibrary] isLoading:', isLoading);
    console.log('[ChromosomeLibrary] filteredChromosomes:', filteredChromosomes.length);
    if (library.length > 0) {
      console.log('[ChromosomeLibrary] First chromosome:', library[0]);
    }
  });

  // Filter library by selected category
  const filteredChromosomes = $derived(
    selectedCategory
      ? library.filter(c => c.type === selectedCategory)
      : library
  );

  // Group chromosomes by type for stats
  const chromosomesByType = $derived(() => {
    const grouped: Record<ChromosomeType, Chromosome[]> = {
      value: [],
      tool: [],
      practice: []
    };

    if (library && Array.isArray(library)) {
      library.forEach(chromosome => {
        if (chromosome && chromosome.type && grouped[chromosome.type]) {
          grouped[chromosome.type].push(chromosome);
        }
      });
    }

    return grouped;
  });

  function setCategory(category: ChromosomeType | null) {
    selectedCategory = category;
  }

  const categoryConfig = [
    { type: 'value' as ChromosomeType, label: 'Values', icon: '💎', color: 'blue' },
    { type: 'tool' as ChromosomeType, label: 'Tools', icon: '🔧', color: 'green' },
    { type: 'practice' as ChromosomeType, label: 'Practices', icon: '🎯', color: 'purple' }
  ];
</script>

<div class="library-container">
  <div class="library-header">
    <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100">
      Chromosome Library
    </h2>
    <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">
      Select chromosomes to add to your DNA sequence
    </p>
  </div>

  <!-- Category Filter Tabs -->
  <div class="category-tabs">
    <button
      type="button"
      class="tab"
      class:active={selectedCategory === null}
      onclick={() => setCategory(null)}
    >
      <span>All</span>
      <span class="count">{library.length}</span>
    </button>

    {#each categoryConfig as category}
      {@const count = chromosomesByType()[category.type].length}
      <button
        type="button"
        class="tab"
        class:active={selectedCategory === category.type}
        onclick={() => setCategory(category.type)}
      >
        <span class="category-icon">{category.icon}</span>
        <span>{category.label}</span>
        <span class="count">{count}</span>
      </button>
    {/each}
  </div>

  <!-- Chromosome List -->
  <div class="chromosome-list">
    {#if isLoading}
      <div class="loading-state">
        <div class="spinner"></div>
        <p class="text-sm text-gray-600 dark:text-gray-400">Loading chromosomes...</p>
      </div>
    {:else if filteredChromosomes.length === 0}
      <div class="empty-state">
        <svg class="empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
        <h3 class="empty-title">No chromosomes found</h3>
        <p class="empty-description">
          {#if selectedCategory}
            No {selectedCategory}s in your library yet. Try selecting a different category.
          {:else}
            Your chromosome library is empty. Add some chromosomes to get started.
          {/if}
        </p>
      </div>
    {:else}
      {#each filteredChromosomes as chromosome (chromosome.id)}
        <div class="chromosome-item">
          <ChromosomeCard
            {chromosome}
            selected={selectedChromosomeIds.includes(chromosome.id)}
            onSelect={onSelectChromosome}
          />
          {#if onDeleteChromosome}
            <button
              type="button"
              class="delete-btn"
              onclick={() => onDeleteChromosome(chromosome.id)}
              title="Delete {chromosome.name}"
              aria-label="Delete {chromosome.name}"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .library-container {
    @apply flex flex-col h-full;
  }

  .library-header {
    @apply p-4 border-b border-gray-200 dark:border-gray-700;
  }

  .category-tabs {
    @apply flex gap-2 p-4 border-b border-gray-200 dark:border-gray-700 overflow-x-auto;
  }

  .tab {
    @apply flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all;
    @apply bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300;
    @apply hover:bg-gray-200 dark:hover:bg-gray-700;
  }

  .tab.active {
    @apply bg-blue-500 dark:bg-blue-600 text-white;
  }

  .category-icon {
    @apply text-base;
  }

  .count {
    @apply text-xs px-2 py-0.5 rounded-full;
    @apply bg-white/20 dark:bg-black/20;
  }

  .tab.active .count {
    @apply bg-white/30 dark:bg-black/30;
  }

  .chromosome-list {
    @apply flex-1 p-4 overflow-y-auto space-y-3;
  }

  .chromosome-item {
    @apply relative;
  }

  .delete-btn {
    @apply absolute top-2 right-2 z-10;
    @apply w-8 h-8 rounded-lg;
    @apply bg-white dark:bg-gray-800;
    @apply border border-gray-300 dark:border-gray-600;
    @apply text-gray-500 dark:text-gray-400;
    @apply hover:bg-red-50 dark:hover:bg-red-900/20;
    @apply hover:text-red-600 dark:hover:text-red-400;
    @apply hover:border-red-300 dark:hover:border-red-600;
    @apply transition-all shadow-sm;
    @apply flex items-center justify-center;
  }

  .delete-btn:hover {
    @apply shadow-md;
  }

  .loading-state {
    @apply flex flex-col items-center justify-center py-12;
  }

  .spinner {
    @apply w-8 h-8 border-4 border-gray-300 dark:border-gray-600 border-t-blue-500 rounded-full animate-spin mb-4;
  }

  .empty-state {
    @apply flex flex-col items-center justify-center py-12 text-center;
  }

  .empty-icon {
    @apply w-16 h-16 text-gray-400 dark:text-gray-600 mb-4;
  }

  .empty-title {
    @apply text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2;
  }

  .empty-description {
    @apply text-sm text-gray-600 dark:text-gray-400 max-w-sm;
  }
</style>
