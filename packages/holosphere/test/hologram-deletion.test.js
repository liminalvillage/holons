/**
 * Tests for hologram deletion functionality
 * Verifies that when deleting holograms, only the hologram is deleted and the target's _holograms list is updated
 * The original data should remain intact
 */

import { testSphere, cleanupTestEnv } from './helpers/testenv.js';

const appName = 'test-hologram-deletion-app';
const testHolon = 'hologramDeletionTestHolon';
const testLens = 'testLens';
const otherLens = 'otherLens';

const waitForGun = (delay = 250) => new Promise(resolve => setTimeout(resolve, delay));

describe('Hologram Deletion Tests', () => {
    let holoSphere;

    afterAll(cleanupTestEnv, 30000);

    beforeEach(async () => {
        holoSphere = testSphere(appName);
        await waitForGun();
    });

    afterEach(async () => {
        if (holoSphere) {
            await holoSphere.close();
        }
        await waitForGun();
    });

    test('delete() should only delete hologram and update target _holograms list', async () => {
        // 1. Store original data
        const originalData = { id: 'original-data-1', value: 'Original content' };
        await holoSphere.put(testHolon, testLens, originalData);
        await waitForGun();
        const originalSoul = `${appName}/${testHolon}/${testLens}/original-data-1`;

        // 2. Store a hologram pointing to the original data
        const hologramData = holoSphere.createHologram(testHolon, testLens, originalData);
        const hologramStorage = { id: 'hologram-to-delete', soul: hologramData.soul };
        await holoSphere.put(testHolon, otherLens, hologramStorage);
        await waitForGun(500);
        const hologramSoul = `${appName}/${testHolon}/${otherLens}/hologram-to-delete`;

        // 3. Verify hologram was added to tracking initially
        const targetNodeRef = holoSphere.getNodeRef(originalSoul);
        let hologramsSet = await new Promise(resolve => targetNodeRef.get('_holograms').once(resolve));
        expect(hologramsSet).toBeDefined();
        expect(hologramsSet[hologramSoul]).toBeDefined();

        // 4. Delete the hologram
        await holoSphere.delete(testHolon, otherLens, 'hologram-to-delete');
        await waitForGun(1000);

        // 5. Verify the hologram is deleted
        const deletedHologram = await holoSphere.get(testHolon, otherLens, 'hologram-to-delete');
        expect(deletedHologram).toBeNull();

        // 6. Verify the original data still exists
        const originalStillExists = await holoSphere.get(testHolon, testLens, 'original-data-1');
        expect(originalStillExists).toBeDefined();
        expect(originalStillExists.value).toBe('Original content');

        // 7. Verify the hologram was removed from target's _holograms list
        hologramsSet = await new Promise(resolve => targetNodeRef.get('_holograms').once(resolve));
        expect(hologramsSet[hologramSoul]).toBeNull();
    }, 15000);

    test('deleteAll() should handle holograms properly', async () => {
        // 1. Store original data
        const originalData = { id: 'original-data-2', value: 'Original content' };
        await holoSphere.put(testHolon, testLens, originalData);
        await waitForGun();
        const originalSoul = `${appName}/${testHolon}/${testLens}/original-data-2`;

        // 2. Store just one hologram in otherLens (simplified test)
        const hologramData = holoSphere.createHologram(testHolon, testLens, originalData);
        const hologramStorage = { id: 'hologram-in-deleteall', soul: hologramData.soul };
        await holoSphere.put(testHolon, otherLens, hologramStorage);
        await waitForGun(500);
        const hologramSoul = `${appName}/${testHolon}/${otherLens}/hologram-in-deleteall`;

        // 3. Verify hologram was added to tracking initially
        const targetNodeRef = holoSphere.getNodeRef(originalSoul);
        let hologramsSet = await new Promise(resolve => targetNodeRef.get('_holograms').once(resolve));
        expect(hologramsSet).toBeDefined();
        expect(hologramsSet[hologramSoul]).toBeDefined();

        // 4. Delete all items from otherLens
        await holoSphere.deleteAll(testHolon, otherLens);
        await waitForGun(1000);

        // 5. Verify all items in otherLens are deleted
        const allItems = await holoSphere.getAll(testHolon, otherLens);
        expect(allItems).toHaveLength(0);

        // 6. Verify the original data still exists
        const originalStillExists = await holoSphere.get(testHolon, testLens, 'original-data-2');
        expect(originalStillExists).toBeDefined();
        expect(originalStillExists.value).toBe('Original content');

        // 7. Verify the hologram was removed from target's _holograms list
        hologramsSet = await new Promise(resolve => targetNodeRef.get('_holograms').once(resolve));
        expect(hologramsSet[hologramSoul]).toBeNull();
    }, 15000);

    test('deleteGlobal() should handle holograms properly', async () => {
        // 1. Store original data
        const originalData = { id: 'original-data-3', value: 'Original content' };
        await holoSphere.put(testHolon, testLens, originalData);
        await waitForGun();
        const originalSoul = `${appName}/${testHolon}/${testLens}/original-data-3`;

        // 2. Store a hologram in global table
        const hologramData = holoSphere.createHologram(testHolon, testLens, originalData);
        const hologramStorage = { id: 'hologram-in-global', soul: hologramData.soul };
        await holoSphere.putGlobal('testTable', hologramStorage);
        await waitForGun(500);
        const hologramSoul = `${appName}/testTable/hologram-in-global`;

        // 3. Verify hologram was added to tracking initially
        const targetNodeRef = holoSphere.getNodeRef(originalSoul);
        let hologramsSet = await new Promise(resolve => targetNodeRef.get('_holograms').once(resolve));
        expect(hologramsSet).toBeDefined();
        expect(hologramsSet[hologramSoul]).toBeDefined();

        // 4. Delete the hologram from global table
        await holoSphere.deleteGlobal('testTable', 'hologram-in-global');
        await waitForGun(1000);

        // 5. Verify the hologram is deleted
        const deletedHologram = await holoSphere.getGlobal('testTable', 'hologram-in-global');
        expect(deletedHologram).toBeNull();

        // 6. Verify the original data still exists
        const originalStillExists = await holoSphere.get(testHolon, testLens, 'original-data-3');
        expect(originalStillExists).toBeDefined();
        expect(originalStillExists.value).toBe('Original content');

        // 7. Verify the hologram was removed from target's _holograms list
        hologramsSet = await new Promise(resolve => targetNodeRef.get('_holograms').once(resolve));
        expect(hologramsSet[hologramSoul]).toBeNull();
    }, 15000);

    test('deleteAllGlobal() should handle holograms properly', async () => {
        // 1. Store original data
        const originalData = { id: 'original-data-4', value: 'Original content' };
        await holoSphere.put(testHolon, testLens, originalData);
        await waitForGun();
        const originalSoul = `${appName}/${testHolon}/${testLens}/original-data-4`;

        // 2. Store just one hologram in global table (simplified test)
        const hologramData = holoSphere.createHologram(testHolon, testLens, originalData);
        const hologramStorage = { id: 'hologram-in-deleteallglobal', soul: hologramData.soul };
        await holoSphere.putGlobal('testTable2', hologramStorage);
        await waitForGun(500);
        const hologramSoul = `${appName}/testTable2/hologram-in-deleteallglobal`;

        // 3. Verify hologram was added to tracking initially
        const targetNodeRef = holoSphere.getNodeRef(originalSoul);
        let hologramsSet = await new Promise(resolve => targetNodeRef.get('_holograms').once(resolve));
        expect(hologramsSet).toBeDefined();
        expect(hologramsSet[hologramSoul]).toBeDefined();

        // 4. Delete all items from global table
        await holoSphere.deleteAllGlobal('testTable2');
        await waitForGun(1000);

        // 5. Verify all items in global table are deleted
        const allItems = await holoSphere.getAllGlobal('testTable2');
        expect(allItems).toHaveLength(0);

        // 6. Verify the original data still exists
        const originalStillExists = await holoSphere.get(testHolon, testLens, 'original-data-4');
        expect(originalStillExists).toBeDefined();
        expect(originalStillExists.value).toBe('Original content');

        // 7. Verify the hologram was removed from target's _holograms list
        hologramsSet = await new Promise(resolve => targetNodeRef.get('_holograms').once(resolve));
        expect(hologramsSet[hologramSoul]).toBeNull();
    }, 15000);

    test('deleting non-hologram data should work normally', async () => {
        // 1. Store regular data
        const regularData = { id: 'regular-data-to-delete', value: 'Regular content' };
        await holoSphere.put(testHolon, testLens, regularData);
        await waitForGun();

        // 2. Delete the regular data
        await holoSphere.delete(testHolon, testLens, 'regular-data-to-delete');
        await waitForGun();

        // 3. Verify the data is deleted
        const deletedData = await holoSphere.get(testHolon, testLens, 'regular-data-to-delete');
        expect(deletedData).toBeNull();
    }, 10000);

    test('get() must NOT delete a hologram whose source soul does not resolve', async () => {
        // Regression: `resolveHologram` returning null is NOT a signal that
        // a hologram is permanently broken — it fires on transient
        // unreachability too (peer offline, federation in flight, max depth).
        // The old behaviour `await holoInstance.delete(...)` here destroyed
        // real data on the first transient miss. get() must skip the entry
        // without touching storage.
        const unreachableSoul = `${appName}/${testHolon}/${testLens}/this-key-was-never-put`;
        const hologramStorage = { id: 'pointer-to-missing', soul: unreachableSoul };

        await holoSphere.put(testHolon, otherLens, hologramStorage);
        await waitForGun();

        // get() returns null (couldn't resolve) — but must NOT delete the
        // hologram envelope from storage.
        const resolved = await holoSphere.get(testHolon, otherLens, 'pointer-to-missing');
        expect(resolved).toBeNull();

        // Re-read with hologram resolution disabled: the raw envelope must
        // still be present. If it were deleted by the previous call, this
        // would return null.
        const raw = await holoSphere.get(testHolon, otherLens, 'pointer-to-missing', null, { resolveHolograms: false });
        expect(raw).not.toBeNull();
        expect(raw.soul).toBe(unreachableSoul);
    }, 10000);

    test('getAll() must NOT delete unresolved-hologram entries', async () => {
        // Same regression as above, but for the getAll path. A holon whose
        // lens contains a mix of real items and stale hologram pointers
        // should return the real items and skip-but-preserve the stale ones.
        const realData = { id: 'real-1', value: 'real value' };
        await holoSphere.put(testHolon, 'gctest', realData);

        const stalePointer = { id: 'stale-1', soul: `${appName}/${testHolon}/gctest/never-put-key` };
        await holoSphere.put(testHolon, 'gctest', stalePointer);
        await waitForGun(400);

        const items = await holoSphere.getAll(testHolon, 'gctest');
        // The real item is returned; the stale pointer is skipped (resolved to null).
        const ids = items.map(i => i.id);
        expect(ids).toContain('real-1');
        expect(ids).not.toContain('stale-1');

        // But the stale pointer must still be on disk — not GCed by the read.
        const raw = await holoSphere.get(testHolon, 'gctest', 'stale-1', null, { resolveHolograms: false });
        expect(raw).not.toBeNull();
        expect(raw.soul).toBe(stalePointer.soul);
    }, 15000);
}); 