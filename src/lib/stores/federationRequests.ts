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
  };
  capabilities: CapabilityInfo[];
  timestamp: number;
  status: RequestStatus;
  message?: string;
  // For outgoing requests, track the recipient
  recipientPubKey?: string;
  recipientNpub?: string;
}

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY = 'federation_requests';
const EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ============================================================================
// Store
// ============================================================================

function createFederationRequestsStore() {
  const { subscribe, set, update } = writable<PendingRequest[]>([]);

  // Load from localStorage on init
  const loadFromStorage = (): PendingRequest[] => {
    if (!browser) return [];

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
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

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
    } catch (error) {
      console.error('Error saving federation requests to storage:', error);
    }
  };

  return {
    subscribe,

    /**
     * Initialize the store from localStorage
     */
    init: () => {
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
      if (browser) {
        localStorage.removeItem(STORAGE_KEY);
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
  lensConfig: { inbound: string[]; outbound: string[] },
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
  message?: string
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
    lensConfig,
    capabilities,
    timestamp: Date.now(),
    status: 'pending',
    message
  };
}
