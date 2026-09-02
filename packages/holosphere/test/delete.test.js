import { testSphere, cleanupTestEnv } from './helpers/testenv.js';
import { jest } from '@jest/globals';

// Configure Jest
jest.setTimeout(30000); // 30 second timeout

// Utility to wait for GunDB propagation
const waitForGun = (delay = 250) => new Promise(resolve => setTimeout(resolve, delay));

describe('HoloSphere Deletion Tests', () => {
    const testAppName = 'test-app-deletion';
    const testHolon = 'testHolonDeletion';
    const testLens = 'testLensDeletion';
    const testGlobalTable = 'testGlobalTable';
    const testPassword = 'testPassword1234';
    let holoSphere;

    afterAll(cleanupTestEnv, 30000);

    beforeAll(async () => {
        holoSphere = await testSphere(testAppName);
    });

    afterAll(async () => {
        // Clean up all test data
        await holoSphere.deleteAll(testHolon, testLens);
        await holoSphere.deleteAllGlobal(testGlobalTable);
        
        // Close Gun connections
        if (holoSphere) {
            await holoSphere.close();
        }
        
        // Wait for connections to close
        await new Promise(resolve => setTimeout(resolve, 1000));
    });

    describe('Basic Deletion', () => {
        test('should delete a single item properly', async () => {
            // Create test data
            const testData = { id: 'delete-test-1', value: 'delete me' };
            
            // Store data
            await holoSphere.put(testHolon, testLens, testData);
            
            // Verify data exists
            const storedData = await holoSphere.get(testHolon, testLens, testData.id);
            expect(storedData).toBeDefined();
            expect(storedData.value).toBe(testData.value);
            
            // Delete data
            const deleteResult = await holoSphere.delete(testHolon, testLens, testData.id);
            expect(deleteResult).toBe(true);
            
            // Verify data is deleted
            const deletedData = await holoSphere.get(testHolon, testLens, testData.id);
            expect(deletedData).toBeNull();
        });

        test('getNode/deleteNode operate on the stored record', async () => {
            await holoSphere.put(testHolon, testLens, { id: 'node-key', value: 'node-to-delete' });
            expect((await holoSphere.getNode(testHolon, testLens, 'node-key')).value).toBe('node-to-delete');
            expect(await holoSphere.deleteNode(testHolon, testLens, 'node-key')).toBe(true);
            expect(await holoSphere.get(testHolon, testLens, 'node-key')).toBeNull();
            expect((await holoSphere.getNode(testHolon, testLens, 'node-key'))._deleted).toBe(true);
        });
    });

    describe('Bulk Deletion', () => {
        test('should delete all items in a lens', async () => {
            // Create multiple test items
            const items = [
                { id: 'bulk-delete-1', value: 'bulk 1' },
                { id: 'bulk-delete-2', value: 'bulk 2' },
                { id: 'bulk-delete-3', value: 'bulk 3' }
            ];
            
            // Store all items
            for (const item of items) {
                await holoSphere.put(testHolon, testLens, item);
            }
            
            // Verify items exist
            const allItems = await holoSphere.getAll(testHolon, testLens);
            expect(allItems.length).toBeGreaterThanOrEqual(items.length);
            
            // Delete all items
            const deleteAllResult = await holoSphere.deleteAll(testHolon, testLens);
            expect(deleteAllResult).toBe(true);
            
            // Verify all items are deleted
            const remainingItems = await holoSphere.getAll(testHolon, testLens);
            expect(remainingItems.length).toBe(0);
        });
    });

    describe('Global Table Deletion', () => {
        test('should delete global items properly', async () => {
            // Create global test data
            const globalData = { id: 'global-delete-test', value: 'global delete me' };

            // 1. Store global data
            await holoSphere.putGlobal(testGlobalTable, globalData);

            // 2. Wait significantly for put to settle
            await waitForGun(1500); // Generous wait after put

            // 3. Delete global data
            const deleteResult = await holoSphere.deleteGlobal(testGlobalTable, globalData.id);
            expect(deleteResult).toBe(true);

            // 4. Wait for delete to settle
            await waitForGun(500); // Wait after delete

            // 5. Verify global data is deleted
            const deletedGlobalData = await holoSphere.getGlobal(testGlobalTable, globalData.id);
            expect(deletedGlobalData).toBeNull();
        });

        test('should delete all global items in a table', async () => {
            // Create multiple global test items
            const items = [
                { id: 'global-bulk-1', value: 'global bulk 1' },
                { id: 'global-bulk-2', value: 'global bulk 2' },
                { id: 'global-bulk-3', value: 'global bulk 3' }
            ];
            
            // Store all global items
            for (const item of items) {
                await holoSphere.putGlobal(testGlobalTable, item);
            }
            
            // Verify global items exist
            const allGlobalItems = await holoSphere.getAllGlobal(testGlobalTable);
            expect(allGlobalItems.length).toBeGreaterThanOrEqual(items.length);
            
            // Delete all global items
            const deleteAllResult = await holoSphere.deleteAllGlobal(testGlobalTable);
            expect(deleteAllResult).toBe(true);
            
            // Verify all global items are deleted
            const remainingGlobalItems = await holoSphere.getAllGlobal(testGlobalTable);
            expect(remainingGlobalItems.length).toBe(0);
        });
    });

    describe('Private Data Deletion', () => {
        test('should delete private data properly', async () => {
            // Create private test data
            const privateData = { id: 'private-delete-test', value: 'private delete me' };
            
            // Store private data
            await holoSphere.put(testHolon, testLens, privateData, testPassword);
            
            // Verify private data exists
            const storedPrivateData = await holoSphere.get(testHolon, testLens, privateData.id, testPassword);
            expect(storedPrivateData).toBeDefined();
            expect(storedPrivateData.value).toBe(privateData.value);
            
            // Delete private data
            const deleteResult = await holoSphere.delete(testHolon, testLens, privateData.id, testPassword);
            expect(deleteResult).toBe(true);
            
            // Verify private data is deleted
            const deletedPrivateData = await holoSphere.get(testHolon, testLens, privateData.id, testPassword);
            expect(deletedPrivateData).toBeNull();
        });

        test('should delete all private items in a lens', async () => {
            // Create multiple private test items
            const items = [
                { id: 'private-bulk-1', value: 'private bulk 1' },
                { id: 'private-bulk-2', value: 'private bulk 2' },
                { id: 'private-bulk-3', value: 'private bulk 3' }
            ];
            
            // Store all private items
            for (const item of items) {
                await holoSphere.put(testHolon, testLens, item, testPassword);
            }
            
            // Verify private items exist
            const allPrivateItems = await holoSphere.getAll(testHolon, testLens, testPassword);
            expect(allPrivateItems.length).toBeGreaterThanOrEqual(items.length);
            
            // Delete all private items
            const deleteAllResult = await holoSphere.deleteAll(testHolon, testLens, testPassword);
            expect(deleteAllResult).toBe(true);
            
            // Verify all private items are deleted
            const remainingPrivateItems = await holoSphere.getAll(testHolon, testLens, testPassword);
            expect(remainingPrivateItems.length).toBe(0);
        });
    });

    describe('Edge Cases', () => {
        test('should handle deletion of non-existent items gracefully', async () => {
            // Try to delete non-existent item
            const deleteResult = await holoSphere.delete(testHolon, testLens, 'non-existent-id');
            expect(deleteResult).toBe(true); // Gun returns success even for non-existent items
            
            // Try to delete non-existent global item
            const deleteGlobalResult = await holoSphere.deleteGlobal(testGlobalTable, 'non-existent-global-id');
            expect(deleteGlobalResult).toBe(true);
        });

        test('should handle invalid parameters gracefully', async () => {
            // holon is optional now (a null holon = a global table), so it is no
            // longer invalid — only missing lens/key are.
            await expect(holoSphere.delete(testHolon, null, 'test-id')).rejects.toThrow();
            await expect(holoSphere.delete(testHolon, testLens, null)).rejects.toThrow();
            
            // Test with missing global parameters
            await expect(holoSphere.deleteGlobal(null, 'test-id')).rejects.toThrow();
            await expect(holoSphere.deleteGlobal(testGlobalTable, null)).rejects.toThrow();
        });
    });
}); 