<script lang="ts">
  import type { CouncilAdvisorExtended } from '../../types/advisor-schema';
  import { getAdvisorPermissions } from '../../utils/advisor-permissions';
  import { createEventDispatcher } from 'svelte';

  /**
   * HOLONIC ADVISOR CARD COMPONENT
   * 
   * Unified advisor display component that provides consistent UI across all contexts.
   * Follows holonic principles by being self-similar - works the same whether displaying
   * one advisor or in a grid of hundreds.
   */

  export let advisor: CouncilAdvisorExtended;
  
  // Context configuration
  export let context: 'seat_picker' | 'advisor_list' | 'ritual_modal' | 'general' = 'general';
  export let variant: 'compact' | 'standard' | 'detailed' = 'standard';
  
  // Action configuration
  export let showActions = true;
  export let availableActions: Array<'chat' | 'seat' | 'delete' | 'add_to_ritual'> = ['chat'];
  
  // Custom styling
  export let customClasses = '';
  export let borderAccent = ''; // e.g., 'border-l-4 border-green-500'
  
  // Disable interactivity
  export let disabled = false;

  const dispatch = createEventDispatcher<{
    chat: { advisor: CouncilAdvisorExtended };
    seat: { advisor: CouncilAdvisorExtended };
    delete: { advisor: CouncilAdvisorExtended };
    addToRitual: { advisor: CouncilAdvisorExtended };
    click: { advisor: CouncilAdvisorExtended };
  }>();

  // Get permissions for this advisor in this context
  $: permissions = getAdvisorPermissions(advisor, { location: context });

  // Calculate which actions should actually be shown
  $: visibleActions = availableActions.filter(action => {
    switch (action) {
      case 'delete': return permissions.canDelete;
      case 'chat': return permissions.canChat;
      case 'seat': return permissions.canSeat;
      case 'add_to_ritual': return permissions.canAddToRitual;
      default: return true;
    }
  });

  // Handle action clicks
  function handleAction(action: string) {
    if (disabled) return;
    
    switch (action) {
      case 'chat':
        dispatch('chat', { advisor });
        break;
      case 'seat':
        dispatch('seat', { advisor });
        break;
      case 'delete':
        if (confirm(`Delete ${advisor.name}? This cannot be undone.`)) {
          dispatch('delete', { advisor });
        }
        break;
      case 'add_to_ritual':
        dispatch('addToRitual', { advisor });
        break;
    }
  }

  function handleCardClick() {
    if (disabled) return;
    dispatch('click', { advisor });
  }

  // Dynamic styling based on variant and state
  $: cardClasses = [
    // Base styles
    'bg-gray-600 rounded-xl transition-colors relative',
    
    // Variant-specific spacing
    variant === 'compact' ? 'p-3' : 'p-4',
    
    // Hover effects (if not disabled)
    !disabled ? 'hover:bg-gray-500 cursor-pointer' : 'opacity-75',
    
    // Custom classes
    customClasses,
    
    // Border accent
    borderAccent
  ].filter(Boolean).join(' ');

  // Action button configurations
  const actionConfigs: Record<string, {
    label: string;
    classes: string;
    fullLabel: string;
    isFloating?: boolean;
  }> = {
    chat: {
      label: '💬 Chat',
      classes: 'bg-indigo-600 hover:bg-indigo-700',
      fullLabel: 'Chat'
    },
    seat: {
      label: 'Seat',
      classes: 'bg-green-600 hover:bg-green-700',
      fullLabel: 'Seat'
    },
    delete: {
      label: '✕',
      classes: 'absolute top-2 right-2 text-gray-300 hover:text-red-400 bg-transparent hover:bg-red-900/20 rounded p-1',
      fullLabel: 'Delete',
      isFloating: true
    },
    add_to_ritual: {
      label: '➕ Add to Ritual',
      classes: 'bg-green-600 hover:bg-green-700',
      fullLabel: 'Add to Ritual'
    }
  };
</script>

<div 
  class={cardClasses}
  on:click={handleCardClick}
  on:keydown={(e) => e.key === 'Enter' && handleCardClick()}
  role="button"
  tabindex={disabled ? -1 : 0}
  aria-label="Advisor: {advisor.name}"
>
  <!-- Floating actions (like delete X) -->
  {#if showActions}
    {#each visibleActions.filter(action => actionConfigs[action]?.isFloating) as action}
      <button
        class={actionConfigs[action].classes}
        title={actionConfigs[action].fullLabel}
        on:click|stopPropagation={() => handleAction(action)}
        disabled={disabled}
      >
        {actionConfigs[action].label}
      </button>
    {/each}
  {/if}

  <!-- Main content area -->
  <div class="flex {visibleActions.some(a => actionConfigs[a]?.isFloating) ? 'pr-8' : ''} mb-3">
    <div class="flex-1">
      <!-- Name -->
      <h5 class="text-white font-bold {variant === 'compact' ? 'text-sm' : ''}">
        {advisor.name}
      </h5>
      
      <!-- Type -->
      <p class="text-gray-300 {variant === 'compact' ? 'text-xs' : 'text-sm'} capitalize">
        {advisor.type}
      </p>
      
      <!-- Lens -->
      {#if advisor.lens}
        <p class="text-gray-300 {variant === 'compact' ? 'text-xs' : 'text-sm'} italic">
          "{advisor.lens}"
        </p>
      {/if}

      <!-- Additional details for detailed variant -->
      {#if variant === 'detailed'}
        {#if advisor.createdAt}
          <p class="text-gray-400 text-xs mt-1">
            Created: {new Date(advisor.createdAt).toLocaleDateString()}
          </p>
        {/if}
        
        {#if permissions.isHECMember}
          <span class="inline-block bg-purple-600 text-white text-xs px-2 py-1 rounded mt-1">
            HEC Member
          </span>
        {:else if permissions.isSystemStatic}
          <span class="inline-block bg-blue-600 text-white text-xs px-2 py-1 rounded mt-1">
            System Advisor
          </span>
        {:else if permissions.isUserCreated}
          <span class="inline-block bg-green-600 text-white text-xs px-2 py-1 rounded mt-1">
            Your Creation
          </span>
        {/if}
      {/if}
    </div>
    
    <!-- Right-aligned content (like compact actions) -->
    {#if variant === 'compact' && visibleActions.includes('chat')}
      <div class="text-blue-400 text-sm ml-2">
        💬
      </div>
    {/if}
  </div>

  <!-- Action buttons (non-floating) -->
  {#if showActions && visibleActions.some(action => !actionConfigs[action]?.isFloating)}
    <div class="flex gap-2">
      {#each visibleActions.filter(action => !actionConfigs[action]?.isFloating) as action}
        <button
          class="flex-1 {actionConfigs[action].classes} text-white py-2 px-3 rounded-lg {variant === 'compact' ? 'text-xs' : 'text-sm'} transition-colors"
          on:click|stopPropagation={() => handleAction(action)}
          disabled={disabled}
        >
          {variant === 'compact' && action === 'add_to_ritual' ? '➕' : actionConfigs[action].label}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* Ensure smooth transitions and accessibility */
  div[role="button"]:focus {
    outline: 2px solid #3b82f6;
    outline-offset: 2px;
  }
  
  div[role="button"]:focus-visible {
    outline: 2px solid #3b82f6;
    outline-offset: 2px;
  }
</style>
