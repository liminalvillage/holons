// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Public entry of the local store. See STORE.md.

import { Store } from './store.js';
import { createMemoryAdapter } from './adapters/memory.js';
import { createIndexedDbAdapter } from './adapters/indexeddb.js';

export { Store, isTombstone, decodeEvent } from './store.js';
export { createMemoryAdapter } from './adapters/memory.js';
export { createIndexedDbAdapter } from './adapters/indexeddb.js';
export { wins, newestFirst } from './lww.js';
export * from './address.js';
export * as privateLens from './private.js';

/**
 * Resolve an adapter spec into an adapter (or a thunk producing one).
 *   'memory'    nothing persisted (tests, serverless, scripts)
 *   'indexeddb' browser IndexedDB
 *   'file'      Node JSONL log + snapshot under `dir` (loaded lazily so the
 *               browser bundle never pulls in node:fs)
 *   'auto'      indexeddb when the platform has it, else memory
 *   object      a ready StoreAdapter instance
 */
export function resolveAdapter(spec, { appName, dir } = {}) {
    if (spec && typeof spec === 'object') return spec;
    const name = spec || 'auto';
    switch (name) {
        case 'memory':
            return createMemoryAdapter();
        case 'indexeddb':
            return createIndexedDbAdapter({ appName });
        case 'file':
            return () => import('./adapters/file.js').then((m) => m.createFileAdapter({ dir, appName }));
        case 'auto':
            return typeof indexedDB !== 'undefined'
                ? createIndexedDbAdapter({ appName })
                : createMemoryAdapter();
        default:
            throw new Error(`store: unknown adapter '${name}' (memory | indexeddb | file | auto)`);
    }
}

/**
 * Build a store. Call `await store.open()` before use.
 * @param {object} opts
 * @param {string} opts.appName
 * @param {'memory'|'indexeddb'|'file'|'auto'|object} [opts.adapter='auto']
 * @param {string} [opts.dir]            directory for the file adapter
 * @param {number} [opts.compactAfter]
 * @param {number} [opts.kind]
 */
export function createStore({ appName, adapter = 'auto', dir, compactAfter, kind } = {}) {
    return new Store({
        appName,
        adapter: resolveAdapter(adapter, { appName, dir }),
        ...(compactAfter !== undefined ? { compactAfter } : {}),
        ...(kind !== undefined ? { kind } : {}),
    });
}
