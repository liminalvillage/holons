<script lang="ts">
  import type { CouncilAdvisorExtended } from '../types/advisor-schema';
  import AdvisorList from './council/AdvisorList.svelte';
  import { getYourCreatedAdvisorsOptions } from '../utils/advisor-filters';

  // Geometry and state passed from parent (Council.svelte)
  export let metatronCircles: Array<{ id: string; x: number; y: number }> = [];
  export let circleRadiusPercent: number = 8;
  export let circleInputs: Record<string, string> = {};
  export let editingCircle: string | null = null;
  export let wishTitle: string = '';

  // Callbacks provided by parent to keep single source of truth
  export let onCircleClick: (circleId: string) => void;
  export let holonAdvisors: CouncilAdvisorExtended[] = [];
  export let onOpenAdvisorChat: (advisor: CouncilAdvisorExtended) => void;
  export let onAddAdvisorToRitual: (advisor: CouncilAdvisorExtended) => void;
  export let onDeleteAdvisor: (advisorName: string) => void;
  export let onCreateAdvisor: () => Promise<void> | void;
  export let getAdvisorDisplayName: (advisorId: string) => string;

  // Bound form fields for creating an advisor
  export let currentAdvisorName = '';
  export let currentAdvisorLens = '';
  export let selectedAdvisorType: 'real' | 'mythic' | 'archetype' = 'real';
  export let isGeneratingAdvisor = false;
  export let generationProgress = '';

  // Optional props for different contexts
  export let showHeader = true;
  export let showTip = true;
</script>

