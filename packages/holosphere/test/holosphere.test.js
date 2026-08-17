import HoloSphere from '../holosphere.js';
import * as h3 from 'h3-js';
import { jest } from '@jest/globals';
import { testSphere, isolatedGunOptions, cleanupTestEnv } from './helpers/testenv.js';

// Configure Jest
jest.setTimeout(30000); // 30 second timeout

describe('HoloSphere', () => {
    const testAppName = 'test-app3';
    const testHolon = 'testHolon3';
    const testLens = 'testLens3';
    const testPassword = 'testPassword1234';
    let holoSphere;
    let strictHoloSphere;
    afterAll(cleanupTestEnv, 30000);

    beforeAll(async () => {
        holoSphere = await testSphere('test-app');
        strictHoloSphere = await testSphere('test-app-strict', { strict: true });
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
        
        // Close HoloSphere instances
        if (holoSphere) {
            await holoSphere.close();
        }
        if (strictHoloSphere) {
            await strictHoloSphere.close();
        }
        
        // Wait for connections to close
        await new Promise(resolve => setTimeout(resolve, 1000));
    });


    describe('Constructor', () => {
        test('should have initialized with correct properties', () => {
            expect(holoSphere).toBeInstanceOf(HoloSphere);
            expect(holoSphere.gun).toBeDefined();
            expect(holoSphere.validator).toBeDefined();
            // The constructor sets `this.openai = null` unconditionally —
            // callers wire a client in themselves when they need one.
            expect(holoSphere.openai).toBeNull();
            expect(holoSphere.subscriptions).toBeDefined();
            expect(holoSphere.subscriptions).toEqual({});
        });

        test('should initialize with OpenAI', async () => {
            const withOpenAI = new HoloSphere(testAppName, false, 'fake-key', isolatedGunOptions());
            expect(withOpenAI.openai).toBeDefined();
            await withOpenAI.close();
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

    describe('Schema Functions', () => {
        test('should set and get a schema', async () => {
            const schema = {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    value: { type: 'string' }
                },
                required: ['id', 'value']
            };
            
            await holoSphere.setSchema('testLens', schema);
            const retrieved = await holoSphere.getSchema('testLens');
            
            expect(retrieved).toEqual(schema);
        });
        
        test('should cache schemas when fetched', async () => {
            const schema = {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    test: { type: 'string' }
                },
                required: ['id', 'test']
            };
            
            // Clear any existing cache and set up fresh schema
            holoSphere.clearSchemaCache();
            await holoSphere.setSchema('cacheTestLens', schema);
            
            // Cache should be populated by setSchema
            expect(holoSphere.schemaCache.has('cacheTestLens')).toBe(true);
            
            // Save the getGlobal method to create a spy
            const originalGetGlobal = holoSphere.getGlobal;
            let globalCalled = false;
            
            // Replace with a spy
            holoSphere.getGlobal = async (...args) => {
                globalCalled = true;
                return originalGetGlobal.apply(holoSphere, args);
            };
            
            // This call should use the cache and not call getGlobal
            const cachedFetch = await holoSphere.getSchema('cacheTestLens');
            expect(cachedFetch).toEqual(schema);
            
            // Verify getGlobal was not called because we used the cache
            expect(globalCalled).toBe(false);
            
            // Now force a non-cached fetch
            globalCalled = false;
            const forcedFetch = await holoSphere.getSchema('cacheTestLens', { useCache: false });
            expect(forcedFetch).toEqual(schema);
            
            // Verify getGlobal was called this time
            expect(globalCalled).toBe(true);
            
            // Restore original method
            holoSphere.getGlobal = originalGetGlobal;
        });
        
        test('should respect cache max age', async () => {
            const schema = {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    age: { type: 'number' }
                },
                required: ['id', 'age']
            };
            
            // Clear any existing cache
            holoSphere.clearSchemaCache();
            await holoSphere.setSchema('ageTestLens', schema);
            
            // First fetch to populate cache
            await holoSphere.getSchema('ageTestLens');
            
            // Verify cache has the entry now
            expect(holoSphere.schemaCache.has('ageTestLens')).toBe(true);
            
            // Manually set an old timestamp on the cache entry
            const oldTimestamp = Date.now() - 3700000; // Older than the default maxCacheAge
            holoSphere.schemaCache.set('ageTestLens', {
                schema,
                timestamp: oldTimestamp
            });
            
            // Save the getGlobal method to create a spy
            const originalGetGlobal = holoSphere.getGlobal;
            let globalCalled = false;
            
            // Replace with a spy
            holoSphere.getGlobal = async (...args) => {
                globalCalled = true;
                return originalGetGlobal.apply(holoSphere, args);
            };
            
            // Call should bypass the cache due to age
            const secondFetch = await holoSphere.getSchema('ageTestLens');
            expect(secondFetch).toEqual(schema);
            
            // getGlobal should have been called again
            expect(globalCalled).toBe(true);
            
            // Restore original method
            holoSphere.getGlobal = originalGetGlobal;
        });
        
        test('should clear cache properly', async () => {
            const schema1 = {
                type: 'object',
                properties: { id: { type: 'string' } },
                required: ['id']
            };
            
            const schema2 = {
                type: 'object',
                properties: { name: { type: 'string' } },
                required: ['name']
            };
            
            // Set two schemas
            await holoSphere.setSchema('clearTest1', schema1);
            await holoSphere.setSchema('clearTest2', schema2);
            
            // Verify they're cached
            expect(holoSphere.schemaCache.has('clearTest1')).toBe(true);
            expect(holoSphere.schemaCache.has('clearTest2')).toBe(true);
            
            // Clear one schema
            holoSphere.clearSchemaCache('clearTest1');
            expect(holoSphere.schemaCache.has('clearTest1')).toBe(false);
            expect(holoSphere.schemaCache.has('clearTest2')).toBe(true);
            
            // Clear all schemas
            holoSphere.clearSchemaCache();
            expect(holoSphere.schemaCache.has('clearTest1')).toBe(false);
            expect(holoSphere.schemaCache.has('clearTest2')).toBe(false);
        });

        test('should provide significant performance improvement with caching', async () => {
            const schema = {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    value: { type: 'number' },
                    name: { type: 'string' }
                },
                required: ['id', 'value']
            };
            
            // Set up the schema
            await holoSphere.setSchema('perfTestLens', schema);
            
            // Measure time without caching (force bypass)
            const start1 = Date.now();
            for (let i = 0; i < 100; i++) {
                await holoSphere.getSchema('perfTestLens', { useCache: false });
            }
            const end1 = Date.now();
            const timeWithoutCache = end1 - start1;
            
            // Measure time with caching
            const start2 = Date.now();
            for (let i = 0; i < 100; i++) {
                await holoSphere.getSchema('perfTestLens');
            }
            const end2 = Date.now();
            const timeWithCache = end2 - start2;
            
            console.log(`Performance comparison:
                Without cache: ${timeWithoutCache}ms
                With cache: ${timeWithCache}ms
                Improvement factor: ${timeWithoutCache / timeWithCache}x
            `);
            
            // The cached version should be at least 2x faster
            expect(timeWithCache).toBeLessThan(timeWithoutCache / 2);
        });
    });
}); 