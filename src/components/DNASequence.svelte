<script lang="ts">
  // DNASequence component - DNA sequence display with drag-and-drop
  // Feature: 001-holon-dna-editor

  import type { Chromosome } from '$lib/dna/types';
  import { dndzone } from 'svelte-dnd-action';
  import ChromosomeCard from './ChromosomeCard.svelte';

  interface Props {
    sequence: Chromosome[];
    onRemoveChromosome: (id: string) => void;
    onReorderSequence: (newOrder: Chromosome[]) => void;
    isLoading?: boolean;
  }

  let {
    sequence,
    onRemoveChromosome,
    onReorderSequence,
    isLoading = false
  }: Props = $props();

  // Local items state for drag-and-drop
  let items = $state(sequence);

  // Update items when sequence prop changes
  $effect(() => {
    items = sequence.map((c) => ({ ...c }));
  });

  // Drag-and-drop handlers
  function handleDndConsider(e: CustomEvent) {
    items = e.detail.items;
  }

  function handleDndFinalize(e: CustomEvent) {
    items = e.detail.items;
    onReorderSequence(items as Chromosome[]);
  }

  // Stats for display
  const stats = $derived(() => {
    const counts = { total: sequence.length, value: 0, tool: 0, practice: 0 };
    sequence.forEach(c => {
      counts[c.type]++;
    });
    return counts;
  });

  const isFull = $derived(sequence.length >= 20);

  const flipDurationMs = 200;
</script>

<div class="sequence-container">
  <div class="sequence-header">
    <div>
      <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100">
        DNA Sequence
      </h2>
      <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">
        {stats().total} / 20 chromosomes
        {#if isFull}
          <span class="text-amber-600 dark:text-amber-400 font-medium">
            (Maximum reached)
          </span>
        {/if}
      </p>
    </div>

    <!-- Stats badges -->
    <div class="stats-badges">
      <span class="stat-badge value">
        💎 {stats().value}
      </span>
      <span class="stat-badge tool">
        🔧 {stats().tool}
      </span>
      <span class="stat-badge practice">
        🎯 {stats().practice}
      </span>
    </div>
  </div>

  <!-- Sequence Display -->
  <div class="sequence-list">
    {#if isLoading}
      <div class="loading-state">
        <div class="spinner"></div>
        <p class="text-sm text-gray-600 dark:text-gray-400">Loading DNA sequence...</p>
      </div>
    {:else if sequence.length === 0}
      <div class="empty-state">
        <svg class="empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        <h3 class="empty-title">No chromosomes in sequence</h3>
        <p class="empty-description">
          Select chromosomes from the library to compose your holon's DNA
        </p>
      </div>
    {:else}
      <div
        class="dnd-container"
        use:dndzone={{ items, flipDurationMs, dropTargetStyle: {} }}
        on:consider={handleDndConsider}
        on:finalize={handleDndFinalize}
      >
        {#each items as chromosome, index (chromosome.id)}
          <div class="sequence-item" tabindex="0">
            <div class="drag-handle" aria-label="Drag to reorder">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16" />
              </svg>
            </div>
            <div class="sequence-number">
              {index + 1}
            </div>
            <div class="flex-1">
              <ChromosomeCard
                chromosome={chromosome}
                showRemove={true}
                onRemove={onRemoveChromosome}
              />
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .sequence-container {
    @apply flex flex-col h-full;
  }

  .sequence-header {
    @apply p-4 border-b border-gray-200 dark:border-gray-700;
    @apply flex items-start justify-between gap-4;
  }

  .stats-badges {
    @apply flex gap-2 flex-shrink-0;
  }

  .stat-badge {
    @apply px-3 py-1 rounded-full text-xs font-medium;
  }

  .stat-badge.value {
    @apply bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200;
  }

  .stat-badge.tool {
    @apply bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200;
  }

  .stat-badge.practice {
    @apply bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200;
  }

  .sequence-list {
    @apply flex-1 p-4 overflow-y-auto;
  }

  .dnd-container {
    @apply space-y-3;
  }

  .sequence-item {
    @apply flex gap-3 items-start;
    @apply transition-all duration-200;
    @apply cursor-move;
  }

  .sequence-item:focus {
    @apply outline-none ring-2 ring-blue-500 dark:ring-blue-400 rounded-lg;
  }

  .drag-handle {
    @apply flex-shrink-0 w-6 text-gray-400 dark:text-gray-600;
    @apply hover:text-gray-600 dark:hover:text-gray-400;
    @apply cursor-grab active:cursor-grabbing;
    @apply transition-colors;
  }

  .sequence-number {
    @apply flex-shrink-0 w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700;
    @apply flex items-center justify-center text-sm font-semibold;
    @apply text-gray-700 dark:text-gray-300;
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
