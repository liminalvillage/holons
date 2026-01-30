import { writable, get } from 'svelte/store';
import { holosphereStore } from './holosphere';
import { fetchHolonName } from '../../utils/holonNames';

/**
 * Reactive store that maps public keys to resolved holon names.
 * Components can call `resolveName(pubkey)` and reactively read `$nameMap[pubkey]`.
 */
const _nameMap = writable<Record<string, string>>({});

// Track in-flight lookups to avoid duplicates
const pending = new Set<string>();

/**
 * Check if a string looks like a hex public key (64 hex chars)
 */
function isPubkey(id: string): boolean {
	return typeof id === 'string' && /^[0-9a-f]{64}$/i.test(id);
}

/**
 * Trigger async name resolution for a public key.
 * The result is stored reactively in the nameMap store.
 * Safe to call multiple times — deduplicates and caches.
 */
export function resolveName(pubkey: string): void {
	if (!pubkey || !isPubkey(pubkey)) return;

	// Already resolved or in-flight
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
		.catch(() => {
			// Silently fail — component will show fallback
		})
		.finally(() => {
			pending.delete(pubkey);
		});
}

/**
 * Get the display name for a user ID.
 * If the ID is a pubkey with a resolved name, returns the name.
 * Otherwise returns the original value (username, first_name, etc).
 *
 * Usage in Svelte: `{displayName(user.id, user.first_name, $nameMap)}`
 */
export function displayName(
	id: string,
	fallback: string,
	nameMap: Record<string, string>
): string {
	if (id && nameMap[id]) {
		return nameMap[id];
	}
	return fallback || (id ? `${id.slice(0, 8)}...` : 'Unknown');
}

export const nameMap = { subscribe: _nameMap.subscribe };
