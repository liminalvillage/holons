/**
 * User profile CRUD against a Holosphere-shaped DB.
 *
 * All functions are UI-agnostic. Callers (Telegram bot, web app, etc.)
 * adapt their user-shape to {@link TelegramUserLike} before calling.
 */
import type { TelegramUserLike, UserDB, UserProfile } from './index.js';

const USERS_LENS = 'users';
const PROFILE_VERSION = '0.3'; // REA-aware profile

/** Normalise a holonId to its persisted string form, or `null` if unusable. */
function normaliseHolonId(holonId: string | number | null | undefined): string | null {
  if (holonId === undefined || holonId === null || holonId === '') return null;
  return String(holonId);
}

/**
 * Build a fresh profile object for a never-seen user.
 * Pure — does not touch the DB.
 */
export function createDefaultProfile(user: TelegramUserLike): UserProfile {
  return {
    id: user.id,
    version: PROFILE_VERSION,
    username: user.username ? user.username : String(user.id),
    first_name: user.first_name,
    last_name: user.last_name,
    values: [],
    needs: [],
    participated: {},
  };
}

/**
 * Load a user's profile for a holon. If absent, a default profile is
 * created and persisted. Returns `null` for bots or when `holonId` is missing.
 */
export async function getUserProfile(
  db: UserDB,
  user: TelegramUserLike,
  holonId: string | number,
): Promise<UserProfile | null> {
  if (user?.is_bot) return null;
  const holonIdStr = normaliseHolonId(holonId);
  if (!holonIdStr) return null;

  const existing = await db.get(holonIdStr, USERS_LENS, String(user.id));
  if (existing && existing !== '') return existing as UserProfile;

  const profile = createDefaultProfile(user);
  await db.put(holonIdStr, USERS_LENS, profile);
  return profile;
}

/**
 * Make sure a user profile exists for the given holon. No-op for bots
 * or missing holon ids. Delegates to {@link getUserProfile} which performs
 * the read+create-if-absent pattern.
 */
export async function ensureUserProfile(
  db: UserDB,
  user: TelegramUserLike,
  holonId: string | number,
): Promise<void> {
  await getUserProfile(db, user, holonId);
}

/**
 * Persist an updated profile. Caller is responsible for shape.
 */
export async function saveUserProfile(
  db: UserDB,
  holonId: string | number,
  profile: UserProfile,
): Promise<void> {
  await db.put(String(holonId), USERS_LENS, profile);
}

/**
 * List every stored user profile in a holon.
 */
export async function getUsers(
  db: UserDB,
  holonId: string | number,
): Promise<UserProfile[]> {
  return (await db.getAll(String(holonId), USERS_LENS)) as UserProfile[];
}
