import HoloSphere from '../holosphere.js';
import { jest } from '@jest/globals';

// Configure timeout
jest.setTimeout(30000); // 30 second timeout

// Setup
describe('HoloSphere Reference System', () => {
    let holoSphere;
    
    beforeEach(async () => {
        // Create a new HoloSphere instance for each test
        holoSphere = new HoloSphere('testApp');
    });
    
    afterEach(async () => {
        // Clean up after each test
        if (holoSphere) {
            await holoSphere.close();
            // Wait for connections to close
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    });
    
    test('should create and parse a reference correctly', async () => {
        // Test data
        const holon = 'testHolon';
        const lens = 'testLens';
        const data = {
            id: 'test-data-123',
            title: 'Test Data',
            content: 'This is test content'
        };
        
        // Create a reference
        const reference = holoSphere.createReference(holon, lens, data);
        
        // Validate reference structure
        expect(reference).toBeTruthy();
        expect(reference.id).toBe(data.id);
        expect(reference.soul).toBe(`testApp/${holon}/${lens}/${data.id}`);
        
        // Test soul path parsing
        const soulInfo = holoSphere.parseSoulPath(reference.soul);
        expect(soulInfo).toBeTruthy();
        expect(soulInfo.appname).toBe('testApp');
        expect(soulInfo.holon).toBe(holon);
        expect(soulInfo.lens).toBe(lens);
        expect(soulInfo.key).toBe(data.id);
    });
    
    test('should detect different types of references correctly', async () => {
        // Soul reference
        const soulReference = {
            id: 'test-data-123',
            soul: 'testApp/testHolon/testLens/test-data-123'
        };
        
        // Legacy federation reference
        const legacyReference = {
            id: 'test-data-456',
            _federation: {
                isReference: true,
                origin: 'originHolon',
                lens: 'originLens'
            }
        };
        
        // Regular data (not a reference)
        const regularData = {
            id: 'test-data-789',
            title: 'Regular Data',
            content: 'This is not a reference'
        };
        
        // Test reference detection
        expect(holoSphere.isReference(soulReference)).toBe(true);
        expect(holoSphere.isReference(legacyReference)).toBe(true);
        expect(holoSphere.isReference(regularData)).toBe(false);
        expect(holoSphere.isReference(null)).toBe(false);
        expect(holoSphere.isReference(undefined)).toBe(false);
        expect(holoSphere.isReference("not an object")).toBe(false);
    });
    
    test('should store and retrieve references properly', async () => {
        // Original data
        const originalData = {
            id: 'original-123',
            title: 'Original Data',
            content: 'This is the original content'
        };
        
        // Store original data
        await holoSphere.put('originHolon', 'testLens', originalData);
        
        // Create a reference to the original data
        const reference = holoSphere.createReference('originHolon', 'testLens', originalData);
        
        // Store the reference in a different holon
        await holoSphere.put('referenceHolon', 'testLens', reference);
        
        // Retrieve the reference with resolution enabled (default)
        const resolvedData = await holoSphere.get('referenceHolon', 'testLens', 'original-123');
        
        // Verify the original data is present
        expect(resolvedData).toBeTruthy();
        expect(resolvedData.title).toBe(originalData.title);
        expect(resolvedData.content).toBe(originalData.content);
        
        // Verify the federation metadata is present
        expect(resolvedData._federation).toBeTruthy();
        expect(resolvedData._federation.isReference).toBe(true);
        expect(resolvedData._federation.resolved).toBe(true);
        expect(resolvedData._federation.soul).toBe(reference.soul);
        expect(resolvedData._federation.timestamp).toBeGreaterThan(0);
        
        // Retrieve the reference without resolution
        const unresolvedData = await holoSphere.get('referenceHolon', 'testLens', 'original-123', null, { 
            resolveReferences: false 
        });
        
        // Verify we got the actual reference
        expect(unresolvedData).toBeTruthy();
        expect(unresolvedData.id).toBe('original-123');
        expect(unresolvedData.soul).toBe(reference.soul);
        expect(unresolvedData.title).toBeUndefined();
    });
    
    test('should update original data and have references reflect the changes', async () => {
        // Original data
        const originalData = {
            id: 'original-456',
            title: 'Original Data',
            content: 'This content will be updated'
        };
        
        // Store original data
        await holoSphere.put('originHolon', 'testLens', originalData);
        
        // Create a reference
        const reference = holoSphere.createReference('originHolon', 'testLens', originalData);
        
        // Store the reference in a different holon
        await holoSphere.put('referenceHolon', 'testLens', reference);
        
        // Update the original data
        const updatedData = {
            ...originalData,
            title: 'Updated Data',
            content: 'This content has been updated'
        };
        await holoSphere.put('originHolon', 'testLens', updatedData);
        
        // Retrieve the reference 
        const resolvedData = await holoSphere.get('referenceHolon', 'testLens', 'original-456');
        
        // Verify the reference resolves to the updated data
        expect(resolvedData).toBeTruthy();
        expect(resolvedData.title).toBe('Updated Data');
        expect(resolvedData.content).toBe('This content has been updated');
    });
    
    test('should create and use manual references across holons', async () => {
        // Original data to reference
        const originalData = {
            id: 'federated-123',
            title: 'Federated Data',
            content: 'This content should be referenced'
        };
        
        // Store original data
        await holoSphere.put('sourceHolon', 'testLens', originalData);
        
        // Create a reference to the original data
        const reference = holoSphere.createReference('sourceHolon', 'testLens', originalData);
        
        // Store reference in the target holon
        await holoSphere.put('targetHolon', 'testLens', reference);
        
        // Retrieve the reference with resolution
        const resolvedData = await holoSphere.get('targetHolon', 'testLens', 'federated-123');
        
        // Verify the reference was resolved to the original data
        expect(resolvedData).toBeTruthy();
        expect(resolvedData.title).toBe('Federated Data');
        expect(resolvedData.content).toBe('This content should be referenced');
        expect(resolvedData._federation).toBeTruthy();
        expect(resolvedData._federation.isReference).toBe(true);
        expect(resolvedData._federation.resolved).toBe(true);
        expect(resolvedData._federation.soul).toBe(reference.soul);
        
        // Update original data
        const updatedData = {
            ...originalData,
            title: 'Updated Data',
            content: 'This content has been updated'
        };
        await holoSphere.put('sourceHolon', 'testLens', updatedData);
        
        // Add a delay to ensure data is updated
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Retrieve the reference again
        const updatedResolvedData = await holoSphere.get('targetHolon', 'testLens', 'federated-123');
        
        // Verify the update was reflected via the reference
        expect(updatedResolvedData).toBeTruthy();
        expect(updatedResolvedData.title).toBe('Updated Data');
        expect(updatedResolvedData.content).toBe('This content has been updated');
    });
}); 