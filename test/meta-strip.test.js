// meta-strip.test.js

import HoloSphere from '../holosphere.js';

describe('Meta Field Stripping Tests', () => {
    let holoSphere;
    const testHolon = 'testHolon';
    const testLens = 'testLens';
    const testGlobalTable = 'testGlobalTable';

    beforeEach(async () => {
        holoSphere = new HoloSphere('test_app', false);
        // Clean up before each test
        try {
            await holoSphere.deleteAll(testHolon, testLens);
            await holoSphere.deleteAllGlobal(testGlobalTable);
        } catch (error) {
            // Ignore cleanup errors
        }
        
        // Small wait for Gun to settle
        await new Promise(resolve => setTimeout(resolve, 100));
    }, 30000);

    afterEach(async () => {
        if (holoSphere) {
            await holoSphere.close();
        }
    }, 30000);

    describe('put() should strip _meta field', () => {
        test('should not store _meta field when putting data', async () => {
            const testData = {
                id: 'test1',
                name: 'Test Item',
                value: 42,
                _meta: {
                    resolvedFromHologram: true,
                    hologramSoul: 'app/holon/lens/key',
                    someOtherMeta: 'should not be stored'
                }
            };

            // Store the data (should strip _meta)
            await holoSphere.put(testHolon, testLens, testData);
            
            // Wait for Gun to settle
            await new Promise(resolve => setTimeout(resolve, 500));

            // Retrieve the data
            const retrieved = await holoSphere.get(testHolon, testLens, testData.id);

            // Verify data exists and _meta is not stored
            expect(retrieved).not.toBeNull();
            expect(retrieved.id).toBe(testData.id);
            expect(retrieved.name).toBe(testData.name);
            expect(retrieved.value).toBe(testData.value);
            expect(retrieved._meta).toBeUndefined(); // _meta should not be stored
        });

        test('should handle data without _meta field normally', async () => {
            const testData = {
                id: 'test2',
                name: 'Test Item Without Meta',
                value: 99
            };

            // Store the data
            await holoSphere.put(testHolon, testLens, testData);
            
            // Wait for Gun to settle
            await new Promise(resolve => setTimeout(resolve, 500));

            // Retrieve the data
            const retrieved = await holoSphere.get(testHolon, testLens, testData.id);

            // Verify data exists and matches exactly
            expect(retrieved).toEqual(testData);
            expect(retrieved._meta).toBeUndefined();
        });
    });

    describe('putGlobal() should strip _meta field', () => {
        test('should not store _meta field when putting global data', async () => {
            const testData = {
                id: 'globaltest1',
                name: 'Global Test Item',
                value: 123,
                _meta: {
                    resolvedFromHologram: true,
                    hologramSoul: 'app/holon/lens/key',
                    federation: { origin: 'someholon' }
                }
            };

            // Store the global data (should strip _meta)
            await holoSphere.putGlobal(testGlobalTable, testData);
            
            // Wait for Gun to settle
            await new Promise(resolve => setTimeout(resolve, 500));

            // Retrieve the data
            const retrieved = await holoSphere.getGlobal(testGlobalTable, testData.id);

            // Verify data exists and _meta is not stored
            expect(retrieved).not.toBeNull();
            expect(retrieved.id).toBe(testData.id);
            expect(retrieved.name).toBe(testData.name);
            expect(retrieved.value).toBe(testData.value);
            expect(retrieved._meta).toBeUndefined(); // _meta should not be stored
        });

        test('should handle global data without _meta field normally', async () => {
            const testData = {
                id: 'globaltest2',
                name: 'Global Test Item Without Meta',
                value: 456
            };

            // Store the global data
            await holoSphere.putGlobal(testGlobalTable, testData);
            
            // Wait for Gun to settle
            await new Promise(resolve => setTimeout(resolve, 500));

            // Retrieve the data
            const retrieved = await holoSphere.getGlobal(testGlobalTable, testData.id);

            // Verify data exists and matches exactly
            expect(retrieved).toEqual(testData);
            expect(retrieved._meta).toBeUndefined();
        });
    });

    test('should preserve _meta in original data object (not mutate input)', async () => {
        const testData = {
            id: 'test3',
            name: 'Test Mutation',
            _meta: {
                resolvedFromHologram: true,
                hologramSoul: 'app/holon/lens/key'
            }
        };

        // Store a copy to verify original isn't mutated
        const originalMeta = { ...testData._meta };

        // Store the data
        await holoSphere.put(testHolon, testLens, testData);

        // Verify the original object still has _meta (we shouldn't mutate the input)
        expect(testData._meta).toBeDefined();
        expect(testData._meta).toEqual(originalMeta);

        // But the stored data should not have _meta
        const retrieved = await holoSphere.get(testHolon, testLens, testData.id);
        expect(retrieved._meta).toBeUndefined();
    });

    describe('put() should strip _hologram envelope', () => {
        test('should not store _hologram envelope when putting data', async () => {
            const testData = {
                id: 'test-hologram-strip',
                name: 'Resolved item',
                value: 7,
                _hologram: {
                    isHologram: true,
                    soul: 'app/holon/lens/key',
                    sourceHolon: 'holon',
                    sourceLens: 'lens',
                    sourceKey: 'key',
                    resolvedAt: Date.now()
                }
            };

            await holoSphere.put(testHolon, testLens, testData);
            await new Promise(resolve => setTimeout(resolve, 500));

            const retrieved = await holoSphere.get(testHolon, testLens, testData.id);
            expect(retrieved).not.toBeNull();
            expect(retrieved.id).toBe(testData.id);
            expect(retrieved.name).toBe(testData.name);
            expect(retrieved._hologram).toBeUndefined();
        });

        test('putGlobal should strip _hologram envelope', async () => {
            const testData = {
                id: 'test-hologram-strip-global',
                name: 'Resolved global',
                _hologram: {
                    isHologram: true,
                    soul: 'app/holon/lens/key',
                    resolvedAt: Date.now()
                }
            };

            await holoSphere.putGlobal(testGlobalTable, testData);
            await new Promise(resolve => setTimeout(resolve, 500));

            const retrieved = await holoSphere.getGlobal(testGlobalTable, testData.id);
            expect(retrieved).not.toBeNull();
            expect(retrieved._hologram).toBeUndefined();
        });
    });
}); 