import { createStore, createMemoryAdapter, GLOBAL_HOLON, addr, parseAddr, addrFromSoul } from '../../store/index.js';
import { APP, keypair, signed, tick } from './helpers.js';

describe('store: apply, LWW and events', () => {
    let store, a, b;
    beforeEach(async () => {
        store = createStore({ appName: APP, adapter: 'memory' });
        await store.open();
        a = keypair();
        b = keypair();
    });
    afterEach(() => store.close());

    test('a signed event becomes the current record and its envelope is kept', () => {
        const evt = signed({ item: { id: 't1', title: 'A' }, sk: a.sk });
        const r = store.apply(evt);
        expect(r.applied).toBe(true);
        expect(store.get('h1', 'tasks', 't1').item.title).toBe('A');
        expect(store.get('h1', 'tasks', 't1').pubkey).toBe(a.pk);
        expect(store.getEvents('h1', 'tasks', 't1').map((e) => e.id)).toEqual([evt.id]);
        expect(store.listEventIds('h1', 'tasks')).toEqual(['t1']);
    });

    test('the same event id is a no-op (seen)', () => {
        const evt = signed({ item: { id: 't1', title: 'A' }, sk: a.sk });
        store.apply(evt);
        expect(store.apply(evt)).toMatchObject({ applied: false, reason: 'seen' });
    });

    test('an older event is stale but the author claim is still tracked', () => {
        const now = Math.floor(Date.now() / 1000);
        const newer = signed({ item: { id: 't1', title: 'new' }, sk: a.sk, created_at: now });
        const older = signed({ item: { id: 't1', title: 'old' }, sk: b.sk, created_at: now - 10 });
        store.apply(newer);
        expect(store.apply(older)).toMatchObject({ applied: false, reason: 'stale' });
        expect(store.get('h1', 'tasks', 't1').item.title).toBe('new');
        // both authors' latest claims are visible to enforce-style reads
        expect(store.getEvents('h1', 'tasks', 't1').map((e) => e.pubkey)).toEqual([a.pk, b.pk]);
    });

    test('an author\'s older claim never displaces their newer one', () => {
        const now = Math.floor(Date.now() / 1000);
        const v2 = signed({ item: { id: 't1', v: 2 }, sk: a.sk, created_at: now });
        const v1 = signed({ item: { id: 't1', v: 1 }, sk: a.sk, created_at: now - 5 });
        store.apply(v2);
        store.apply(v1);
        expect(store.getEvents('h1', 'tasks', 't1')).toHaveLength(1);
        expect(store.events.has(v1.id)).toBe(false);
        expect(store.get('h1', 'tasks', 't1').item.v).toBe(2);
    });

    test('forged, wrong-kind, foreign-namespace and malformed events are rejected', () => {
        const evt = signed({ item: { id: 't1', title: 'A' }, sk: a.sk });
        expect(store.apply({ ...evt, content: JSON.stringify({ id: 't1', title: 'X' }) })).toMatchObject({ applied: false, reason: 'invalid' });
        expect(store.apply({ ...evt, kind: 1 })).toMatchObject({ applied: false, reason: 'kind' });
        expect(store.apply(signed({ item: { id: 't2' }, sk: a.sk, app: 'other-app' }))).toMatchObject({ applied: false, reason: 'foreign' });
        expect(store.apply({ ...evt, id: 'x', tags: [['n', APP]] })).toMatchObject({ applied: false, reason: 'malformed' });
        expect(store.get('h1', 'tasks', 't1')).toBeUndefined();
    });

    test('tombstones are records: hidden from list, visible with includeDeleted', () => {
        store.apply(signed({ item: { id: 't1', title: 'A' }, sk: a.sk }));
        const now = Math.floor(Date.now() / 1000) + 1;
        store.apply(signed({ item: { id: 't1', _deleted: true }, sk: a.sk, created_at: now }));
        expect(store.listKeys('h1', 'tasks')).toEqual([]);
        expect(store.listKeys('h1', 'tasks', { includeDeleted: true })).toEqual(['t1']);
        expect(store.get('h1', 'tasks', 't1').item._deleted).toBe(true);
    });

    test('globals live under the _g sentinel', () => {
        store.apply(signed({ holon: null, lens: 'federation', item: { id: 'f1', x: 1 }, sk: a.sk }));
        expect(store.get(null, 'federation', 'f1').item.x).toBe(1);
        expect(store.get(null, 'federation', 'f1').holon).toBeNull();
        expect(store.listHolons()).toEqual([]);
        expect(store.exportEvents({ holon: null })).toHaveLength(1);
        expect(addr(null, 'federation', 'f1')).toBe(addr(GLOBAL_HOLON, 'federation', 'f1'));
        expect(parseAddr(addr(null, 'x', 'y'))).toEqual({ holon: null, lens: 'x', id: 'y' });
    });

    test('putRaw always becomes current and loses ties to signed events', () => {
        const rec = store.putRaw('h1', 'tasks', 'r1', { id: 'r1', v: 'raw' });
        expect(rec.eventId).toBe('');
        expect(store.get('h1', 'tasks', 'r1').item.v).toBe('raw');
        const evt = signed({ item: { id: 'r1', v: 'signed' }, sk: a.sk, created_at: rec.created_at });
        expect(store.apply(evt).applied).toBe(true);
        expect(store.get('h1', 'tasks', 'r1').item.v).toBe('signed');
        // and a second raw write bumps past it
        store.putRaw('h1', 'tasks', 'r1', { id: 'r1', v: 'raw2' });
        expect(store.get('h1', 'tasks', 'r1').item.v).toBe('raw2');
        expect(store.get('h1', 'tasks', 'r1').created_at).toBeGreaterThan(evt.created_at);
    });

    test('nextCreatedAt is strictly past the newest claim at the address', () => {
        const future = Math.floor(Date.now() / 1000) + 50;
        store.apply(signed({ item: { id: 't1' }, sk: a.sk, created_at: future }));
        expect(store.nextCreatedAt('h1', 'tasks', 't1')).toBe(future + 1);
        expect(store.nextCreatedAt('h1', 'tasks', 'fresh')).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000));
    });

    test('list/listKeys/listLenses/listHolons reflect the index', () => {
        store.apply(signed({ holon: 'h1', lens: 'tasks', item: { id: 't1' }, sk: a.sk }));
        store.apply(signed({ holon: 'h1', lens: 'roles', item: { id: 'r1' }, sk: a.sk }));
        store.apply(signed({ holon: 'h2', lens: 'tasks', item: { id: 't9' }, sk: b.sk }));
        store.putRaw('_capabilities', 'h1', 'cap', { id: 'cap' });
        expect(store.listHolons().sort()).toEqual(['h1', 'h2']);
        expect(store.listLenses('h1').sort()).toEqual(['roles', 'tasks']);
        expect(store.list('h2', 'tasks').map((r) => r.id)).toEqual(['t9']);
    });

    test('export is oldest-first and import verifies and dedupes', () => {
        const now = Math.floor(Date.now() / 1000);
        const e1 = signed({ item: { id: 't1' }, sk: a.sk, created_at: now - 2 });
        const e2 = signed({ item: { id: 't2' }, sk: a.sk, created_at: now - 1 });
        store.apply(e2);
        store.apply(e1);
        expect(store.exportEvents().map((e) => e.id)).toEqual([e1.id, e2.id]);
        expect(store.exportEvents({ authors: [b.pk] })).toEqual([]);

        const other = createStore({ appName: APP, adapter: 'memory' });
        return other.open().then(() => {
            const forged = { ...e2, id: 'f'.repeat(64) };
            expect(other.importEvents([e1, e2, e1, forged])).toEqual({ received: 4, applied: 2, rejected: 1 });
            expect(other.listKeys('h1', 'tasks').sort()).toEqual(['t1', 't2']);
            return other.close();
        });
    });
});

