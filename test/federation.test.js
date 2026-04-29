import HoloSphere from '../holosphere.js';
import { jest } from '@jest/globals';

// Increase the default test timeout for all tests
jest.setTimeout(30000);

describe('Federation Tests', () => {
  let holosphere;
  const testPrefix = `test_${Date.now()}_`;

  beforeEach(() => {
    holosphere = new HoloSphere('testApp', false);
  });

  afterEach(async () => {
    try {
      await holosphere.close();
    } catch (error) {
      console.warn('Error closing HoloSphere:', error);
    }
    jest.clearAllMocks();
  });

  describe('federate', () => {
    test('records the partner in `federated` even with empty lens config', async () => {
      const space1 = `${testPrefix}fed_space1`;
      const space2 = `${testPrefix}fed_space2`;

      const result = await holosphere.federate(space1, space2, null, null);
      expect(result).toBe(true);

      const fedInfo = await holosphere.getFederation(space1);
      expect(fedInfo).toBeTruthy();
      expect(fedInfo.federated).toContain(space2);
      // No lens flow specified → not in inbound/outbound.
      expect(fedInfo.inbound).not.toContain(space2);
      expect(fedInfo.outbound).not.toContain(space2);
    });

    test('mirrors a directional federation onto the partner with inverted directions', async () => {
      const space1 = `${testPrefix}dir_space1`;
      const space2 = `${testPrefix}dir_space2`;

      // From space1's POV: receive `quests` from space2, send `offers` to space2.
      await holosphere.federate(space1, space2, null, null, true, {
        inbound: ['quests'],
        outbound: ['offers']
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      const fedInfo1 = await holosphere.getFederation(space1);
      expect(fedInfo1.federated).toContain(space2);
      expect(fedInfo1.inbound).toContain(space2);
      expect(fedInfo1.outbound).toContain(space2);
      expect(fedInfo1.lensConfig[space2].inbound).toEqual(['quests']);
      expect(fedInfo1.lensConfig[space2].outbound).toEqual(['offers']);

      // From space2's POV the directions invert: receives `offers` from space1, sends `quests` to space1.
      const fedInfo2 = await holosphere.getFederation(space2);
      expect(fedInfo2.federated).toContain(space1);
      expect(fedInfo2.inbound).toContain(space1);
      expect(fedInfo2.outbound).toContain(space1);
      expect(fedInfo2.lensConfig[space1].inbound).toEqual(['offers']);
      expect(fedInfo2.lensConfig[space1].outbound).toEqual(['quests']);
    });

    test('respects unidirectional setting (no mirror onto partner)', async () => {
      const space1 = `${testPrefix}uni_space1`;
      const space2 = `${testPrefix}uni_space2`;

      await holosphere.federate(space1, space2, null, null, false, {
        inbound: ['quests'],
        outbound: ['offers']
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      const fedInfo1 = await holosphere.getFederation(space1);
      expect(fedInfo1.federated).toContain(space2);
      expect(fedInfo1.lensConfig[space2].inbound).toEqual(['quests']);
      expect(fedInfo1.lensConfig[space2].outbound).toEqual(['offers']);

      // space2 has no record because we did not mirror.
      const fedInfo2 = await holosphere.getFederation(space2);
      expect(fedInfo2 == null || !(fedInfo2.federated || []).includes(space1)).toBe(true);
    });

    test('throws when trying to federate a space with itself', async () => {
      const space = `${testPrefix}self_fed_space`;
      await expect(holosphere.federate(space, space, null))
        .rejects.toThrow('Cannot federate a space with itself');
    });

    test('persists per-partner lens configuration', async () => {
      const space1 = `${testPrefix}lens_space1`;
      const space2 = `${testPrefix}lens_space2`;

      const lensConfig = {
        inbound: ['quests', 'announcements'],
        outbound: ['quests']
      };

      const result = await holosphere.federate(space1, space2, null, null, true, lensConfig);
      expect(result).toBe(true);

      const fedInfo = await holosphere.getFederation(space1);
      expect(fedInfo.lensConfig[space2].inbound).toEqual(['quests', 'announcements']);
      expect(fedInfo.lensConfig[space2].outbound).toEqual(['quests']);
    });

    test('only propagates lenses listed in outbound', async () => {
      const space1 = `${testPrefix}prop_space1`;
      const space2 = `${testPrefix}prop_space2`;

      await holosphere.federate(space1, space2, null, null, true, {
        inbound: ['quests', 'announcements'],
        outbound: ['quests']
      });

      const questData = { id: 'test-quest', title: 'Test Quest' };
      const questResult = await holosphere.propagate(space1, 'quests', questData);
      expect(questResult.success).toBe(1);

      const shoppingData = { id: 'test-shopping', item: 'Test Item' };
      const shoppingResult = await holosphere.propagate(space1, 'shopping', shoppingData);
      expect(shoppingResult.success).toBe(0);
      expect(shoppingResult.messages.some(msg =>
        msg.includes(`Propagation of lens 'shopping' to target space ${space2} skipped: lens not in 'outbound' configuration.`)
      )).toBe(true);
    });

    test('wildcard outbound propagates any lens', async () => {
      const space1 = `${testPrefix}wild_space1`;
      const space2 = `${testPrefix}wild_space2`;

      await holosphere.federate(space1, space2, null, null, true, {
        inbound: [],
        outbound: ['*']
      });

      const testData = { id: 'test-item', value: 'test' };

      const r1 = await holosphere.propagate(space1, 'quests', testData);
      expect(r1.success).toBe(1);

      const r2 = await holosphere.propagate(space1, 'shopping', testData);
      expect(r2.success).toBe(1);
    });
  });

  describe('unfederate', () => {
    test('removes the partner from federated/inbound/outbound and clears lens config', async () => {
      const space1 = `${testPrefix}unfed_space1`;
      const space2 = `${testPrefix}unfed_space2`;

      await holosphere.federate(space1, space2, null, null, true, {
        inbound: ['quests'], outbound: ['offers']
      });
      await new Promise(resolve => setTimeout(resolve, 500));

      const result = await holosphere.unfederate(space1, space2, null, null);
      expect(result).toBe(true);

      const fedInfo = await holosphere.getFederation(space1);
      expect(fedInfo.federated).not.toContain(space2);
      expect(fedInfo.inbound).not.toContain(space2);
      expect(fedInfo.outbound).not.toContain(space2);
      expect(fedInfo.lensConfig[space2]).toBeUndefined();
    });

    test('handles missing federation gracefully', async () => {
      const space1 = `${testPrefix}missing_fed1`;
      const space2 = `${testPrefix}missing_fed2`;
      const result = await holosphere.unfederate(space1, space2, null, null);
      expect(result).toBe(true);
    });
  });

  describe('data propagation and cross-space access', () => {
    test('stores data in a space', async () => {
      const space = `${testPrefix}data_space`;
      const testData = { id: 'test-item', title: 'Test Item', value: 42 };
      await holosphere.put(space, 'items', testData);

      const retrievedData = await holosphere.get(space, 'items', 'test-item');
      expect(retrievedData).toBeDefined();
      expect(retrievedData.id).toBe('test-item');
      expect(retrievedData.value).toBe(42);
    });
  });

  describe('getFederated', () => {
    test('returns empty array when no data exists', async () => {
      const space = `${testPrefix}empty_space`;
      const result = await holosphere.getFederated(space, 'nonexistent');
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });

  describe('propagate', () => {
    test('handles propagation to non-federated space gracefully', async () => {
      const space = `${testPrefix}no_fed_space`;
      const data = { id: 'test-item', value: 42 };
      const result = await holosphere.propagate(space, 'items', data);
      expect(result).toBeDefined();
      expect(result.messages).toBeDefined();
      expect(Array.isArray(result.messages)).toBe(true);
    });
  });

  describe('getFederatedConfig', () => {
    test('returns the inbound/outbound lens config for a federation link', async () => {
      const space1 = `${testPrefix}lens_config_space1`;
      const space2 = `${testPrefix}lens_config_space2`;
      const space3 = `${testPrefix}lens_config_space3`;

      const specificLensConfig = {
        inbound: ['books', 'movies'],
        outbound: ['books']
      };

      await holosphere.federate(space1, space2, null, null, true, specificLensConfig);
      await holosphere.federate(space1, space3, null, null, true, {});

      const cfg1to2 = await holosphere.getFederatedConfig(space1, space2);
      expect(cfg1to2).toEqual(specificLensConfig);

      const cfg1to3 = await holosphere.getFederatedConfig(space1, space3);
      expect(cfg1to3).not.toEqual(specificLensConfig);
      expect(cfg1to3).toEqual({ inbound: [], outbound: [] });

      const space4 = `${testPrefix}lens_config_space4`;
      const cfg1to4 = await holosphere.getFederatedConfig(space1, space4);
      expect(cfg1to4).toBeNull();
    });

    test('returns null when no federation info exists for the source space', async () => {
      const nonExistentSpace = `${testPrefix}non_existent_space`;
      const targetSpace = `${testPrefix}any_target_space`;
      const config = await holosphere.getFederatedConfig(nonExistentSpace, targetSpace);
      expect(config).toBeNull();
    });
  });
});
