/**
 * Federation Requests Store
 *
 * Manages pending incoming and outgoing federation requests.
 * Persisted to localStorage for resilience across page reloads.
 */

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import type { CapabilityInfo } from '../federation/nostrDM';

// ============================================================================
// Types
// ============================================================================

export type RequestStatus = 'pending' | 'accepted' | 'rejected' | 'expired';
export type RequestType = 'incoming' | 'outgoing';
export type UpdateType = 'incoming_update' | 'outgoing_update';

export interface PendingRequest {
  id: string;
  type: RequestType;
  senderPubKey: string;
  senderNpub: string;
  senderHolonId: string;
  senderHolonName: string;
  lensConfig: {
    inbound: string[];
    outbound: string[];
    writeInbound?: string[];
    writeOutbound?: string[];
  };
  capabilities: CapabilityInfo[];
  timestamp: number;
  status: RequestStatus;
  message?: string;
  // For outgoing requests, track the recipient
  recipientPubKey?: string;
  recipientNpub?: string;
  recipientHolonName?: string;
}

export interface PendingUpdate {
  id: string;  // updateId
  type: UpdateType;
  partnerPubKey: string;
  partnerNpub: string;
  partnerHolonId: string;
  partnerHolonName: string;
  currentLensConfig: {
    inbound: string[];
    outbound: string[];
  };
  newLensConfig: {
    inbound: string[];
    outbound: string[];
  };
  timestamp: number;
  status: RequestStatus;
  message?: string;
}

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY_PREFIX = 'federation_requests_';
const EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ============================================================================
// Store
// ============================================================================

function createFederationRequestsStore() {
  const { subscribe, set, update } = writable<PendingRequest[]>([]);

  // Track current user's public key for scoped storage
  let currentUserPubKey: string | null = null;

  // Get the storage key for the current user
  const getStorageKey = (): string | null => {
    if (!currentUserPubKey) return null;
    return `${STORAGE_KEY_PREFIX}${currentUserPubKey}`;
  };

  // Load from localStorage on init
  const loadFromStorage = (): PendingRequest[] => {
    if (!browser) return [];
    const storageKey = getStorageKey();
    if (!storageKey) return [];

    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const requests = JSON.parse(stored) as PendingRequest[];
        // Filter out expired requests
        const now = Date.now();
        return requests.filter((r) => {
          if (r.status !== 'pending') return true; // Keep non-pending for history
          return now - r.timestamp < EXPIRATION_MS;
        });
      }
    } catch (error) {
      console.error('Error loading federation requests from storage:', error);
    }
    return [];
  };

  // Save to localStorage
  const saveToStorage = (requests: PendingRequest[]) => {
    if (!browser) return;
    const storageKey = getStorageKey();
    if (!storageKey) return;

    try {
      localStorage.setItem(storageKey, JSON.stringify(requests));
    } catch (error) {
      console.error('Error saving federation requests to storage:', error);
    }
  };

  return {
    subscribe,

    /**
     * Initialize the store with user's public key for scoped storage
     */
    init: (userPubKey?: string) => {
      if (userPubKey) {
        currentUserPubKey = userPubKey;
      }
      const requests = loadFromStorage();
      set(requests);
    },

    /**
     * Set the current user and reload requests
     */
    setUser: (userPubKey: string) => {
      if (userPubKey === currentUserPubKey) return;
      currentUserPubKey = userPubKey;
      const requests = loadFromStorage();
      set(requests);
    },

    /**
     * Add a new pending request
     */
    add: (request: PendingRequest) => {
      update((requests) => {
        // Check for duplicate by id
        if (requests.some((r) => r.id === request.id)) {
          console.warn('Duplicate federation request ignored:', request.id);
          return requests;
        }
        const updated = [...requests, request];
        saveToStorage(updated);
        return updated;
      });
    },

    /**
     * Update the status of a request
     */
    updateStatus: (requestId: string, status: RequestStatus) => {
      update((requests) => {
        const updated = requests.map((r) =>
          r.id === requestId ? { ...r, status } : r
        );
        saveToStorage(updated);
        return updated;
      });
    },

    /**
     * Remove a request by ID
     */
    remove: (requestId: string) => {
      update((requests) => {
        const updated = requests.filter((r) => r.id !== requestId);
        saveToStorage(updated);
        return updated;
      });
    },

    /**
     * Get a request by ID
     */
    getById: (requestId: string): PendingRequest | undefined => {
      const requests = get({ subscribe });
      return requests.find((r) => r.id === requestId);
    },

    /**
     * Get all incoming pending requests
     */
    getIncomingPending: (): PendingRequest[] => {
      const requests = get({ subscribe });
      return requests.filter((r) => r.type === 'incoming' && r.status === 'pending');
    },

    /**
     * Get all outgoing pending requests
     */
    getOutgoingPending: (): PendingRequest[] => {
      const requests = get({ subscribe });
      return requests.filter((r) => r.type === 'outgoing' && r.status === 'pending');
    },

    /**
     * Check if we have a pending request for a specific pubkey
     */
    hasPendingForPubKey: (pubKey: string): boolean => {
      const requests = get({ subscribe });
      return requests.some(
        (r) =>
          r.status === 'pending' &&
          (r.senderPubKey === pubKey || r.recipientPubKey === pubKey)
      );
    },

    /**
     * Mark expired requests
     */
    cleanupExpired: () => {
      const now = Date.now();
      update((requests) => {
        let changed = false;
        const updated = requests.map((r) => {
          if (r.status === 'pending' && now - r.timestamp >= EXPIRATION_MS) {
            changed = true;
            return { ...r, status: 'expired' as RequestStatus };
          }
          return r;
        });
        if (changed) {
          saveToStorage(updated);
        }
        return updated;
      });
    },

    /**
     * Clear all requests (for testing/debug)
     */
    clear: () => {
      set([]);
      const storageKey = getStorageKey();
      if (browser && storageKey) {
        localStorage.removeItem(storageKey);
      }
    }
  };
}

