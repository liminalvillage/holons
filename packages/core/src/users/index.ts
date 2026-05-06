/**
 * `@holons/core/users` — user profile, values/needs, and holon membership.
 *
 * UI-agnostic. Pass any object that implements the {@link UserDB} surface
 * (Holosphere instances satisfy it natively) plus a {@link TelegramUserLike}
 * descriptor for the acting user.
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
  // Aggregates may be merged in by callers; keep open for forward-compat.
  [key: string]: unknown;
}

export {
  createDefaultProfile,
  getUserProfile,
  ensureUserProfile,
  saveUserProfile,
  getUsers,
} from './profile.js';

export { addUserValues, addUserNeeds } from './values-needs.js';

export { joinHolon, leaveHolon, type JoinResult } from './membership.js';
