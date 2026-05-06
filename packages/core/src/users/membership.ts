/**
 * Holon membership operations: join / leave.
 *
 * "Join" is implemented as ensuring the user profile exists — there is no
 * separate membership record in the holosphere model. "Leave" deletes the
 * profile from the holon's `users` lens.
 */
import { getUserProfile } from './profile.js';
import type { TelegramUserLike, UserDB, UserProfile } from './index.js';

const USERS_LENS = 'users';

export interface JoinResult {
  /** Loaded (or newly-created) profile, or `null` if join was rejected. */
  profile: UserProfile | null;
  /** True iff the user has a usable username. */
  hasUsername: boolean;
}

/**
 * Add a user to a holon by ensuring their profile exists.
 *
 * Returns the loaded profile and a `hasUsername` flag so callers can decide
 * whether to nudge the user to set one (Telegram-specific concern, but
 * exposed here so the bot doesn't need to re-fetch).
 */
export async function joinHolon(
  db: UserDB,
  user: TelegramUserLike,
  holonId: string | number,
): Promise<JoinResult> {
  const profile = await getUserProfile(db, user, holonId);
  // Original behaviour: only "true" once the profile loaded successfully
  // (so bot users / missing holon are treated as no-username).
  return {
    profile,
    hasUsername: Boolean(profile && user.username),
  };
}

/**
 * Remove a user from a holon by deleting their profile entry.
 * Returns `true` when the underlying delete reported success.
 */
export async function leaveHolon(
  db: UserDB,
  userId: string | number,
  holonId: string | number,
): Promise<boolean> {
  return db.delete(String(holonId), USERS_LENS, String(userId));
}
