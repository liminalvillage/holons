<script lang="ts">
  import type { CouncilAdvisorExtended } from '../../types/advisor-schema';
  import { filterAdvisors, searchAdvisors, sortAdvisors, type FilterOptions, type SortOrder } from '../../utils/advisor-filters';
  import AdvisorCard from './AdvisorCard.svelte';
  import { createEventDispatcher } from 'svelte';

  /**
   * HOLONIC ADVISOR LIST COMPONENT
   * 
   * Unified advisor list component that provides consistent layout, filtering, and search
   * across all contexts. Follows holonic principles by composing AdvisorCard components
   * into a self-similar list pattern that works at any scale.
   */

  export let advisors: CouncilAdvisorExtended[] = [];
  
  // Context configuration
  export let context: 'seat_picker' | 'advisor_list' | 'ritual_modal' | 'general' = 'general';
  export let variant: 'compact' | 'standard' | 'detailed' = 'standard';
  
  // Display configuration
  export let title = '';
  export let emptyMessage = 'No advisors found.';
  export let showSearch = false;
  export let showFilters = false;
  export let showSort = false;
  export let maxHeight = ''; // e.g., 'max-h-[50vh]'
  
  // Grid configuration
  export let columns = 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';
  export let gap = 'gap-4';
  
  // Action configuration
  export let availableActions: Array<'chat' | 'seat' | 'delete' | 'add_to_ritual'> = ['chat'];
  export let showActions = true;
  
  // Filter configuration
  export let filterOptions: FilterOptions = {};
  export let excludeSeated: string[] = [];
  
  // Styling
  export let containerClasses = 'bg-gray-700 rounded-xl p-6';
  export let customCardClasses = '';
  export let borderAccent = '';

  const dispatch = createEventDispatcher<{
    chat: { advisor: CouncilAdvisorExtended };
    seat: { advisor: CouncilAdvisorExtended };
    delete: { advisor: CouncilAdvisorExtended };
    addToRitual: { advisor: CouncilAdvisorExtended };
    advisorClick: { advisor: CouncilAdvisorExtended };
  }>();

  // Local state
  let searchQuery = '';
  let sortOrder: SortOrder = 'name_asc';
  let localFilterOptions: FilterOptions = { ...filterOptions };

  // Combine filter options with excludeSeated
  $: combinedFilterOptions = {
    ...localFilterOptions,
    ...filterOptions,
    excludeSeated: excludeSeated.length > 0 ? excludeSeated : filterOptions.excludeSeated,
    searchQuery: searchQuery || filterOptions.searchQuery
  };

  // Apply filtering, searching, and sorting
  $: filteredAdvisors = (() => {
    let result = filterAdvisors(advisors, combinedFilterOptions);
    
    // Apply search if there's a query
    if (searchQuery.trim()) {
      result = searchAdvisors(result, searchQuery);
    }
    
    // Apply sorting
    result = sortAdvisors(result, sortOrder);
    
    return result;
  })();

  // Event handlers
  function handleAdvisorChat(event: CustomEvent<{ advisor: CouncilAdvisorExtended }>) {
    dispatch('chat', event.detail);
  }

  function handleAdvisorSeat(event: CustomEvent<{ advisor: CouncilAdvisorExtended }>) {
    dispatch('seat', event.detail);
  }

  function handleAdvisorDelete(event: CustomEvent<{ advisor: CouncilAdvisorExtended }>) {
    dispatch('delete', event.detail);
  }

  function handleAdvisorAddToRitual(event: CustomEvent<{ advisor: CouncilAdvisorExtended }>) {
    dispatch('addToRitual', event.detail);
  }

  function handleAdvisorClick(event: CustomEvent<{ advisor: CouncilAdvisorExtended }>) {
    dispatch('advisorClick', event.detail);
  }

  // Quick filter functions
  function setQuickFilter(options: Partial<FilterOptions>) {
    localFilterOptions = { ...localFilterOptions, ...options };
  }

  function clearFilters() {
    localFilterOptions = {};
    searchQuery = '';
  }

  function setSortOrder(order: SortOrder) {
    sortOrder = order;
  }
</script>