<!-- Header section (can be hidden for modal) -->
{#if showHeader}
  <div class="text-center mb-6">
    <div class="text-5xl mb-4">💠</div>
    <h3 class="text-3xl font-bold text-white mb-2">Seat Your Council</h3>
    <p class="text-gray-300 text-lg">Add, replace, or remove advisors. Seats can be left empty.</p>
    {#if showTip}
      <p class="text-gray-400 text-sm mt-2">Tip: You can seat, replace, or remove advisors anytime by clicking on any circle in the Metatron table.</p>
    {/if}
  </div>
{/if}

<!-- Metatron cube visualization (identical to main page) -->
<div class="metatron-container relative w-full max-w-[600px] mx-auto aspect-square" style="--diam:{circleRadiusPercent * 2}%">
  <!-- Connecting lines -->
  <svg class="absolute inset-0 w-full h-full pointer-events-none" style="z-index: 5;">
    <!-- Lines from center to all other circles -->
    {#each metatronCircles.filter(c => c.id !== 'center') as circle}
      <line 
        x1="50%" y1="50%" 
        x2="{circle.x}%" y2="{circle.y}%" 
        stroke="#c6c6c5" 
        stroke-width="1" 
        opacity="0.6"
      />
    {/each}
    
    <!-- Lines between all circles (except center) -->
    {#each metatronCircles.filter(c => c.id !== 'center') as circle1, i}
      {#each metatronCircles.filter(c => c.id !== 'center' && c.id !== circle1.id).slice(i) as circle2}
        <line 
          x1="{circle1.x}%" y1="{circle1.y}%" 
          x2="{circle2.x}%" y2="{circle2.y}%" 
          stroke="#c6c6c5" 
          stroke-width="0.5" 
          opacity="0.2"
        />
      {/each}
    {/each}
  </svg>
  {#each metatronCircles as circle}
    <div
      class="metatron-circle interactive-circle"
      class:editing={editingCircle === circle.id}
      style="left:{circle.x}%; top:{circle.y}%; width:{circleRadiusPercent * 2}%; height:{circleRadiusPercent * 2}%;"
      data-circle-id={circle.id}
      on:click={() => onCircleClick && onCircleClick(circle.id)}
      on:keydown={(e) => e.key === 'Enter' && onCircleClick && onCircleClick(circle.id)}
      role="button"
      tabindex="0"
    >
      {#if circle.id === 'center'}
        <span class="label-text select-none text-center leading-tight">
          {#if wishTitle}
            {#each wishTitle.split('\n') as word}
              <div class="text-xs font-medium">{word}</div>
            {/each}
          {:else}
            <div class="text-xs opacity-60">Speak</div>
            <div class="text-xs opacity-60">Your</div>
            <div class="text-xs opacity-60">Wish</div>
          {/if}
        </span>
      {:else if circleInputs[circle.id]}
        <span class="label-text select-none">
          {getAdvisorDisplayName(circleInputs[circle.id])}
        </span>
      {/if}
    </div>
  {/each}
</div>

<!-- Your created advisors with Add to Ritual -->
<AdvisorList
  advisors={holonAdvisors}
  context="ritual_modal"
  title="Your Created Advisors:"
  emptyMessage="No advisors created yet."
  availableActions={['chat', 'delete', 'add_to_ritual']}
  columns="grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
  on:chat={(event) => onOpenAdvisorChat && onOpenAdvisorChat(event.detail.advisor)}
  on:delete={(event) => onDeleteAdvisor && onDeleteAdvisor(event.detail.advisor.name)}
  on:addToRitual={(event) => onAddAdvisorToRitual && onAddAdvisorToRitual(event.detail.advisor)}
/>

<!-- Create new advisor (optional) -->
<div class="bg-gray-700 rounded-xl p-6 space-y-4 mt-6">
  <h4 class="text-gray-300 font-medium">Create a New Advisor</h4>
  <div class="grid md:grid-cols-3 gap-4">
    <div>
      <label for="advisor-name" class="block text-gray-300 mb-2">Advisor Name</label>
      <input id="advisor-name" bind:value={currentAdvisorName} placeholder="e.g., Donella Meadows" class="w-full bg-gray-600 border border-gray-500 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
    </div>
    <div>
      <label for="advisor-type" class="block text-gray-300 mb-2">Type</label>
      <select id="advisor-type" bind:value={selectedAdvisorType} class="w-full bg-gray-600 border border-gray-500 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
        <option value="real">Historical/Real Person</option>
        <option value="mythic">Mythic/Spiritual Being</option>
        <option value="archetype">Archetypal Force</option>
      </select>
    </div>
    <div>
      <label for="advisor-lens" class="block text-gray-300 mb-2">Lens/Wisdom</label>
      <input id="advisor-lens" bind:value={currentAdvisorLens} placeholder="e.g., deep ecology" class="w-full bg-gray-600 border border-gray-500 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
    </div>
  </div>
  <button
    on:click={() => onCreateAdvisor && onCreateAdvisor()}
    disabled={!currentAdvisorName.trim() || !currentAdvisorLens.trim() || isGeneratingAdvisor}
    class="group relative w-full bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 disabled:from-gray-600 disabled:to-gray-600 text-white py-4 rounded-xl transition-all duration-200 font-semibold shadow-lg hover:shadow-xl disabled:hover:shadow-lg transform hover:scale-105 disabled:hover:scale-100"
  >
    {#if isGeneratingAdvisor}
      <div class="flex items-center gap-3">
        <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
        {generationProgress}
      </div>
    {:else}
      Create Advisor
    {/if}
    <div class="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 disabled:opacity-0 rounded-xl transition-opacity duration-200"></div>
  </button>
</div>

<style>
  .metatron-container { 
    position: relative; 
  }
  
  .label-text { 
    position: absolute; 
    top: 50%; 
    left: 50%; 
    transform: translate(-50%, -50%); 
    color: #ffffff;
    font-size: clamp(0.5rem, 2vw, 0.75rem);
    text-align: center;
    pointer-events: none;
    white-space: normal;
    word-wrap: break-word;
    max-width: 80%;
    max-height: 80%;
    overflow: hidden;
    line-height: 1.2;
  }

  .metatron-circle {
    position: absolute;
    width: var(--diam);
    height: var(--diam);
    border-radius: 50%;
    background: rgba(198, 198, 197, 0.3);
    transition: all 0.3s ease;
    cursor: pointer;
    transform: translate(-50%, -50%);
    pointer-events: auto;
    z-index: 20;
    border: 2px solid rgba(255, 255, 255, 0.2);
  }

  .metatron-circle:hover {
    background: rgba(198, 198, 197, 0.5);
    border-color: rgba(255, 255, 255, 0.4);
    box-shadow: 0 0 20px rgba(255, 255, 255, 0.3);
  }

  @keyframes pulse {
    0% {
      opacity: 0.8;
    }
    50% {
      opacity: 0.4;
    }
    100% {
      opacity: 0;
    }
  }

  .metatron-circle:hover::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.3);
    animation: pulse 1.5s ease-out infinite;
    pointer-events: none;
  }


</style>


