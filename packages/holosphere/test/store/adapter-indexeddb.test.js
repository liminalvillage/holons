import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createStore, createIndexedDbAdapter, resolveAdapter } from '../../store/index.js';
import { APP, keypair, signed } from './helpers.js';

describe('store/adapters/indexeddb', () => {
    let idb;
    beforeEach(() => { idb = new IDBFactory(); });

    const openStore = async () => {
        const adapter = createIndexedDbAdapter({ appName: APP, indexedDB: idb });
        const store = createStore({ appName: APP, adapter });
        await store.open();
        return { store, adapter };
    };

    test('auto picks IndexedDB when the platform has it', () => {
        expect(resolveAdapter('auto', { appName: APP }).kind).toBe('indexeddb');
    });

    test('state survives close + reopen on the same database', async () => {
        const a = keypair();
        const { store: s1 } = await openStore();
        const evt = signed({ item: { id: 't1', title: 'A' }, sk: a.sk });
        s1.apply(evt);
        s1.putRaw('h1', 'tasks', 't2', { id: 't2' });
        s1.privatePut('App:h1', 'notes', 'n1', 'cipher');
        s1.setCursor('h1', 'tasks', 42);
        await s1.close();

        const { store: s2 } = await openStore();
        expect(s2.get('h1', 'tasks', 't1').item.title).toBe('A');
        expect(s2.getEvents('h1', 'tasks', 't1')[0].id).toBe(evt.id);
        expect(s2.listKeys('h1', 'tasks').sort()).toEqual(['t1', 't2']);
        expect(s2.privateGet('App:h1', 'notes', 'n1')).toBe('cipher');
        expect(s2.getCursor('h1', 'tasks').since).toBe(42);
        await s2.close();
    });

    test('superseded events and deleted private rows are removed', async () => {
        const a = keypair();
        const { store: s1 } = await openStore();
        const now = Math.floor(Date.now() / 1000);
        s1.apply(signed({ item: { id: 't1', v: 1 }, sk: a.sk, created_at: now - 1 }));
        s1.apply(signed({ item: { id: 't1', v: 2 }, sk: a.sk, created_at: now }));
        s1.privatePut('App:h1', 'notes', 'n1', 'c');
        s1.privateDelete('App:h1', 'notes', 'n1');
        await s1.close();
        const { store: s2 } = await openStore();
        expect(s2.events.size).toBe(1);
        expect(s2.privateList('App:h1', 'notes')).toEqual([]);
        await s2.close();
    });

    test('compaction rewrites the database from memory', async () => {
        const { store } = await openStore();
        store.putRaw('h1', 'tasks', 't1', { id: 't1' });
        await store.compact();
        await store.close();
        const { store: again } = await openStore();
        expect(again.listKeys('h1', 'tasks')).toEqual(['t1']);
        await again.close();
    });

    test('a missing IndexedDB degrades to memory-only with a warning', async () => {
        const origWarn = console.warn; let warned = 0; console.warn = () => { warned++; };
        const adapter = createIndexedDbAdapter({ appName: APP, indexedDB: null });
        const store = createStore({ appName: APP, adapter });
        await store.open();
        expect(adapter.degraded).toBe(true);
        store.putRaw('h1', 'tasks', 't1', { id: 't1' });
        await store.flush();
        expect(store.listKeys('h1', 'tasks')).toEqual(['t1']);
        await store.close();
        expect(warned).toBeGreaterThan(0);
        console.warn = origWarn;
    });
});
