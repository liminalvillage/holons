// hologram-updates.test.js

import { testSphere, cleanupTestEnv } from './helpers/testenv.js';

describe('Hologram Update Tests', () => {
    let holoSphere;
    const testHolon = 'updateTestHolon';
    const testLens = 'testLens';
    const otherLens = 'otherLens';
    const appName = 'test-hologram-update-app';

    const waitForGun = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms));

    afterAll(cleanupTestEnv, 30000);

    beforeEach(async () => {
        holoSphere = testSphere(appName);
        // Clean up before each test
        try {
            await holoSphere.deleteAll(testHolon, testLens);
            await holoSphere.deleteAll(testHolon, otherLens);
        } catch (error) {
            // Ignore cleanup errors
        }
        
        await waitForGun(100);
    }, 30000);

    afterEach(async () => {
        if (holoSphere) {
            await holoSphere.close();
        }
    }, 30000);

    test('should update active holograms when original data is modified', async () => {
        // 1. Store original data
        const originalData = { id: 'update-test-item', value: 'Original Value', count: 1 };
        await holoSphere.put(testHolon, testLens, originalData);
        await waitForGun();

        // 2. Create and store a hologram pointing to the original data
        const hologram = holoSphere.createHologram(testHolon, testLens, originalData);
        await holoSphere.put(testHolon, otherLens, hologram); // Store hologram in different lens
        await waitForGun(500);

        // 3. Get the hologram before update (should not have 'updated' field)
        const hologramBeforeUpdate = await holoSphere.get(testHolon, otherLens, originalData.id, null, { resolveHolograms: false });
        expect(hologramBeforeUpdate).toBeDefined();
        expect(hologramBeforeUpdate.soul).toBe(hologram.soul);
        expect(hologramBeforeUpdate.updated).toBeUndefined();

        // 4. Update the original data
        const updatedData = { id: 'update-test-item', value: 'Updated Value', count: 2 };
        await holoSphere.put(testHolon, testLens, updatedData);
        await waitForGun(1000); // Give time for hologram updates to propagate

        // 5. Check that the hologram now has an 'updated' timestamp
        const hologramAfterUpdate = await holoSphere.get(testHolon, otherLens, originalData.id, null, { resolveHolograms: false });
        expect(hologramAfterUpdate).toBeDefined();
        expect(hologramAfterUpdate.soul).toBe(hologram.soul);
        expect(hologramAfterUpdate.updated).toBeDefined();
        expect(typeof hologramAfterUpdate.updated).toBe('number');
        expect(hologramAfterUpdate.updated).toBeGreaterThan(Date.now() - 5000); // Should be recent

        // 6. Verify that resolving the hologram gives the updated data
        const resolvedData = await holoSphere.get(testHolon, otherLens, originalData.id);
        expect(resolvedData).toBeDefined();
        expect(resolvedData.value).toBe('Updated Value');
        expect(resolvedData.count).toBe(2);
    });

    test('should update multiple holograms pointing to the same data', async () => {
        // 1. Store original data
        const originalData = { id: 'multi-hologram-test', value: 'Original Value' };
        await holoSphere.put(testHolon, testLens, originalData);
        await waitForGun();

        // 2. Create and store multiple holograms pointing to the same data
        const hologram1 = holoSphere.createHologram(testHolon, testLens, originalData);
        const hologram2 = holoSphere.createHologram(testHolon, testLens, originalData);
        
        await holoSphere.put(testHolon, otherLens, { ...hologram1, id: 'hologram-1' });
        await holoSphere.put(testHolon, otherLens, { ...hologram2, id: 'hologram-2' });
        await waitForGun(500);

        // 3. Update the original data
        const updatedData = { id: 'multi-hologram-test', value: 'Updated Value' };
        await holoSphere.put(testHolon, testLens, updatedData);
        await waitForGun(1000);

        // 4. Check that both holograms have been updated
        const updatedHologram1 = await holoSphere.get(testHolon, otherLens, 'hologram-1', null, { resolveHolograms: false });
        const updatedHologram2 = await holoSphere.get(testHolon, otherLens, 'hologram-2', null, { resolveHolograms: false });

        expect(updatedHologram1.updated).toBeDefined();
        expect(updatedHologram2.updated).toBeDefined();
        expect(typeof updatedHologram1.updated).toBe('number');
        expect(typeof updatedHologram2.updated).toBe('number');
    });

    test('should not update deleted holograms', async () => {
        // 1. Store original data
        const originalData = { id: 'delete-test-item', value: 'Original Value' };
        await holoSphere.put(testHolon, testLens, originalData);
        await waitForGun();

        // 2. Create and store a hologram
        const hologram = holoSphere.createHologram(testHolon, testLens, originalData);
        await holoSphere.put(testHolon, otherLens, hologram);
        await waitForGun(500);

        // 3. Delete the hologram
        await holoSphere.delete(testHolon, otherLens, originalData.id);
        await waitForGun(500);

        // 4. Update the original data
        const updatedData = { id: 'delete-test-item', value: 'Updated Value' };
        await holoSphere.put(testHolon, testLens, updatedData);
        await waitForGun(1000);

        // 5. Verify the original data was updated
        const retrievedData = await holoSphere.get(testHolon, testLens, originalData.id);
        expect(retrievedData.value).toBe('Updated Value');

        // 6. Verify the hologram was not updated (since it's deleted)
        const deletedHologram = await holoSphere.get(testHolon, otherLens, originalData.id);
        expect(deletedHologram).toBeNull(); // Should be null since it was deleted
    });

    test('should work with data that has no holograms', async () => {
        // 1. Store data that has no holograms pointing to it
        const originalData = { id: 'no-holograms-test', value: 'Original Value' };
        await holoSphere.put(testHolon, testLens, originalData);
        await waitForGun();

        // 2. Update the data (should not cause errors even with no holograms)
        const updatedData = { id: 'no-holograms-test', value: 'Updated Value' };
        await holoSphere.put(testHolon, testLens, updatedData);
        await waitForGun(1000);

        // 3. Verify the data was updated successfully
        const retrievedData = await holoSphere.get(testHolon, testLens, originalData.id);
        expect(retrievedData.value).toBe('Updated Value');
    });
}); 