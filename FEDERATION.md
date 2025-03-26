# HoloSphere Federation

HoloSphere's federation system allows different holons (spaces) to share and access data from each other. Federation creates a relationship between spaces that enables data propagation and cross-space access.

## Key Concepts

- **Federation Relationship**: A connection between two spaces that allows data to flow between them.
- **Soul References**: Lightweight references that point to data in its original location (single source of truth).
- **Notification Flow**: Data notifications flow from source spaces to target spaces that are in the notify list.
- **Source-Target Relationship**: Each federation sets up a source space (federation list) and a target space (notify list).

## Federation Data Flow

The HoloSphere federation system works with a clear source-target relationship:

1. **Federation List**: When space A federates with space B, space A adds B to its federation list.
2. **Notify List**: Space B adds space A to its notify list.
3. **Data Flow**: When space A changes, space B gets notified (but not vice versa unless bidirectional).

## Creating Federation

Create federation relationships between spaces:

```javascript
// Create federation between space1 and space2
await holoSphere.federate('space1', 'space2');

// This sets up:
// - space1.federation includes space2
// - space2.notify includes space1
```

The bidirectional parameter is largely unused in the current implementation since the federation system naturally sets up the correct notification flow. The default relationship allows space2 to be notified of changes in space1.

## Storing and Propagating Data

Data must be explicitly propagated to federated spaces:

```javascript
const data = {
  id: 'item1',
  title: 'Federation Example',
  value: 42
};

// Store data in space1
await holoSphere.put('space1', 'items', data);

// Propagate to federated spaces
await holoSphere.propagate('space1', 'items', data);
```

You can also enable automatic propagation in the `put()` method:

```javascript
// Store data and automatically propagate
await holoSphere.put('space1', 'items', data, null, {
  autoPropagate: true
});
```

## Accessing Federated Data

### Direct Retrieval

You can access data directly from any space:

```javascript
// Retrieve data from space2 (will resolve reference if it's a reference)
const data = await holoSphere.get('space2', 'items', 'item1', null, {
  resolveReferences: true  // Default is true
});
```

### Aggregate Federated Data

Use `getFederated()` to get data from multiple federated spaces:

```javascript
// Get combined data from the local space and all its federated spaces
const federatedData = await holoSphere.getFederated('space2', 'items', {
  resolveReferences: true,  // Default: true
  idField: 'id'             // Field to use as the unique identifier
});
```

## Soul References

HoloSphere uses a simplified reference system based on soul paths:

1. A reference contains only an `id` and a `soul` property
2. The soul path is in the format: `appname/holon/lens/key`
3. When resolving a reference, HoloSphere follows the soul path to retrieve the original data

By default, federation propagation uses references instead of duplicating data. This can be controlled:

```javascript
// Propagate with full data copy instead of references
await holoSphere.propagate('space1', 'items', data, {
  useReferences: false
});
```

## Removing Federation

```javascript
// Remove federation relationship
await holoSphere.unfederate('space1', 'space2');
```

## Complete Example

Here's a complete example showing the proper way to set up and use federation:

```javascript
import HoloSphere from './holosphere.js';

async function federationExample() {
  const holoSphere = new HoloSphere('example-app');
  
  try {
    const space1 = 'public-space1';
    const space2 = 'public-space2';
    
    // Step 1: Create federation relationship
    await holoSphere.federate(space1, space2);
    
    // Step 2: Verify federation is set up properly
    const fedInfo1 = await holoSphere.getFederation(space1);
    const fedInfo2 = await holoSphere.getFederation(space2);
    
    console.log(`Federation info for ${space1}:`, fedInfo1);
    // Should include: federation: ['space2']
    
    console.log(`Federation info for ${space2}:`, fedInfo2);
    // Should include: notify: ['space1']
    
    // Step 3: Store data in space1
    const item = { 
      id: 'item1', 
      title: 'Federation Test', 
      value: 42 
    };
    
    await holoSphere.put(space1, 'items', item);
    
    // Step 4: Propagate data to federated spaces
    await holoSphere.propagate(space1, 'items', item);
    
    // Allow time for propagation
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 5: Access data from space2 (resolves reference)
    const itemFromSpace2 = await holoSphere.get(space2, 'items', 'item1');
    console.log('Item from space2:', itemFromSpace2);
    
    // Step 6: Update item in space1
    const updatedItem = {
      ...item,
      value: 100,
      updated: true
    };
    
    await holoSphere.put(space1, 'items', updatedItem);
    
    // Since we're using soul references, the update is immediately visible
    // through the reference without needing to propagate again
    
    // Verify update is visible through the reference
    const updatedItemFromSpace2 = await holoSphere.get(space2, 'items', 'item1');
    console.log('Updated item from space2:', updatedItemFromSpace2);
    
    // Step 7: Clean up
    await holoSphere.unfederate(space1, space2);
  } finally {
    // Always close the HoloSphere instance
    await holoSphere.close();
  }
}

federationExample().catch(console.error);
```

## Troubleshooting

### Common Issues

1. **Federation Relationship**: Make sure to check both the federation list and notify list to understand data flow.

2. **Data Propagation**: If data isn't appearing in federated spaces, check:
   - The federation relationship was created correctly
   - The data was propagated explicitly or `autoPropagate` was set to `true`
   - The notify list includes the target space

3. **Reference Resolution**: If you're getting reference objects instead of the actual data:
   - Make sure `resolveReferences` is set to `true` (it's the default)
   - Check that the original data still exists at the referenced location

4. **Timing Issues**: Data propagation is asynchronous. Add small delays (500-1000ms) between operations to allow propagation to complete.

### Best Practices

1. **Verify Federation Structure**: After creating a federation, check both spaces to ensure:
   - Source space has the target in its federation list
   - Target space has the source in its notify list

2. **Explicit Propagation**: Unless you're using `autoPropagate`, always call `propagate()` explicitly after storing data that should be shared.

3. **Choose the Right Propagation Method**:
   - Use `useReferences: true` (default) to keep a single source of truth
   - Use `useReferences: false` only when you need independent copies

4. **Cleanup**: Always close the HoloSphere instance when done to prevent resource leaks. 