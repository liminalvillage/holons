// tombstone-never-follows-hologram.test.js
//
// Deleting a mirrored record means dropping THIS holon's pointer — the
// original stays for its owner. A `_deleted: true` payload must therefore
// never be redirected through a hologram, neither by the `_hologram`
// envelope a resolved read carries nor by a pointer already stored at the
// destination. An ordinary edit of the same record still follows the pointer
// (see put-source-redirect.test.js).

import { testSphere, cleanupTestEnv } from './helpers/testenv.js';

describe('put: a tombstone never follows a hologram', () => {
    let holoSphere;
    const appName = 'test-tombstone-no-follow-app';
    const sourceHolon = 'sourceHolon';
    const localHolon = 'localHolon';
    const lens = 'quests';

    const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

    afterAll(cleanupTestEnv, 30000);

    beforeEach(async () => {
        holoSphere = await testSphere(appName);
        try {
            await holoSphere.deleteAll(sourceHolon, lens);
            await holoSphere.deleteAll(localHolon, lens);
        } catch {
            // ignore cleanup errors
        }
        await settle(100);
    }, 30000);

    afterEach(async () => {
        if (holoSphere) await holoSphere.close();
    });

    async function mirror(id) {
        const original = { id, title: 'shared task', status: 'open' };
        await holoSphere.put(sourceHolon, lens, original);
        await settle();
        const holo = holoSphere.createHologram(sourceHolon, lens, original);
        await holoSphere.put(localHolon, lens, { id, soul: holo.soul });
        await settle();
        return original;
    }

    test('a tombstone of a resolved mirror lands on the local pointer, not the source', async () => {
        await mirror('t1');
        const resolved = await holoSphere.get(localHolon, lens, 't1');
        expect(resolved._hologram?.sourceHolon).toBe(sourceHolon);

        // Delete "from my holon": the payload still carries the read-side envelope.
        await holoSphere.put(localHolon, lens, { ...resolved, _deleted: true });
        await settle();

        const sourceItem = await holoSphere.get(sourceHolon, lens, 't1', null, { resolveHolograms: false });
        expect(sourceItem).toBeTruthy();
        expect(sourceItem._deleted).toBeUndefined();
        expect(sourceItem.status).toBe('open');

        const localRaw = await holoSphere.get(localHolon, lens, 't1', null, {
            resolveHolograms: false,
            includeDeleted: true,
        });
        expect(localRaw?._deleted).toBe(true);
        expect(holoSphere.isHologram(localRaw)).toBe(false);
        expect(await holoSphere.get(localHolon, lens, 't1')).toBeNull();
    }, 30000);

    test('a bare tombstone aimed at a stored pointer does not reach the source either', async () => {
        await mirror('t2');

        await holoSphere.put(localHolon, lens, { id: 't2', _deleted: true });
        await settle();

        const sourceItem = await holoSphere.get(sourceHolon, lens, 't2', null, { resolveHolograms: false });
        expect(sourceItem?.status).toBe('open');
        expect(await holoSphere.get(localHolon, lens, 't2')).toBeNull();
    }, 30000);

    test('an ordinary edit of the same mirror still follows the pointer', async () => {
        await mirror('t3');
        const resolved = await holoSphere.get(localHolon, lens, 't3');

        await holoSphere.put(localHolon, lens, { ...resolved, status: 'completed' });
        await settle();

        const sourceItem = await holoSphere.get(sourceHolon, lens, 't3', null, { resolveHolograms: false });
        expect(sourceItem.status).toBe('completed');
        const localRaw = await holoSphere.get(localHolon, lens, 't3', null, { resolveHolograms: false });
        expect(holoSphere.isHologram(localRaw)).toBe(true);
    }, 30000);
});
