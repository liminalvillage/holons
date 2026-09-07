/**
 * One address, one author, two wire encodings.
 *
 * A record can be encoded twice — the legacy kind-30078 envelope and a standard
 * kind — and NIP-33 makes those independent replaceable slots on the relay. The
 * envelope index has to mirror that, or the newer encoding evicts the older and
 * everything that reads envelopes (getEvents, exportEvents, nextCreatedAt,
 * enforce mode) silently loses half the picture while the RECORD looks fine.
 *
 * `_indexEvent` is the snapshot-hydration path, and the only route that accepts
 * more than one kind until the wire registry lands.
 */
import { createStore } from '../../store/index.js';
import { buildEvent } from '../../nostr-events.js';
import { APP, keypair, signed } from './helpers.js';

const HOLON = 'h1';
const LENS = 'tasks';
const ID = 't1';

const standard = ({ item, sk, created_at }) =>
    buildEvent({ holon: HOLON, lens: LENS, item, sk, created_at, kind: 31923, extraTags: [['n', APP]] });

describe('store: envelope claims are keyed by author AND kind', () => {
    let store;
    beforeEach(async () => {
        store = createStore({ appName: APP, adapter: 'memory' });
        await store.open();
    });
    afterEach(async () => { await store.close(); });

    test('both encodings of one record by one author survive', () => {
        const a = keypair();
        const legacy = signed({ holon: HOLON, lens: LENS, item: { id: ID, title: 'legacy' }, sk: a.sk, created_at: 1000 });
        const modern = standard({ item: { id: ID, title: 'standard' }, sk: a.sk, created_at: 1001 });

        store._indexEvent(legacy);
        store._indexEvent(modern);

        const kinds = store.getEvents(HOLON, LENS, ID).map((e) => e.kind).sort((x, y) => x - y);
        expect(kinds).toEqual([30078, 31923]);
    });

    test('a newer claim still replaces the same author on the same kind', () => {
        const a = keypair();
        store._indexEvent(signed({ holon: HOLON, lens: LENS, item: { id: ID, title: 'first' }, sk: a.sk, created_at: 1000 }));
        store._indexEvent(signed({ holon: HOLON, lens: LENS, item: { id: ID, title: 'second' }, sk: a.sk, created_at: 1001 }));

        const events = store.getEvents(HOLON, LENS, ID);
        expect(events).toHaveLength(1);
        expect(JSON.parse(events[0].content).title).toBe('second');
    });

    test('an older claim on the same kind is not kept', () => {
        const a = keypair();
        store._indexEvent(signed({ holon: HOLON, lens: LENS, item: { id: ID, title: 'newer' }, sk: a.sk, created_at: 2000 }));
        store._indexEvent(signed({ holon: HOLON, lens: LENS, item: { id: ID, title: 'older' }, sk: a.sk, created_at: 1000 }));

        const events = store.getEvents(HOLON, LENS, ID);
        expect(events).toHaveLength(1);
        expect(JSON.parse(events[0].content).title).toBe('newer');
    });

    test('two authors still occupy two slots per kind', () => {
        const a = keypair();
        const b = keypair();
        store._indexEvent(signed({ holon: HOLON, lens: LENS, item: { id: ID, title: 'a' }, sk: a.sk, created_at: 1000 }));
        store._indexEvent(signed({ holon: HOLON, lens: LENS, item: { id: ID, title: 'b' }, sk: b.sk, created_at: 1000 }));
        store._indexEvent(standard({ item: { id: ID, title: 'a-std' }, sk: a.sk, created_at: 1000 }));

        expect(store.getEvents(HOLON, LENS, ID)).toHaveLength(3);
    });

    test('nextCreatedAt ratchets over the standard encoding too', () => {
        const a = keypair();
        // Just ahead of now, so the ratchet has to see it without tripping the
        // store's far-future drift warning.
        const ahead = Math.floor(Date.now() / 1000) + 10;
        store._indexEvent(standard({ item: { id: ID, title: 'ahead' }, sk: a.sk, created_at: ahead }));
        expect(store.nextCreatedAt(HOLON, LENS, ID)).toBe(ahead + 1);
    });
});

describe('store: exportEvents narrows by decoding, not by reading tags', () => {
    let store;
    beforeEach(async () => {
        store = createStore({ appName: APP, adapter: 'memory' });
        await store.open();
    });
    afterEach(async () => { await store.close(); });

    test('a standard-kind event is exported under its decoded address', () => {
        const a = keypair();
        store._indexEvent(standard({ item: { id: ID, title: 'standard' }, sk: a.sk, created_at: 1000 }));

        expect(store.exportEvents({ holon: HOLON, lens: LENS })).toHaveLength(1);
        expect(store.exportEvents({ holon: HOLON, lens: 'other' })).toHaveLength(0);
        expect(store.exportEvents({ holon: 'other', lens: LENS })).toHaveLength(0);
    });

    test('an unnarrowed export needs no decode at all', () => {
        const a = keypair();
        store._indexEvent(signed({ holon: HOLON, lens: LENS, item: { id: ID }, sk: a.sk, created_at: 1000 }));
        expect(store.exportEvents()).toHaveLength(1);
        expect(store.exportEvents({ authors: [a.pk] })).toHaveLength(1);
        expect(store.exportEvents({ authors: ['deadbeef'] })).toHaveLength(0);
    });
});
