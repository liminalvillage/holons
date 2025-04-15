import HoloSphere from '../holosphere.js';
import { jest } from '@jest/globals';

// Configure timeout
jest.setTimeout(30000); // 30 second timeout

// Utility to wait for GunDB propagation
const waitForGun = (delay = 250) => new Promise(resolve => setTimeout(resolve, delay));

// Setup
describe('HoloSphere Reference System', () => {
    let holoSphere;
    const appName = 'test-hologram-app'; // Update app name
    const testHolon = 'hologramTestHolon'; // Update holon name
    const testLens = 'testLens';
    
    beforeAll(async () => {
        // Create a single HoloSphere instance for all tests
        holoSphere = new HoloSphere(appName);
    });
    
    afterAll(async () => {
        // Clean up after all tests
        if (holoSphere) {
            await holoSphere.close();
            // Wait for connections to close
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    });
    
    test('should create and parse a hologram correctly', async () => {
        // Test data
        const data = { id: 'ref1', value: 'Original Data' };
        await holoSphere.put(testHolon, testLens, data);
        await waitForGun(); // <-- Add delay
        
        // Create a hologram
        const hologram = holoSphere.createHologram(testHolon, testLens, data); // Use renamed method
        
        expect(hologram).toBeDefined();
        expect(hologram.id).toBe('ref1');
        expect(hologram.soul).toBe(`${appName}/${testHolon}/${testLens}/ref1`);
        expect(holoSphere.isHologram(hologram)).toBe(true); // Use renamed method
    });
    
    test('isHologram should return false for non-hologram objects', () => { // Rename test description
        expect(holoSphere.isHologram(null)).toBe(false); // Use renamed method
        expect(holoSphere.isHologram(undefined)).toBe(false); // Use renamed method
        expect(holoSphere.isHologram({})).toBe(false); // Use renamed method
        expect(holoSphere.isHologram({ id: 'test' })).toBe(false); // Use renamed method
        expect(holoSphere.isHologram({ soul: 'path' })).toBe(false); // Use renamed method
        expect(holoSphere.isHologram('string')).toBe(false); // Use renamed method
    });
    
    test('should resolve a valid hologram', async () => { // Rename test description
        const data = { id: 'ref2', value: 'Data to Resolve' };
        await holoSphere.put(testHolon, testLens, data);
        await waitForGun(); // <-- Add delay
        const hologram = holoSphere.createHologram(testHolon, testLens, data); // Use renamed method

        const resolved = await holoSphere.resolveHologram(hologram); // Use renamed method

        expect(resolved).toBeDefined();
        expect(resolved.id).toBe('ref2');
        expect(resolved.value).toBe('Data to Resolve');
        // Check for metadata added during resolution
        expect(resolved._meta).toBeDefined();
        expect(resolved._meta.isHologram).toBe(true);
        expect(resolved._meta.resolved).toBe(true);
        expect(resolved._meta.soul).toBe(hologram.soul);
    });
    
    test('resolveHologram should return null for a hologram pointing to non-existent data', async () => { // Rename test description
        const nonExistentData = { id: 'ref-non-existent' }; // Data never stored
        const hologram = holoSphere.createHologram(testHolon, testLens, nonExistentData); // Create hologram for it

        const resolved = await holoSphere.resolveHologram(hologram); // Use renamed method
        expect(resolved).toBeNull(); // Resolution should fail and return null
    });
    
    test('resolveHologram should return the original object if not a hologram', async () => { // Rename test description
        const plainObject = { id: 'not-a-ref', value: 123 };
        const resolved = await holoSphere.resolveHologram(plainObject); // Use renamed method
        expect(resolved).toBe(plainObject); // Should return the object itself
    });
    
    // Test for nested holograms
    test('should resolve nested holograms correctly', async () => { // Rename test description
        // 1. Original Data stored under its own ID
        const originalData = { id: 'actual-nested-original', value: 'level 0' };
        await holoSphere.put(testHolon, testLens, originalData);
        await waitForGun(); // <-- Add delay

        // 2. Hologram 1 pointing to Original Data, stored under 'hologram1-id'
        const hologram1Data = holoSphere.createHologram(testHolon, testLens, originalData);
        const hologram1Storage = { id: 'hologram1-id', soul: hologram1Data.soul }; // Soul points to originalData
        await holoSphere.put(testHolon, testLens, hologram1Storage); 
        await waitForGun(); // <-- Add delay

        // 3. Hologram 2 pointing to Hologram 1, stored under 'hologram2-id'
        // Create a temporary object representing hologram1 for creating hologram2
        const hologram1Ref = { id: 'hologram1-id' }; // We only need the ID hologram2 should point to
        const hologram2Data = holoSphere.createHologram(testHolon, testLens, hologram1Ref); // Soul points to hologram1Storage
        const hologram2Storage = { id: 'hologram2-id', soul: hologram2Data.soul }; // Soul points to .../hologram1-id
        await holoSphere.put(testHolon, testLens, hologram2Storage); 
        await waitForGun(); // <-- Add delay

        // Resolve Hologram 2 (which is stored at hologram2-id)
        // The system should fetch hologram2Storage, see its soul points to hologram1-id,
        // fetch hologram1Storage, see its soul points to actual-nested-original,
        // fetch originalData, and return it.
        const resolved = await holoSphere.get(testHolon, testLens, 'hologram2-id'); 

        console.log("!!!!!!!!!!!!! nested hologram", resolved);

        expect(resolved).toBeDefined();
        // Check against originalData
        expect(resolved.id).toBe('actual-nested-original');
        expect(resolved.value).toBe('level 0');
        expect(resolved._meta).toBeDefined();
        expect(resolved._meta.isHologram).toBe(true); // It was resolved from a hologram
        expect(resolved._meta.resolved).toBe(true);
        // The final soul in meta should be from the *first* hologram fetched (hologram2Storage)
        expect(resolved._meta.soul).toBe(hologram2Storage.soul);

        // Resolve Hologram 2 without following deeply - should return Hologram 1 data
        // Fetch hologram2Storage with resolveHolograms: false. This gets the raw hologram object.
        const fetchedHologram2 = await holoSphere.get(testHolon, testLens, 'hologram2-id', null, { resolveHolograms: false });
        // Now, resolve *this specific hologram object* one level deep.
        const resolvedShallow = await holoSphere.resolveHologram(fetchedHologram2, { followHolograms: false });
        
        console.log("!!!!!!!!!!!!! nested hologram shallow", resolvedShallow);

        expect(resolvedShallow).toBeDefined();
        // Should match hologram1Storage
        expect(resolvedShallow.id).toBe('hologram1-id'); // ID from hologram1Storage
        expect(resolvedShallow.soul).toBe(hologram1Storage.soul); // Soul from hologram1Storage
        expect(resolvedShallow.value).toBeUndefined(); // Should not have value from originalData
        expect(resolvedShallow._meta).toBeDefined();
        expect(resolvedShallow._meta.isHologram).toBe(true);
        expect(resolvedShallow._meta.resolved).toBe(true);
        expect(resolvedShallow._meta.soul).toBe(hologram2Storage.soul); // Soul should be from hologram2Storage
    });
    
    // Test for circular holograms
    test('should detect and handle circular holograms', async () => { // Rename test description
        // Hologram A points to Hologram B's future location
        const holoA = { id: 'holoA', soul: `${appName}/${testHolon}/${testLens}/holoB` };
        await holoSphere.put(testHolon, testLens, holoA);
        await waitForGun(); // <-- Add delay

        // Hologram B points to Hologram A's location
        const holoB = { id: 'holoB', soul: `${appName}/${testHolon}/${testLens}/holoA` };
        await holoSphere.put(testHolon, testLens, holoB);
        await waitForGun(); // <-- Add delay

        // Attempt to resolve Hologram A via get, which should handle the circular error from resolveHologram
        const resolved = await holoSphere.get(testHolon, testLens, holoA.id); 

        // Should return null due to circular detection handled in get()
        expect(resolved).toBeNull();
    });

    test('get should resolve holograms by default', async () => { // Rename test description
        // 1. Store the actual data under its own ID
        const actualData = { id: 'actual-data-id', value: 'Fetched via get' };
        await holoSphere.put(testHolon, testLens, actualData);
        await waitForGun(); // <-- Add delay

        // 2. Create a hologram pointing to the actual data
        // The hologram object itself will have the ID 'actual-data-id'
        const hologramPointingToData = holoSphere.createHologram(testHolon, testLens, actualData);

        // 3. Store the hologram object under the ID we want to fetch ('get-ref')
        // We need to create a new object for storage that uses the hologram's soul
        // but has the ID 'get-ref'.
        const hologramStorageObject = { id: 'get-ref', soul: hologramPointingToData.soul };
        await holoSphere.put(testHolon, testLens, hologramStorageObject); 
        await waitForGun(); // <-- Add delay

        // 4. Get the item by the hologram's storage ID ('get-ref')
        // This should retrieve hologramStorageObject and then resolve its soul
        const resolved = await holoSphere.get(testHolon, testLens, 'get-ref');

        expect(resolved).toBeDefined();
        console.log("!!!!!!!!!!!!!",resolved); // Should now show resolved data + meta
        // Assertions should check against the *actualData*
        expect(resolved.id).toBe('actual-data-id'); // ID comes from the resolved data
        expect(resolved.value).toBe('Fetched via get'); // Value comes from the resolved data
        expect(resolved._meta).toBeDefined();
        expect(resolved._meta.isHologram).toBe(true);
        expect(resolved._meta.resolved).toBe(true);
        // The soul in the meta should be the soul of the *hologram object* we fetched
        expect(resolved._meta.soul).toBe(hologramStorageObject.soul);
    });

    test('get should not resolve holograms if resolveHolograms is false', async () => { // Rename test description
        const data = { id: 'get-no-res', value: 'Original' };
        await holoSphere.put(testHolon, testLens, data);
        await waitForGun(); // <-- Add delay
        const hologram = holoSphere.createHologram(testHolon, testLens, data); // Use renamed method
        await holoSphere.put(testHolon, testLens, hologram); // Store the hologram itself at its ID
        await waitForGun(); // <-- Add delay

        // Get the item by ID without resolving
        const unresolved = await holoSphere.get(testHolon, testLens, 'get-no-res', null, { resolveHolograms: false }); // Use renamed option

        expect(unresolved).toBeDefined();
        expect(unresolved.id).toBe('get-no-res');
        expect(unresolved.soul).toBe(hologram.soul);
        expect(unresolved.value).toBeUndefined(); // Should be the raw hologram
        expect(unresolved._meta).toBeUndefined();
    });

    test('get should return null if hologram resolution fails (target deleted)', async () => { // Rename test description
        const data = { id: 'get-deleted-target' };
        // Create hologram but DO NOT store the original data
        const hologram = holoSphere.createHologram(testHolon, testLens, data);
        await holoSphere.put(testHolon, testLens, hologram); // Store the hologram
        await waitForGun(); // <-- Add delay

        // Get the item - resolution should fail
        const result = await holoSphere.get(testHolon, testLens, 'get-deleted-target');
        expect(result).toBeNull();
    });

    test('updates to original data should be reflected when resolving hologram', async () => { // Rename test description
        const originalData = { id: 'update-ref', value: 'Version 1' };
        await holoSphere.put(testHolon, testLens, originalData);
        await waitForGun(); // <-- Add delay
        const hologram = holoSphere.createHologram(testHolon, testLens, originalData); // Use renamed method
        await holoSphere.put(testHolon, 'otherLens', hologram); // Store hologram elsewhere
        await waitForGun(); // <-- Add delay

        // Resolve initially
        const resolved1 = await holoSphere.resolveHologram(hologram); // Use renamed method
        expect(resolved1.value).toBe('Version 1');
        
        // Update original data
        const updatedData = { ...originalData, value: 'Version 2' };
        await holoSphere.put(testHolon, testLens, updatedData);
        await waitForGun(300); // <-- Increase delay for update propagation

        // Resolve again
        const resolved2 = await holoSphere.resolveHologram(hologram); // Use renamed method
        expect(resolved2).toBeDefined();
        expect(resolved2.value).toBe('Version 2');
        expect(resolved2._meta).toBeDefined();
        expect(resolved2._meta.soul).toBe(hologram.soul);
    });

    // --- Tests for _holograms tracking ---
    test('should add hologram soul to target _holograms set on put', async () => {
        // 1. Store original data
        const targetData = { id: 'target-for-tracking', value: 'Track me' };
        await holoSphere.put(testHolon, testLens, targetData);
        await waitForGun();
        const targetSoul = `${appName}/${testHolon}/${testLens}/target-for-tracking`;

        // 2. Store a hologram pointing to the original data
        const hologramData = holoSphere.createHologram(testHolon, testLens, targetData);
        const hologramStorage = { id: 'hologram-tracker-1', soul: hologramData.soul };
        await holoSphere.put(testHolon, 'otherLens', hologramStorage); // Store in different lens
        await waitForGun(500); // Longer wait for tracking update
        const storedHologramSoul = `${appName}/${testHolon}/otherLens/hologram-tracker-1`;

        // 3. Get the target node reference and fetch the _holograms set
        const targetNodeRef = holoSphere.getNodeRef(targetSoul);
        const hologramsSet = await new Promise(resolve => targetNodeRef.get('_holograms').once(resolve));

        // 4. Verify the _holograms set exists and contains the stored hologram's soul
        expect(hologramsSet).toBeDefined();
        // Gun stores set members as keys, excluding metadata '_'
        const hologramKeys = Object.keys(hologramsSet).filter(k => k !== '_');
        expect(hologramKeys).toContain(storedHologramSoul);
        expect(hologramsSet[storedHologramSoul]).toBe(true); // Check the value stored
    });

    test('should remove hologram soul from target _holograms set on delete', async () => {
        // 1. Store original data
        const targetData = { id: 'target-for-delete-tracking', value: 'Untrack me' };
        await holoSphere.put(testHolon, testLens, targetData);
        await waitForGun();
        const targetSoul = `${appName}/${testHolon}/${testLens}/target-for-delete-tracking`;

        // 2. Store a hologram pointing to the original data
        const hologramData = holoSphere.createHologram(testHolon, testLens, targetData);
        const hologramStorage = { id: 'hologram-tracker-2', soul: hologramData.soul };
        await holoSphere.put(testHolon, 'otherLens', hologramStorage); // Store in different lens
        await waitForGun(500); // Wait for put and tracking update
        const storedHologramSoul = `${appName}/${testHolon}/otherLens/hologram-tracker-2`;

        // 3. Verify hologram was added to tracking initially
        const targetNodeRef = holoSphere.getNodeRef(targetSoul);
        let hologramsSet = await new Promise(resolve => targetNodeRef.get('_holograms').once(resolve));
        expect(hologramsSet).toBeDefined();
        expect(hologramsSet[storedHologramSoul]).toBe(true);

        // 4. Delete the hologram
        await holoSphere.delete(testHolon, 'otherLens', 'hologram-tracker-2');
        await waitForGun(500); // Wait for delete and tracking update

        // 5. Fetch the _holograms set again
        hologramsSet = await new Promise(resolve => targetNodeRef.get('_holograms').once(resolve));

        // 6. Verify the hologram's soul is no longer in the _holograms set
        expect(hologramsSet).toBeDefined();
        // Check that the key has been nulled out by Gun
        expect(hologramsSet[storedHologramSoul]).toBeNull();
        // Optionally, check that the key is not present after filtering metadata
        const hologramKeys = Object.keys(hologramsSet).filter(k => k !== '_');
        expect(hologramKeys).not.toContain(storedHologramSoul);
    });
    // --- End tests for _holograms tracking ---

});
