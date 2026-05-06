// Svelte stores for DNA Editor state management
// Feature: 001-holon-dna-editor

import { writable, derived } from 'svelte/store';
import type { Chromosome, DNASequence } from '$lib/dna/types';

export interface DNAEditorState {
  // Current DNA sequence being edited
  currentSequence: Chromosome[];

  // Available chromosomes in the library
  library: Chromosome[];

  // Selected category filter (null = all)
  selectedCategory: 'value' | 'tool' | 'practice' | null;

  // Loading states
  isLoadingLibrary: boolean;
  isLoadingSequence: boolean;
  isSaving: boolean;

  // Connection status
  isOnline: boolean;
  isSyncing: boolean;

  // UI states
  showLibrary: boolean; // sidebar visibility

  // Errors
  validationErrors: string[];
  saveError: string | null;
}

// Initial state
const initialState: DNAEditorState = {
  currentSequence: [],
  library: [],
  selectedCategory: null,
  isLoadingLibrary: true,
  isLoadingSequence: true,
  isSaving: false,
  isOnline: true,
  isSyncing: false,
  showLibrary: true,
  validationErrors: [],
  saveError: null
};

// Main DNA editor store
export const dnaEditorState = writable<DNAEditorState>(initialState);

// Derived store: filtered library by category
export const filteredLibrary = derived(
  dnaEditorState,
  ($state) => {
    if (!$state.selectedCategory) {
      return $state.library;
    }
    return $state.library.filter(c => c.type === $state.selectedCategory);
  }
);

// Derived store: chromosomes grouped by type
export const libraryByType = derived(
  dnaEditorState,
  ($state) => {
    const grouped: Record<string, Chromosome[]> = {
      value: [],
      tool: [],
      practice: []
    };

    $state.library.forEach(chromosome => {
      grouped[chromosome.type].push(chromosome);
    });

    return grouped;
  }
);

// Derived store: whether DNA sequence can be saved
export const canSave = derived(
  dnaEditorState,
  ($state) => {
    return !$state.isSaving &&
           $state.validationErrors.length === 0 &&
           $state.currentSequence.length > 0 &&
           $state.currentSequence.length <= 20;
  }
);

// Derived store: count of chromosomes by type in current sequence
export const sequenceStats = derived(
  dnaEditorState,
  ($state) => {
    const stats = {
      total: $state.currentSequence.length,
      value: 0,
      tool: 0,
      practice: 0
    };

    $state.currentSequence.forEach(chromosome => {
      stats[chromosome.type]++;
    });

    return stats;
  }
);

// Actions

/**
 * Set the chromosome library
 */
export function setLibrary(library: Chromosome[]) {
  dnaEditorState.update(state => ({
    ...state,
    library,
    isLoadingLibrary: false
  }));
}

/**
 * Set the current DNA sequence
 */
export function setCurrentSequence(chromosomes: Chromosome[]) {
  dnaEditorState.update(state => ({
    ...state,
    currentSequence: chromosomes,
    isLoadingSequence: false,
    validationErrors: [] // Clear errors when setting new sequence
  }));
}

/**
 * Add a chromosome to the current sequence
 */
export function addChromosomeToSequence(chromosome: Chromosome) {
  dnaEditorState.update(state => {
    // Check if already in sequence
    if (state.currentSequence.find(c => c.id === chromosome.id)) {
      return state;
    }

    // Check max length
    if (state.currentSequence.length >= 20) {
      return {
        ...state,
        validationErrors: ['Maximum 20 chromosomes allowed']
      };
    }

    return {
      ...state,
      currentSequence: [...state.currentSequence, chromosome],
      validationErrors: []
    };
  });
}

/**
 * Remove a chromosome from the current sequence
 */
export function removeChromosomeFromSequence(chromosomeId: string) {
  dnaEditorState.update(state => ({
    ...state,
    currentSequence: state.currentSequence.filter(c => c.id !== chromosomeId),
    validationErrors: []
  }));
}

/**
 * Reorder chromosomes in the sequence
 */
export function reorderSequence(newOrder: Chromosome[]) {
  dnaEditorState.update(state => ({
    ...state,
    currentSequence: newOrder
  }));
}

/**
 * Set the category filter
 */
export function setCategory(category: 'value' | 'tool' | 'practice' | null) {
  dnaEditorState.update(state => ({
    ...state,
    selectedCategory: category
  }));
}

/**
 * Toggle library sidebar visibility
 */
export function toggleLibrary() {
  dnaEditorState.update(state => ({
    ...state,
    showLibrary: !state.showLibrary
  }));
}

/**
 * Set saving state
 */
export function setSaving(isSaving: boolean) {
  dnaEditorState.update(state => ({
    ...state,
    isSaving
  }));
}

/**
 * Set online/offline status
 */
export function setOnlineStatus(isOnline: boolean) {
  dnaEditorState.update(state => ({
    ...state,
    isOnline
  }));
}

/**
 * Set syncing status
 */
export function setSyncingStatus(isSyncing: boolean) {
  dnaEditorState.update(state => ({
    ...state,
    isSyncing
  }));
}

/**
 * Set validation errors
 */
export function setValidationErrors(errors: string[]) {
  dnaEditorState.update(state => ({
    ...state,
    validationErrors: errors
  }));
}

/**
 * Set save error
 */
export function setSaveError(error: string | null) {
  dnaEditorState.update(state => ({
    ...state,
    saveError: error
  }));
}

/**
 * Reset the editor state
 */
export function resetEditor() {
  dnaEditorState.set(initialState);
}
