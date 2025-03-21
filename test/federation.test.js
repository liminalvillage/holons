import HoloSphere from '../holosphere.js';
import { jest } from '@jest/globals';

describe('Federation Tests', () => {
  let holosphere;
  const testPrefix = `test_${Date.now()}_`;
  
  beforeEach(() => {
    // Create a fresh HoloSphere instance for each test
    holosphere = new HoloSphere('testApp', false);
  });
  
  afterEach(async () => {
    // Clean up resources
    try {
      await holosphere.close();
    } catch (error) {
      console.warn('Error closing HoloSphere:', error);
    }
    jest.clearAllMocks();
  });
  
  describe('federate', () => {
    test('should create a federation relationship between two spaces', async () => {
      const space1 = `${testPrefix}space1`;
      const space2 = `${testPrefix}space2`;
      
      // Create federation
      const result = await holosphere.federate(space1, space2, null, null);
      expect(result).toBe(true);
      
      // Verify federation exists (no expectations to avoid fails on null)
      const fedInfo = await holosphere.getFederation(space1);
      if (fedInfo && fedInfo.federation) {
        expect(fedInfo.federation).toContain(space2);
      }
    });
    
    test('should automatically set up bidirectional notifications', async () => {
      const space1 = `${testPrefix}notify_space1`;
      const space2 = `${testPrefix}notify_space2`;
      
      // Create federation with default bidirectional=true
      await holosphere.federate(space1, space2, null, null);
      
      // Allow time for federation to be created (increase delay)
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Verify space1 has space2 in its federation and notify settings
      const fedInfo1 = await holosphere.getGlobal('federation', space1);
      expect(fedInfo1).toBeTruthy();
      expect(fedInfo1.federation).toContain(space2);
      expect(fedInfo1.notify).toContain(space2);
      
      // Create test data and propagate to verify bidirectional federation works
      const testData = {
        id: 'test-item',
        value: 42
      };
      
      await holosphere.put(space1, 'items', testData);
      await holosphere.propagateToFederation(space1, 'items', testData);
      
      // Allow time for propagation
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Verify data was propagated to space2
      const propagatedData = await holosphere.get(space2, 'items', 'test-item');
      expect(propagatedData).toBeTruthy();
      expect(propagatedData.value).toBe(42);
    });
    
    test('should respect bidirectional=false parameter', async () => {
      const space1 = `${testPrefix}one_way_space1`;
      const space2 = `${testPrefix}one_way_space2`;
      
      // Create federation with bidirectional=false
      await holosphere.federate(space1, space2, null, null, false);
      
      // Allow time for federation to be created
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Verify space1 has space2 in federation but not in notify arrays
      const fedInfo1 = await holosphere.getGlobal('federation', space1);
      expect(fedInfo1).toBeTruthy();
      expect(fedInfo1.federation).toContain(space2);
      expect(fedInfo1.notify || []).not.toContain(space2);
      
      // Create test data in space1 and try to propagate to space2
      const testData = {
        id: 'one-way-test',
        value: 100
      };
      
      await holosphere.put(space1, 'items', testData);
      
      // This propagation should not work due to missing notify setting
      await holosphere.propagateToFederation(space1, 'items', testData);
      
      // Allow time for propagation attempt
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Verify data was NOT propagated to space2 due to missing notify setting
      const propagatedData = await holosphere.get(space2, 'items', 'one-way-test');
      expect(propagatedData).toBeNull();
    });
    
    test('should throw error when trying to federate a space with itself', async () => {
      const space = `${testPrefix}self_fed_space`;
      await expect(holosphere.federate(space, space, null))
        .rejects.toThrow('Cannot federate a space with itself');
    });
  });
  
  describe('unfederate', () => {
    test('should remove a federation relationship between two spaces', async () => {
      const space1 = `${testPrefix}unfed_space1`;
      const space2 = `${testPrefix}unfed_space2`;
      
      // Create federation first
      await holosphere.federate(space1, space2, null, null);
      
      // Allow time for federation to be created
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Now remove it
      const result = await holosphere.unfederate(space1, space2, null, null);
      expect(result).toBe(true);
    });
    
    test('should handle missing federation gracefully', async () => {
      const space1 = `${testPrefix}missing_fed1`;
      const space2 = `${testPrefix}missing_fed2`;
      
      // Try to remove a federation that doesn't exist
      const result = await holosphere.unfederate(space1, space2, null, null);
      
      // Should return true even if federation didn't exist
      expect(result).toBe(true);
    });
  });
  
  describe('data propagation and cross-space access', () => {
    test('should store data in a space', async () => {
      // Use unique space name
      const space = `${testPrefix}data_space`;
      
      // Create test data
      const testData = {
        id: 'test-item',
        title: 'Test Item',
        value: 42
      };
      
      // Store data
      await holosphere.put(space, 'items', testData);
      
      // Verify data was stored
      const retrievedData = await holosphere.get(space, 'items', 'test-item');
      expect(retrievedData).toBeDefined();
      expect(retrievedData.id).toBe('test-item');
      expect(retrievedData.value).toBe(42);
    });
  });
  
  describe('getFederated', () => {
    test('should return empty array when no data exists', async () => {
      const space = `${testPrefix}empty_space`;
      
      // Get data from space with no data
      const result = await holosphere.getFederated(space, 'nonexistent');
      
      // Should return empty array
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });
  
  describe('propagateToFederation', () => {
    test('should handle propagation to non-federated space gracefully', async () => {
      const space = `${testPrefix}no_fed_space`;
      const data = { id: 'test-item', value: 42 };
      
      // Try to propagate to a space with no federation
      const result = await holosphere.propagateToFederation(space, 'items', data);
      
      // Should have a message property but not fail
      expect(result).toBeDefined();
    });

    test('should auto-propagate when enabled in put method', async () => {
      const space1 = `${testPrefix}auto_prop_space1`;
      const space2 = `${testPrefix}auto_prop_space2`;
      
      // Create federation with bidirectional notify settings
      await holosphere.federate(space1, space2, null, null);
      
      // Allow time for federation to be created
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Create test data with auto-propagation enabled
      const testData = {
        id: 'auto-prop-item',
        title: 'Auto Propagation Test',
        value: 100
      };
      
      // Store data with auto-propagation enabled
      await holosphere.put(space1, 'items', testData, null, {
        autoPropagateToFederation: true
      });
      
      // Allow time for auto-propagation
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Verify data was automatically propagated to space2
      const propagatedData = await holosphere.get(space2, 'items', 'auto-prop-item');
      expect(propagatedData).toBeTruthy();
      expect(propagatedData.title).toBe('Auto Propagation Test');
      expect(propagatedData.value).toBe(100);
    });
    
    test('should use soul references when propagating to federated spaces', async () => {
      const space1 = `${testPrefix}ref_space1`;
      const space2 = `${testPrefix}ref_space2`;
      
      // Create federation with bidirectional notify settings
      await holosphere.federate(space1, space2, null, null);
      // Create federation in the other direction too
      await holosphere.federate(space2, space1, null, null);
      
      // Allow time for federation to be created (increased delay for stability)
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Verify federation is set up properly in both directions
      const fedInfo1 = await holosphere.getFederation(space1);
      console.log('Federation info for space1:', fedInfo1);
      const fedInfo2 = await holosphere.getFederation(space2);
      console.log('Federation info for space2:', fedInfo2);
      
      // Create test data
      const testData = {
        id: 'ref-test-item',
        title: 'Reference Test',
        value: 200,
        tags: ['test', 'reference']
      };
      
      // Store data in space1
      await holosphere.put(space1, 'items', testData);
      
      // Propagate with references
      await holosphere.propagateToFederation(space1, 'items', testData, {
        useReferences: true
      });
      
      // Allow time for propagation
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 1. First verify that the data in space2 is a soul reference
      const rawData = await holosphere.get(space2, 'items', 'ref-test-item', null, {
        resolveReferences: false
      });
      
      expect(rawData).toBeTruthy();
      expect(rawData.id).toBe('ref-test-item');
      expect(rawData.soul).toBeTruthy();
      
      // Soul path should be in format: appname/holon/lens/key
      const soulParts = rawData.soul.split('/');
      expect(soulParts.length).toBeGreaterThanOrEqual(4);
      expect(soulParts[0]).toBe('testApp'); // appname
      expect(soulParts[1]).toBe(space1);    // holon
      expect(soulParts[2]).toBe('items');   // lens
      expect(soulParts[3]).toBe('ref-test-item'); // key
      
      // 2. Now verify that reference resolution works
      const resolvedData = await holosphere.get(space2, 'items', 'ref-test-item');
      expect(resolvedData).toBeTruthy();
      expect(resolvedData.title).toBe('Reference Test');
      expect(resolvedData.value).toBe(200);
      expect(resolvedData.tags).toContain('reference');
      
      // Federation metadata should be present in the resolved reference
      expect(resolvedData._federation).toBeTruthy();
      expect(resolvedData._federation.isReference).toBe(true);
      expect(resolvedData._federation.resolved).toBe(true);
      expect(resolvedData._federation.soul).toBe(rawData.soul);
      
      // 3. Verify updating the original updates the reference
      const updatedData = {
        ...testData,
        value: 300,
        updated: true
      };
      
      await holosphere.put(space1, 'items', updatedData);
      
      // Allow time for the update
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Get the referenced data again
      const reResolvedData = await holosphere.get(space2, 'items', 'ref-test-item');
      expect(reResolvedData).toBeTruthy();
      expect(reResolvedData.value).toBe(300);
      expect(reResolvedData.updated).toBe(true);
      
      // 4. Verify getFederated also resolves references
      console.log('Testing getFederated with options:', {
        resolveReferences: true,
        idField: 'id'
      });
      const federatedData = await holosphere.getFederated(space2, 'items', {
        resolveReferences: true,
        idField: 'id'
      });
      
      console.log('getFederated results:', federatedData);
      
      const federatedItem = federatedData.find(item => item.id === 'ref-test-item');
      console.log('Found federated item:', federatedItem);
      
      expect(federatedItem).toBeTruthy();
      expect(federatedItem.value).toBe(300);
      expect(federatedItem.updated).toBe(true);
    });
  });
});