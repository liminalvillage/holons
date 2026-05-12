// Memoized REAEventStore so multiple components share one instance per
// holosphere handle. Stateless beyond the db reference, but reusing one
// store keeps GC pressure low and centralizes the wiring.

import { REAEventStore } from '@holons/core/rea';

let cached: { holosphere: unknown; store: REAEventStore } | null = null;

/**
 * Return a memoized REAEventStore for the given holosphere instance. Reuses
 * the cached store when called with the same holosphere reference; otherwise
 * builds a new one (and updates the cache).
 */
export function getEventStore(holosphere: any): REAEventStore {
    if (cached && cached.holosphere === holosphere) return cached.store;
    const store = new REAEventStore(holosphere);
    cached = { holosphere, store };
    return store;
}
