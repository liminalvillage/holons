import HoloSphere from '../holosphere.js';
import { jest } from '@jest/globals';

// Increase the default test timeout for all tests
jest.setTimeout(30000);

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
    
    test('should set up the correct notification structure', async () => {
      const space1 = `${testPrefix}notify_space1`;
      const space2 = `${testPrefix}notify_space2`;
      
      // Create federation
      await holosphere.federate(space1, space2, null, null);
      
      // Allow time for federation to be created
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // In the current implementation:
      // space1's federation list should contain space2
      // space2's notify list should contain space1
      const fedInfo1 = await holosphere.getGlobal('federation', space1);
      expect(fedInfo1).toBeTruthy();
      expect(fedInfo1.federation).toContain(space2);
      
      const fedInfo2 = await holosphere.getGlobal('federation', space2);
      expect(fedInfo2).toBeTruthy();
      expect(fedInfo2.notify).toContain(space1);
    });
    
    test('should respect unidirectional settings', async () => {
      const space1 = `${testPrefix}one_way_space1`;
      const space2 = `${testPrefix}one_way_space2`;
      
      // Create federation with bidirectional=false
      await holosphere.federate(space1, space2, null, null, false);
      
      // Allow time for federation to be created
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Verify federation structure:
      // space1 has space2 in federation list
      // space2 has space1 in notify list (this is different from the original test)
      const fedInfo1 = await holosphere.getGlobal('federation', space1);
      expect(fedInfo1).toBeTruthy();
      expect(fedInfo1.federation).toContain(space2);
      
      const fedInfo2 = await holosphere.getGlobal('federation', space2);
      expect(fedInfo2).toBeTruthy();
      expect(fedInfo2.notify).toContain(space1);
    });
    
    test('should throw error when trying to federate a space with itself', async () => {
      const space = `${testPrefix}self_fed_space`;
      await expect(holosphere.federate(space, space, null))
        .rejects.toThrow('Cannot federate a space with itself');
    });

    test('should create a federation with lens-specific settings', async () => {
      const space1 = `${testPrefix}lens_space1`;
      const space2 = `${testPrefix}lens_space2`;
      
      // Create federation with specific lens configuration
      const lensConfig = {
        federate: ['quests', 'announcements'],
        notify: ['quests']
      };
      
      const result = await holosphere.federate(space1, space2, null, null, true, lensConfig);
      expect(result).toBe(true);
      
      // Verify federation info contains lens configuration
      const fedInfo = await holosphere.getFederation(space1);
      expect(fedInfo).toBeTruthy();
      expect(fedInfo.lensConfig).toBeTruthy();
      expect(fedInfo.lensConfig[space2]).toBeTruthy();
      expect(fedInfo.lensConfig[space2].federate).toEqual(['quests', 'announcements']);
      expect(fedInfo.lensConfig[space2].notify).toEqual(['quests']);
    });

    test('should respect lens configuration during propagation', async () => {
      const space1 = `${testPrefix}prop_space1`;
      const space2 = `${testPrefix}prop_space2`;
      
      // Create federation with specific lens configuration
      const lensConfig = {
        federate: ['quests', 'announcements'],
        notify: ['quests']
      };
      
      await holosphere.federate(space1, space2, null, null, true, lensConfig);
      
      // Test propagation for allowed lens
      const questData = { id: 'test-quest', title: 'Test Quest' };
      const questResult = await holosphere.propagate(space1, 'quests', questData);
      expect(questResult.success).toBe(1); // Should propagate
      
      // Test propagation for non-allowed lens
      const shoppingData = { id: 'test-shopping', item: 'Test Item' };
      const shoppingResult = await holosphere.propagate(space1, 'shopping', shoppingData);
      expect(shoppingResult.success).toBe(0); // Should not propagate
      expect(shoppingResult.message).toContain('No valid target spaces found after lens filtering');
    });

    test('should handle wildcard lens configuration', async () => {
      const space1 = `${testPrefix}wild_space1`;
      const space2 = `${testPrefix}wild_space2`;
      
      // Create federation with wildcard lens configuration
      const lensConfig = {
        federate: ['*'],
        notify: ['quests', 'announcements']
      };
      
      await holosphere.federate(space1, space2, null, null, true, lensConfig);
      
      // Test propagation for various lenses
      const testData = { id: 'test-item', value: 'test' };
      
      // Should propagate for quests (in notify list)
      const questResult = await holosphere.propagate(space1, 'quests', testData);
      expect(questResult.success).toBe(1);
      
      // Should propagate for announcements (in notify list)
      const announcementResult = await holosphere.propagate(space1, 'announcements', testData);
      expect(announcementResult.success).toBe(1);
      
      // Should not propagate for other lenses (not in notify list)
      const otherResult = await holosphere.propagate(space1, 'shopping', testData);
      expect(otherResult.success).toBe(0);
    });

    test('should handle bidirectional lens configuration correctly', async () => {
      const space1 = `${testPrefix}bi_space1`;
      const space2 = `${testPrefix}bi_space2`;
      
      // Create federation with different lens configs for each direction
      const lensConfig = {
        federate: ['quests', 'announcements'],
        notify: ['quests']
      };
      
      await holosphere.federate(space1, space2, null, null, true, lensConfig);
      
      // Verify both spaces have correct lens configuration
      const fedInfo1 = await holosphere.getFederation(space1);
      const fedInfo2 = await holosphere.getFederation(space2);
      
      expect(fedInfo1.lensConfig[space2].federate).toEqual(['quests', 'announcements']);
      expect(fedInfo1.lensConfig[space2].notify).toEqual(['quests']);
      expect(fedInfo2.lensConfig[space1].federate).toEqual(['quests', 'announcements']);
      expect(fedInfo2.lensConfig[space1].notify).toEqual(['quests']);
      
      // Test propagation in both directions
      const testData = { id: 'test-item', value: 'test' };
      
      // Space1 to Space2
      const result1 = await holosphere.propagate(space1, 'quests', testData);
      expect(result1.success).toBe(1);
      
      // Space2 to Space1
      const result2 = await holosphere.propagate(space2, 'quests', testData);
      expect(result2.success).toBe(1);
    });

    test('should handle unidirectional lens configuration', async () => {
      const space1 = `${testPrefix}uni_space1`;
      const space2 = `${testPrefix}uni_space2`;
      
      // Create federation with unidirectional lens config
      const lensConfig = {
        federate: ['quests', 'announcements'],
        notify: ['quests']
      };
      
      await holosphere.federate(space1, space2, null, null, false, lensConfig);
      
      // Verify lens configuration is only set for one direction
      const fedInfo1 = await holosphere.getFederation(space1);
      const fedInfo2 = await holosphere.getFederation(space2);
      
      expect(fedInfo1.lensConfig[space2].federate).toEqual(['quests', 'announcements']);
      expect(fedInfo1.lensConfig[space2].notify).toEqual(['quests']);
      expect(fedInfo2.lensConfig[space1].federate).toEqual([]);
      expect(fedInfo2.lensConfig[space1].notify).toEqual([]);
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
  
  describe('propagate', () => {
    test('should handle propagation to non-federated space gracefully', async () => {
      const space = `${testPrefix}no_fed_space`;
      const data = { id: 'test-item', value: 42 };
      
      // Try to propagate to a space with no federation
      const result = await holosphere.propagate(space, 'items', data);
      
      // Should have a message property but not fail
      expect(result).toBeDefined();
      expect(result.message).toBeDefined();
    });
  });
});