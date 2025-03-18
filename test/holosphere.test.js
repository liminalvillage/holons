import HoloSphere from '../holosphere.js';
import * as h3 from 'h3-js';
import { jest } from '@jest/globals';

// Configure Jest
jest.setTimeout(30000); // 30 second timeout

describe('HoloSphere', () => {
    const testAppName = 'test-app3';
    const testHolon = 'testHolon3';
    const testLens = 'testLens3';
    const testPassword = 'testPassword1234';
    let holoSphere;
    let strictHoloSphere;
    beforeAll(async () => {
        holoSphere = new HoloSphere('test-app', false, null);
        strictHoloSphere = new HoloSphere('test-app-strict', true, null);
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
        await holoSphere.deleteAll(testHolon, testLens);
        await holoSphere.deleteAllGlobal('testTable');
        
        // Close Gun connections
        if (holoSphere.gun) {
            holoSphere.gun.off();
        }
        if (strictHoloSphere.gun) {
            strictHoloSphere.gun.off();
        }
        
        // Wait for connections to close
        await new Promise(resolve => setTimeout(resolve, 1000));
    });


    describe('Constructor', () => {
        test('should have initialized with correct properties', () => {
            expect(holoSphere).toBeInstanceOf(HoloSphere);
            expect(holoSphere.gun).toBeDefined();
            expect(holoSphere.validator).toBeDefined();
            expect(holoSphere.openai).toBeUndefined();
            expect(holoSphere.subscriptions).toBeDefined();
            expect(holoSphere.subscriptions).toEqual({});
        });

        test('should initialize with OpenAI', () => {
            expect(new HoloSphere(testAppName, false, 'fake-key').openai).toBeDefined();
        });
    });

    describe('Space Management', () => {
        test('should handle private space authentication', async () => {
            const testData = { id: 'test1', value: 'data' + Date.now() };
            
            await holoSphere.put(testHolon, testLens, testData, testPassword);
            const result = await holoSphere.get(testHolon, testLens, testData.id, testPassword);
            expect(result).toBeDefined();
            expect(result.value).toBe(testData.value);
        });

        test('should handle public space access', async () => {
            const testData = { id: 'public1', value: 'public data' + Date.now() };
            
            await holoSphere.put(testHolon, testLens, testData);
            const result = await holoSphere.get(testHolon, testLens, testData.id);
            expect(result).toBeDefined();
            expect(result.value).toBe(testData.value);
        });

        test('should handle missing parameters gracefully', async () => {
            const result1 = await holoSphere.get(null, testLens, 'key');
            expect(result1).toBeNull();

            const result2 = await holoSphere.get(testHolon, null, 'key');
            expect(result2).toBeNull();

            const result3 = await holoSphere.get(testHolon, testLens, null);
            expect(result3).toBeNull();
        });

        test('should handle authentication errors gracefully', async () => {
            const testData = { id: 'test2', value: 'private data' };
            
            await holoSphere.put(testHolon, testLens, testData, testPassword);
            const result = await holoSphere.get(testHolon, testLens, testData.id, 'wrong_password');
            expect(result).toBeNull();
        });
    });

    describe('Data Operations', () => {
        const validSchema = {
            type: 'object',
            properties: {
                id: { type: 'string' },
                value: { type: 'string' }
            },
            required: ['id', 'value']
        };

        beforeEach(async () => {
            await holoSphere.setSchema(testLens, validSchema);
        });

        test('should handle data operations gracefully', async () => {
            const testData = { id: 'test3', value: 'test data' };
            
            // Test non-existent data
            const nonExistent = await holoSphere.get(testHolon, testLens, 'non-existent');
            expect(nonExistent).toBeNull();

            // Test storing and retrieving data
            await holoSphere.put(testHolon, testLens, testData);
            const result = await holoSphere.get(testHolon, testLens, testData.id);
            expect(result).toEqual(testData);

            // Test deleting data
            await holoSphere.delete(testHolon, testLens, testData.id);
            const deletedResult = await holoSphere.get(testHolon, testLens, testData.id);
            expect(deletedResult).toBeNull();
        });

        test('should handle invalid data gracefully', async () => {
            const invalidData = { wrongField: 'no id field' };
            
            // Should not throw when storing invalid data in non-strict mode
            await expect(holoSphere.put(testHolon, testLens, invalidData))
                .resolves.toBeTruthy();

            // Should return null when retrieving invalid data
            const result = await holoSphere.get(testHolon, testLens, 'undefined');
            expect(result).toBeNull();
        });
    });

    describe('Global Operations', () => {
        test('should handle global operations gracefully', async () => {
            const globalData = { id: 'global1', value: 'global test data' };
            
            // Test non-existent data
            const nonExistent = await holoSphere.getGlobal(testHolon, testLens, 'non-existent');
            expect(nonExistent).toBeNull();

            // Test storing and retrieving data
            await holoSphere.putGlobal(testLens, globalData);
            const result = await holoSphere.getGlobal(testLens, globalData.id);
            expect(result).toEqual(globalData);

            // Test deleting data
            await holoSphere.deleteGlobal( testLens, globalData.id);
            const deletedResult = await holoSphere.getGlobal( testLens, globalData.id);
            expect(deletedResult).toBeNull();
        });
    });
}); 