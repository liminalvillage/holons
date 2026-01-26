/**
 * Write Notifications Store
 *
 * Manages toast notifications for write permission errors.
 * Notifications auto-dismiss after a configurable timeout.
 */

import { writable } from 'svelte/store';

// ============================================================================
// Types
// ============================================================================

export interface WriteNotification {
  id: string;
  message: string;
  timestamp: number;
}

// ============================================================================
// Constants
// ============================================================================

const AUTO_DISMISS_MS = 5000; // 5 seconds

// ============================================================================
// Store
// ============================================================================

let nextId = 0;

function createWriteNotificationsStore() {
  const { subscribe, set, update } = writable<WriteNotification[]>([]);

  return {
    subscribe,

    /**
     * Add a new write denied notification
     */
    notifyWriteDenied: (message: string): void => {
      const id = String(nextId++);
      const notification: WriteNotification = {
        id,
        message,
        timestamp: Date.now()
      };

      update(notifications => [...notifications, notification]);

      // Auto-dismiss after timeout
      setTimeout(() => {
        update(notifications => notifications.filter(n => n.id !== id));
      }, AUTO_DISMISS_MS);
    },

    /**
     * Dismiss a specific notification by ID
     */
    dismiss: (id: string): void => {
      update(notifications => notifications.filter(n => n.id !== id));
    },

    /**
     * Clear all notifications
     */
    clear: (): void => {
      set([]);
    }
  };
}

export const writeNotifications = createWriteNotificationsStore();

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Show a write denied notification
 */
export function notifyWriteDenied(message: string): void {
  writeNotifications.notifyWriteDenied(message);
}

/**
 * Dismiss a notification
 */
export function dismissNotification(id: string): void {
  writeNotifications.dismiss(id);
}
