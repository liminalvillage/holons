/**
 * The wire registry: which kinds this store consumes, and how each decodes to
 * an address.
 *
 * Until now the store took exactly one kind and read the address straight off
 * the envelope's `h`/`l` tags. A lens that wants a standard Nostr kind as its
 * canonical encoding needs both of those to be per-kind decisions, so a NIP-52
 * calendar event and our own envelope can land at the same address.
 */
import { createStore, createWireRegistry, decodeEvent } from '../../store/index.js';
import { buildEvent } from '../../nostr-events.js';
import { APP, keypair, signed } from './helpers.js';

const HOLON = 'h1';
const LENS = 'tasks';
const OCC = 31923;

const asKind = (kind, { item, sk, created_at, holon = HOLON, lens = LENS }) =>
    buildEvent({ holon, lens, item, sk, created_at, kind, extraTags: [['n', APP]] });

const envelopeGrammar = (e) => { const d = decodeEvent(e); return d ? [d] : null; };

describe('store: the wire registry decides what is consumable', () => {
    const open = async (wire) => {
        const store = createStore({ appName: APP, adapter: 'memory', ...(wire ? { wire } : {}) });
        await store.open();
        return store;
    };

    test('a store nobody configured consumes the legacy envelope alone', async () => {
        const store = await open();
        const a = keypair();
        expect(store.apply(signed({ item: { id: 't1' }, sk: a.sk })).applied).toBe(true);
        expect(store.apply(asKind(OCC, { item: { id: 't2' }, sk: a.sk })).reason).toBe('kind');
        await store.close();
    });

    test('a registered kind becomes an ordinary record', async () => {
        const wire = createWireRegistry();
        wire.register({ lens: LENS, kinds: [OCC], decode: envelopeGrammar });
        const store = await open(wire);
        const a = keypair();

        const r = store.apply(asKind(OCC, { item: { id: 't1', title: 'standard' }, sk: a.sk }));
        expect(r.applied).toBe(true);
        expect(store.get(HOLON, LENS, 't1').item.title).toBe('standard');
        expect(store.list(HOLON, LENS)).toHaveLength(1);
        await store.close();
    });

    test('an unregistered kind is refused as "kind", not swallowed as malformed', async () => {
        const wire = createWireRegistry();
        wire.register({ lens: LENS, kinds: [OCC], decode: envelopeGrammar });
        const store = await open(wire);
        const a = keypair();
        expect(store.apply(asKind(30402, { item: { id: 't1' }, sk: a.sk })).reason).toBe('kind');
        await store.close();
    });

    test('the legacy kind cannot be overridden by a codec', async () => {
        const wire = createWireRegistry();
        wire.register({ lens: LENS, kinds: [30078, OCC], decode: () => [{ holon: 'hijacked', lens: 'x', id: 'y', item: { id: 'y' } }] });
        const store = await open(wire);
        const a = keypair();
        store.apply(signed({ item: { id: 't1', title: 'mine' }, sk: a.sk }));
        expect(store.get(HOLON, LENS, 't1').item.title).toBe('mine');
        expect(store.get('hijacked', 'x', 'y')).toBeUndefined();
        await store.close();
    });

    test('one event may claim several addresses', async () => {
        // A codec is free to fan one event out over several records — a list
        // kind carrying its members, say. Kind 5 is the case the registry
        // handles itself; this is the general capability underneath it.
        const wire = createWireRegistry();
        wire.register({
            lens: LENS,
            kinds: [30003],
            decode: () => ['t1', 't2', 't3'].map((id) => ({ holon: HOLON, lens: LENS, id, item: { id, title: id } })),
        });
        const store = await open(wire);
        const a = keypair();

        const r = store.apply(asKind(30003, { item: { id: 'ignored' }, sk: a.sk }));
        expect(r.applied).toBe(true);
        expect(r.records).toHaveLength(3);
        expect(store.list(HOLON, LENS).map((x) => x.id).sort()).toEqual(['t1', 't2', 't3']);
        await store.close();
    });

    test('a codec that throws is a malformed event, not a crash', async () => {
        const wire = createWireRegistry();
        wire.register({ lens: LENS, kinds: [OCC], decode: () => { throw new Error('bad grammar'); } });
        const store = await open(wire);
        const a = keypair();
        expect(store.apply(asKind(OCC, { item: { id: 't1' }, sk: a.sk })).reason).toBe('malformed');
        await store.close();
    });

    test('last writer wins across the two encodings at one address', async () => {
        const wire = createWireRegistry();
        wire.register({ lens: LENS, kinds: [OCC], decode: envelopeGrammar });
        const store = await open(wire);
        const a = keypair();

        store.apply(signed({ item: { id: 't1', title: 'legacy' }, sk: a.sk, created_at: 1000 }));
        store.apply(asKind(OCC, { item: { id: 't1', title: 'standard' }, sk: a.sk, created_at: 1001 }));
        expect(store.get(HOLON, LENS, 't1').item.title).toBe('standard');

        // ...and an older standard event does not beat a newer envelope.
        store.apply(signed({ item: { id: 't2', title: 'legacy' }, sk: a.sk, created_at: 2000 }));
        store.apply(asKind(OCC, { item: { id: 't2', title: 'standard' }, sk: a.sk, created_at: 1999 }));
        expect(store.get(HOLON, LENS, 't2').item.title).toBe('legacy');
        await store.close();
    });

    test('a NIP-09 retraction becomes an ordinary tombstone', async () => {
        const wire = createWireRegistry();
        wire.register({
            lens: LENS, kinds: [OCC], decode: envelopeGrammar,
            address: (d) => ({ holon: HOLON, lens: LENS, id: d.replace('shift-', '') }),
        });
        const store = await open(wire);
        const a = keypair();

        store.apply(asKind(OCC, { item: { id: 't1', title: 'live' }, sk: a.sk, created_at: 1000 }));
        expect(store.list(HOLON, LENS)).toHaveLength(1);

        // The author retracts their own address, naming it the NIP-09 way.
        const retract = buildEvent({
            holon: HOLON, lens: LENS, item: { id: 'x' }, sk: a.sk, kind: 5, created_at: 1001,
            extraTags: [['n', APP], ['a', `${OCC}:${a.pk}:shift-t1`]],
        });
        expect(store.apply(retract).applied).toBe(true);
        expect(store.list(HOLON, LENS)).toHaveLength(0);
        expect(store.get(HOLON, LENS, 't1').item._deleted).toBe(true);
        await store.close();
    });

    test('a retraction naming someone else\'s address is not a claim', async () => {
        const wire = createWireRegistry();
        wire.register({
            lens: LENS, kinds: [OCC], decode: envelopeGrammar,
            address: (d) => ({ holon: HOLON, lens: LENS, id: d.replace('shift-', '') }),
        });
        const store = await open(wire);
        const a = keypair();
        const b = keypair();

        store.apply(asKind(OCC, { item: { id: 't1', title: 'live' }, sk: a.sk, created_at: 1000 }));
        // b tries to delete a's record. NIP-09 says only the author may.
        const forged = buildEvent({
            holon: HOLON, lens: LENS, item: { id: 'x' }, sk: b.sk, kind: 5, created_at: 1001,
            extraTags: [['n', APP], ['a', `${OCC}:${a.pk}:shift-t1`]],
        });
        expect(store.apply(forged).reason).toBe('malformed');
        expect(store.list(HOLON, LENS)).toHaveLength(1);
        await store.close();
    });

    test('a later event resurrects a retracted address', async () => {
        // Not an accident. A peer that cancels a shift and then edits it must
        // win; our tombstone is a record, not an erasure.
        const wire = createWireRegistry();
        wire.register({
            lens: LENS, kinds: [OCC], decode: envelopeGrammar,
            address: (d) => ({ holon: HOLON, lens: LENS, id: d.replace('shift-', '') }),
        });
        const store = await open(wire);
        const a = keypair();

        store.apply(asKind(OCC, { item: { id: 't1', title: 'live' }, sk: a.sk, created_at: 1000 }));
        store.apply(buildEvent({
            holon: HOLON, lens: LENS, item: { id: 'x' }, sk: a.sk, kind: 5, created_at: 1001,
            extraTags: [['n', APP], ['a', `${OCC}:${a.pk}:shift-t1`]],
        }));
        expect(store.list(HOLON, LENS)).toHaveLength(0);

        store.apply(asKind(OCC, { item: { id: 't1', title: 'back' }, sk: a.sk, created_at: 1002 }));
        expect(store.get(HOLON, LENS, 't1').item.title).toBe('back');
        await store.close();
    });

    test('kind 5 is not consumable while the envelope is the only wire', async () => {
        const store = await open();
        const a = keypair();
        const retract = buildEvent({
            holon: HOLON, lens: LENS, item: { id: 'x' }, sk: a.sk, kind: 5, created_at: 1000,
            extraTags: [['n', APP], ['a', `${OCC}:${a.pk}:shift-t1`]],
        });
        expect(store.apply(retract).reason).toBe('kind');
        await store.close();
    });

    test('isStandardPrimary names the lenses that own a wire', () => {
        const wire = createWireRegistry();
        expect(wire.isStandardPrimary(LENS)).toBe(false);
        wire.register({ lens: LENS, kinds: [OCC], decode: envelopeGrammar });
        expect(wire.isStandardPrimary(LENS)).toBe(true);
        expect(wire.isStandardPrimary('quests')).toBe(false);
        expect(wire.kinds()).toEqual([30078, OCC]);
    });
});
