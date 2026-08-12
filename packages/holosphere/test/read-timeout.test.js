// Regression: `get` and `getAll`'s underlying `.once()` calls must time out
// instead of hanging forever on cold paths (peer offline, never-written
// key, partitioned mesh). Consumers used to wrap every read in their own
// `Promise.race(setTimeout(reject, 8000))` — now the library owns it.

import { testSphere, cleanupTestEnv } from './helpers/testenv.js';

const APP = 'test-read-timeout';

describe('read-path timeout', () => {
    let hs;

    afterAll(cleanupTestEnv, 30000);

    beforeEach(async () => {
        hs = testSphere(APP);
        await new Promise(r => setTimeout(r, 100));
    }, 30000);

    afterEach(async () => {
        if (hs) await hs.close();
    }, 30000);

    test('getAll resolves to [] within the timeout for a cold empty lens', async () => {
        const start = Date.now();
        const items = await hs.getAll('never-touched-holon', 'never-touched-lens', null, { timeout: 1500 });
        const elapsed = Date.now() - start;

        expect(Array.isArray(items)).toBe(true);
        expect(items).toEqual([]);
        // Must complete well within the 30s test timeout — bounded by our `timeout` + the
        // single 1500ms retry the function does between probes.
        expect(elapsed).toBeLessThan(7000);
    }, 20000);

    test('get resolves to null within the timeout for a missing key', async () => {
        const start = Date.now();
        const value = await hs.get('never-touched-holon-2', 'never-touched-lens-2', 'never-written-key', null, { timeout: 1500 });
        const elapsed = Date.now() - start;

        expect(value).toBeNull();
        expect(elapsed).toBeLessThan(5000);
    }, 20000);

    test('getAll still returns the records on a populated lens (timeout doesnt fire early)', async () => {
        await hs.put('populated-holon', 'lens', { id: 'a', value: 1 });
        await hs.put('populated-holon', 'lens', { id: 'b', value: 2 });
        await new Promise(r => setTimeout(r, 400));

        const items = await hs.getAll('populated-holon', 'lens');
        expect(Array.isArray(items)).toBe(true);
        expect(items.length).toBe(2);
    }, 15000);
});
