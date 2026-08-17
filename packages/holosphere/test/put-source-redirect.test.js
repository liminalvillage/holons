// put-source-redirect.test.js
//
// A write of an item that was RESOLVED from a hologram (so it still carries the
// canonical `_hologram` envelope) must land on the ORIGINAL in its owner's
// graph — never fork a local copy. This is the "borrow/return a federated item"
// case: read a mirrored item, mutate it, put it back. See the Source-Envelope
// Hologram Redirection block in content.js.

import { testSphere, cleanupTestEnv } from './helpers/testenv.js';

// KNOWN ENFORCE GAP: hologram/pointer writes are unsigned by design (the sign
// hook skips them), so enforce-mode reads drop them from the authorized view.
// This suite asserts raw hologram semantics and is skipped under
// HOLO_TEST_SIGNING=enforce until envelopes resolve through soul redirects.
const describeUnlessEnforce = process.env.HOLO_TEST_SIGNING === 'enforce' ? describe.skip : describe;
describeUnlessEnforce('put: source-envelope hologram redirection', () => {
    let holoSphere;
    const appName = 'test-source-redirect-app';
    const sourceHolon = 'sourceHolon';
    const localHolon = 'localHolon';
    const lens = 'library';

    const waitForGun = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

    afterAll(cleanupTestEnv, 30000);

    beforeEach(async () => {
        holoSphere = await testSphere(appName);
        try {
            await holoSphere.deleteAll(sourceHolon, lens);
            await holoSphere.deleteAll(localHolon, lens);
        } catch {
            // ignore cleanup errors
        }
        await waitForGun(100);
    }, 30000);

    afterEach(async () => {
        if (holoSphere) await holoSphere.close();
    });

    test('writing a resolved hologram back lands on the source, not a local copy', async () => {
        // The real item lives in the source holon.
        const original = { id: 'drill', borrowed: false, value: 5 };
        await holoSphere.put(sourceHolon, lens, original);
        await waitForGun();

        // A hologram pointer in the LOCAL holon points back at the source item.
        const holo = holoSphere.createHologram(sourceHolon, lens, original);
        await holoSphere.put(localHolon, lens, { id: 'drill', soul: holo.soul });
        await waitForGun();

        // Reading it locally resolves to the source item + a `_hologram` envelope.
        const resolved = await holoSphere.get(localHolon, lens, 'drill');
        expect(resolved.borrowed).toBe(false);
        expect(resolved._hologram?.sourceHolon).toBe(sourceHolon);
        expect(resolved._hologram?.sourceKey).toBe('drill');

        // Mutate and write back to the LOCAL holon — the redirect sends it to the
        // source, so the borrow lands on the real item.
        await holoSphere.put(localHolon, lens, { ...resolved, borrowed: true });
        await waitForGun();

        // The source item is updated…
        const sourceItem = await holoSphere.get(sourceHolon, lens, 'drill', null, {
            resolveHolograms: false,
        });
        expect(sourceItem.borrowed).toBe(true);
        // …and stored clean, with no read-side envelope persisted.
        expect(sourceItem._hologram).toBeUndefined();

        // The local holon still holds ONLY the hologram pointer — no forked copy.
        const localRaw = await holoSphere.get(localHolon, lens, 'drill', null, {
            resolveHolograms: false,
        });
        expect(holoSphere.isHologram(localRaw)).toBe(true);
    }, 30000);

    test('disableHologramRedirection writes the item where addressed', async () => {
        const original = { id: 'saw', borrowed: false };
        await holoSphere.put(sourceHolon, lens, original);
        await waitForGun();
        const holo = holoSphere.createHologram(sourceHolon, lens, original);
        const resolved = { ...original, _hologram: { isHologram: true, soul: holo.soul, sourceHolon, sourceLens: lens, sourceKey: 'saw' } };

        // Opt out → the write stays on the local holon (a deliberate copy).
        await holoSphere.put(localHolon, lens, { ...resolved, borrowed: true }, null, {
            disableHologramRedirection: true,
        });
        await waitForGun();

        const localRaw = await holoSphere.get(localHolon, lens, 'saw', null, {
            resolveHolograms: false,
        });
        expect(localRaw.borrowed).toBe(true);
        expect(holoSphere.isHologram(localRaw)).toBe(false);
    }, 30000);
});
