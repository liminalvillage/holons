/**
 * Holosphere Query Manager
 *
 * Centralized query management with caching, deduplication, and real-time subscriptions.
 * Provides optimized data fetching across all components.
 */

import type { HoloSphere } from 'holosphere';

export interface QueryConfig {
	holonId: string;
	lens: string;
	onUpdate?: (data: any[]) => void;
	onError?: (error: Error) => void;
}

interface CacheEntry {
	data: Map<string, any>;
	timestamp: number;
	subscription?: { unsubscribe: () => void };
}

interface PendingQuery {
	promise: Promise<any[]>;
	timestamp: number;
}

// Cache TTL in milliseconds (5 minutes)
const CACHE_TTL = 5 * 60 * 1000;

// Deduplication window in milliseconds (100ms)
const DEDUP_WINDOW = 100;

/**
 * Centralized query management with caching, deduplication, and real-time subscriptions.
 *
 * QueryManager provides an optimized layer for data fetching across all components
 * in the application. It implements smart caching, query deduplication to prevent
 * redundant requests, and real-time subscription management for live data updates.
 *
 * @class QueryManager
 *
 * @example
 * ```typescript
 * import { queryManager } from './QueryManager';
 * import { holosphere } from 'holosphere';
 *
 * // Initialize with HoloSphere instance
 * queryManager.init(holosphere);
 *
 * // Query data with automatic caching
 * const users = await queryManager.query('myHolon', 'users');
 *
 * // Subscribe to real-time updates
 * const unsubscribe = queryManager.subscribe({
 *   holonId: 'myHolon',
 *   lens: 'quests',
 *   onUpdate: (data) => console.log('Quests updated:', data),
 *   onError: (error) => console.error('Error:', error)
 * });
 *
 * // Later: unsubscribe when done
 * unsubscribe();
 * ```
 */
class QueryManager {
	private cache: Map<string, CacheEntry> = new Map();
	private pendingQueries: Map<string, PendingQuery> = new Map();
	private subscribers: Map<string, Set<(data: any[]) => void>> = new Map();
	private holosphere: HoloSphere | null = null;

	/**
	 * Initialize the query manager with a HoloSphere instance
	 */
	init(holosphere: HoloSphere) {
		this.holosphere = holosphere;
	}

	/**
	 * Generate a cache key for a holon/lens combination
	 */
	private getCacheKey(holonId: string, lens: string): string {
		return `${holonId}:${lens}`;
	}

	private isValidItem(item: any): boolean {
		if (!item || !item.id) return false;
		if (item._deleted) return false;
		return true;
	}

	/**
	 * Get data from cache if valid
	 */
	private getFromCache(key: string): any[] | null {
		const entry = this.cache.get(key);
		if (!entry) return null;

		const age = Date.now() - entry.timestamp;
		if (age > CACHE_TTL) {
			return null; // Cache expired
		}

		return Array.from(entry.data.values());
	}

	/**
	 * Query data with caching and deduplication
	 */
	async query(holonId: string, lens: string): Promise<any[]> {
		if (!this.holosphere) {
			throw new Error('QueryManager not initialized. Call init() first.');
		}

		const key = this.getCacheKey(holonId, lens);

		// Check cache first
		const cached = this.getFromCache(key);
		if (cached !== null) {
			return cached;
		}

		// Check for pending query (deduplication)
		const pending = this.pendingQueries.get(key);
		if (pending && Date.now() - pending.timestamp < DEDUP_WINDOW) {
			return pending.promise;
		}

		// Execute new query
		const promise = this.executeQuery(holonId, lens, key);
		this.pendingQueries.set(key, { promise, timestamp: Date.now() });

		try {
			const result = await promise;
			return result;
		} finally {
			// Clean up pending query after a short delay
			setTimeout(() => {
				this.pendingQueries.delete(key);
			}, DEDUP_WINDOW * 2);
		}
	}

