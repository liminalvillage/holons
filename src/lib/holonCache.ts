/**
 * Centralized per-holon cache for settings and users
 *
 * Provides instant access to cached data and keeps it fresh via subscriptions.
 * Preload on holon navigation for instant TaskModal/component loading.
 */

import { DEFAULT_EQUATION, type ScoreEquation } from './scoring/ContributionScoring';
import { fetchHolonName } from '../utils/holonNames';

// Types
export interface CachedUser {
    id: string;
    username: string;
    first_name: string;
    last_name?: string;
    picture?: string;
    actions?: any[];
    initiated?: string[];
    completed?: string[];
    hours?: number;
    collaboration?: number;
}

export interface CachedSettings {
    id: string;
    name?: string;
    purpose?: string;
    hex?: string;
    equation?: ScoreEquation;
    [key: string]: any;
}

interface HolonCacheEntry {
    settings: CachedSettings | null;
    users: Map<string, CachedUser>;
    equation: ScoreEquation;
    lastUpdated: number;
}

// Global caches
const holonCache = new Map<string, HolonCacheEntry>();
const subscriptions = new Map<string, { settings?: () => void; users?: () => void }>();
const preloadPromises = new Map<string, Promise<void>>();

/**
 * Get or create cache entry for a holon
 */
function getOrCreateEntry(holonId: string): HolonCacheEntry {
    if (!holonCache.has(holonId)) {
        holonCache.set(holonId, {
            settings: null,
            users: new Map(),
            equation: { ...DEFAULT_EQUATION },
            lastUpdated: 0
        });
    }
    return holonCache.get(holonId)!;
}

// ============ SETTINGS CACHE ============

/**
 * Get cached settings synchronously (returns null if not cached)
 */
export function getCachedSettings(holonId: string): CachedSettings | null {
    return holonCache.get(holonId)?.settings ?? null;
}

/**
 * Get cached equation synchronously (returns default if not cached)
 */
export function getCachedEquation(holonId: string): ScoreEquation {
    return holonCache.get(holonId)?.equation ?? { ...DEFAULT_EQUATION };
}

/**
 * Update cached settings
 */
function updateCachedSettings(holonId: string, settings: CachedSettings | null): void {
    const entry = getOrCreateEntry(holonId);
    entry.settings = settings;
    if (settings?.equation) {
        entry.equation = { ...DEFAULT_EQUATION, ...settings.equation };
    }
    entry.lastUpdated = Date.now();
}

// ============ USERS CACHE ============

/**
 * Get cached users synchronously (returns empty map if not cached)
 */
export function getCachedUsers(holonId: string): Map<string, CachedUser> {
    return holonCache.get(holonId)?.users ?? new Map();
}

/**
 * Get cached users as object keyed by username (for compatibility)
 */
export function getCachedUsersObject(holonId: string): Record<string, CachedUser> {
    const users = getCachedUsers(holonId);
    const result: Record<string, CachedUser> = {};
    for (const [key, user] of users) {
        result[key] = user;
    }
    return result;
}

/**
 * Get a single cached user by username
 */
export function getCachedUser(holonId: string, username: string): CachedUser | undefined {
    return holonCache.get(holonId)?.users.get(username);
}

/**
 * Update a single user in the cache
 */
function updateCachedUser(holonId: string, user: CachedUser): void {
    if (!user?.username) return;
    const entry = getOrCreateEntry(holonId);
    entry.users.set(user.username, user);
    entry.lastUpdated = Date.now();
}

/**
 * Remove a user from the cache
 */
function removeCachedUser(holonId: string, username: string): void {
    holonCache.get(holonId)?.users.delete(username);
}

/**
 * Set all users in the cache (replaces existing)
 */
function setCachedUsers(holonId: string, users: CachedUser[]): void {
    const entry = getOrCreateEntry(holonId);
    entry.users.clear();
    for (const user of users) {
        if (user?.username) {
            entry.users.set(user.username, user);
        }
    }
    entry.lastUpdated = Date.now();
}

// ============ NAME RESOLUTION ============

/**
 * Check if a string looks like a hex public key (64 hex chars)
 */
function isPubkey(s: string): boolean {
    return typeof s === 'string' && /^[0-9a-f]{64}$/i.test(s);
}

/**
 * Check if a name looks like it was derived from a pubkey (truncated hex)
 */
function looksLikeTruncatedPubkey(name: string, pubkey: string): boolean {
    if (!name || !pubkey) return false;
    // Matches patterns like "a1b2c3d4" or "a1b2c3d4e5f6" that are a prefix of the pubkey
    if (/^[0-9a-f]{6,16}$/i.test(name) && pubkey.toLowerCase().startsWith(name.toLowerCase())) {
        return true;
    }
    // Also catch "a1b2c3d4..." style truncations
    if (/^[0-9a-f]{6,16}\.\.\.$/i.test(name)) {
        return true;
    }
    return false;
}

/**
 * Resolve display names for cached users whose names look like truncated pubkeys.
 * Runs in the background — does not block preloading.
 */
