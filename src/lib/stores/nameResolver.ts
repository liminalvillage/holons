/**
 * Unified Holon Name Service
 *
 * Single source of truth for resolving holon/user display names.
 *
 *   WRITE  →  src/lib/hns/index.ts   (HNS registration, untouched)
 *   READ   →  this file               (cache, fetch, reactive store)
 *
 * All UI components import from here. Nothing else is needed.
 */

import { writable, get } from 'svelte/store';
import type { HoloSphere } from 'holosphere';
import { holosphereStore } from './holosphere';
import { lookupName as hnsLookup, clearHNSCache } from '../hns';

// ─── low-level cache ────────────────────────────────────────────────

const holonNameCache = new Map<string, string>();
const fetchPromises = new Map<string, Promise<string>>();

const RESERVED_NAMES = new Set([
	'no', 'yes', 'true', 'false', 'null', 'undefined', 'none', 'n/a',
	'na', 'nil', 'empty', 'blank', 'unknown', 'anonymous', 'default'
]);

// ─── pure helpers ───────────────────────────────────────────────────

/** Check if a string looks like a 64-char hex public key. */
function isPubkey(id: string): boolean {
	return typeof id === 'string' && /^[0-9a-f]{64}$/i.test(id);
}

/** Validate that a holon name is acceptable. */
export function isValidHolonName(name: unknown): name is string {
	if (typeof name !== 'string') return false;
	const trimmed = name.trim();
	if (trimmed.length < 2) return false;
	if (RESERVED_NAMES.has(trimmed.toLowerCase())) return false;
	return true;
}

/** Extract holon ID from a hologram soul path like "Holons/<id>/quests/380". */
export function extractHolonIdFromSoul(hologramSoul: string | undefined): string | null {
	if (!hologramSoul) return null;
	const match = hologramSoul.match(/Holons\/([^\/]+)/);
	return match ? match[1] : null;
}

// ─── async fetch (cache → HNS → settings → fallback) ───────────────

/**
 * Fetch a holon name. Tries HNS (signed) then local settings.
 * Results are cached — safe to call repeatedly.
 */
async function fetchHolonName(holosphere: HoloSphere, holonId: string): Promise<string> {
	const cached = holonNameCache.get(holonId);
	if (cached) return cached;

	if (fetchPromises.has(holonId)) return fetchPromises.get(holonId)!;

	const promise = (async () => {
		try {
			if (!holosphere) {
				const fb = `Holon ${holonId}`;
				holonNameCache.set(holonId, fb);
				return fb;
			}

			// 1. HNS — cryptographically signed, authoritative
			try {
				const hnsName = await hnsLookup(holosphere, holonId);
				if (hnsName && hnsName.trim() !== '') {
					holonNameCache.set(holonId, hnsName);
					return hnsName;
				}
			} catch {
				// continue
			}

			// 2. Local settings (requires federation)
			try {
				const settings = await holosphere.get(holonId, 'settings', holonId);
				let name: string | undefined;
				if (Array.isArray(settings)) {
					name = settings.find((s: any) => s?.name)?.name;
				} else if (settings) {
					name = settings?.name;
				}
				if (name && name.trim() !== '') {
					holonNameCache.set(holonId, name);
					return name;
				}
			} catch {
				// continue
			}

			// 3. Fallback
			const fb = `Holon ${holonId.slice(0, 8)}...`;
			holonNameCache.set(holonId, fb);
			return fb;
		} catch {
			const fb = `Holon ${holonId.slice(0, 8)}...`;
			holonNameCache.set(holonId, fb);
			return fb;
		} finally {
			fetchPromises.delete(holonId);
		}
	})();

	fetchPromises.set(holonId, promise);
	return promise;
}

/** Clear low-level cache (one entry or everything). Also clears HNS cache. */
function clearHolonNameCache(holonId?: string): void {
	if (holonId) {
		holonNameCache.delete(holonId);
		fetchPromises.delete(holonId);
		clearHNSCache(holonId);
	} else {
		holonNameCache.clear();
		fetchPromises.clear();
		clearHNSCache();
	}
}

