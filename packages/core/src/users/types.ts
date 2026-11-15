/**
 * Shared types for `@holons/core/users`. Kept out of index.ts so the
 * implementation files don't import the barrel that re-exports them.
 */

/** Minimal user shape — matches Telegram's `from` object but not exclusive to it. */
export interface TelegramUserLike {
  id: string | number;
  username?: string;
  first_name?: string;
  last_name?: string;
  is_bot?: boolean;
}

/** Holosphere-shaped storage surface used by this module. */
export interface UserDB {
  get(holon: string, lens: string, key: string): Promise<unknown>;
  put(holon: string, lens: string, data: object): Promise<unknown>;
  delete(holon: string, lens: string, key: string): Promise<boolean>;
  getAll(holon: string, lens: string): Promise<unknown[]>;
}

/** Persisted user profile shape (REA-aware, version 0.3). */
export interface UserProfile {
  id: string | number;
  version: string;
  username: string;
  first_name?: string;
  last_name?: string;
  values: string[];
  needs: string[];
  participated: Record<string, unknown>;
  /**
   * Keys the person holds BESIDES their derived one (64-hex), linked after
   * proof of control — see `keys.ts`. Canonical on the personal-holon record.
   */
  linkedKeys?: string[];
  // Aggregates may be merged in by callers; keep open for forward-compat.
  [key: string]: unknown;
}