<div class={containerClasses}>
  <!-- Title -->
  {#if title}
    <div class="mb-4">
      <h4 class="text-gray-300 font-medium">{title}</h4>
    </div>
  {/if}

  <!-- Controls Row -->
  {#if showSearch || showFilters || showSort}
    <div class="mb-4 space-y-3">
      
      <!-- Search -->
      {#if showSearch}
        <div class="relative">
          <input
            type="text"
            placeholder="Search advisors..."
            bind:value={searchQuery}
            class="w-full bg-gray-600 text-white placeholder-gray-400 rounded-lg px-4 py-2 pr-10 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <div class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            <svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>
      {/if}

      <!-- Filters and Sort Row -->
      {#if showFilters || showSort}
        <div class="flex flex-wrap gap-2 items-center">
          
          <!-- Quick Filters -->
          {#if showFilters}
            <div class="flex flex-wrap gap-1">
              <button
                class="px-3 py-1 text-xs rounded bg-gray-600 hover:bg-gray-500 text-white"
                on:click={() => setQuickFilter({ includeUserCreated: true })}
              >
                Your Created
              </button>
              <button
                class="px-3 py-1 text-xs rounded bg-gray-600 hover:bg-gray-500 text-white"
                on:click={() => setQuickFilter({ includeHEC: true })}
              >
                HEC Members
              </button>
              <button
                class="px-3 py-1 text-xs rounded bg-gray-600 hover:bg-gray-500 text-white"
                on:click={() => setQuickFilter({ includeSystemStatic: true })}
              >
                System Advisors
              </button>
              <button
                class="px-3 py-1 text-xs rounded bg-gray-600 hover:bg-gray-500 text-white"
                on:click={() => setQuickFilter({ includeReal: true })}
              >
                Real People
              </button>
              <button
                class="px-3 py-1 text-xs rounded bg-gray-600 hover:bg-gray-500 text-white"
                on:click={() => setQuickFilter({ includeMythic: true })}
              >
                Mythic
              </button>
              <button
                class="px-3 py-1 text-xs rounded bg-gray-600 hover:bg-gray-500 text-white"
                on:click={() => setQuickFilter({ includeArchetype: true })}
              >
                Archetypes
              </button>
              <button
                class="px-2 py-1 text-xs rounded bg-red-600 hover:bg-red-500 text-white"
                on:click={clearFilters}
              >
                Clear
              </button>
            </div>
          {/if}

          <!-- Sort Options -->
          {#if showSort}
            <div class="flex items-center gap-2 ml-auto">
              <span class="text-gray-400 text-sm">Sort:</span>
              <select
                bind:value={sortOrder}
                class="bg-gray-600 text-white text-sm rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="name_asc">Name A→Z</option>
                <option value="name_desc">Name Z→A</option>
                <option value="type_asc">Type A→Z</option>
                <option value="type_desc">Type Z→A</option>
                <option value="created_desc">Newest First</option>
                <option value="created_asc">Oldest First</option>
              </select>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Results Count -->
  {#if showSearch || showFilters}
    <div class="mb-3">
      <p class="text-gray-400 text-sm">
        {filteredAdvisors.length} of {advisors.length} advisor{advisors.length !== 1 ? 's' : ''}
        {searchQuery ? `matching "${searchQuery}"` : ''}
      </p>
    </div>
  {/if}

  <!-- Advisor Grid -->
  {#if filteredAdvisors.length > 0}
    <div class="grid {columns} {gap} {maxHeight} overflow-y-auto">
      {#each filteredAdvisors as advisor (advisor.id || advisor.name)}
        <AdvisorCard
          {advisor}
          {context}
          {variant}
          {availableActions}
          {showActions}
          customClasses={customCardClasses}
          {borderAccent}
          on:chat={handleAdvisorChat}
          on:seat={handleAdvisorSeat}
          on:delete={handleAdvisorDelete}
          on:addToRitual={handleAdvisorAddToRitual}
          on:click={handleAdvisorClick}
        />
      {/each}
    </div>
  {:else}
    <!-- Empty State -->
    <div class="text-center py-8">
      <div class="text-gray-400 text-4xl mb-3">👥</div>
      <p class="text-gray-400 text-sm italic">{emptyMessage}</p>
      {#if searchQuery}
        <button
          class="mt-2 text-indigo-400 hover:text-indigo-300 text-sm underline"
          on:click={() => searchQuery = ''}
        >
          Clear search
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Custom scrollbar for overflow areas */
  .overflow-y-auto::-webkit-scrollbar {
    width: 6px;
  }
  
  .overflow-y-auto::-webkit-scrollbar-track {
    background: rgb(55 65 81); /* gray-700 */
  }
  
  .overflow-y-auto::-webkit-scrollbar-thumb {
    background: rgb(107 114 128); /* gray-500 */
    border-radius: 3px;
  }
  
  .overflow-y-auto::-webkit-scrollbar-thumb:hover {
    background: rgb(75 85 99); /* gray-600 */
  }
</style>

