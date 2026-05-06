/**
 * Values & needs management for a user inside a holon.
 *
 * Both lists are stored as deduplicated string arrays on the user profile.
 */
import { getUserProfile, saveUserProfile } from './profile.js';
import type { TelegramUserLike, UserDB, UserProfile } from './index.js';

type ListField = 'values' | 'needs';

async function appendUnique(
  db: UserDB,
  user: TelegramUserLike,
  holonId: string | number,
  field: ListField,
  additions: string[],
): Promise<UserProfile | null> {
  if (!additions?.length) return null;
  const profile = await getUserProfile(db, user, holonId);
  if (!profile) return null;

  profile[field] = Array.from(new Set([...(profile[field] ?? []), ...additions]));
  await saveUserProfile(db, holonId, profile);
  return profile;
}

/**
 * Append values to a user profile. Returns `null` when the profile cannot be
 * loaded (bot user, missing holonId) or `additions` is empty.
 */
export function addUserValues(
  db: UserDB,
  user: TelegramUserLike,
  holonId: string | number,
  values: string[],
): Promise<UserProfile | null> {
  return appendUnique(db, user, holonId, 'values', values);
}

/**
 * Append needs to a user profile. Mirror of {@link addUserValues}.
 */
export function addUserNeeds(
  db: UserDB,
  user: TelegramUserLike,
  holonId: string | number,
  needs: string[],
): Promise<UserProfile | null> {
  return appendUnique(db, user, holonId, 'needs', needs);
}
