/**
 * @holons/core/library — type definitions
 *
 * Authoritative source for community-library item shapes shared across UIs.
 * Originally extracted from packages/telegram-ui/src/Library.js.
 */

/** Standard item categories supported by the library. */
export const LIBRARY_TYPES = {
  TOOL: 'tool',
  BOOK: 'book',
  EQUIPMENT: 'equipment',
  OTHER: 'other'
} as const;

export type LibraryItemType = (typeof LIBRARY_TYPES)[keyof typeof LIBRARY_TYPES];

/** Persisted library item shape. */
export interface LibraryItem {
  id: string;
  type: LibraryItemType;
  borrowed: boolean;
  /** Telegram user id of the owner (numeric in TG, but tolerated as string). */
  createdBy?: number | string;
  createdByUsername?: string;
  borrower: string | null;
  borrowerId?: number | string | null;
  borrowerInitials?: string;
  borrowedAt?: Date | string;
  returnBy?: Date | string;
  returnedAt?: Date | string;
  category: string;
  description: string;
  value: number;
  created: Date | string;
  ratings?: Array<{ user?: string; rating: number; review?: string; date: Date | string }>;
  issues?: Array<{ reporter?: string; issue: string; date: Date | string; resolved: boolean }>;
  // forward compat
  [k: string]: unknown;
}

/** Options for `createLibraryItem`. */
export interface CreateLibraryItemOptions {
  createdBy?: number | string;
  createdByUsername?: string;
  category?: string;
  description?: string;
  value?: number;
}

/** Minimal HoloSphere-shaped storage interface this module needs. */
export interface LibraryDB {
  get(holon: string, lens: string, key?: string): Promise<any | null>;
  put(holon: string, lens: string, data: any): Promise<unknown>;
  delete(holon: string, lens: string, key: string): Promise<unknown>;
  getAll(holon: string, lens: string): Promise<Array<any>>;
}

/** Shape of a borrower (caller-provided; matches Telegram `ctx.from`). */
export interface BorrowActor {
  id: number | string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

/** Aggregate stats produced by `getLibraryStats`. */
export interface LibraryStats {
  total: number;
  borrowed: number;
  available: number;
  byType: Record<string, number>;
}
