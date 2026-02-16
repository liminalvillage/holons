/**
 * AD4M Configuration Store
 *
 * Manages connection settings for the AD4M executor with localStorage persistence.
 * Controls which backend is active (holosphere, ad4m, or dual-write mode).
 *
 * @module ad4m/config
 */

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';

// =============================================================================
// Types
// =============================================================================

/** Which backend to use for data operations */
export type BackendMode = 'holosphere' | 'ad4m' | 'dual';

/** Full AD4M configuration state */
export interface Ad4mConfig {
  /** WebSocket URL of the AD4M executor's GraphQL endpoint */
  executorUrl: string;
  /** JWT authentication token */
  token: string;
  /** Which backend mode is active */
  mode: BackendMode;
  /** Whether to auto-connect on app startup */
  autoConnect: boolean;
  /** Perspective UUID to use for the current holon (optional override) */
  perspectiveUuid?: string;
}

/** Default configuration */
const DEFAULT_CONFIG: Ad4mConfig = {
  executorUrl: 'ws://localhost:12000/graphql',
  token: '',
  mode: 'holosphere',
  autoConnect: false,
};

/** localStorage key for persisting config */
const STORAGE_KEY = 'harvest-ad4m-config';

// =============================================================================
// Store
// =============================================================================

/**
 * Load configuration from localStorage (if available).
 */
function loadFromStorage(): Ad4mConfig {
  if (!browser) return { ...DEFAULT_CONFIG };

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to handle added fields in future versions
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch (e) {
    console.warn('[Ad4mConfig] Failed to load from localStorage:', e);
  }

  return { ...DEFAULT_CONFIG };
}

/**
 * Save configuration to localStorage.
 */
function saveToStorage(config: Ad4mConfig): void {
  if (!browser) return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.warn('[Ad4mConfig] Failed to save to localStorage:', e);
  }
}

/**
 * Create the AD4M configuration store with localStorage persistence.
 */
function createAd4mConfigStore() {
  const { subscribe, set, update } = writable<Ad4mConfig>(loadFromStorage());

  // Auto-save to localStorage on every change
  let skipFirstSave = true; // Skip the initial load trigger
  subscribe((config) => {
    if (skipFirstSave) {
      skipFirstSave = false;
      return;
    }
    saveToStorage(config);
  });

  return {
    subscribe,

    /** Set the executor URL */
    setExecutorUrl(url: string) {
      update((c) => ({ ...c, executorUrl: url }));
    },

    /** Set the authentication token */
    setToken(token: string) {
      update((c) => ({ ...c, token }));
    },

    /** Set the backend mode */
    setMode(mode: BackendMode) {
      update((c) => ({ ...c, mode }));
    },

    /** Set the auto-connect flag */
    setAutoConnect(autoConnect: boolean) {
      update((c) => ({ ...c, autoConnect }));
    },

    /** Set a specific perspective UUID override */
    setPerspectiveUuid(uuid: string | undefined) {
      update((c) => ({ ...c, perspectiveUuid: uuid }));
    },

    /** Replace the entire config */
    setConfig(config: Partial<Ad4mConfig>) {
      update((c) => ({ ...c, ...config }));
    },

    /** Reset to defaults */
    reset() {
      set({ ...DEFAULT_CONFIG });
    },

    /** Get current config value (non-reactive) */
    getConfig(): Ad4mConfig {
      return get({ subscribe });
    },
  };
}

/** The AD4M configuration store */
export const ad4mConfig = createAd4mConfigStore();

// =============================================================================
// Derived Stores
// =============================================================================

/** Whether AD4M mode is enabled (ad4m or dual) */
export const isAd4mEnabled = derived(ad4mConfig, ($config) => $config.mode !== 'holosphere');

/** Whether we're in dual-write mode */
export const isDualMode = derived(ad4mConfig, ($config) => $config.mode === 'dual');

/** Whether HoloSphere is active (holosphere or dual) */
export const isHoloSphereActive = derived(ad4mConfig, ($config) => $config.mode !== 'ad4m');

/** Whether AD4M is the primary backend */
export const isAd4mPrimary = derived(ad4mConfig, ($config) => $config.mode === 'ad4m');
