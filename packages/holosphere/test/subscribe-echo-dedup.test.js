// subscribe-echo-dedup.test.js
//
// Regression test for the hologram resolve-per-fire feedback loop (field
// incident 2026-07-23, second wave): every map().on fire for a hologram key
// ran resolveHologramDetailed, whose reads make Gun re-emit the lens with
// value-identical echoes — so a lens with many perfectly healthy pointers
// stormed itself into fire-storm quarantine with no circular hologram at
// all. subscribe() now drops value-identical pointer echoes before
// resolving; a genuinely NEW pointer value (e.g. an `updated` bump from the
// redirected-put refresh) still resolves afresh.

import { testSphere, cleanupTestEnv } from './helpers/testenv.js';

describe('subscribe hologram echo dedup', () => {
    let holoSphere;
    const holon = 'echoDedupHolon';
    const srcLens = 'srcLens';
    const ptrLens = 'ptrLens';
    const appName = 'test-subscribe-echo-dedup';

    const waitForGun = (ms = 400) => new Promise((r) => setTimeout(r, ms));

    afterAll(cleanupTestEnv, 30000);

    beforeEach(async () => {
        holoSphere = testSphere(appName);
        try {
            await holoSphere.deleteAll(holon, srcLens);
            await holoSphere.deleteAll(holon, ptrLens);
        } catch {
            /* ignore */
        }
        await waitForGun(100);
    }, 30000);

    afterEach(async () => {
        if (holoSphere) await holoSphere.close();
    }, 30000);

    test('value-identical pointer echoes resolve once; a changed pointer re-resolves', async () => {
        const item = { id: 'echo-item', title: 'source content' };
        await holoSphere.put(holon, srcLens, item);
        await waitForGun();

        const pointer = holoSphere.createHologram(holon, srcLens, item);
        await holoSphere.put(holon, ptrLens, pointer);
        await waitForGun();

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
        await waitForGun(800);
        const resolvesAfterAttach = resolves;

        // Re-emit the IDENTICAL pointer value several times — the echo shape
        // Gun produces when resolution reads touch the lens. Gun does NOT
        // replay the in-memory graph to a fresh map().on, so the FIRST of
        // these is legitimately the subscription's first sight of the pointer
        // (one resolve); every echo after it must be dropped.
        const raw = JSON.stringify({ id: item.id, soul: pointer.soul });
        for (let i = 0; i < 5; i++) {
            holoSphere.gun.get(appName).get(holon).get(ptrLens).get(item.id).put(raw);
            await waitForGun(150);
        }
        expect(resolves).toBe(resolvesAfterAttach + 1);

        // A genuinely NEW pointer value (an `updated` bump) must re-resolve.
        const bumped = JSON.stringify({ id: item.id, soul: pointer.soul, updated: 12345 });
        holoSphere.gun.get(appName).get(holon).get(ptrLens).get(item.id).put(bumped);
        await waitForGun(800);
        expect(resolves).toBeGreaterThan(resolvesAfterAttach);

        // And the subscriber actually received resolved content, not pointers.
        const resolved = seen.filter((s) => s.data && s.data.title === 'source content');
        expect(resolved.length).toBeGreaterThan(0);

        sub.unsubscribe();
    }, 30000);
});
