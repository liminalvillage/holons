/**
 * Shared shopping-list types for Holons UIs (web, telegram, text, ai).
 *
 * Storage layout (canonical, see HolonsBot commit 63aa1d4 + ShoppingList.svelte):
 * a single container document under the `checklists` collection with id `shopping`,
 * holding all items in `items[]`.
 */

import type { ResolvedHologramMeta, FederationMeta } from 'holosphere';

/**
 * One row in a shopping checklist. Identical between web and telegram UIs.
 * `id` may be a string (web: `Date.now().toString()`) or number (telegram: `Date.now() + Math.random()`)
 * for legacy compatibility — both UIs compare with `String(item.id)`.
 */
export interface ShoppingItem {
  id: string | number;
  text: string;
  checked: boolean;
  createdBy?: number | string;
  /**
   * Free-form grouping label. In the Telegram UI this is auto-populated from
   * the forum topic the `/buy` command was sent into (see Shopping.getCategory).
   * Empty / undefined means "uncategorized".
   */
  category?: string;
  // Optional federation/hologram metadata stamped by holosphere on read.
  _hologram?: ResolvedHologramMeta;
  _federation?: FederationMeta;
  _deleted?: boolean;
  // Allow forward-compatible fields (priority, quantity, notes).
  [key: string]: unknown;
}

/**
 * Container document persisted at (`<holonId>`, `checklists`, `shopping`).
 */
export interface ShoppingChecklist {
  id: 'shopping';
  type: 'shopping';
  title: string;
  items: ShoppingItem[];
  /** Canonical creation timestamp (ISO string). */
  created: string;
  _hologram?: ResolvedHologramMeta;
  _federation?: FederationMeta;
  [key: string]: unknown;
}

/** Storage-layer constants shared by both UIs. */
export const SHOPPING_KEY = 'shopping' as const;
export const CHECKLISTS_COLLECTION = 'checklists' as const;