export const pendingFederationRequests = createFederationRequestsStore();

// ============================================================================
// Derived Stores
// ============================================================================

/**
 * Count of pending incoming requests (for notification badge)
 */
export const federationNotifications = derived(
  pendingFederationRequests,
  ($requests) => $requests.filter((r) => r.type === 'incoming' && r.status === 'pending').length
);

/**
 * Incoming pending requests only
 */
export const incomingRequests = derived(
  pendingFederationRequests,
  ($requests) => $requests.filter((r) => r.type === 'incoming' && r.status === 'pending')
);

/**
 * Outgoing pending requests only
 */
export const outgoingRequests = derived(
  pendingFederationRequests,
  ($requests) => $requests.filter((r) => r.type === 'outgoing' && r.status === 'pending')
);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a new incoming request object
 */
export function createIncomingRequest(
  requestId: string,
  senderPubKey: string,
  senderNpub: string,
  senderHolonId: string,
  senderHolonName: string,
  lensConfig: { inbound: string[]; outbound: string[]; writeInbound?: string[]; writeOutbound?: string[] },
  capabilities: CapabilityInfo[],
  message?: string
): PendingRequest {
  return {
    id: requestId,
    type: 'incoming',
    senderPubKey,
    senderNpub,
    senderHolonId,
    senderHolonName,
    lensConfig,
    capabilities,
    timestamp: Date.now(),
    status: 'pending',
    message
  };
}

/**
 * Create a new outgoing request object
 */
export function createOutgoingRequest(
  requestId: string,
  senderPubKey: string,
  senderNpub: string,
  senderHolonId: string,
  senderHolonName: string,
  recipientPubKey: string,
  recipientNpub: string,
  lensConfig: { inbound: string[]; outbound: string[] },
  capabilities: CapabilityInfo[],
  message?: string,
  recipientHolonName?: string
): PendingRequest {
  return {
    id: requestId,
    type: 'outgoing',
    senderPubKey,
    senderNpub,
    senderHolonId,
    senderHolonName,
    recipientPubKey,
    recipientNpub,
    recipientHolonName,
    lensConfig,
    capabilities,
    timestamp: Date.now(),
    status: 'pending',
    message
  };
}

// ============================================================================
// Pending Updates Store (for lens config renegotiation)
// ============================================================================

const UPDATES_STORAGE_KEY_PREFIX = 'federation_updates_';

