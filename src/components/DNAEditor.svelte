<script lang="ts">
  // DNAEditor component - Main DNA editor interface
  // Feature: 001-holon-dna-editor

  import { onMount, onDestroy } from 'svelte';
  import type HoloSphere from 'holosphere';
  import type { Chromosome } from '$lib/dna/types';
  import {
    getDNASequence,
    getChromosomeLibrary,
    getChromosome,
    saveDNASequence,
    subscribeToDNASequence,
    subscribeToChromosomeLibrary,
    seedChromosomeLibrary,
    removeChromosome,
    addChromosome
  } from '$lib/dna/holosphere';
  import { validateDNASequence } from '$lib/dna/validation';
  import ChromosomeLibrary from './ChromosomeLibrary.svelte';
  import DNASequence from './DNASequence.svelte';

  interface Props {
    holosphere: HoloSphere;
    holonId: string;
  }

  let { holosphere, holonId }: Props = $props();

  // State
  let library = $state<Chromosome[]>([]);
  let currentSequence = $state<Chromosome[]>([]);
  let isLoadingLibrary = $state(true);
  let isLoadingSequence = $state(true);
  let isSaving = $state(false);
  let isSeeding = $state(false);
  let showLibrary = $state(true);
  let saveError = $state<string | null>(null);
  let saveSuccess = $state(false);
  let currentVersion = $state(0);
  let isOnline = $state(true);
  let isSyncing = $state(false);
  let showAddModal = $state(false);
  let isAdding = $state(false);

  // Unsubscribe functions
  let unsubscribeDNA: (() => void) | null = null;
  let unsubscribeLibrary: (() => void) | null = null;

  // Derived
  const selectedChromosomeIds = $derived(currentSequence.map(c => c.id));
  const hasUnsavedChanges = $state(false);

  onMount(async () => {
    console.log('[DNAEditor] onMount - holosphere:', holosphere, 'holonId:', holonId);
    await loadInitialData();
    setupRealTimeSync();
  });

  onDestroy(() => {
    // Clean up subscriptions
    if (unsubscribeDNA) unsubscribeDNA();
    if (unsubscribeLibrary) unsubscribeLibrary();
  });

  async function loadInitialData() {
    try {
      // Load library first
      const libraryData = await getChromosomeLibrary(holosphere, holonId);
      console.log('Loaded library data:', libraryData, 'length:', libraryData.length);

      // Filter out chromosomes with no names
      const validChromosomes = libraryData.filter(c => c.name && c.name.trim() !== '');
      const invalidCount = libraryData.length - validChromosomes.length;

      if (invalidCount > 0) {
        console.log(`Found ${invalidCount} chromosomes with no names, cleaning up...`);
        // Remove invalid chromosomes
        for (const chromosome of libraryData) {
          if (!chromosome.name || chromosome.name.trim() === '') {
            await removeChromosome(holosphere, holonId, chromosome.id);
          }
        }
      }

      // If library is empty, seed it with default chromosomes
      if (validChromosomes.length === 0) {
        console.log('Library is empty, seeding with default chromosomes...');
        isSeeding = true;
        await seedChromosomeLibrary(holosphere, holonId);

        // Wait a moment for holosphere to propagate
        await new Promise(resolve => setTimeout(resolve, 500));

        // Reload the library
        const reloadedLibrary = await getChromosomeLibrary(holosphere, holonId);
        const reloadedValid = reloadedLibrary.filter(c => c.name && c.name.trim() !== '');
        console.log('After seeding, library has:', reloadedValid.length, 'valid chromosomes');
        library = reloadedValid;
        isSeeding = false;
      } else {
        library = validChromosomes;
        console.log('Using existing library with', validChromosomes.length, 'valid chromosomes');
      }

      isLoadingLibrary = false;

      // Load DNA sequence
      const dnaData = await getDNASequence(holosphere, holonId);

      if (dnaData) {
        // Load full chromosome objects from IDs
        const chromosomePromises = dnaData.chromosomeIds.map(id =>
          getChromosome(holosphere, holonId, id)
        );
        const chromosomes = await Promise.all(chromosomePromises);
        currentSequence = chromosomes.filter(c => c !== null) as Chromosome[];
        currentVersion = dnaData.version || 0;
      }

      isLoadingSequence = false;
    } catch (error) {
      console.error('Failed to load DNA editor data:', error);
      isLoadingLibrary = false;
      isLoadingSequence = false;
    }
  }

  function setupRealTimeSync() {
    // Subscribe to DNA sequence changes
    unsubscribeDNA = subscribeToDNASequence(holosphere, holonId, async (dna) => {
      if (dna && dna.version > currentVersion) {
        isSyncing = true;
        // Load updated chromosomes
        const chromosomePromises = dna.chromosomeIds.map(id =>
          getChromosome(holosphere, holonId, id)
        );
        const chromosomes = await Promise.all(chromosomePromises);
        currentSequence = chromosomes.filter(c => c !== null) as Chromosome[];
        currentVersion = dna.version;
        isSyncing = false;
      }
    });

    // Subscribe to library changes
    unsubscribeLibrary = subscribeToChromosomeLibrary(holosphere, holonId, (chromosome, chromosomeId) => {
      if (chromosome === null) {
        // Chromosome removed
        library = library.filter(c => c.id !== chromosomeId);
      } else {
        // Chromosome added or updated - only update if it exists or has a valid name
        if (!chromosome.name) {
          console.log('[DNAEditor] Skipping chromosome with no name:', chromosomeId);
          return;
        }

        const existingIndex = library.findIndex(c => c.id === chromosome.id);
        if (existingIndex >= 0) {
          // Update existing chromosome
          library[existingIndex] = chromosome;
          library = [...library]; // Trigger reactivity
        } else {
          // Check if we already have this chromosome by ID to prevent duplicates
          const alreadyExists = library.some(c => c.id === chromosome.id);
          if (!alreadyExists) {
            library = [...library, chromosome];
          }
        }
      }
    });
  }

  async function handleSave() {
    if (isSaving) return;

    try {
      isSaving = true;
      saveError = null;
      saveSuccess = false;

      // Validate before saving
      const validation = validateDNASequence(
        {
          holonId,
          chromosomeIds: currentSequence.map(c => c.id),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          version: currentVersion + 1
        },
        library
      );

      if (!validation.isValid) {
        saveError = validation.errors.join(', ');
        isSaving = false;
        return;
      }

      // Save to holosphere
      const saved = await saveDNASequence(
        holosphere,
        holonId,
        currentSequence.map(c => c.id),
        currentVersion
      );

      currentVersion = saved.version;
      saveSuccess = true;
      setTimeout(() => {
        saveSuccess = false;
      }, 3000);
    } catch (error) {
      console.error('Failed to save DNA:', error);
      saveError = error instanceof Error ? error.message : 'Failed to save DNA sequence';
      isOnline = false; // Assume offline on error
    } finally {
      isSaving = false;
    }
  }

  function handleSelectChromosome(chromosomeId: string) {
    // Check if already in sequence
    if (selectedChromosomeIds.includes(chromosomeId)) {
      return;
    }

    // Check max length
    if (currentSequence.length >= 20) {
      alert('Maximum 20 chromosomes allowed in DNA sequence');
      return;
    }

    // Find chromosome in library and add to sequence
    const chromosome = library.find(c => c.id === chromosomeId);
    if (chromosome) {
      currentSequence = [...currentSequence, chromosome];
    }
  }

  function handleRemoveChromosome(chromosomeId: string) {
    currentSequence = currentSequence.filter(c => c.id !== chromosomeId);
  }

  function handleReorderSequence(newOrder: Chromosome[]) {
    currentSequence = newOrder;
  }

  function toggleLibrary() {
    showLibrary = !showLibrary;
  }

  async function handleManualSeed() {
    try {
      isSeeding = true;
      console.log('Manually seeding chromosome library...');
      await seedChromosomeLibrary(holosphere, holonId);

      // Wait for holosphere to propagate
      await new Promise(resolve => setTimeout(resolve, 500));

      library = await getChromosomeLibrary(holosphere, holonId);
      console.log('Manual seed complete, library now has:', library.length, 'chromosomes');
      isSeeding = false;
    } catch (error) {
      console.error('Failed to seed library:', error);
      isSeeding = false;
    }
  }

  async function handleDeleteChromosome(chromosomeId: string) {
    try {
      console.log('[DNAEditor] Deleting chromosome:', chromosomeId);

      // Remove from library
      await removeChromosome(holosphere, holonId, chromosomeId);

      // Also remove from current sequence if present
      if (currentSequence.some(c => c.id === chromosomeId)) {
        currentSequence = currentSequence.filter(c => c.id !== chromosomeId);
      }

      // Update local library state immediately for better UX
      library = library.filter(c => c.id !== chromosomeId);

      console.log('[DNAEditor] Chromosome deleted successfully');
    } catch (error) {
      console.error('[DNAEditor] Failed to delete chromosome:', error);
      alert('Failed to delete chromosome. Please try again.');
    }
  }

  async function handleAddChromosome(chromosomeData: { name: string; type: 'value' | 'tool' | 'practice'; description: string; icon?: string }) {
    try {
      isAdding = true;
      console.log('[DNAEditor] Adding chromosome:', chromosomeData);

      const newChromosome = await addChromosome(holosphere, holonId, {
        ...chromosomeData,
        holonId
      });

      console.log('[DNAEditor] Chromosome added successfully:', newChromosome);

      // Local state will be updated by subscription
      showAddModal = false;
      isAdding = false;
    } catch (error) {
      console.error('[DNAEditor] Failed to add chromosome:', error);
      alert(error instanceof Error ? error.message : 'Failed to add chromosome. Please try again.');
      isAdding = false;
    }
  }
