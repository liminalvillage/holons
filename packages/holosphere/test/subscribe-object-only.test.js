// Regression: `subscribe`'s callback must receive `object | null` only —
// never a string/number/boolean. `parse()` can return a primitive when a
// legacy leaf happens to be a JSON-encoded primitive (`'"hello"'` →
// `'hello'`); previously those reached consumers and every callback had to
// re-`JSON.parse` defensively. The library now drops non-object payloads
// at the boundary.

import { testSphere, cleanupTestEnv } from './helpers/testenv.js';

const APP = 'test-subscribe-object-only';

describe('subscribe callback contract: object | null only', () => {
    let hs;
    const holon = 'sub-object-holon';
    const lens = 'items';

    afterAll(cleanupTestEnv, 30000);

    beforeEach(async () => {
        hs = await testSphere(APP);
        try { await hs.deleteAll(holon, lens); } catch {}
        await new Promise(r => setTimeout(r, 200));
    }, 30000);

    afterEach(async () => {
        if (hs) await hs.close();
    }, 30000);

    test('callback fires for normal object writes', async () => {
        const received = [];
        const sub = hs.subscribe(holon, lens, (data, key) => {
            if (data) received.push({ key, type: typeof data, value: data });
        });

        await hs.put(holon, lens, { id: 'a', value: 1 });
        await new Promise(r => setTimeout(r, 500));

        sub.unsubscribe();
        expect(received.length).toBeGreaterThan(0);
        for (const r of received) {
            expect(r.type).toBe('object');
            expect(r.value).not.toBeNull();
        }
    }, 15000);

    test('non-object payloads (primitive JSON leaves) are dropped, never delivered as strings', async () => {
        const received = [];
        const sub = hs.subscribe(holon, lens, (data, key) => {
            // Anything non-null reaching the callback must be a real object.
            if (data !== null) {
                received.push({ key, type: typeof data, isArray: Array.isArray(data), value: data });
            }
        });

        // Directly inject a primitive leaf into the gun graph at the same
        // path subscribe is watching. We can't go through `holosphere.put`
        // (it sanitizes/requires an object); this simulates legacy/corrupt
        // data that the wire could deliver.
        const path = hs.gun.get(APP).get(holon).get(lens).get('primitive');
        path.put(JSON.stringify('just-a-string'));
        await new Promise(r => setTimeout(r, 800));

        sub.unsubscribe();

        // No string-typed payloads must have surfaced to the consumer.
        const strings = received.filter(r => r.type === 'string');
        expect(strings).toEqual([]);
    }, 15000);
});
