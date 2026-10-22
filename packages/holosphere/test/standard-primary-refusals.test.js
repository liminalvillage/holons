/**
 * What a lens carried on a standard Nostr kind refuses, and why it throws
 * rather than quietly degrading.
 *
 * Each of these has a reason rooted in the encoding, not in taste. Silently
 * falling back to a local-only write is the failure this whole change exists
 * to remove, so the refusals are loud.
 */
import { createWireRegistry, decodeEvent } from '../store/index.js';
import { testSphere, cleanupTestEnv } from './helpers/testenv.js';

const APP = 'refusal-test';
const HOLON = 'refusal-holon';
const LENS = 'shifts';
const OTHER = 'tasks';

const wireWith = () => {
    const wire = createWireRegistry();
    wire.register({
        lens: LENS,
        kinds: [31923],
        decode: (e) => { const d = decodeEvent(e); return d ? [d] : null; },
        filters: () => [{ kinds: [31923] }],
    });
    return wire;
};

describe('a standard-primary lens refuses what its encoding cannot express', () => {
    let sphere;
    beforeEach(async () => {
        sphere = await testSphere(APP, { store: { adapter: 'memory', wire: wireWith() } });
    });
    afterAll(async () => { await cleanupTestEnv(); });

    test('a hologram pointer — a soul names a place, a coordinate names an author', async () => {
        await expect(sphere.put(HOLON, LENS, { id: 's1', soul: `${APP}/other/shifts/s1` }))
            .rejects.toThrow(/hologram pointer/);
    });

    test('a global record — every standard grammar here is group-scoped', async () => {
        await expect(sphere.putGlobal(LENS, { id: 's1' })).rejects.toThrow(/global record/);
    });

    test('a federated copy — `_federation` has nowhere to live in a standard schema', async () => {
        await expect(sphere.put(HOLON, LENS, { id: 's1', _federation: { origin: 'x' } }, null, { preserveFederationMeta: true }))
            .rejects.toThrow(/federated copy/);
    });

    test('scalespace propagation — N copies would collide on one replaceable slot', async () => {
        await expect(sphere.put(HOLON, LENS, { id: 's1' }, null, { autoPropagate: true }))
            .rejects.toThrow(/propagated across scalespace/);
    });

    test('propagate and propagateDeletion report the refusal instead of acting', async () => {
        expect(await sphere.propagate(HOLON, LENS, { id: 's1' })).toMatchObject({ skipped: 'standard-primary lens' });
        expect(await sphere.propagateDeletion(HOLON, LENS, 's1')).toMatchObject({ skipped: 'standard-primary lens' });
    });

    test('every one of these is still fine on an ordinary lens', async () => {
        await expect(sphere.put(HOLON, OTHER, { id: 't1', soul: `${APP}/other/tasks/t1` })).resolves.toBeTruthy();
        await expect(sphere.putGlobal(OTHER, { id: 't2' })).resolves.toBeTruthy();
        expect(await sphere.propagate(HOLON, OTHER, { id: 't1' })).not.toMatchObject({ skipped: 'standard-primary lens' });
    });

    test('any write at all, when the wire has no encoder', async () => {
        // The records are authored elsewhere, by whoever owns that kind.
        // Falling through to a kind-30078 envelope would put a second record
        // at the same address, where last-writer-wins could let our phantom
        // shadow the real one.
        await expect(sphere.put(HOLON, LENS, { id: 's1', title: 'ok' })).rejects.toThrow(/read-only here/);
    });

    test('a wire that CAN encode is written normally', async () => {
        const wire = createWireRegistry();
        wire.register({
            lens: LENS, kinds: [31923],
            decode: (e) => { const d = decodeEvent(e); return d ? [d] : null; },
            encode: () => ({ kind: 31923, tags: [], content: '' }),
        });
        const writable = await testSphere(APP, { store: { adapter: 'memory', wire } });
        await expect(writable.put(HOLON, LENS, { id: 's1', title: 'ok' })).resolves.toBeTruthy();
    });
});
