import HoloSphere from '../holosphere.js';
import { jest } from '@jest/globals';

// Configure Jest
jest.setTimeout(30000); // 30 second timeout

describe('HoloSphere Deletion Tests', () => {
    const testAppName = 'test-app-deletion';
    const testHolon = 'testHolonDeletion';
    const testLens = 'testLensDeletion';
    const testGlobalTable = 'testGlobalTable';
    const testPassword = 'testPassword1234';
    let holoSphere;

    beforeAll(async () => {
        holoSphere = new HoloSphere(testAppName, false, null);
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

        test('should delete a node properly', async () => {
            // Create test node data
            const nodeData = { value: 'node-to-delete' };
            const nodeKey = 'test-node-key';
            
            // Store node
            await holoSphere.putNode(testHolon, testLens, { id: nodeKey, value: nodeData });
            
            // Verify node exists
            const storedNode = await holoSphere.getNode(testHolon, testLens, 'value');
            expect(storedNode).toBeDefined();
            
            // Delete node
            const deleteResult = await holoSphere.deleteNode(testHolon, testLens, 'value');
            expect(deleteResult).toBe(true);
            
            // Verify node is deleted
            const deletedNode = await holoSphere.getNode(testHolon, testLens, 'value');
            expect(deletedNode).toBeNull();
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
            
            // Store global data
            await holoSphere.putGlobal(testGlobalTable, globalData);
            
            // Verify global data exists
            const storedGlobalData = await holoSphere.getGlobal(testGlobalTable, globalData.id);
            expect(storedGlobalData).toBeDefined();
            console.log(storedGlobalData);
            expect(storedGlobalData.value).toBe(globalData.value);
            
            // Delete global data
            const deleteResult = await holoSphere.deleteGlobal(testGlobalTable, globalData.id);
            //const newLocal = expect(deleteResult).toBe(true);

            // Add a short delay to allow GunDB to process the deletion
            await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay
            
            // Verify global data is deleted
            const deletedGlobalData = await holoSphere.getGlobal(testGlobalTable, globalData.id);
            console.log('!!!!!!!!!!!!!',deletedGlobalData);
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
            // Test with missing parameters
            await expect(holoSphere.delete(null, testLens, 'test-id')).rejects.toThrow();
            await expect(holoSphere.delete(testHolon, null, 'test-id')).rejects.toThrow();
            await expect(holoSphere.delete(testHolon, testLens, null)).rejects.toThrow();
            
            // Test with missing global parameters
            await expect(holoSphere.deleteGlobal(null, 'test-id')).rejects.toThrow();
            await expect(holoSphere.deleteGlobal(testGlobalTable, null)).rejects.toThrow();
        });
    });
}); 