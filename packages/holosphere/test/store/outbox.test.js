// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The outbox table: published events wait here until a relay acknowledges
// them, survive a reopen through every adapter, and collapse per replaceable
// coordinate so a burst of edits to one record resends only the newest.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createStore, createMemoryAdapter, createIndexedDbAdapter } from '../../store/index.js';
import { replaceableCoordinate } from '../../store/store.js';
import { finalizeEvent } from 'nostr-tools/pure';
import { APP, keypair, signed } from './helpers.js';

const now = () => Math.floor(Date.now() / 1000);

describe('store outbox', () => {
    test('add / list / remove, oldest first', async () => {
        const a = keypair();
        const s = createStore({ appName: APP, adapter: 'memory' });
        await s.open();
        const e1 = signed({ item: { id: 'a' }, sk: a.sk, created_at: now() - 10 });
        const e2 = signed({ item: { id: 'b' }, sk: a.sk, created_at: now() });
        s.outboxAdd(e2);
        s.outboxAdd(e1);
        expect(s.outboxSize()).toBe(2);
        expect(s.outboxList().map((e) => e.id)).toEqual([e1.id, e2.id]);
        expect(s.stats().outbox).toBe(2);
        expect(s.outboxRemove(e1.id)).toBe(true);
        expect(s.outboxRemove(e1.id)).toBe(false);
        expect(s.outboxList().map((e) => e.id)).toEqual([e2.id]);
        await s.close();
    });

    test('a newer claim at the same replaceable coordinate evicts the unsent older one', async () => {
        const a = keypair();
        const s = createStore({ appName: APP, adapter: 'memory' });
        await s.open();
        const t = now();
        const v1 = signed({ item: { id: 't1', v: 1 }, sk: a.sk, created_at: t - 2 });
        const v2 = signed({ item: { id: 't1', v: 2 }, sk: a.sk, created_at: t - 1 });
        const other = signed({ item: { id: 't2' }, sk: a.sk, created_at: t - 1 });
        s.outboxAdd(v1);
        s.outboxAdd(other);
        expect(s.outboxAdd(v2)).toEqual([v1.id]);
        expect(s.outboxList().map((e) => e.id).sort()).toEqual([other.id, v2.id].sort());
        // An OLDER claim arriving after a newer one is not queued at all.
        const v0 = signed({ item: { id: 't1', v: 0 }, sk: a.sk, created_at: t - 5 });
        expect(s.outboxAdd(v0)).toEqual([]);
        expect(s.outbox.has(v0.id)).toBe(false);
        await s.close();
    });

    test('regular kinds are never collapsed; coordinates follow NIP-01', () => {
        const a = keypair();
        const mk = (kind, tags = []) => finalizeEvent({ kind, created_at: now(), tags, content: '' }, a.sk);
        expect(replaceableCoordinate(mk(1808))).toBeNull();
        expect(replaceableCoordinate(mk(1))).toBeNull();
        expect(replaceableCoordinate(mk(0))).toBe(`0|${a.pk}`);
        expect(replaceableCoordinate(mk(10002))).toBe(`10002|${a.pk}`);
        expect(replaceableCoordinate(mk(30078, [['d', 'x']]))).toBe(`30078|${a.pk}|x`);
        expect(replaceableCoordinate(mk(30078, [['d', 'y']]))).not.toBe(replaceableCoordinate(mk(30078, [['d', 'x']])));
    });

    test('two append-only log entries both wait', async () => {
        const a = keypair();
        const s = createStore({ appName: APP, adapter: 'memory' });
        await s.open();
        const mk = (c) => finalizeEvent({ kind: 1808, created_at: now(), tags: [['n', APP]], content: c }, a.sk);
        s.outboxAdd(mk('one'));
        s.outboxAdd(mk('two'));
        expect(s.outboxSize()).toBe(2);
        await s.close();
    });

    test('survives a reopen on the memory adapter (retain) and on IndexedDB', async () => {
        const a = keypair();
        const evt = signed({ item: { id: 'off' }, sk: a.sk });
        const acked = signed({ item: { id: 'on' }, sk: a.sk });

        const mem = createMemoryAdapter({ retain: true });
        const m1 = createStore({ appName: APP, adapter: mem });
        await m1.open();
        m1.outboxAdd(evt);
        m1.outboxAdd(acked);
        m1.outboxRemove(acked.id);
        await m1.close();
        const m2 = createStore({ appName: APP, adapter: mem });
        await m2.open();
        expect(m2.outboxList().map((e) => e.id)).toEqual([evt.id]);
        await m2.compact();
        await m2.close();
        const m3 = createStore({ appName: APP, adapter: mem });
        await m3.open();
        expect(m3.outboxList().map((e) => e.id)).toEqual([evt.id]);
        await m3.close();

        const idb = new IDBFactory();
        const openIdb = async () => {
            const s = createStore({ appName: APP, adapter: createIndexedDbAdapter({ appName: APP, indexedDB: idb }) });
            await s.open();
            return s;
        };
        const i1 = await openIdb();
        i1.outboxAdd(evt);
        i1.outboxAdd(acked);
        i1.outboxRemove(acked.id);
        await i1.close();
        const i2 = await openIdb();
        expect(i2.outboxList().map((e) => e.id)).toEqual([evt.id]);
        await i2.compact();
        await i2.close();
        const i3 = await openIdb();
        expect(i3.outboxList().map((e) => e.id)).toEqual([evt.id]);
        i3.outboxRemove(evt.id);
        await i3.close();
        const i4 = await openIdb();
        expect(i4.outboxSize()).toBe(0);
        await i4.close();
    });

    test('a v2 IndexedDB database (no outbox store) upgrades in place', async () => {
        const idb = new IDBFactory();
        // Create the pre-outbox schema by hand.
        await new Promise((resolve, reject) => {
            const r = idb.open(`holosphere:${APP}`, 2);
            r.onupgradeneeded = () => {
                const d = r.result;
                d.createObjectStore('records', { keyPath: 'addr' });
                d.createObjectStore('events', { keyPath: 'id' });
                d.createObjectStore('private', { keyPath: 'k' });
                d.createObjectStore('cursors', { keyPath: 'k' });
            };
            r.onsuccess = () => {
                const db = r.result;
                const tx = db.transaction(['cursors'], 'readwrite');
                tx.objectStore('cursors').put({ k: 'old', v: { since: 7, syncedAt: 1 } });
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onerror = () => reject(tx.error);
            };
            r.onerror = () => reject(r.error);
        });
        const a = keypair();
        const adapter = createIndexedDbAdapter({ appName: APP, indexedDB: a && idb });
        const s = createStore({ appName: APP, adapter });
        await s.open();
        expect(adapter.degraded).toBe(false);
        expect(s.cursors.get('old')?.since).toBe(7);
        s.outboxAdd(signed({ item: { id: 'x' }, sk: a.sk }));
        await s.flush();
        expect(adapter.degraded).toBe(false);
        await s.close();
    });
});
