import type { HoloSphere } from "holosphere";
import { lookupName as hnsLookup } from "../lib/hns";

// Global cache for holon names
const holonNameCache = new Map<string, string>();

// Global cache for promises to avoid duplicate requests
const fetchPromises = new Map<string, Promise<string>>();

/**
 * Fetch holon name - tries HNS first, then falls back to local settings
 */
export async function fetchHolonName(holosphere: HoloSphere, holonId: string): Promise<string> {
	// Return cached name if available
	const cachedName = holonNameCache.get(holonId);
	if (cachedName) {
		return cachedName;
	}

	// Return existing promise if already fetching
	if (fetchPromises.has(holonId)) {
		return fetchPromises.get(holonId)!;
	}

	// Create new fetch promise
	const fetchPromise = (async () => {
		try {
			// Check if holosphere is available
			if (!holosphere) {
				const fallbackName = `Holon ${holonId}`;
				holonNameCache.set(holonId, fallbackName);
				return fallbackName;
			}

			// Try HNS (Holon Name Service) first - global public registry
			try {
				const hnsName = await hnsLookup(holosphere, holonId);
				if (hnsName && hnsName.trim() !== '') {
					holonNameCache.set(holonId, hnsName);
					return hnsName;
				}
			} catch (hnsError) {
				// HNS lookup failed, continue to fallback
				console.debug('HNS lookup failed, trying local settings:', hnsError);
			}

			// Fallback: Get settings from the holon itself (requires federation)
			const settings = await holosphere.get(holonId, "settings", holonId);

			// Check if settings exists and has the expected structure
			if (!settings) {
				const fallbackName = `Holon ${holonId}`;
				holonNameCache.set(holonId, fallbackName);
				return fallbackName;
			}

			// Settings might be an array (readAll returns array) or single object
			let holonName: string | undefined;
			if (Array.isArray(settings)) {
				const settingsObj = settings.find((s: any) => s?.name);
				holonName = settingsObj?.name;
			} else {
				holonName = settings?.name;
			}

			// Check if we got a real name (not empty, not undefined)
			if (holonName && holonName.trim() !== '') {
				holonNameCache.set(holonId, holonName);
				return holonName;
			} else {
				const fallbackName = `Holon ${holonId}`;
				holonNameCache.set(holonId, fallbackName);
				return fallbackName;
			}
		} catch (error) {
			const fallbackName = `Holon ${holonId}`;
			holonNameCache.set(holonId, fallbackName);
			return fallbackName;
		} finally {
			fetchPromises.delete(holonId);
		}
	})();

	// Cache the promise
	fetchPromises.set(holonId, fetchPromise);

	return fetchPromise;
}

/**
 * Get cached holon name or return fallback
 */
export function getCachedHolonName(holonId: string): string {
	const cachedName = holonNameCache.get(holonId);
	// Return cached name if it exists
	if (cachedName) {
		return cachedName;
	}
	// Return fallback (not cached here since it should be fetched properly)
	return `Holon ${holonId}`;
}

/**
 * Extract holon ID from hologram soul path
 */
export function extractHolonIdFromSoul(hologramSoul: string | undefined): string | null {
	if (!hologramSoul) return null;
	// Extract the holon ID from path like "Holons/-1002593778587/quests/380"
	const match = hologramSoul.match(/Holons\/([^\/]+)/);
	return match ? match[1] : null;
}

/**
 * Get hologram source name with automatic fetching - SYNCHRONOUS VERSION
 * This function immediately returns cached name or fallback, and triggers async fetch if needed
 */
export function getHologramSourceName(
	holosphere: HoloSphere, 
	hologramSoul: string | undefined,
	onUpdate?: () => void
): string {
	const holonId = extractHolonIdFromSoul(hologramSoul);
	if (!holonId) return 'External Source';
	
	// If we have cached name, return it immediately
	if (holonNameCache.has(holonId)) {
		const cachedName = holonNameCache.get(holonId)!;
		return cachedName;
	}
	
	// If we don't have the name cached, start fetching it
	fetchHolonName(holosphere, holonId).then((fetchedName) => {
		if (onUpdate) {
			onUpdate();
		}
	}).catch((error) => {
		if (onUpdate) {
			onUpdate(); // Still trigger update even on error
		}
	});
	
	return `Holon ${holonId}`; // Temporary fallback while loading
}

/**
 * Get hologram source name with automatic fetching - ASYNC VERSION
 * This function waits for the name to be fetched and returns the actual name
 */
export async function getHologramSourceNameAsync(
	holosphere: HoloSphere, 
	hologramSoul: string | undefined
): Promise<string> {
	const holonId = extractHolonIdFromSoul(hologramSoul);
	if (!holonId) return 'External Source';
	
	// Fetch and return the actual name
	return await fetchHolonName(holosphere, holonId);
}

/**
 * Clear cache for a specific holon or all holons
 */
export function clearHolonNameCache(holonId?: string): void {
	if (holonId) {
		holonNameCache.delete(holonId);
		fetchPromises.delete(holonId);
	} else {
		holonNameCache.clear();
		fetchPromises.clear();
	}
}

/**
 * Clear fallback names from cache to force re-fetching
 * This is useful when you want to retry fetching proper names for holons
 * that previously didn't have settings
 */
export function clearFallbackNames(): void {
	const holonIds = Array.from(holonNameCache.keys());
	let clearedCount = 0;

	for (const id of holonIds) {
		const cachedName = holonNameCache.get(id);
		// Clear fallback names to allow retry
		if (cachedName === `Holon ${id}`) {
			holonNameCache.delete(id);
			clearedCount++;
		}
	}
}

/**
 * Force refresh of a specific holon name by clearing cache and re-fetching
 */
export async function forceRefreshHolonName(holosphere: HoloSphere, holonId: string): Promise<string> {
	clearHolonNameCache(holonId);
	return await fetchHolonName(holosphere, holonId);
}

/**
 * Preload holon names for multiple holons
 */
export async function preloadHolonNames(holosphere: HoloSphere, holonIds: string[]): Promise<void> {
	const promises = holonIds.map(id => fetchHolonName(holosphere, id));
	await Promise.allSettled(promises);
} 