function createPendingUpdatesStore() {
  const { subscribe, set, update } = writable<PendingUpdate[]>([]);
  let currentUserPubKey: string | null = null;

  const getStorageKey = (): string | null => {
    if (!currentUserPubKey) return null;
    return `${UPDATES_STORAGE_KEY_PREFIX}${currentUserPubKey}`;
  };

  const loadFromStorage = (): PendingUpdate[] => {
    if (!browser) return [];
    const storageKey = getStorageKey();
    if (!storageKey) return [];

    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const updates = JSON.parse(stored) as PendingUpdate[];
        const now = Date.now();
        return updates.filter((u) => {
          if (u.status !== 'pending') return true;
          return now - u.timestamp < EXPIRATION_MS;
        });
      }
    } catch (error) {
      console.error('Error loading pending updates from storage:', error);
    }
    return [];
  };

  const saveToStorage = (updates: PendingUpdate[]) => {
    if (!browser) return;
    const storageKey = getStorageKey();
    if (!storageKey) return;

    try {
      localStorage.setItem(storageKey, JSON.stringify(updates));
    } catch (error) {
      console.error('Error saving pending updates to storage:', error);
    }
  };

  return {
    subscribe,

    init: (userPubKey?: string) => {
      if (userPubKey) {
        currentUserPubKey = userPubKey;
      }
      const updates = loadFromStorage();
      set(updates);
    },

    setUser: (userPubKey: string) => {
      if (userPubKey === currentUserPubKey) return;
      currentUserPubKey = userPubKey;
      const updates = loadFromStorage();
      set(updates);
    },

    add: (pendingUpdate: PendingUpdate) => {
      update((updates) => {
        if (updates.some((u) => u.id === pendingUpdate.id)) {
          console.warn('Duplicate update request ignored:', pendingUpdate.id);
          return updates;
        }
        const updated = [...updates, pendingUpdate];
        saveToStorage(updated);
        return updated;
      });
    },

    updateStatus: (updateId: string, status: RequestStatus) => {
      update((updates) => {
        const updated = updates.map((u) =>
          u.id === updateId ? { ...u, status } : u
        );
        saveToStorage(updated);
        return updated;
      });
    },

    remove: (updateId: string) => {
      update((updates) => {
        const updated = updates.filter((u) => u.id !== updateId);
        saveToStorage(updated);
        return updated;
      });
    },

    getById: (updateId: string): PendingUpdate | undefined => {
      const updates = get({ subscribe });
      return updates.find((u) => u.id === updateId);
    },

    getByPartnerPubKey: (partnerPubKey: string): PendingUpdate | undefined => {
      const updates = get({ subscribe });
      return updates.find((u) => u.partnerPubKey === partnerPubKey && u.status === 'pending');
    },

    hasPendingForPartner: (partnerPubKey: string): boolean => {
      const updates = get({ subscribe });
      return updates.some((u) => u.partnerPubKey === partnerPubKey && u.status === 'pending');
    },

    clear: () => {
      set([]);
      const storageKey = getStorageKey();
      if (browser && storageKey) {
        localStorage.removeItem(storageKey);
      }
    }
  };
}

export const pendingUpdates = createPendingUpdatesStore();

/**
 * Incoming update requests only
 */
export const incomingUpdates = derived(
  pendingUpdates,
  ($updates) => $updates.filter((u) => u.type === 'incoming_update' && u.status === 'pending')
);

/**
 * Outgoing update requests only
 */
export const outgoingUpdates = derived(
  pendingUpdates,
  ($updates) => $updates.filter((u) => u.type === 'outgoing_update' && u.status === 'pending')
);

/**
 * Create a new incoming update request
 */
export function createIncomingUpdate(
  updateId: string,
  partnerPubKey: string,
  partnerNpub: string,
  partnerHolonId: string,
  partnerHolonName: string,
  currentLensConfig: { inbound: string[]; outbound: string[] },
  newLensConfig: { inbound: string[]; outbound: string[] },
  message?: string
): PendingUpdate {
  return {
    id: updateId,
    type: 'incoming_update',
    partnerPubKey,
    partnerNpub,
    partnerHolonId,
    partnerHolonName,
    currentLensConfig,
    newLensConfig,
    timestamp: Date.now(),
    status: 'pending',
    message
  };
}

/**
 * Create a new outgoing update request
 */
export function createOutgoingUpdate(
  updateId: string,
  partnerPubKey: string,
  partnerNpub: string,
  partnerHolonId: string,
  partnerHolonName: string,
  currentLensConfig: { inbound: string[]; outbound: string[] },
  newLensConfig: { inbound: string[]; outbound: string[] },
  message?: string
): PendingUpdate {
  return {
    id: updateId,
    type: 'outgoing_update',
    partnerPubKey,
    partnerNpub,
    partnerHolonId,
    partnerHolonName,
    currentLensConfig,
    newLensConfig,
    timestamp: Date.now(),
    status: 'pending',
    message
  };
}
