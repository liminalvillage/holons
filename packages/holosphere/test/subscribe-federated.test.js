// subscribe-federated.test.js
//
// `subscribeFederated` is the live equivalent of `getFederated`: one
// subscription that folds in per-lens inbound partners, tags partner items with
// `_federation.origin`, leaves local items untagged, and dedups by id with the
// LOCAL item winning. See federation.js.
//
// Uses a live instance, so each test gets fresh holon ids (no shared cleanup) and
// generous settle waits — the partner subscription attaches only after the
// async federation-config read resolves.

import { jest } from '@jest/globals';
import { testSphere, cleanupTestEnv } from './helpers/testenv.js';

jest.setTimeout(90000);

const lens = 'library';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// `federate` writes to the global federation table over the live peer, which can
// transiently fail under load — retry so setup flakiness doesn't mask the
// subscribeFederated behavior under test.
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

describe('subscribeFederated', () => {
    let hs;

    afterAll(cleanupTestEnv, 30000);

    beforeEach(async () => {
        hs = await testSphere('test-subscribe-federated');
    });

    afterEach(async () => {
        if (hs) await hs.close();
    }, 30000);

    test('folds in an inbound partner, tags its items, and dedups local-first', async () => {
        const local = `subfed_a_${Date.now()}_local`;
        const partner = `subfed_a_${Date.now()}_partner`;

        // local receives `library` from partner.
        await federateRetry(hs, local, partner, { inbound: [lens], outbound: [] });
        await wait(1500);

        // autoPropagate:false → partner items stay in the partner's graph (as in
        // prod, where library writes don't copy into partners); subscribeFederated
        // must fold them in via the live federated subscription, not a local copy.
        const noProp = { autoPropagate: false };
        await hs.put(local, lens, { id: 'Drill', value: 1 }, noProp);
        await hs.put(partner, lens, { id: 'Ladder', value: 2 }, noProp);
        await hs.put(local, lens, { id: 'Shared', value: 'LOCAL' }, noProp);
        await hs.put(partner, lens, { id: 'Shared', value: 'PARTNER' }, noProp);
        await wait(1200);

        let latest = [];
        const sub = hs.subscribeFederated(local, lens, (items) => { latest = items; });
        await wait(5000); // let the async partner subscription attach + settle
        sub.unsubscribe();

        const byId = new Map(latest.map((i) => [i.id, i]));
        expect([...byId.keys()].sort()).toEqual(['Drill', 'Ladder', 'Shared']);

        // Local untagged; partner item carries the canonical `_federation` envelope.
        expect(byId.get('Drill')._federation).toBeUndefined();
        expect(byId.get('Ladder')._federation?.origin).toBe(partner);
        expect(byId.get('Ladder')._federation?.sourceLens).toBe(lens);

        // Local wins the id collision — its value survives, untagged.
        expect(byId.get('Shared').value).toBe('LOCAL');
        expect(byId.get('Shared')._federation).toBeUndefined();
    }, 90000);

    test('includeFederated:false yields local-only items', async () => {
        const local = `subfed_b_${Date.now()}_local`;
        const partner = `subfed_b_${Date.now()}_partner`;

        await federateRetry(hs, local, partner, { inbound: [lens], outbound: [] });
        await wait(1200);
        const noProp = { autoPropagate: false };
        await hs.put(local, lens, { id: 'Drill', value: 1 }, noProp);
        await hs.put(partner, lens, { id: 'Ladder', value: 2 }, noProp);
        await wait(1000);

        let latest = [];
        const sub = hs.subscribeFederated(
            local,
            lens,
            (items) => { latest = items; },
            { includeFederated: false },
        );
        await wait(3000);
        sub.unsubscribe();

        const ids = latest.map((i) => i.id);
        expect(ids).toContain('Drill');
        expect(ids).not.toContain('Ladder');
    }, 90000);

    test('a re-subscribe on a warm instance is seeded', async () => {
        // Regression: page remount pattern — subscribe, settle, unsubscribe,
        // subscribe again on the SAME instance. The seed must work even when the
        // watch replay is late or absent, so the
        // second subscription used to start empty and stay empty until the next
        // write. The getAll seed inside addSpace must fill it.
        const local = `subfed_d_${Date.now()}_local`;
        const partner = `subfed_d_${Date.now()}_partner`;

        await federateRetry(hs, local, partner, { inbound: [lens], outbound: [] });
        await wait(1500);
        const noProp = { autoPropagate: false };
        await hs.put(local, lens, { id: 'Drill', value: 1 }, noProp);
        await hs.put(partner, lens, { id: 'Ladder', value: 2 }, noProp);
        await wait(1200);

        // First visit: warms the instance's in-memory graph.
        const subA = hs.subscribeFederated(local, lens, () => {});
        await wait(5000);
        subA.unsubscribe();
        await wait(500);

        // Revisit: no new writes will arrive — only the seed can populate this.
        let latest = [];
        const subB = hs.subscribeFederated(local, lens, (items) => { latest = items; });
        await wait(5000);
        subB.unsubscribe();

        const byId = new Map(latest.map((i) => [i.id, i]));
        expect([...byId.keys()].sort()).toEqual(['Drill', 'Ladder']);
        expect(byId.get('Ladder')._federation?.origin).toBe(partner);
    }, 90000);

    test('partner attaches even when the first federation-config reads return null (cold race)', async () => {
        // Regression: on a cold graph the point-in-time getGlobal('federation')
        // read fires before the relay syncs and returns null; attachPartners
        // used to silently attach zero partners forever. Simulate the lost race
        // by nulling the first reads — the retry ladder must recover.
        const local = `subfed_e_${Date.now()}_local`;
        const partner = `subfed_e_${Date.now()}_partner`;

        await federateRetry(hs, local, partner, { inbound: [lens], outbound: [] });
        await wait(1500);
        const noProp = { autoPropagate: false };
        await hs.put(local, lens, { id: 'Drill', value: 1 }, noProp);
        await hs.put(partner, lens, { id: 'Ladder', value: 2 }, noProp);
        await wait(1200);

        const origGetGlobal = hs.getGlobal.bind(hs);
        let coldReads = 0;
        hs.getGlobal = async (table, key, password) => {
            if (table === 'federation' && key === local && coldReads < 2) {
                coldReads++;
                return null; // cold store: the read lost the race
            }
            return origGetGlobal(table, key, password);
        };

        let latest = [];
        const sub = hs.subscribeFederated(local, lens, (items) => { latest = items; });
        // retry ladder: 1s + 3s before the third (successful) read — wait past it
        await wait(9000);
        sub.unsubscribe();
        hs.getGlobal = origGetGlobal;

        expect(coldReads).toBe(2); // the stub actually exercised the race
        const byId = new Map(latest.map((i) => [i.id, i]));
        expect([...byId.keys()].sort()).toEqual(['Drill', 'Ladder']);
        expect(byId.get('Ladder')._federation?.origin).toBe(partner);
    }, 90000);

    test('setFederated toggles partners live without dropping local items', async () => {
        const local = `subfed_c_${Date.now()}_local`;
        const partner = `subfed_c_${Date.now()}_partner`;

        await federateRetry(hs, local, partner, { inbound: [lens], outbound: [] });
        await wait(1200);
        const noProp = { autoPropagate: false };
        await hs.put(local, lens, { id: 'Drill', value: 1 }, noProp);
        await hs.put(partner, lens, { id: 'Ladder', value: 2 }, noProp);
        await wait(1000);

        let latest = [];
        const sub = hs.subscribeFederated(
            local,
            lens,
            (items) => { latest = items; },
            { includeFederated: false },
        );
        await wait(1500);
        expect(latest.map((i) => i.id)).toEqual(['Drill']); // local only

        sub.setFederated(true);
        await wait(4000);
        expect(latest.map((i) => i.id).sort()).toEqual(['Drill', 'Ladder']); // partner folded in

        sub.setFederated(false);
        await wait(1500);
        expect(latest.map((i) => i.id)).toEqual(['Drill']); // partner dropped, local kept
        sub.unsubscribe();
    }, 90000);

    // `checklists` ids are the list's NAME, so `agenda`/`shopping` exist under
    // that same id in EVERY holon. The default local-wins collapse would drop a
    // partner's copy entirely — the lens would look like it federated nothing.
    test('dedupeAcrossSpaces:false keeps a partner copy sharing a local id', async () => {
        const cl = 'checklists';
        const local = `subfed_c_${Date.now()}_local`;
        const partner = `subfed_c_${Date.now()}_partner`;

        await federateRetry(hs, local, partner, { inbound: [cl], outbound: [] });
        await wait(1500);

        // Independently authored lists: same name, different creation instants.
        const noProp = { autoPropagate: false };
        await hs.put(local, cl, { id: 'shopping', created: 'A', items: [{ text: 'ours' }] }, noProp);
        await hs.put(partner, cl, { id: 'shopping', created: 'B', items: [{ text: 'theirs' }] }, noProp);
        await wait(1200);

        let latest = [];
        const sub = hs.subscribeFederated(
            local,
            cl,
            (items) => { latest = items; },
            { dedupeAcrossSpaces: false },
        );
        await wait(5000);
        sub.unsubscribe();

        // BOTH survive — same id, different holons.
        const shopping = latest.filter((i) => i.id === 'shopping');
        expect(shopping).toHaveLength(2);

        const own = shopping.find((i) => !i._federation);
        const theirs = shopping.find((i) => i._federation);
        expect(own.items[0].text).toBe('ours');
        expect(theirs._federation.origin).toBe(partner);
        expect(theirs.items[0].text).toBe('theirs');
    }, 90000);

    // A holon that BOTH receives pushed copies (outbound propagation) and
    // aggregates live holds its own copy of the partner's list. That copy is not
    // a second list, so it must not render as one — even after an ordinary write
    // has stripped its `_federation` stamp (content.js), which is why the
    // creation instant is the fallback signal.
    test('dedupeAcrossSpaces:false collapses a partner record our copy came from', async () => {
        const cl = 'checklists';
        const local = `subfed_e_${Date.now()}_local`;
        const partner = `subfed_e_${Date.now()}_partner`;

        await federateRetry(hs, local, partner, { inbound: [cl], outbound: [] });
        await wait(1500);

        const noProp = { autoPropagate: false };
        const made = '2026-07-21T12:40:15.189Z';
        // The partner's original, and our de-stamped propagated copy of it.
        await hs.put(partner, cl, { id: 'shopping', created: made, items: [{ text: 'oats' }] }, noProp);
        await hs.put(local, cl, { id: 'shopping', created: made, items: [{ text: 'oats' }] }, noProp);
        await wait(1200);

        let latest = [];
        const sub = hs.subscribeFederated(
            local,
            cl,
            (items) => { latest = items; },
            { dedupeAcrossSpaces: false },
        );
        await wait(5000);
        sub.unsubscribe();

        const shopping = latest.filter((i) => i.id === 'shopping');
        expect(shopping).toHaveLength(1);
        expect(shopping[0]._federation).toBeUndefined(); // ours survived
    }, 90000);

    test('dedupeAcrossSpaces:false collapses a partner record we carry stamped', async () => {
        const cl = 'checklists';
        const local = `subfed_f_${Date.now()}_local`;
        const partner = `subfed_f_${Date.now()}_partner`;

        await federateRetry(hs, local, partner, { inbound: [cl], outbound: [] });
        await wait(1500);

        const noProp = { autoPropagate: false };
        await hs.put(partner, cl, { id: 'agenda', created: 'X', items: [] }, noProp);
        // A freshly propagated copy still carries the origin stamp; no shared
        // `created` needed for it to be recognised as ours-from-them.
        await hs.put(
            local,
            cl,
            { id: 'agenda', created: 'Y', items: [], _federation: { origin: partner, sourceLens: cl } },
            { ...noProp, preserveFederationMeta: true },
        );
        await wait(1200);

        let latest = [];
        const sub = hs.subscribeFederated(
            local,
            cl,
            (items) => { latest = items; },
            { dedupeAcrossSpaces: false },
        );
        await wait(5000);
        sub.unsubscribe();

        expect(latest.filter((i) => i.id === 'agenda')).toHaveLength(1);
    }, 90000);

    // Within one space the store is still keyed by id, so a re-emit of the same
    // record replaces it rather than piling up duplicate cards.
    test('dedupeAcrossSpaces:false still dedups within a single space', async () => {
        const cl = 'checklists';
        const local = `subfed_d_${Date.now()}_local`;

        let latest = [];
        const sub = hs.subscribeFederated(
            local,
            cl,
            (items) => { latest = items; },
            { includeFederated: false, dedupeAcrossSpaces: false },
        );
        await hs.put(local, cl, { id: 'agenda', items: [{ text: 'one' }] }, { autoPropagate: false });
        await wait(1200);
        await hs.put(local, cl, { id: 'agenda', items: [{ text: 'two' }] }, { autoPropagate: false });
        await wait(1500);
        sub.unsubscribe();

        expect(latest.filter((i) => i.id === 'agenda')).toHaveLength(1);
    }, 90000);
});