describe('store: watch feed', () => {
    let store, a;
    beforeEach(async () => {
        store = createStore({ appName: APP, adapter: 'memory' });
        await store.open();
        a = keypair();
    });
    afterEach(() => store.close());

    test('a late subscriber gets the full snapshot (tombstones excluded), then live changes', async () => {
        store.apply(signed({ item: { id: 't1', title: 'A' }, sk: a.sk }));
        store.putRaw('h1', 'tasks', 't2', { id: 't2', title: 'B' });
        store.putRaw('h1', 'tasks', 'dead', { id: 'dead', _deleted: true });
        await tick();

        const seen = [];
        const off = store.watch('h1', 'tasks', (item, id, meta) => seen.push([id, meta.replay, meta.tombstone]));
        expect(seen).toEqual([]); // replay is asynchronous: the handle exists first
        await tick();
        expect(seen.sort()).toEqual([['t1', true, false], ['t2', true, false]]);

        store.putRaw('h1', 'tasks', 't3', { id: 't3' });
        store.putRaw('h1', 'tasks', 't1', { id: 't1', _deleted: true });
        expect(seen.slice(2)).toEqual([['t3', false, false], ['t1', false, true]]);

        off();
        store.putRaw('h1', 'tasks', 't4', { id: 't4' });
        expect(seen).toHaveLength(4);
    });

    test('a write in the same tick as the subscribe is delivered once', async () => {
        const seen = [];
        store.watch('h1', 'tasks', (item, id) => seen.push(id));
        store.putRaw('h1', 'tasks', 't1', { id: 't1' });
        await tick();
        expect(seen).toEqual(['t1']);
    });

    test('every subscriber gets its own replay; lens watches are isolated', async () => {
        store.putRaw('h1', 'tasks', 't1', { id: 't1' });
        const one = [], two = [], other = [];
        store.watch('h1', 'tasks', (_, id) => one.push(id));
        store.watch('h1', 'tasks', (_, id) => two.push(id));
        store.watch('h1', 'roles', (_, id) => other.push(id));
        await tick();
        expect(one).toEqual(['t1']);
        expect(two).toEqual(['t1']);
        expect(other).toEqual([]);
    });

    test('replay: false skips the snapshot', async () => {
        store.putRaw('h1', 'tasks', 't1', { id: 't1' });
        const seen = [];
        store.watch('h1', 'tasks', (_, id) => seen.push(id), { replay: false });
        await tick();
        expect(seen).toEqual([]);
        store.putRaw('h1', 'tasks', 't2', { id: 't2' });
        expect(seen).toEqual(['t2']);
    });

    test('a throwing watcher does not break delivery to others', async () => {
        const origWarn = console.warn; let warned = 0; console.warn = () => { warned++; };
        const seen = [];
        store.watch('h1', 'tasks', () => { throw new Error('boom'); });
        store.watch('h1', 'tasks', (_, id) => seen.push(id));
        store.putRaw('h1', 'tasks', 't1', { id: 't1' });
        expect(seen).toEqual(['t1']);
        console.warn = origWarn;
    });
});

