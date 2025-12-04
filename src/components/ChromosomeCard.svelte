<script lang="ts">
  // ChromosomeCard component - Individual chromosome display
  // Feature: 001-holon-dna-editor

  import type { Chromosome } from '$lib/dna/types';

  interface Props {
    chromosome: Chromosome;
    onSelect?: (id: string) => void;
    onRemove?: (id: string) => void;
    selected?: boolean;
    showRemove?: boolean;
  }

  let {
    chromosome,
    onSelect,
    onRemove,
    selected = false,
    showRemove = false
  }: Props = $props();

  // Debug logging
  $effect(() => {
    console.log('[ChromosomeCard] Rendering chromosome:', {
      id: chromosome.id,
      name: chromosome.name,
      type: chromosome.type,
      description: chromosome.description,
      icon: chromosome.icon,
      selected,
      showRemove,
      hasOnSelect: !!onSelect
    });
  });

  function handleClick() {
    if (onSelect) {
      onSelect(chromosome.id);
    }
  }

  function handleRemove(e: MouseEvent) {
    e.stopPropagation();
    if (onRemove) {
      onRemove(chromosome.id);
    }
  }

  // Get type-specific color classes
  const typeColors = {
    value: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    tool: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    practice: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
  };

  const typeColor = $derived(typeColors[chromosome.type]);
</script>

<div
  class="card"
  class:selected
  class:clickable={!!onSelect}
  onclick={handleClick}
  role={onSelect ? 'button' : 'article'}
  tabindex={onSelect ? 0 : undefined}
  onkeydown={(e) => {
    if (onSelect && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      handleClick();
    }
  }}
  data-chromosome-id={chromosome.id}
>
  <div class="card-content">
    {#if chromosome.icon}
      <span class="icon">{chromosome.icon}</span>
    {/if}
    <div class="flex-1 min-w-0">
      <div class="flex items-start justify-between gap-2 mb-1">
        <h3 class="card-title">
          {chromosome.name || 'Unnamed'}
        </h3>
        {#if showRemove}
          <button
            type="button"
            class="remove-btn"
            onclick={handleRemove}
            aria-label="Remove {chromosome.name}"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        {/if}
      </div>
      <p class="card-description">
        {chromosome.description || 'No description'}
      </p>
      <span class="badge {typeColor}">
        {chromosome.type}
      </span>
    </div>
  </div>
</div>

<style>
  .card {
    @apply bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm;
    @apply text-gray-900 dark:text-gray-100;
    transition: all 0.2s ease-in-out;
    min-height: 100px;
    display: flex;
    flex-direction: column;
  }

  .card.clickable {
    @apply cursor-pointer;
  }

  .card.clickable:hover {
    @apply shadow-lg transform -translate-y-0.5;
  }

  .card.selected {
    @apply ring-2 ring-blue-500 dark:ring-blue-400;
  }

  .card-content {
    @apply p-4 flex items-start gap-3;
    flex: 1;
    width: 100%;
  }

  .icon {
    @apply text-2xl flex-shrink-0;
    line-height: 1;
  }

  .card-title {
    @apply font-semibold text-base text-gray-900 dark:text-gray-100;
  }

  .card-description {
    @apply text-sm text-gray-600 dark:text-gray-400 mt-1 mb-2;
    line-height: 1.4;
    display: block;
    word-wrap: break-word;
  }

  .badge {
    @apply inline-block px-2 py-1 rounded-full text-xs font-medium;
    text-transform: capitalize;
  }

  .remove-btn {
    @apply text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors flex-shrink-0 p-1;
  }

  .remove-btn:hover {
    @apply bg-red-50 dark:bg-red-900/20 rounded;
  }
</style>
