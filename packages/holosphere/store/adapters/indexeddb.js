// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Browser adapter on the raw IndexedDB API (no dependency). One database per
// app (`holosphere:<app>`), four object stores mirroring the persistence
// tables. Each `append` is one read-write transaction. A quota or corruption
// error degrades the adapter to a no-op with a single warning: the store keeps
// running from memory rather than taking the app down.

const DB_VERSION = 1;
const STORES = ['records', 'events', 'private', 'cursors'];

const req = (r) => new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
});

const done = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
});

export function createIndexedDbAdapter({ appName = 'holosphere', dbName, indexedDB: idb } = {}) {
    const factory = idb === undefined ? globalThis.indexedDB : idb;
    const name = dbName || `holosphere:${appName}`;
    let db = null;
    let degraded = false;
    let chain = Promise.resolve();

    const serial = (fn) => {
        const next = chain.then(fn, fn);
        chain = next.catch(() => {});
        return next;
    };

    const degrade = (where, e) => {
        if (!degraded) {
            console.warn(`[holosphere/store] IndexedDB ${where} failed (${e?.name || ''} ${e?.message || e}); continuing in memory only`);
        }
        degraded = true;
    };

    async function openDb() {
        const r = factory.open(name, DB_VERSION);
        r.onupgradeneeded = () => {
            const d = r.result;
            if (!d.objectStoreNames.contains('records')) d.createObjectStore('records', { keyPath: 'addr' });
            if (!d.objectStoreNames.contains('events')) d.createObjectStore('events', { keyPath: 'id' });
            if (!d.objectStoreNames.contains('private')) d.createObjectStore('private', { keyPath: 'k' });
            if (!d.objectStoreNames.contains('cursors')) d.createObjectStore('cursors', { keyPath: 'k' });
        };
        return req(r);
    }

    return {
        kind: 'indexeddb',
        name,

        async open() {
            if (!factory) {
                degrade('open', new Error('indexedDB is not available'));
                return null;
            }
            try {
                db = await openDb();
                db.onversionchange = () => { try { db.close(); } catch { /* ignore */ } };
                const tx = db.transaction(STORES, 'readonly');
                const [records, events, priv, cursors] = await Promise.all(
                    STORES.map((s) => req(tx.objectStore(s).getAll())),
                );
                await done(tx);
                return {
                    records,
                    events,
                    private: priv.map((row) => [row.k, row.v]),
                    cursors: cursors.map((row) => [row.k, row.v]),
                };
            } catch (e) {
                degrade('open', e);
                return null;
            }
        },

        append(ops) {
            if (!db || degraded || !ops.length) return Promise.resolve();
            return serial(async () => {
                try {
                    const tx = db.transaction(STORES, 'readwrite');
                    for (const op of ops) {
                        switch (op.t) {
                            case 'rec': tx.objectStore('records').put(op.v); break;
                            case 'evt': tx.objectStore('events').put(op.v); break;
                            case 'evt-del': tx.objectStore('events').delete(op.id); break;
                            case 'priv': tx.objectStore('private').put({ k: op.k, v: op.v }); break;
                            case 'priv-del': tx.objectStore('private').delete(op.k); break;
                            case 'cur': tx.objectStore('cursors').put({ k: op.k, v: op.v }); break;
                            default: break;
                        }
                    }
                    await done(tx);
                } catch (e) {
                    degrade('write', e);
                }
            });
        },

        snapshot(full) {
            if (!db || degraded) return Promise.resolve();
            return serial(async () => {
                try {
                    const tx = db.transaction(STORES, 'readwrite');
                    for (const s of STORES) tx.objectStore(s).clear();
                    for (const rec of full.records) tx.objectStore('records').put(rec);
                    for (const evt of full.events) tx.objectStore('events').put(evt);
                    for (const [k, v] of full.private) tx.objectStore('private').put({ k, v });
                    for (const [k, v] of full.cursors) tx.objectStore('cursors').put({ k, v });
                    await done(tx);
                } catch (e) {
                    degrade('snapshot', e);
                }
            });
        },

        clear() {
            if (!db || degraded) return Promise.resolve();
            return serial(async () => {
                try {
                    const tx = db.transaction(STORES, 'readwrite');
                    for (const s of STORES) tx.objectStore(s).clear();
                    await done(tx);
                } catch (e) {
                    degrade('clear', e);
                }
            });
        },

        async close() {
            await chain;
            try { db?.close(); } catch { /* ignore */ }
            db = null;
        },

        get degraded() {
            return degraded;
        },
    };
}
