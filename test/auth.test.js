import HoloSphere from '../holosphere.js';
import { jest } from '@jest/globals';

// Increase timeout for all tests
jest.setTimeout(30000);

describe('HoloSphere Authentication and Authorization', () => {
    let holoSphere;
    let strictHoloSphere;
    const testPassword = 'TestPass123!';
    const testHolon = 'test-holon';
    const testLens = 'test-lens';

    beforeAll(async () => {
        holoSphere = new HoloSphere('test-app', false, null);
        strictHoloSphere = new HoloSphere('test-app-strict', true, null);
        // Wait for initialization
        await new Promise(resolve => setTimeout(resolve, 1000));
    });

    beforeEach(async () => {
        // Clean state before each test
        await holoSphere.deleteAll(testHolon, testLens);
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    afterEach(async () => {
        // Clean up test data
        try {
            if (holoSphere) {
                await holoSphere.deleteAll(testHolon, testLens);
            }
            if (strictHoloSphere) {
                await strictHoloSphere.deleteAll(testHolon, testLens);
            }
        } catch (error) {
            console.error('Error in afterEach cleanup:', error);
        }
    });

    afterAll(async () => {
        // Clean up all test data
        try {
            if (holoSphere) {
                await holoSphere.deleteAll(testHolon, testLens);
                await holoSphere.deleteAllGlobal('testTable');
            }
            // Assuming strict instance uses the same testHolon/testLens/testTable
            if (strictHoloSphere) {
                 await strictHoloSphere.deleteAll(testHolon, testLens);
                 await strictHoloSphere.deleteAllGlobal('testTable');
            }
        } catch (error) {
            console.error('Error during afterAll data cleanup:', error);
        }

        // Close HoloSphere instances
        try {
            if (holoSphere) {
                console.log('Closing non-strict HoloSphere instance...');
                await holoSphere.close();
                console.log('Non-strict HoloSphere instance closed.');
            }
            if (strictHoloSphere) {
                console.log('Closing strict HoloSphere instance...');
                await strictHoloSphere.close();
                console.log('Strict HoloSphere instance closed.');
            }
        } catch (error) {
             console.error('Error during afterAll close:', error);
        }

        // Add a slightly longer, more explicit wait after close calls
        console.log('Waiting extra time for cleanup...');
        await new Promise(resolve => setTimeout(resolve, 2000)); 
        console.log('Finished afterAll.');
    });

    describe('Authentication System', () => {
        it('should authenticate with password and handle auth failures', async () => {
            const testData = { id: 'test1', value: 'private-data' };
            
            // Test storing with authentication
            await holoSphere.put(testHolon, testLens, testData, testPassword);
            // Wait for data to be properly stored
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Test retrieving with wrong password
            const wrongResult = await holoSphere.get(testHolon, testLens, testData.id, 'wrong_password');
            expect(wrongResult).toBeNull();
            
            // Test retrieving with no password
            const noPassResult = await holoSphere.get(testHolon, testLens, testData.id);
            expect(noPassResult).toBeNull();
            
            // Test retrieving with correct password
            const correctResult = await holoSphere.get(testHolon, testLens, testData.id, testPassword);
            expect(correctResult).toEqual(testData);  // Use full object comparison
        });

        it('should handle authentication errors gracefully', async () => {
            const testData = { id: 'test2', value: 'private-data' };
            
            // Store data with correct password
            await holoSphere.put(testHolon, testLens, testData, testPassword);
            
            // Try to retrieve with wrong password
            const result = await holoSphere.get(testHolon, testLens, testData.id, 'wrong_password');
            expect(result).toBeNull();
        }, 10000);
    });

    describe('Schema Validation', () => {
        it('should only validate schema in strict mode', async () => {
            const schema = {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    value: { type: 'number' }
                },
                required: ['id', 'value']
            };
            
            // Set schema for both instances
            await holoSphere.setSchema(testLens, schema);
            await strictHoloSphere.setSchema(testLens, schema);
            
            const invalidData = { id: 'invalid' }; // Missing required 'value' field
            
            // Should work in non-strict mode
            await expect(holoSphere.put(testHolon, testLens, invalidData)).resolves.toBeTruthy();
            
            // Should fail in strict mode
            await expect(strictHoloSphere.put(testHolon, testLens, invalidData))
                .rejects.toThrow('Schema validation failed');
        }, 10000);

        it('should require schema in strict mode', async () => {
            const testData = { id: 'test', value: 123 };
            
            // Should work in non-strict mode without schema
            await expect(holoSphere.put(testHolon, 'nonExistentLens', testData)).resolves.toBeTruthy();
            
            // Delete any existing schema for the lens
            await strictHoloSphere.putGlobal('schemas', { id: 'nonExistentLens', schema: null });
            
            try {
                // This should throw an error in strict mode
                await strictHoloSphere.put(testHolon, 'nonExistentLens', testData);
                // If we get here, the test should fail
                expect('Expected an error').toBe('but none was thrown');
            } catch (error) {
                expect(error.message).toBe('Schema required in strict mode');
            }
        }, 10000);
    });

    describe('Private Data Operations', () => {
        it('should store and retrieve private data with password', async () => {
            const testData = { id: 'test3', value: 123 };
            
            await holoSphere.put(testHolon, testLens, testData, testPassword);
            
            const result = await holoSphere.get(testHolon, testLens, testData.id, testPassword);
            expect(result).toEqual(testData);
        });

        it('should handle public data access', async () => {
            const testData = { id: 'public', value: 456 };
            
            await holoSphere.put(testHolon, testLens, testData);
            
            const result = await holoSphere.get(testHolon, testLens, testData.id);
            expect(result).toEqual(testData);
        });

        it('should prevent unauthorized access to private data', async () => {
            const testData = { id: 'private', value: 789 };
            
            // Store with password
            await holoSphere.put(testHolon, testLens, testData, testPassword);
            
            // Try to retrieve without password
            const result = await holoSphere.get(testHolon, testLens, testData.id);
            expect(result).toBeNull();
        });

        it('should handle deletion of private data', async () => {
            const testData = { id: 'delete', value: 101 };
            
            await holoSphere.put(testHolon, testLens, testData, testPassword);
            await holoSphere.delete(testHolon, testLens, testData.id, testPassword);
            
            const result = await holoSphere.get(testHolon, testLens, testData.id, testPassword);
            expect(result).toBeNull();
        });

        it('should handle multiple private data versions', async () => {
            const versions = [
                { id: 'version1', value: 1 },
                { id: 'version2', value: 2 },
                { id: 'version3', value: 3 }
            ];
            
            // Clean up any existing data first
            await holoSphere.deleteAll(testHolon, testLens, testPassword);
            
            // Store each version
            for (const data of versions) {
                await holoSphere.put(testHolon, testLens, data, testPassword);
            }
            
            // Wait a bit for data to settle
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const results = await holoSphere.getAll(testHolon, testLens, testPassword);
            expect(results.length).toBe(versions.length);
            for (const version of versions) {
                expect(results).toContainEqual(expect.objectContaining(version));
            }
        }, 10000);
    });

    describe('Global Data Operations', () => {
        it('should handle private global data', async () => {
            const testData = { id: 'global', value: 111 };
            
            await holoSphere.putGlobal('testTable', testData, testPassword);
            
            const result = await holoSphere.getGlobal('testTable', testData.id, testPassword);
            expect(result).toEqual(testData);
        });

        it('should handle public global data', async () => {
            const testData = { id: 'public_global', value: 222 };
            
            await holoSphere.putGlobal('testTable', testData);
            
            const result = await holoSphere.getGlobal('testTable', testData.id);
            expect(result).toEqual(testData);
        });

        it('should handle getAllGlobal with private data', async () => {
            const testData = [
                { id: 'global1', value: 1 },
                { id: 'global2', value: 2 }
            ];
            
            // Clean up any existing data first
            await holoSphere.deleteAllGlobal('testTable', testPassword);
            
            // Store each item
            for (const data of testData) {
                await holoSphere.putGlobal('testTable', data, testPassword);
            }
            
            // Wait a bit for data to settle
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const results = await holoSphere.getAllGlobal('testTable', testPassword);
            expect(results.length).toBe(testData.length);
            for (const data of testData) {
                expect(results).toContainEqual(expect.objectContaining(data));
            }
        }, 10000);

        it('should handle deleteGlobal with private data', async () => {
            const testData = { id: 'delete_global', value: 333 };
            
            await holoSphere.putGlobal('testTable', testData, testPassword);
            
            await holoSphere.deleteGlobal('testTable', testData.id, testPassword);
            
            const result = await holoSphere.getGlobal('testTable', testData.id, testPassword);
            expect(result).toBeNull();
        });
    });
}); 