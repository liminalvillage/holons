import HoloSphere from '../holosphere.js';

describe('Parent Propagation Tests', () => {
  let holosphere;
  const testPrefix = 'parent_prop_test_';

  beforeEach(() => {
    holosphere = new HoloSphere('parent-propagation-test');
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
        expect.arrayContaining([expect.stringContaining('No parent hexagons found')])
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

      // First, store the original data in the child hexagon
      await holosphere.put(childHexagon, 'items', testData);

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