describe('store: backlinks (hologram pointers)', () => {
    let store;
    beforeEach(async () => {
        store = createStore({ appName: APP, adapter: 'memory' });
        await store.open();
    });
    afterEach(() => store.close());

    const src = `${APP}/h1/tasks/t1`;

    test('a pointer record links to its source; tombstoning or replacing it unlinks', () => {
        store.putRaw('h2', 'tasks', 'p1', { id: 'p1', soul: src });
        store.putRaw('h3', 'tasks', 'p2', { id: 'p2', soul: src });
        expect(store.getBacklinks(src).sort()).toEqual([`${APP}/h2/tasks/p1`, `${APP}/h3/tasks/p2`]);
        store.putRaw('h2', 'tasks', 'p1', { id: 'p1', _deleted: true });
        expect(store.getBacklinks(src)).toEqual([`${APP}/h3/tasks/p2`]);
        store.putRaw('h3', 'tasks', 'p2', { id: 'p2', title: 'now a plain record' });
        expect(store.getBacklinks(src)).toEqual([]);
        expect(addrFromSoul(src, APP)).toBe(addr('h1', 'tasks', 't1'));
        expect(addrFromSoul(src, 'other')).toBeNull();
    });

    test('backlinks are rebuilt from records on open', async () => {
        const adapter = createMemoryAdapter({ retain: true });
        const first = createStore({ appName: APP, adapter });
        await first.open();
        first.putRaw('h2', 'tasks', 'p1', { id: 'p1', soul: src });
        await first.close();

        const second = createStore({ appName: APP, adapter });
        await second.open();
        expect(second.getBacklinks(src)).toEqual([`${APP}/h2/tasks/p1`]);
        await second.close();
    });
});

describe('store: cursors', () => {
    test('cursors only move forward and survive a reopen', async () => {
        const adapter = createMemoryAdapter({ retain: true });
        const store = createStore({ appName: APP, adapter });
        await store.open();
        expect(store.getCursor('h1', 'tasks')).toBeNull();
        store.setCursor('h1', 'tasks', 100);
        store.setCursor('h1', 'tasks', 50);
        expect(store.getCursor('h1', 'tasks').since).toBe(100);
        await store.close();

        const again = createStore({ appName: APP, adapter });
        await again.open();
        expect(again.getCursor('h1', 'tasks').since).toBe(100);
        expect(again.getCursor('h1', 'roles')).toBeNull();
        await again.close();
    });
});