</script>

<div class="dna-editor">
  <!-- Header with Save Button and Status -->
  <header class="editor-header">
    <div class="header-content">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
        DNA Editor
      </h1>

      <div class="header-actions">
        <!-- Connection Status -->
        <div class="status-indicator">
          {#if isSyncing}
            <span class="status-badge syncing">
              <svg class="animate-spin w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Syncing...
            </span>
          {:else if !isOnline}
            <span class="status-badge offline">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414" />
              </svg>
              Offline
            </span>
          {:else}
            <span class="status-badge online">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
              Online
            </span>
          {/if}
        </div>

        <!-- Add Chromosome Button -->
        <button
          type="button"
          class="btn-add"
          onclick={() => showAddModal = true}
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          Add Chromosome
        </button>

        <!-- Seed Button -->
        {#if library.length === 0 && !isLoadingLibrary && !isSeeding}
          <button
            type="button"
            class="btn-seed"
            onclick={handleManualSeed}
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Add Default Chromosomes
          </button>
        {/if}

        {#if isSeeding}
          <div class="status-badge syncing">
            <svg class="animate-spin w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Adding chromosomes...
          </div>
        {/if}

        <!-- Save Button -->
        <button
          type="button"
          class="btn-save"
          onclick={handleSave}
          disabled={isSaving || currentSequence.length === 0}
        >
          {#if isSaving}
            <svg class="animate-spin w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Saving...
          {:else}
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            Save DNA
          {/if}
        </button>
      </div>
    </div>

    <!-- Notifications -->
    {#if saveSuccess}
      <div class="notification success">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        DNA sequence saved successfully!
      </div>
    {/if}

    {#if saveError}
      <div class="notification error">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {saveError}
        <button
          type="button"
          class="ml-2 text-sm underline"
          onclick={() => saveError = null}
        >
          Dismiss
        </button>
      </div>
    {/if}
  </header>

  <!-- Main Content Area -->
  <div class="editor-content">
    <!-- Sidebar: Chromosome Library -->
    <aside class="library-sidebar" class:collapsed={!showLibrary}>
    <button
      type="button"
      class="toggle-btn"
      onclick={toggleLibrary}
      aria-label={showLibrary ? 'Hide library' : 'Show library'}
    >
      <svg
        class="w-5 h-5 transition-transform"
        class:rotate-180={!showLibrary}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
    </button>

    {#if showLibrary}
      <ChromosomeLibrary
        {library}
        {selectedChromosomeIds}
        onSelectChromosome={handleSelectChromosome}
        onDeleteChromosome={handleDeleteChromosome}
        isLoading={isLoadingLibrary}
      />
    {/if}
  </aside>

    <!-- Main: DNA Sequence -->
    <main class="sequence-main">
      <DNASequence
        sequence={currentSequence}
        onRemoveChromosome={handleRemoveChromosome}
        onReorderSequence={handleReorderSequence}
        isLoading={isLoadingSequence}
      />
    </main>
  </div>

  <!-- Add Chromosome Modal -->
  {#if showAddModal}
    <div class="modal-overlay" onclick={() => showAddModal = false}>
      <div class="modal-content" onclick={(e) => e.stopPropagation()}>
        <h2 class="modal-title">Add New Chromosome</h2>

        <form onsubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          handleAddChromosome({
            name: formData.get('name') as string,
            type: formData.get('type') as 'value' | 'tool' | 'practice',
            description: formData.get('description') as string,
            icon: formData.get('icon') as string || undefined
          });
        }}>
          <div class="form-group">
            <label for="name">Name *</label>
            <input
              type="text"
              id="name"
              name="name"
              required
              class="input"
              placeholder="e.g., Collaboration"
            />
          </div>

          <div class="form-group">
            <label for="type">Type *</label>
            <select id="type" name="type" required class="input">
              <option value="value">Value</option>
              <option value="tool">Tool</option>
              <option value="practice">Practice</option>
            </select>
          </div>

          <div class="form-group">
            <label for="icon">Icon (emoji)</label>
            <input
              type="text"
              id="icon"
              name="icon"
              class="input"
              placeholder="e.g., 🤝"
              maxlength="4"
            />
          </div>

          <div class="form-group">
            <label for="description">Description *</label>
            <textarea
              id="description"
              name="description"
              required
              class="input"
              rows="4"
              placeholder="Describe this chromosome..."
            ></textarea>
          </div>

          <div class="modal-actions">
            <button
              type="button"
              class="btn-cancel"
              onclick={() => showAddModal = false}
              disabled={isAdding}
            >
              Cancel
            </button>
            <button
              type="submit"
              class="btn-submit"
              disabled={isAdding}
            >
              {#if isAdding}
                <svg class="animate-spin w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Adding...
              {:else}
                Add Chromosome
              {/if}
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}
</div>

<style>
  .dna-editor {
    @apply flex flex-col h-full bg-gray-50 dark:bg-gray-900;
  }

  .editor-header {
    @apply bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700;
    @apply px-6 py-4 flex-shrink-0;
  }

  .header-content {
    @apply flex items-center justify-between gap-4;
  }

  .header-actions {
    @apply flex items-center gap-4;
  }

  .status-indicator {
    @apply flex items-center;
  }

  .status-badge {
    @apply flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium;
  }

  .status-badge.online {
    @apply bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200;
  }

  .status-badge.offline {
    @apply bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200;
  }

  .status-badge.syncing {
    @apply bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200;
  }

  .btn-save {
    @apply flex items-center gap-2 px-4 py-2 rounded-lg;
    @apply bg-blue-600 dark:bg-blue-500 text-white;
    @apply hover:bg-blue-700 dark:hover:bg-blue-600;
    @apply disabled:opacity-50 disabled:cursor-not-allowed;
    @apply transition-all font-medium shadow-sm;
  }

  .btn-save:not(:disabled):hover {
    @apply shadow-md;
  }

  .btn-add {
    @apply flex items-center gap-2 px-4 py-2 rounded-lg;
    @apply bg-purple-600 dark:bg-purple-500 text-white;
    @apply hover:bg-purple-700 dark:hover:bg-purple-600;
    @apply transition-all font-medium shadow-sm;
  }

  .btn-add:hover {
    @apply shadow-md;
  }

  .btn-seed {
    @apply flex items-center gap-2 px-4 py-2 rounded-lg;
    @apply bg-green-600 dark:bg-green-500 text-white;
    @apply hover:bg-green-700 dark:hover:bg-green-600;
    @apply transition-all font-medium shadow-sm;
  }

  .btn-seed:hover {
    @apply shadow-md;
  }

  .notification {
    @apply flex items-center gap-2 px-4 py-3 mt-3 rounded-lg text-sm font-medium;
  }

  .notification.success {
    @apply bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200;
  }

  .notification.error {
    @apply bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200;
  }

  .editor-content {
    @apply flex flex-1 overflow-hidden;
  }

  .library-sidebar {
    @apply w-96 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700;
    @apply flex-shrink-0 relative transition-all duration-300;
  }

  .library-sidebar.collapsed {
    @apply w-12;
  }

  .toggle-btn {
    @apply absolute top-4 -right-3 z-10;
    @apply w-6 h-6 rounded-full bg-white dark:bg-gray-800;
    @apply border border-gray-300 dark:border-gray-600;
    @apply flex items-center justify-center;
    @apply text-gray-600 dark:text-gray-400;
    @apply hover:bg-gray-100 dark:hover:bg-gray-700;
    @apply transition-colors shadow-sm;
  }

  .sequence-main {
    @apply flex-1 bg-white dark:bg-gray-800;
    @apply overflow-hidden;
  }

  /* Responsive design */
  @media (max-width: 768px) {
    .editor-content {
      @apply flex-col;
    }

    .header-content {
      @apply flex-col items-start gap-3;
    }

    .header-actions {
      @apply w-full justify-between;
    }

    .library-sidebar {
      @apply w-full border-r-0 border-b border-gray-200 dark:border-gray-700;
      @apply max-h-64;
    }

    .library-sidebar.collapsed {
      @apply max-h-12 w-full;
    }

    .toggle-btn {
      @apply top-auto bottom-4 right-4;
    }
  }

  /* Modal styles */
  .modal-overlay {
    @apply fixed inset-0 z-50;
    @apply bg-black/50 dark:bg-black/70;
    @apply flex items-center justify-center;
    @apply p-4;
  }

  .modal-content {
    @apply bg-white dark:bg-gray-800;
    @apply rounded-lg shadow-xl;
    @apply max-w-lg w-full;
    @apply p-6;
    @apply max-h-[90vh] overflow-y-auto;
  }

  .modal-title {
    @apply text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6;
  }

  .form-group {
    @apply mb-4;
  }

  .form-group label {
    @apply block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2;
  }

  .input {
    @apply w-full px-3 py-2 rounded-lg;
    @apply border border-gray-300 dark:border-gray-600;
    @apply bg-white dark:bg-gray-700;
    @apply text-gray-900 dark:text-gray-100;
    @apply focus:outline-none focus:ring-2 focus:ring-purple-500 dark:focus:ring-purple-400;
    @apply transition-colors;
  }

  .modal-actions {
    @apply flex gap-3 justify-end mt-6;
  }

  .btn-cancel {
    @apply px-4 py-2 rounded-lg;
    @apply bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200;
    @apply hover:bg-gray-300 dark:hover:bg-gray-600;
    @apply disabled:opacity-50 disabled:cursor-not-allowed;
    @apply transition-all font-medium;
  }

  .btn-submit {
    @apply flex items-center gap-2 px-4 py-2 rounded-lg;
    @apply bg-purple-600 dark:bg-purple-500 text-white;
    @apply hover:bg-purple-700 dark:hover:bg-purple-600;
    @apply disabled:opacity-50 disabled:cursor-not-allowed;
    @apply transition-all font-medium;
  }
</style>
