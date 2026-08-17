import { testSphere, cleanupTestEnv } from './helpers/testenv.js';

// KNOWN ENFORCE GAP: hologram/pointer writes are unsigned by design (the sign
// hook skips them), so enforce-mode reads drop them from the authorized view.
// This suite asserts raw hologram semantics and is skipped under
// HOLO_TEST_SIGNING=enforce until envelopes resolve through soul redirects.
const describeUnlessEnforce = process.env.HOLO_TEST_SIGNING === 'enforce' ? describe.skip : describe;
describeUnlessEnforce('Parent Propagation Tests', () => {
  let holosphere;
  const testPrefix = 'parent_prop_test_';

  afterAll(cleanupTestEnv, 30000);

  beforeEach(async () => {
    holosphere = await testSphere('parent-propagation-test');
  });

  afterEach(async () => {
    if (holosphere) {
      await holosphere.close();
    }
  });

  describe('propagate with parent propagation', () => {
    test('should propagate to parent hexagons when holon is valid H3 hexagon', async () => {
      // Create a valid H3 hexagon (resolution 7)
      const childHexagon = '87283472bffffff'; // Example H3 hexagon at resolution 7
      const parentHexagon = '86283472fffffff'; // Parent at resolution 6
      
      // Test data
      const testData = {
        id: 'test-item-1',
        title: 'Test Item',
        value: 42
      };

      // Propagate with parent propagation enabled
      const result = await holosphere.propagate(childHexagon, 'items', testData, {
        propagateToParents: true,
        maxParentLevels: 5
      });

      // Check that parent propagation was attempted
      expect(result.parentPropagation).toBeDefined();
      expect(result.parentPropagation.success).toBeGreaterThan(0);
      expect(result.parentPropagation.messages).toEqual(
        expect.arrayContaining([expect.stringContaining('parent hexagons to propagate to')])
      );

      // Allow time for propagation
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify data was propagated to parent hexagon (check for hologram, not resolved data)
      const parentHologram = await holosphere.get(parentHexagon, 'items', testData.id, null, { resolveHolograms: false });
      expect(parentHologram).toBeDefined();
      expect(parentHologram._federation.propagationType).toBe('parent');
    });

    test('should skip parent propagation for non-H3 hexagons', async () => {
      // Use a non-H3 hexagon identifier
      const nonHexagonHolon = 'not-a-hexagon';
      
      const testData = {
        id: 'test-item-2',
        title: 'Test Item',
        value: 42
      };

      const result = await holosphere.propagate(nonHexagonHolon, 'items', testData, {
        propagateToParents: true
      });

      expect(result.parentPropagation).toBeDefined();
      expect(result.parentPropagation.skipped).toBe(1);
      expect(result.parentPropagation.messages).toEqual(
        expect.arrayContaining([expect.stringContaining('not a valid H3 hexagon')])
      );
    });

    test('should respect maxParentLevels option', async () => {
      const childHexagon = '87283472bffffff'; // Resolution 7
      
      const testData = {
        id: 'test-item-3',
        title: 'Test Item',
        value: 42
      };

      const result = await holosphere.propagate(childHexagon, 'items', testData, {
        propagateToParents: true,
        maxParentLevels: 2 // Only propagate to 2 parent levels
      });

      expect(result.parentPropagation).toBeDefined();
      expect(result.parentPropagation.success).toBe(2); // Should propagate to 2 parent levels
    });

    test('should disable parent propagation when propagateToParents is false', async () => {
      const childHexagon = '87283472bffffff';
      
      const testData = {
        id: 'test-item-4',
        title: 'Test Item',
        value: 42
      };

      const result = await holosphere.propagate(childHexagon, 'items', testData, {
        propagateToParents: false
      });

      expect(result.parentPropagation).toBeDefined();
      expect(result.parentPropagation.success).toBe(0);
      expect(result.parentPropagation.skipped).toBe(0);
    });

    test('should include parent level information in federation metadata', async () => {
      const childHexagon = '87283472bffffff'; // Resolution 7
      const parentHexagon = '86283472fffffff'; // Resolution 6
      
      const testData = {
        id: 'test-item-5',
        title: 'Test Item',
        value: 42
      };

      // First, store the original data in the child hexagon. Disable auto-
      // propagation on this seed write: holograms are now opt-in, so a plain put
      // background-propagates a *full copy* to parents, which would race the
      // explicit hologram propagate below and clobber its `_federation`
      // metadata. This test exercises the explicit propagate() path only.
      await holosphere.put(childHexagon, 'items', testData, null, { autoPropagate: false });

      // Then propagate to parent
      await holosphere.propagate(childHexagon, 'items', testData, {
        propagateToParents: true,
        maxParentLevels: 1
      });

      // Allow time for propagation
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check parent data has correct metadata (check for hologram, not resolved data)
      const parentHologram = await holosphere.get(parentHexagon, 'items', testData.id, null, { resolveHolograms: false });
      expect(parentHologram).toBeDefined();
      expect(parentHologram._federation.propagationType).toBe('parent');
      expect(parentHologram._federation.parentLevel).toBe(1); // 1 level up from resolution 7 to 6
    });
  });
}); 