function resolveUserNames(holonId: string, holosphere: any): void {
    const entry = holonCache.get(holonId);
    if (!entry || entry.users.size === 0) return;

    for (const [key, user] of entry.users) {
        const userId = user.id;
        if (!userId || !isPubkey(userId)) continue;

        const nameNeedsResolving =
            looksLikeTruncatedPubkey(user.first_name, userId) ||
            looksLikeTruncatedPubkey(user.username, userId) ||
            user.first_name === userId ||
            user.username === userId;

        if (!nameNeedsResolving) continue;

        fetchHolonName(holosphere, userId)
            .then((resolved) => {
                if (resolved && !resolved.startsWith('Holon ')) {
                    const currentEntry = holonCache.get(holonId);
                    const currentUser = currentEntry?.users.get(key);
                    if (currentUser) {
                        currentUser.first_name = resolved;
                        if (looksLikeTruncatedPubkey(currentUser.username, userId) || currentUser.username === userId) {
                            currentUser.username = resolved;
                        }
                    }
                }
            })
            .catch(() => {
                // Silently fail — user will keep truncated pubkey as fallback
            });
    }
}

// ============ PRELOADING ============

/**
 * Preload settings and users for a holon
 * Returns immediately if already preloading/preloaded
 */
export async function preloadHolon(
    holosphere: any,
    holonId: string,
    options: { force?: boolean } = {}
): Promise<void> {
    if (!holosphere || !holonId) return;

    // Return existing preload promise if in progress
    if (preloadPromises.has(holonId) && !options.force) {
        return preloadPromises.get(holonId);
    }

    // Check if recently preloaded (within 30 seconds)
    const entry = holonCache.get(holonId);
    if (entry && !options.force && Date.now() - entry.lastUpdated < 30000) {
        return;
    }

    const preloadPromise = (async () => {
        try {
            // Fetch settings and users in parallel
            const [settingsData, usersData] = await Promise.all([
                holosphere.get(holonId, 'settings', holonId).catch(() => null),
                holosphere.getAll(holonId, 'users').catch(() => [])
            ]);

            // Update settings cache
            if (settingsData) {
                updateCachedSettings(holonId, settingsData);
            }

            // Update users cache
            const users = Array.isArray(usersData)
                ? usersData
                : Object.values(usersData || {});
            setCachedUsers(holonId, users.filter((u): u is CachedUser => !!u?.username));

            // Resolve names for users whose first_name/username looks like a truncated pubkey
            resolveUserNames(holonId, holosphere);

        } catch (error) {
            console.error('[HolonCache] Preload error:', error);
        } finally {
            preloadPromises.delete(holonId);
        }
    })();

    preloadPromises.set(holonId, preloadPromise);
    return preloadPromise;
}

// ============ SUBSCRIPTIONS ============

/**
 * Subscribe to settings and user changes for a holon
 * Call this once per holon to keep cache fresh
 */
export function subscribeToHolon(holosphere: any, holonId: string): () => void {
    if (!holosphere || !holonId) return () => {};

    // Already subscribed?
    if (subscriptions.has(holonId)) {
        return () => unsubscribeFromHolon(holonId);
    }

    const subs: { settings?: () => void; users?: () => void } = {};

    // Subscribe to settings changes
    try {
        const settingsUnsub = holosphere.subscribe(holonId, 'settings', (settings: any) => {
            if (settings) {
                updateCachedSettings(holonId, settings);
            }
        });
        subs.settings = typeof settingsUnsub === 'function'
            ? settingsUnsub
            : settingsUnsub?.unsubscribe;
    } catch (e) {
        console.error('[HolonCache] Settings subscription error:', e);
    }

    // Subscribe to user changes
    try {
        const usersUnsub = holosphere.subscribe(holonId, 'users', (user: CachedUser | null, key?: string) => {
            if (user?.username) {
                updateCachedUser(holonId, user);
            } else if (user === null && key) {
                removeCachedUser(holonId, String(key));
            }
        });
        subs.users = typeof usersUnsub === 'function'
            ? usersUnsub
            : usersUnsub?.unsubscribe;
    } catch (e) {
        console.error('[HolonCache] Users subscription error:', e);
    }

    subscriptions.set(holonId, subs);

    return () => unsubscribeFromHolon(holonId);
}

/**
 * Unsubscribe from a holon's updates
 */
export function unsubscribeFromHolon(holonId: string): void {
    const subs = subscriptions.get(holonId);
    if (subs) {
        if (subs.settings) subs.settings();
        if (subs.users) subs.users();
        subscriptions.delete(holonId);
    }
}

/**
 * Check if a holon is already subscribed
 */
export function isSubscribed(holonId: string): boolean {
    return subscriptions.has(holonId);
}

// ============ CACHE MANAGEMENT ============

/**
 * Clear cache for a specific holon
 */
export function clearHolonCache(holonId: string): void {
    holonCache.delete(holonId);
    unsubscribeFromHolon(holonId);
}

/**
 * Clear all caches
 */
export function clearAllCaches(): void {
    for (const holonId of subscriptions.keys()) {
        unsubscribeFromHolon(holonId);
    }
    holonCache.clear();
    preloadPromises.clear();
}

/**
 * Get cache stats for debugging
 */
export function getCacheStats(): { holons: number; subscriptions: number; preloading: number } {
    return {
        holons: holonCache.size,
        subscriptions: subscriptions.size,
        preloading: preloadPromises.size
    };
}
