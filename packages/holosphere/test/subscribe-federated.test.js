// subscribe-federated.test.js
//
// `subscribeFederated` is the live equivalent of `getFederated`: one
// subscription that folds in per-lens inbound partners, tags partner items with
// `_federation.origin`, leaves local items untagged, and dedups by id with the
// LOCAL item winning. See federation.js.
//
// Uses live Gun, so each test gets fresh holon ids (no shared cleanup) and
// generous settle waits — the partner subscription attaches only after the
// async federation-config read resolves.

import HoloSphere from '../holosphere.js';
import { jest } from '@jest/globals';

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

    beforeEach(() => {
        hs = new HoloSphere('test-subscribe-federated', false);
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
});
