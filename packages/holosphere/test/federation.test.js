import { jest } from '@jest/globals';
import { testSphere, cleanupTestEnv } from './helpers/testenv.js';

// Increase the default test timeout for all tests
jest.setTimeout(30000);

describe('Federation Tests', () => {
  let holosphere;
  const testPrefix = `test_${Date.now()}_`;

  afterAll(cleanupTestEnv, 30000);

  beforeEach(() => {
    holosphere = testSphere('testApp');
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

    test('mirrors the removal onto the partner record (symmetry with federate)', async () => {
      const space1 = `${testPrefix}unfed_mirror1`;
      const space2 = `${testPrefix}unfed_mirror2`;

      await holosphere.federate(space1, space2, null, null, true, {
        inbound: ['quests'], outbound: ['offers']
      });
      await new Promise(resolve => setTimeout(resolve, 500));

      // federate() recorded the link on BOTH sides…
      const before = await holosphere.getFederation(space2);
      expect(before.federated).toContain(space1);

      await holosphere.unfederate(space1, space2, null, null);
      await new Promise(resolve => setTimeout(resolve, 500));

      // …so unfederate() must clean both sides too.
      const fedInfo2 = await holosphere.getFederation(space2);
      expect(fedInfo2.federated).not.toContain(space1);
      expect(fedInfo2.inbound).not.toContain(space1);
      expect(fedInfo2.outbound).not.toContain(space1);
      expect(fedInfo2.lensConfig[space1]).toBeUndefined();
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

    test('only pulls a partner lens we configured as inbound from that partner', async () => {
      const home = `${testPrefix}gf_home`;
      const partner = `${testPrefix}gf_partner`;

      // Home receives ONLY `quests` from the partner — `library` is not inbound,
      // even though the partner is a federation member (partner-level inbound).
      await holosphere.federate(home, partner, null, null, true, {
        inbound: ['quests'],
        outbound: []
      });

      // Partner holds items in both lenses.
      await holosphere.put(partner, 'quests', { id: 'q1', title: 'Partner quest' });
      await holosphere.put(partner, 'library', { id: 'l1', title: 'Partner book' });

      // Query partners only (no local) so we're asserting which partner spaces
      // each lens fans out to, not local hologram replication.
      const opts = { includeLocal: false, resolveReferences: false };

      // The inbound lens flows through, tagged with its source.
      const quests = await holosphere.getFederated(home, 'quests', opts);
      const q1 = quests.find(item => item && item.id === 'q1');
      expect(q1).toBeDefined();
      expect(q1._federation.origin).toBe(partner);

      // The lens we did NOT opt into must not leak, despite the partner being
      // in `inbound` at the partner level.
      const library = await holosphere.getFederated(home, 'library', opts);
      expect(library.some(item => item && item.id === 'l1')).toBe(false);
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

  describe('self-referential propagation guard', () => {
    // Regression: a bidirectional federation (A↔B) used to corrupt records.
    // A propagates quest q → B, which stores a hologram with soul pointing at
    // A. B also has A in its outbound, so the hologram echoes back: B forwards
    // it to A — and because the soul still points at A, A's own record gets
    // overwritten with a pointer to ITSELF. That self-hologram can never
    // resolve (get() logs "CIRCULAR … Breaking loop" forever). The guard must
    // skip any target the hologram's soul already points at.
    test('skips forwarding a received hologram back to its source (echo)', async () => {
      const A = `${testPrefix}echo_A`;
      const B = `${testPrefix}echo_B`;
      const APP = holosphere.appname;

      // B forwards `quests` to A (the back-edge of an A↔B federation).
      await holosphere.federate(B, A, null, null, true, {
        inbound: [],
        outbound: ['quests']
      });

      // The hologram B holds for q1 points at A's storage (A is the origin).
      const echoed = {
        id: 'q1',
        soul: `${APP}/${A}/quests/q1`,
        _federation: { origin: A, sourceLens: 'quests', originalId: 'q1' }
      };

      const result = await holosphere.propagate(B, 'quests', echoed);

      expect(result.success).toBe(0);
      expect(result.skipped).toBeGreaterThanOrEqual(1);
      expect(result.messages.some(m => m.includes('self-referential'))).toBe(true);

      // A's record must NOT have been clobbered with a self-pointer.
      const atA = await holosphere.gun.get(APP).get(A).get('quests').get('q1');
      // (No write happened, so nothing self-referential landed at A.)
      expect(atA && atA.soul === `${APP}/${A}/quests/q1`).toBeFalsy();
    });

    test('still forwards a hologram to a DIFFERENT third party', async () => {
      const A = `${testPrefix}fwd_A`;
      const B = `${testPrefix}fwd_B`;
      const C = `${testPrefix}fwd_C`;
      const APP = holosphere.appname;

      // A forwards `quests` to C.
      await holosphere.federate(A, C, null, null, true, {
        inbound: [],
        outbound: ['quests']
      });

      // A holds a hologram for q2 whose soul points at B (a third holon, not C).
      const fromB = {
        id: 'q2',
        soul: `${APP}/${B}/quests/q2`,
        _federation: { origin: B, sourceLens: 'quests', originalId: 'q2' }
      };

      const result = await holosphere.propagate(A, 'quests', fromB);

      // Soul points at B, target is C — not self-referential, so it propagates.
      expect(result.success).toBe(1);
      expect(result.skipped).toBe(0);
    });

    test('still forwards a holon\'s own fresh data to a partner', async () => {
      const A = `${testPrefix}fresh_A`;
      const B = `${testPrefix}fresh_B`;

      await holosphere.federate(A, B, null, null, true, {
        inbound: [],
        outbound: ['quests']
      });

      // Plain (non-hologram) data minted at A → hologram soul points at A,
      // target is B, so the guard must NOT skip it.
      const result = await holosphere.propagate(A, 'quests', { id: 'q3', title: 'Fresh' });

      expect(result.success).toBe(1);
      expect(result.skipped).toBe(0);
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
