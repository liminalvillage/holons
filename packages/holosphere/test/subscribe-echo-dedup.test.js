// subscribe-echo-dedup.test.js
//
// A subscribed pointer lens resolves each pointer exactly once per change:
// once on the replay, never again without a write, and once more when the
// pointer's value genuinely changes (an `updated` bump). The store's change
// feed carries no echoes, so resolution can never feed back on itself
// (the 2026-07-23 fire-storm shape).

import { testSphere, cleanupTestEnv } from './helpers/testenv.js';

describe('subscribe hologram echo dedup', () => {
    let holoSphere;
    const holon = 'echoDedupHolon';
    const srcLens = 'srcLens';
    const ptrLens = 'ptrLens';
    const appName = 'test-subscribe-echo-dedup';

    const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

    afterAll(cleanupTestEnv, 30000);

    beforeEach(async () => {
        holoSphere = await testSphere(appName);
    }, 30000);

    afterEach(async () => {
        if (holoSphere) await holoSphere.close();
    }, 30000);

    test('a pointer resolves once on replay, never without a write, and again on a real change', async () => {
        const item = { id: 'echo-item', title: 'source content' };
        await holoSphere.put(holon, srcLens, item);

        const pointer = holoSphere.createHologram(holon, srcLens, item);
        await holoSphere.put(holon, ptrLens, pointer);

        // Count resolutions from here on.
        let resolves = 0;
        const original = holoSphere.resolveHologramDetailed.bind(holoSphere);
        holoSphere.resolveHologramDetailed = async (...args) => {
            resolves++;
            return original(...args);
        };

        const seen = [];
        const sub = holoSphere.subscribe(holon, ptrLens, (data, key) => {
            seen.push({ key, data });
        });
        await settle();
        expect(resolves).toBe(1); // the replay

        await settle(600);
        expect(resolves).toBe(1); // nothing re-emits on its own

        // A genuinely NEW pointer value (an `updated` bump) resolves again.
        await holoSphere.put(holon, ptrLens, { ...pointer, updated: 12345 }, null, { disableHologramRedirection: true });
        await settle();
        expect(resolves).toBe(2);

        // And the subscriber received resolved content, not pointers.
        expect(seen.filter((s) => s.data && s.data.title === 'source content').length).toBe(2);

        sub.unsubscribe();
    }, 30000);
});
