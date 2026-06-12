// hologram-updates-return.test.js

import HoloSphere from '../holosphere.js';

describe('Hologram Updates Return Value Tests', () => {
    let holoSphere;
    const testHolon = 'updateReturnTestHolon';
    const testLens = 'testLens';
    const otherLens = 'otherLens';
    const appName = 'test-hologram-return-app';

    const waitForGun = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms));

    beforeEach(async () => {
        holoSphere = new HoloSphere(appName, false);
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
    });

    test('put should return empty array when no holograms exist', async () => {
        const originalData = { id: 'no-holograms-test', value: 'Original Value' };
        
        // Put original data
        const result = await holoSphere.put(testHolon, testLens, originalData);
        
        expect(result).toBeDefined();
        expect(result.success).toBe(true);
        expect(result.updatedHolograms).toBeDefined();
        expect(Array.isArray(result.updatedHolograms)).toBe(true);
        expect(result.updatedHolograms).toHaveLength(0);
    });

    test('put should return list of updated holograms when they exist', async () => {
        const originalData = { id: 'with-holograms-test', value: 'Original Value' };
        
        // Step 1: Put original data
        await holoSphere.put(testHolon, testLens, originalData);
        await waitForGun();
        
        // Step 2: Create holograms pointing to the original data
        const hologram1 = holoSphere.createHologram(testHolon, testLens, originalData);
        const hologram2 = holoSphere.createHologram(testHolon, testLens, originalData);
        
        await holoSphere.put(testHolon, otherLens, { id: 'hologram-1', soul: hologram1.soul });
        await holoSphere.put(testHolon, otherLens, { id: 'hologram-2', soul: hologram2.soul });
        await waitForGun(500);
        
        // Step 3: Update the original data and check the return value
        const updatedData = { ...originalData, value: 'Updated Value', count: 42 };
        const result = await holoSphere.put(testHolon, testLens, updatedData);
        
        expect(result).toBeDefined();
        expect(result.success).toBe(true);
        expect(result.updatedHolograms).toBeDefined();
        expect(Array.isArray(result.updatedHolograms)).toBe(true);
        expect(result.updatedHolograms.length).toBeGreaterThan(0);
        
        // Check that the returned hologram info is complete
        result.updatedHolograms.forEach(hologram => {
            expect(hologram.soul).toBeDefined();
            expect(hologram.holon).toBe(testHolon);
            expect(hologram.lens).toBeDefined(); // Could be testLens or otherLens
            expect(hologram.key).toBeDefined();
            expect(hologram.id).toBeDefined();
            expect(hologram.timestamp).toBeDefined();
            expect(typeof hologram.timestamp).toBe('number');
        });
        
        // Verify that the souls match what we expect
        const expectedSouls = [
            `${appName}/${testHolon}/${otherLens}/hologram-1`,
            `${appName}/${testHolon}/${otherLens}/hologram-2`
        ];
        
        const returnedSouls = result.updatedHolograms.map(h => h.soul);
        expectedSouls.forEach(expectedSoul => {
            expect(returnedSouls).toContain(expectedSoul);
        });
    });

    test('put should return updated holograms with correct structure', async () => {
        const originalData = { id: 'structure-test', value: 'Test Value' };
        
        // Put original data
        await holoSphere.put(testHolon, testLens, originalData);
        await waitForGun();
        
        // Create one hologram
        const hologram = holoSphere.createHologram(testHolon, testLens, originalData);
        await holoSphere.put(testHolon, otherLens, { id: 'structure-hologram', soul: hologram.soul });
        await waitForGun(500);
        
        // Update original data
        const updatedData = { ...originalData, value: 'Updated Test Value' };
        const result = await holoSphere.put(testHolon, testLens, updatedData);
        
        expect(result.updatedHolograms).toHaveLength(1);
        
        const updatedHologram = result.updatedHolograms[0];
        expect(updatedHologram).toEqual({
            soul: `${appName}/${testHolon}/${otherLens}/structure-hologram`,
            holon: testHolon,
            lens: otherLens,
            key: 'structure-hologram',
            id: 'structure-hologram',
            timestamp: expect.any(Number)
        });
        
        // Verify timestamp is recent (within last few seconds)
        const now = Date.now();
        expect(updatedHologram.timestamp).toBeGreaterThan(now - 5000);
        expect(updatedHologram.timestamp).toBeLessThanOrEqual(now);
    });

    test('put with isHologramUpdate option should not return updated holograms', async () => {
        const originalData = { id: 'no-recursive-test', value: 'Original Value' };
        
        // Put original data
        await holoSphere.put(testHolon, testLens, originalData);
        await waitForGun();
        
        // Create hologram
        const hologram = holoSphere.createHologram(testHolon, testLens, originalData);
        await holoSphere.put(testHolon, otherLens, { id: 'recursive-test', soul: hologram.soul });
        await waitForGun(500);
        
        // Update with isHologramUpdate flag (should not trigger hologram updates)
        const updatedData = { ...originalData, value: 'Updated Value' };
        const result = await holoSphere.put(testHolon, testLens, updatedData, null, { isHologramUpdate: true });
        
        expect(result).toBeDefined();
        expect(result.success).toBe(true);
        expect(result.updatedHolograms).toBeDefined();
        expect(result.updatedHolograms).toHaveLength(0);
    });

    test('put hologram should not return updated holograms', async () => {
        const originalData = { id: 'hologram-put-test', value: 'Original Value' };
        
        // Put original data
        await holoSphere.put(testHolon, testLens, originalData);
        await waitForGun();
        
        // Put a hologram (not original data)
        const hologram = holoSphere.createHologram(testHolon, testLens, originalData);
        const result = await holoSphere.put(testHolon, otherLens, { id: 'test-hologram', soul: hologram.soul });
        
        expect(result).toBeDefined();
        expect(result.success).toBe(true);
        expect(result.updatedHolograms).toBeDefined();
        expect(result.updatedHolograms).toHaveLength(0);
    });
}); 