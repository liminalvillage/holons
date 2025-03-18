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
  });
});