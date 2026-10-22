// self-hologram-guard.test.js
//
// Regression tests for the "self-pointing hologram husk" factory (field
// incident 2026-07-23): put()'s target-path hologram redirection fired even
// when the payload being written was ITSELF a bare `{ id, soul }` pointer.
// Re-publishing an already-published item therefore read the existing pointer
// at the destination, redirected the write to its soul — the SOURCE — and
// stored the pointer on top of the original, destroying its content and
// leaving a hologram that points at its own path. Resolving such a husk
// loops, resolution would chase itself unboundedly, and the guard quarantines the
// lens (the "board frozen until reload" failure).

import { testSphere, cleanupTestEnv } from './helpers/testenv.js';

describe('Self-hologram guards', () => {
    let holoSphere;
    const sourceHolon = 'selfGuardSource';
    const mirrorHolon = 'selfGuardMirror';
    const lens = 'quests';
    const appName = 'test-self-hologram-guard';

    const waitForGun = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

    afterAll(cleanupTestEnv, 30000);

    beforeEach(async () => {
        holoSphere = await testSphere(appName);
        try {
            await holoSphere.deleteAll(sourceHolon, lens);
            await holoSphere.deleteAll(mirrorHolon, lens);
        } catch {
            // Ignore cleanup errors
        }
        await waitForGun(100);
    }, 30000);

    afterEach(async () => {
        if (holoSphere) {
            await holoSphere.close();
        }
    }, 30000);

    test('re-publishing a pointer does not overwrite the source (husk factory)', async () => {
        // 1. Real item lives at the source.
        const item = { id: 'husk-repro', title: 'the real content', count: 7 };
        await holoSphere.put(sourceHolon, lens, item);
        await waitForGun();

        // 2. First publish: a bare pointer lands at the mirror. Fine.
        const pointer = holoSphere.createHologram(sourceHolon, lens, item);
        await holoSphere.put(mirrorHolon, lens, pointer);
        await waitForGun(500);

        // 3. Second publish of the SAME pointer (a re-join / re-share). The
        //    target path now holds a hologram, which used to redirect this
        //    write onto the source itself — replacing the original with a
        //    pointer to its own path.
        await holoSphere.put(mirrorHolon, lens, { id: item.id, soul: pointer.soul });
        await waitForGun(500);

        // The source must still be the real item, not a husk.
        const source = await holoSphere.get(sourceHolon, lens, item.id, null, {
            resolveHolograms: false
        });
        expect(source).toBeDefined();
        expect(source.title).toBe('the real content');
        expect(holoSphere.isHologram(source)).toBe(false);

        // The mirror still holds a pointer at the SAME soul.
        const mirror = await holoSphere.get(mirrorHolon, lens, item.id, null, {
            resolveHolograms: false
        });
        expect(mirror).toBeDefined();
        expect(holoSphere.isHologram(mirror)).toBe(true);
        expect(mirror.soul).toBe(pointer.soul);
    }, 30000);

    test('refuses to store a hologram whose soul is its own destination', async () => {
        const item = { id: 'self-write', title: 'still here' };
        await holoSphere.put(sourceHolon, lens, item);
        await waitForGun();

        // A direct self-pointer write (e.g. publish target == source holon)
        // must be a no-op, never replace the original.
        const selfSoul = `${appName}/${sourceHolon}/${lens}/${item.id}`;
        await holoSphere.put(sourceHolon, lens, { id: item.id, soul: selfSoul });
        await waitForGun(500);

        const after = await holoSphere.get(sourceHolon, lens, item.id, null, {
            resolveHolograms: false
        });
        expect(after).toBeDefined();
        expect(after.title).toBe('still here');
        expect(holoSphere.isHologram(after)).toBe(false);
    }, 30000);
});