/** Clear cache then re-fetch. Awaitable — used by BrowserPanel for federation partner names. */
export async function forceRefreshHolonName(holosphere: HoloSphere, holonId: string): Promise<string> {
	clearHolonNameCache(holonId);
	return fetchHolonName(holosphere, holonId);
}

// ─── reactive store (single UI interface) ───────────────────────────

const _nameMap = writable<Record<string, string>>({});
const pending = new Set<string>();

/**
 * Trigger async name resolution for a pubkey.
 * Result lands in the `nameMap` store. Safe to call many times.
 */
export function resolveName(pubkey: string): void {
	if (!pubkey || !isPubkey(pubkey)) return;

	const current = get(_nameMap);
	if (current[pubkey] || pending.has(pubkey)) return;

	pending.add(pubkey);

	const holosphere = get(holosphereStore);
	if (!holosphere) {
		pending.delete(pubkey);
		return;
	}

	fetchHolonName(holosphere, pubkey)
		.then((name) => {
			if (name && !name.startsWith('Holon ')) {
				_nameMap.update((map) => ({ ...map, [pubkey]: name }));
			}
		})
		.catch(() => {})
		.finally(() => {
			pending.delete(pubkey);
		});
}

/** Batch resolve multiple IDs. */
export function resolveNames(ids: string[]): void {
	for (const id of ids) resolveName(id);
}

/** Resolve hologram source: extract holon ID from soul path, then resolve. */
export function resolveHologramSource(hologramSoul: string): void {
	const holonId = extractHolonIdFromSoul(hologramSoul);
	if (holonId) resolveName(holonId);
}

/**
 * Awaitable version — resolves the name and populates the reactive store.
 * Use in imperative code (QR page, federation, etc.).
 */
export async function awaitName(pubkey: string): Promise<string> {
	if (!pubkey || !isPubkey(pubkey)) return pubkey || 'Unknown';

	const current = get(_nameMap);
	if (current[pubkey]) return current[pubkey];

	const holosphere = get(holosphereStore);
	if (!holosphere) return pubkey.slice(0, 8);

	try {
		const name = await fetchHolonName(holosphere, pubkey);
		if (name && !name.startsWith('Holon ')) {
			_nameMap.update((map) => ({ ...map, [pubkey]: name }));
			return name;
		}
		return pubkey.slice(0, 8);
	} catch {
		return pubkey.slice(0, 8);
	}
}

/** Force refresh: clear caches + re-resolve reactively. */
export function forceRefresh(pubkey: string): void {
	if (!pubkey) return;

	_nameMap.update((map) => {
		const { [pubkey]: _, ...rest } = map;
		return rest;
	});
	pending.delete(pubkey);
	clearHolonNameCache(pubkey);

	if (isPubkey(pubkey)) resolveName(pubkey);
}

/**
 * Directly set a resolved name (no fetch needed).
 * Use after writing settings/HNS to avoid relay round-trip races.
 */
export function setName(pubkey: string, name: string): void {
	if (!pubkey || !name) return;
	holonNameCache.set(pubkey, name);
	if (isPubkey(pubkey) && !name.startsWith('Holon ')) {
		_nameMap.update((map) => ({ ...map, [pubkey]: name }));
	}
}

// ─── display-name helpers ───────────────────────────────────────────

/** Display name for a user ID with a string fallback. */
export function displayName(
	id: string,
	fallback: string,
	nameMap: Record<string, string>
): string {
	if (id && nameMap[id]) return nameMap[id];
	return fallback || (id ? `${id.slice(0, 8)}...` : 'Unknown');
}

/** Display name from a user object, using nameMap for pubkey resolution. */
export function userDisplayName(
	user: { id?: string; first_name?: string; last_name?: string; username?: string } | null,
	nameMap: Record<string, string>
): string {
	if (!user) return 'Unknown User';
	if (user.id && nameMap[user.id]) return nameMap[user.id];
	if (user.first_name && user.last_name) return `${user.first_name} ${user.last_name}`;
	if (user.first_name) return user.first_name;
	if (user.username) return user.username;
	return 'Unknown User';
}

// ─── public store (read-only) ───────────────────────────────────────

export const nameMap = { subscribe: _nameMap.subscribe };
