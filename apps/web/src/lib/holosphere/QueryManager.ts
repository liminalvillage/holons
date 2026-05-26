/**
 * Holosphere Query Manager
 *
 * Centralized query management with caching, deduplication, and real-time subscriptions.
 * Provides optimized data fetching across all components.
 */

import type { HoloSphere } from "holosphere";

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
 * Coerce whatever shape `holosphere.subscribe` returned into a stable
 * `{ unsubscribe: () => void }`. The patched library returns this shape
 * synchronously, but a stale dev bundle may still return the old
 * `Promise<{ unsubscribe }>`. Without this, swapping versions mid-session
 * crashes the next teardown with `subscription.unsubscribe is not a function`.
 */
function normalizeSubscription(sub: unknown): { unsubscribe: () => void } {
  if (sub && typeof (sub as any).unsubscribe === "function") {
    return sub as { unsubscribe: () => void };
  }
  if (sub && typeof (sub as any).then === "function") {
    let resolved: { unsubscribe?: () => void } | null = null;
    let cancelled = false;
    (sub as PromiseLike<{ unsubscribe?: () => void }>).then(
      (value) => {
        resolved = value;
        // If unsubscribe was called before the Promise settled, fire now.
        if (cancelled) value?.unsubscribe?.();
      },
      () => {
        /* swallow — subscribe errors are reported via onError */
      },
    );
    return {
      unsubscribe: () => {
        cancelled = true;
        resolved?.unsubscribe?.();
      },
    };
  }
  // Unknown shape — no-op cleanup rather than crash on teardown.
  return { unsubscribe: () => {} };
}

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

  // Pending notifications (coalesced via microtask so a burst of per-item
  // updates from Gun's map().on() fires one re-render per cycle, not N).
  private pendingNotifications: Set<string> = new Set();
  private notifyScheduled = false;

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
    // Note: `getFederated` now drops unresolved-hologram error stubs
    // (`_hologram.isHologram === false`) at the library boundary, so no
    // extra placeholder filter is needed here.
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
      throw new Error("QueryManager not initialized. Call init() first.");
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
  private async executeQuery(
    holonId: string,
    lens: string,
    key: string,
  ): Promise<any[]> {
    try {
      // holosphere.getAll's contract is Promise<Array<T>> — every code
      // path in content.js resolves to an array (or throws).
      const items = await this.holosphere!.getAll(holonId, lens);

      // Convert to map for efficient updates
      const dataMap = new Map<string, any>();

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
        subscription: existingEntry?.subscription,
      });

      return Array.from(dataMap.values());
    } catch (error) {
      console.error(`QueryManager: Error querying ${holonId}/${lens}:`, error);
      throw error;
    }
  }

  /**
   * Subscribe to real-time updates for a holon/lens.
   *
   * Local-first + progressive: emits the cached snapshot synchronously
   * (next microtask), then streams in items as Gun's map().on() delivers
   * them — local cache first, federated peers as they respond. No blocking
   * getAll round-trip on the critical path.
   */
  subscribe(config: QueryConfig): () => void {
    if (!this.holosphere) {
      throw new Error("QueryManager not initialized. Call init() first.");
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

    // Ensure cache entry exists so per-item updates have a place to land.
    let entry = this.cache.get(key);
    if (!entry) {
      entry = { data: new Map(), timestamp: 0 };
      this.cache.set(key, entry);
    }

    // Emit current cached snapshot immediately so the UI paints what we
    // already know without waiting on the network.
    if (onUpdate) {
      const snapshot = Array.from(entry.data.values());
      queueMicrotask(() => {
        try {
          onUpdate(snapshot);
        } catch (error) {
          console.error(
            "QueryManager: initial snapshot callback error:",
            error,
          );
        }
      });
    }

    // Set up holosphere subscription if not already active. Gun's
    // map().on() fires per-item — first for whatever is in the local
    // graph, then again for each peer response as it arrives.
    //
    // Patched holosphere returns `{ unsubscribe }` synchronously, but
    // a stale Vite/browser cache may still be serving the pre-patch
    // async version (Promise<{ unsubscribe }>). Coerce both shapes
    // through a small normalizer so a cache miss can't crash the app.
    if (!entry.subscription) {
      try {
        const sub = this.holosphere.subscribe(
          holonId,
          lens,
          (item: any, itemKey?: string) => {
            this.handleSubscriptionEvent(key, item, itemKey);
          },
        );
        entry.subscription = normalizeSubscription(sub);
      } catch (error) {
        console.error(
          `QueryManager: subscribe error for ${holonId}/${lens}:`,
          error,
        );
        if (onError)
          onError(error instanceof Error ? error : new Error(String(error)));
      }
    }

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
              const sub = cacheEntry.subscription;
              cacheEntry.subscription = undefined;
              try {
                sub.unsubscribe();
              } catch (e) {
                console.error("QueryManager: unsubscribe error:", e);
              }
            }
          }
        }
      }
    };
  }

  /**
   * Handle a single per-item event from holosphere.subscribe.
   *
   * Treats tombstones (null/_deleted) as removals so the cached snapshot
   * stays consistent with the federated graph.
   */
  private handleSubscriptionEvent(key: string, item: any, itemKey?: string) {
    const entry = this.cache.get(key);
    if (!entry) return;

    // Tombstone: item was deleted upstream.
    if (!item) {
      if (itemKey && entry.data.delete(itemKey)) {
        entry.timestamp = Date.now();
        this.scheduleNotify(key);
      }
      return;
    }

    if (item._deleted) {
      const removeId = item.id ?? itemKey;
      if (removeId && entry.data.delete(removeId)) {
        entry.timestamp = Date.now();
        this.scheduleNotify(key);
      }
      return;
    }

    if (!this.isValidItem(item)) return;

    entry.data.set(item.id, item);
    entry.timestamp = Date.now();
    this.scheduleNotify(key);
  }

  /**
   * Coalesce a burst of per-item updates into one subscriber notification
   * per microtask. Gun's map().on() can fire hundreds of times in a row
   * when local cache hydrates; without this, every subscriber would
   * re-render once per item.
   */
  private scheduleNotify(key: string) {
    this.pendingNotifications.add(key);
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      const keys = Array.from(this.pendingNotifications);
      this.pendingNotifications.clear();
      for (const k of keys) this.notifySubscribers(k);
    });
  }

  private notifySubscribers(key: string) {
    const entry = this.cache.get(key);
    if (!entry) return;
    const subs = this.subscribers.get(key);
    if (!subs || subs.size === 0) return;
    const data = Array.from(entry.data.values());
    subs.forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        console.error("QueryManager: Subscriber callback error:", error);
      }
    });
  }

  /**
   * Synchronously drop a single record from the cache and notify
   * subscribers. Use this immediately after `holosphere.delete(...)` so the
   * UI doesn't see the deleted item flash back when an unrelated update
   * causes the manager to re-emit its cached snapshot before Gun's null
   * tombstone has propagated through `subscribe()`.
   *
   * If the id isn't in the cache, it's a no-op (no spurious notification).
   */
  evict(holonId: string, lens: string, id: string) {
    const key = this.getCacheKey(holonId, lens);
    const entry = this.cache.get(key);
    if (entry?.data.delete(id)) {
      entry.timestamp = Date.now();
      this.scheduleNotify(key);
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
      activeSubscriptions: Array.from(this.cache.values()).filter(
        (e) => e.subscription,
      ).length,
      subscriberCount: Array.from(this.subscribers.values()).reduce(
        (sum, set) => sum + set.size,
        0,
      ),
    };
  }
}

// Singleton instance
export const queryManager = new QueryManager();

export default queryManager;
