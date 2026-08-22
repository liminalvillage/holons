// propagate-no-overwrite.test.js
//
// Propagation may only write a slot that is empty, tombstoned, or already holds
// a copy THIS holon put there — the same rule `propagateDeletion` enforces on
// the way out. Anything else at that key belongs to the target.
//
// Regression: a full-copy propagation used to blind-write the target. For a
// whole-record lens that is a REPLACE, not a merge, so an unrelated edit to one
// holon's `checklists/shopping` destroyed its partner's shopping list outright.
// The pre-existing guard only ran in hologram mode, so the default path
// (useHolograms:false) had none.
//
// These tests force the legacy `useHolograms:false` mode on purpose: full
// copies are the shape that could overwrite, so that is what the guard has to
// be proven against. Propagation itself is opt-in now, hence `autoPropagate`.
//
// Uses live Gun: fresh holon ids per test, generous settle waits.

import { jest } from '@jest/globals';
import { testSphere, cleanupTestEnv } from './helpers/testenv.js';

jest.setTimeout(90000);

const lens = 'checklists';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const federateRetry = async (hs, a, b, cfg, tries = 4) => {
    for (let i = 0; i < tries; i++) {
        try {
            await hs.federate(a, b, null, null, true, cfg);
            return;
        } catch (err) {
            if (i === tries - 1) throw err;
            await wait(1000);
        }
    }
};

describe('propagate: never overwrites a record the target owns', () => {
    let hs;

    afterAll(cleanupTestEnv, 30000);
    beforeEach(async () => { hs = await testSphere('test-propagate-no-overwrite'); });
    afterEach(async () => { if (hs) await hs.close(); }, 30000);

    test('leaves the target\'s own same-id record untouched', async () => {
        const source = `prop_a_${Date.now()}_source`;
        const target = `prop_a_${Date.now()}_target`;

        // source SENDS `checklists` to target — the config that caused the loss.
        await federateRetry(hs, source, target, { inbound: [], outbound: [lens] });
        await wait(1500);

        // The target authored its own shopping list.
        await hs.put(target, lens, {
            id: 'shopping',
            created: 'TARGET-OWN',
            items: [{ id: 't1', text: 'target milk' }],
        }, { autoPropagate: false });
        await wait(1500);

        // An unrelated edit in the source now propagates.
        await hs.put(source, lens, {
            id: 'shopping',
            created: 'SOURCE-OWN',
            items: [{ id: 's1', text: 'source bread' }],
        }, { autoPropagate: true, propagationOptions: { useHolograms: false } });
        await wait(4000);

        const after = await hs.get(target, lens, 'shopping');
        expect(after.created).toBe('TARGET-OWN');
        expect(after.items).toHaveLength(1);
        expect(after.items[0].text).toBe('target milk');

        // The source keeps its own record either way.
        const src = await hs.get(source, lens, 'shopping');
        expect(src.created).toBe('SOURCE-OWN');
    }, 90000);

    test('still propagates into an empty slot', async () => {
        const source = `prop_b_${Date.now()}_source`;
        const target = `prop_b_${Date.now()}_target`;

        await federateRetry(hs, source, target, { inbound: [], outbound: [lens] });
        await wait(1500);

        await hs.put(source, lens, {
            id: 'agenda',
            created: 'SOURCE-OWN',
            items: [{ id: 's1', text: 'opening circle' }],
        }, { autoPropagate: true, propagationOptions: { useHolograms: false } });
        await wait(4000);

        const copy = await hs.get(target, lens, 'agenda');
        expect(copy).toBeTruthy();
        expect(copy.items[0].text).toBe('opening circle');
        // Stamped, so the copy stays identifiable as the source's.
        expect(String(copy._federation?.origin)).toBe(source);
    }, 90000);

    test('still updates a copy it put there itself', async () => {
        const source = `prop_c_${Date.now()}_source`;
        const target = `prop_c_${Date.now()}_target`;

        await federateRetry(hs, source, target, { inbound: [], outbound: [lens] });
        await wait(1500);

        await hs.put(source, lens, { id: 'agenda', items: [{ id: 's1', text: 'first' }] },
            { autoPropagate: true, propagationOptions: { useHolograms: false } });
        await wait(4000);
        expect((await hs.get(target, lens, 'agenda')).items[0].text).toBe('first');

        // A second write must still flow — the target's copy is provably ours.
        await hs.put(source, lens, {
            id: 'agenda',
            items: [{ id: 's1', text: 'first' }, { id: 's2', text: 'second' }],
        }, { autoPropagate: true, propagationOptions: { useHolograms: false } });
        await wait(4000);

        const updated = await hs.get(target, lens, 'agenda');
        expect(updated.items).toHaveLength(2);
        expect(updated.items[1].text).toBe('second');
    }, 90000);
});