	/**
	 * Execute the actual query
	 */
	private async executeQuery(holonId: string, lens: string, key: string): Promise<any[]> {
		try {
			const data = await this.holosphere!.getAll(holonId, lens);

			// Convert to map for efficient updates
			const dataMap = new Map<string, any>();
			const items = Array.isArray(data) ? data : (data && typeof data === 'object' ? Object.values(data) : []);

			for (const item of items) {
				if (this.isValidItem(item)) {
					dataMap.set(item.id, item);
				}
			}

			// Update cache
			const existingEntry = this.cache.get(key);
			this.cache.set(key, {
				data: dataMap,
				timestamp: Date.now(),
				subscription: existingEntry?.subscription
			});

			return Array.from(dataMap.values());
		} catch (error) {
			console.error(`QueryManager: Error querying ${holonId}/${lens}:`, error);
			throw error;
		}
	}

	/**
	 * Subscribe to real-time updates for a holon/lens
	 */
	subscribe(config: QueryConfig): () => void {
		if (!this.holosphere) {
			throw new Error('QueryManager not initialized. Call init() first.');
		}

		const { holonId, lens, onUpdate, onError } = config;
		const key = this.getCacheKey(holonId, lens);

		// Add subscriber
		if (onUpdate) {
			if (!this.subscribers.has(key)) {
				this.subscribers.set(key, new Set());
			}
			this.subscribers.get(key)!.add(onUpdate);
		}

		// Set up holosphere subscription if not already active
		let entry = this.cache.get(key);
		if (!entry?.subscription) {
			// holosphere.subscribe returns synchronously in the current implementation
			const subscription = this.holosphere.subscribe(holonId, lens, (item: any) => {
				if (this.isValidItem(item)) {
					this.handleUpdate(key, item);
				}
			}) as unknown as { unsubscribe: () => void };

			if (entry) {
				entry.subscription = subscription;
			} else {
				this.cache.set(key, {
					data: new Map(),
					timestamp: 0,
					subscription
				});
			}
		}

		// Initial data fetch
		this.query(holonId, lens)
			.then((data) => {
				if (onUpdate) {
					onUpdate(data);
				}
			})
			.catch((error) => {
				if (onError) {
					onError(error);
				}
			});

		// Return unsubscribe function
		return () => {
			if (onUpdate) {
				const subs = this.subscribers.get(key);
				if (subs) {
					subs.delete(onUpdate);

					// If no more subscribers, clean up the holosphere subscription
					if (subs.size === 0) {
						this.subscribers.delete(key);
						const cacheEntry = this.cache.get(key);
						if (cacheEntry?.subscription) {
							cacheEntry.subscription.unsubscribe();
							cacheEntry.subscription = undefined;
						}
					}
				}
			}
		};
	}

	/**
	 * Handle real-time update from holosphere
	 */
	private handleUpdate(key: string, item: any) {
		const entry = this.cache.get(key);
		if (!entry) return;

		// Update cache
		entry.data.set(item.id, item);
		entry.timestamp = Date.now();

		// Notify subscribers
		const data = Array.from(entry.data.values());
		const subs = this.subscribers.get(key);
		if (subs) {
			subs.forEach((callback) => {
				try {
					callback(data);
				} catch (error) {
					console.error('QueryManager: Subscriber callback error:', error);
				}
			});
		}
	}

	/**
	 * Invalidate cache for a specific holon/lens
	 */
	invalidate(holonId: string, lens?: string) {
		if (lens) {
			const key = this.getCacheKey(holonId, lens);
			const entry = this.cache.get(key);
			if (entry) {
				entry.timestamp = 0; // Force refetch on next query
			}
		} else {
			// Invalidate all lenses for this holon
			for (const [key, entry] of this.cache.entries()) {
				if (key.startsWith(`${holonId}:`)) {
					entry.timestamp = 0;
				}
			}
		}
	}

	/**
	 * Clear all caches and subscriptions
	 */
	clear() {
		// Unsubscribe from all holosphere subscriptions
		for (const entry of this.cache.values()) {
			if (entry.subscription) {
				entry.subscription.unsubscribe();
			}
		}

		this.cache.clear();
		this.pendingQueries.clear();
		this.subscribers.clear();
	}

	/**
	 * Get cache stats for debugging
	 */
	getStats() {
		return {
			cacheSize: this.cache.size,
			pendingQueries: this.pendingQueries.size,
			activeSubscriptions: Array.from(this.cache.values()).filter(e => e.subscription).length,
			subscriberCount: Array.from(this.subscribers.values()).reduce((sum, set) => sum + set.size, 0)
		};
	}
}

// Singleton instance
export const queryManager = new QueryManager();

export default queryManager;
