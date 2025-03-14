import Gun from 'gun';
import HoloSphere from '../holosphere.js';
import * as h3 from 'h3-js';
import { jest } from '@jest/globals';

// Increase timeout for all tests
jest.setTimeout(60000);

describe('HoloSphere Authentication and Authorization', () => {
    let holoSphere;
    let gunInstance;
    const testPassword = 'TestPass123!';
    const testHolon = 'test-holon';
    const testLens = 'test-lens';

    // Helper function to create a Gun instance
    const createGunInstance = () => {
        const gunOptions = {
            localStorage: false,
            radisk: false,
            file: false,
            web: false,
            multicast: false,
            peers: [],
            axe: false
        };
        return Gun(gunOptions);
    };

    // Helper function to wait for Gun operations
    const waitForGun = (ms = 1000) => new Promise(resolve => setTimeout(resolve, ms));

    beforeAll(async () => {
        // Create a custom Gun instance for testing with memory adapter
        gunInstance = createGunInstance();
        holoSphere = new HoloSphere('test-app', false, null, gunInstance);
        
        // Wait for Gun to initialize
        await waitForGun(2000);
    }, 60000);

    afterEach(async () => {
        // Clean up test data
        try {
            if (holoSphere) {
                await holoSphere.deleteAll(testHolon, testLens);
                await waitForGun(1000);
            }
        } catch (error) {
            console.error('Error in afterEach cleanup:', error);
        }
    }, 60000);

    afterAll(async () => {
        try {
            if (holoSphere) {
                // Clean up subscriptions
                await holoSphere.deleteAll(testHolon, testLens);
                await waitForGun(1000);
            }
            
            if (gunInstance) {
                // Close all connections
                gunInstance.off();
            }
            
            // Clear references
            holoSphere = null;
            gunInstance = null;
            
            // Force cleanup in test environment
            if (process.env.NODE_ENV === 'test') {
                await waitForGun(1000);
                process.exit(0);
            }
        } catch (error) {
            console.error('Error in afterAll cleanup:', error);
        }
    }, 60000);

    describe('Authentication System', () => {
        it('should authenticate with password and return user reference', async () => {
            const space = await holoSphere._getHolonSpace(testHolon, testPassword);
            expect(space).toBeDefined();
            expect(space.user).toBeDefined();
            expect(space.pub).toBeDefined();
        }, 60000);

        it('should handle authentication errors gracefully', async () => {
            try {
                await holoSphere._getHolonSpace(testHolon, 'wrong_password');
                fail('Should have thrown an error');
            } catch (error) {
                expect(error.message).toContain('Wrong user or password');
            }
        }, 60000);
    });

    describe('Private Data Operations', () => {
        it('should store and retrieve private data with password', async () => {
            const testData = { name: 'test', value: 123 };
            
            await holoSphere.put(testHolon, testLens, testData, testPassword);
            await waitForGun(1000);
            
            const result = await holoSphere.get(testHolon, testLens, testData.name, testPassword);
            expect(result).toEqual(testData);
        }, 60000);

        it('should handle public data access', async () => {
            const testData = { name: 'public', value: 456 };
            
            await holoSphere.put(testHolon, testLens, testData);
            await waitForGun(1000);
            
            const result = await holoSphere.get(testHolon, testLens, testData.name);
            expect(result).toEqual(testData);
        }, 60000);

        it('should prevent unauthorized modification of private data', async () => {
            const testData = { name: 'private', value: 789 };
            
            await holoSphere.put(testHolon, testLens, testData, testPassword);
            await waitForGun(1000);
            
            // Try to modify without password
            const modifiedData = { name: 'private', value: 999 };
            await holoSphere.put(testHolon, testLens, modifiedData);
            await waitForGun(1000);
            
            // Original data should still be accessible with password
            const result = await holoSphere.get(testHolon, testLens, testData.name, testPassword);
            expect(result).toEqual(testData);
        }, 60000);

        it('should handle deletion of private data', async () => {
            const testData = { name: 'delete', value: 101 };
            
            await holoSphere.put(testHolon, testLens, testData, testPassword);
            await waitForGun(1000);
            
            await holoSphere.delete(testHolon, testLens, testData.name, testPassword);
            await waitForGun(1000);
            
            const result = await holoSphere.get(testHolon, testLens, testData.name, testPassword);
            expect(result).toBeNull();
        }, 60000);

        it('should handle multiple private data versions', async () => {
            const versions = [
                { name: 'version1', value: 1 },
                { name: 'version2', value: 2 },
                { name: 'version3', value: 3 }
            ];
            
            for (const data of versions) {
                await holoSphere.put(testHolon, testLens, data, testPassword);
                await waitForGun(1000);
            }
            
            const result = await holoSphere.get(testHolon, testLens, versions[versions.length - 1].name, testPassword);
            expect(result).toEqual(versions[versions.length - 1]);
        }, 60000);

        it('should handle getAll with private data', async () => {
            const testData = {
                key1: { name: 'first', value: 1 },
                key2: { name: 'second', value: 2 }
            };
            
            for (const [key, value] of Object.entries(testData)) {
                await holoSphere.put(testHolon, testLens, value, testPassword);
                await waitForGun(1000);
            }
            
            const result = await holoSphere.getAll(testHolon, testLens, testPassword);
            expect(result).toEqual(testData);
        }, 60000);
    });

    describe('Global Data Operations', () => {
        it('should handle private global data', async () => {
            const testData = { name: 'global', value: 111 };
            
            await holoSphere.putGlobal('testTable', testData, testPassword);
            await waitForGun(1000);
            
            const result = await holoSphere.getGlobal('testTable', testData.name, testPassword);
            expect(result).toEqual(testData);
        }, 60000);

        it('should handle public global data', async () => {
            const testData = { name: 'public_global', value: 222 };
            
            await holoSphere.putGlobal('testTable', testData);
            await waitForGun(1000);
            
            const result = await holoSphere.getGlobal('testTable', testData.name);
            expect(result).toEqual(testData);
        }, 60000);

        it('should handle getAllGlobal with private data', async () => {
            const testData = {
                global1: { name: 'first', value: 1 },
                global2: { name: 'second', value: 2 }
            };
            
            for (const [key, value] of Object.entries(testData)) {
                await holoSphere.putGlobal('testTable', value, testPassword);
                await waitForGun(1000);
            }
            
            const result = await holoSphere.getAllGlobal('testTable', testPassword);
            expect(result).toEqual(testData);
        }, 60000);

        it('should handle deleteGlobal with private data', async () => {
            const testData = { name: 'delete_global', value: 333 };
            
            await holoSphere.putGlobal('testTable', testData, testPassword);
            await waitForGun(1000);
            
            await holoSphere.deleteGlobal('testTable', testData.name, testPassword);
            await waitForGun(1000);
            
            const result = await holoSphere.getGlobal('testTable', testData.name, testPassword);
            expect(result).toBeNull();
        }, 60000);
    });

    describe('Schema Validation', () => {
        it('should validate data against schema', async () => {
            const schema = {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    value: { type: 'number' }
                },
                required: ['name', 'value']
            };
            
            await holoSphere.setSchema(testLens, schema);
            await waitForGun(1000);
            
            const validData = { name: 'valid', value: 444 };
            const invalidData = { name: 'invalid' };
            
            await holoSphere.put(testHolon, testLens, validData);
            await waitForGun(1000);
            
            await expect(holoSphere.put(testHolon, testLens, invalidData))
                .rejects.toThrow();
        }, 60000);
    });
}); 