# HoloSphere Federation

HoloSphere's federation system allows different holons (spaces) to share and access data from each other. Federation creates a relationship between spaces that enables data propagation and cross-space access.

## Key Concepts

- **Federation Relationship**: A connection between two spaces that allows data to flow between them.
- **Soul References**: Lightweight references that point to data in its original location (single source of truth).
- **Automatic Propagation**: Data is automatically propagated to federated spaces when adding new content.
- **Bidirectional Federation**: By default, federation is set up to allow data flow in both directions.

## Automatic Federation System

The HoloSphere federation system is designed to bye simple and automatic:

1. **Automatic Propagation**: When you store data using `put()`, it automatically propagates to federated spaces.
2. **Soul References**: By default, references (not duplicated data) are stored in federated spaces.
3. **Transparent Resolution**: When retrieving data, references are automatically resolved to the original data.
4. **Single Source of Truth**: Changes to the original data are immediately reflected when accessed through references.

## Creating Federation

Create federation relationships between spaces:

```javascript
// Create bidirectional federation (default)
await holoSphere.federate('space1', 'space2');

// Create one-way federation (space1 can see space2's data, but not vice versa)
await holoSphere.federate('space1', 'space2', null, null, false);
```

## Storing and Propagating Data

Data is automatically propagated to federated spaces when using `put()`:

```javascript
const data = {
  id: 'item1',
  title: 'Federation Example',
  value: 42
};

// Store data in space1 and automatically propagate to federated spaces
await holoSphere.put('space1', 'items', data);
```

If needed, you can disable automatic propagation:

```javascript
// Store data without automatic propagation
await holoSphere.put('space1', 'items', data, null, {
  autoPropagate: false
});
```

## Accessing Federated Data

### Direct Retrieval

You can access data directly from any space:

```javascript
// Retrieve data from space2 (will resolve reference if it's a reference)
const data = await holoSphere.get('space2', 'items', 'item1');
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

## Hierarchical Data with Federation (Upcast)

The `upcastWithFederation` method creates a hierarchical structure using federation:

```javascript
// Upcast content from a high-resolution holon to parent holons
await holoSphere.upcastWithFederation(highResHolon, 'items', data);
```

This creates a federation relationship between each child and parent holon, storing soul references in the parent holons instead of duplicating the data.

## Advanced Options

### Configuring Propagation

You can customize how data is propagated:

```javascript
// Store data with custom propagation options
await holoSphere.put('space1', 'items', data, null, {
  propagationOptions: {
    useReferences: false,  // Store full copies instead of references
    targetSpaces: ['space3', 'space4']  // Only propagate to specific spaces
  }
});
```

### Removing Federation

```javascript
// Remove federation relationship
await holoSphere.unfederate('space1', 'space2');
```

## Federation and Soul References

HoloSphere uses a simplified reference system based on soul paths:

1. A reference contains only an `id` and a `soul` property
2. The soul path is in the format: `appname/holon/lens/key`
3. When resolving a reference, HoloSphere follows the soul path to retrieve the original data

This lightweight approach reduces data duplication while maintaining a single source of truth.

## Complete Example

Here's a complete example showing the proper way to set up and use federation:

```javascript
import HoloSphere from './holosphere.js';

async function federationExample() {
  const holoSphere = new HoloSphere('example-app');
  
  try {
    const space1 = 'public-space1';
    const space2 = 'public-space2';
    
    // Step 1: Create federation with automatic bidirectional notify settings
    await holoSphere.federate(space1, space2);
    
    // Step 2: Verify federation is set up properly
    const updatedFedInfo = await holoSphere.getFederation(space1);
    console.log(`Federation info for ${space1}:`, updatedFedInfo);
    // Should include: federation: ['space2'], notify: ['space2']
    
    // Step 3: Store data in space1 with automatic propagation
    const item = { 
      id: 'item1', 
      title: 'Federation Test', 
      value: 42 
    };
    
    // Store with auto-propagation
    await holoSphere.put(space1, 'items', item, null, {
      autoPropagate: true
    });
    
    // Step 4: Allow time for propagation
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 5: Access data from both spaces
    const itemFromSpace1 = await holoSphere.get(space1, 'items', 'item1');
    console.log('Item from space1:', itemFromSpace1);
    
    // Step 6: Access federated data
    // Method 1: Using getFederated
    const federatedData = await holoSphere.getFederated(space2, 'items');
    const itemFromFederation = federatedData.find(item => item.id === 'item1');
    console.log('Item from federation:', itemFromFederation);
    
    // Method 2: Direct access (if propagation worked correctly)
    const directAccess = await holoSphere.get(space2, 'items', 'item1');
    console.log('Direct access from space2:', directAccess);
    
    // Step 7: Update item with automatic propagation
    const updatedItem = {
      ...item,
      value: 100,
      updated: true
    };
    
    await holoSphere.put(space1, 'items', updatedItem, null, {
      autoPropagate: true
    });
    
    // Allow time for propagation
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Verify update was propagated
    const updatedDirectAccess = await holoSphere.get(space2, 'items', 'item1');
    console.log('Updated item in space2:', updatedDirectAccess);
    
    // Step 8: Clean up
    await holoSphere.unfederate(space1, space2);
  } finally {
    // Always close the HoloSphere instance
    await holoSphere.close();
  }
}

federationExample().catch(console.error);
```

## Running the Tests

HoloSphere includes test scripts to verify federation functionality:

### Public Federation Tests

Run the public federation tests with:

```bash
node test-federation.js
```

This tests:
- Creating public federations
- Storing and retrieving data
- Propagating data to federated spaces
- Subscribing to federation changes
- Removing federations

## Troubleshooting

### Common Issues

1. **One-way Federation**: If you need a one-way federation (data should only flow in one direction), set `bidirectional=false` when calling `federate()`.

2. **Data Propagation**: There are two ways to propagate data:
   - **Automatic**: Set `autoPropagate: true` in the `put()` options (simplest approach)
   - **Manual**: Explicitly call `propagate()` after storing data

3. **Authentication Errors**: When working with private federations, ensure passwords are correct and consistent.

4. **Timing Issues**: Data propagation is asynchronous. Add small delays (500-1000ms) between operations to allow propagation to complete.

5. **Missing Federation Metadata**: After propagation, federated items should have a `federation` property containing the origin space and timestamp.

### Best Practices

1. **Verify Federation Setup**: After creating a federation, always check the federation info to ensure it includes both the federation relationship and notify settings.

2. **Error Handling**: Wrap federation operations in try/catch blocks and handle errors gracefully.

3. **Choose the Right Propagation Method**: 
   - Use automatic propagation for simplicity and to avoid forgetting to propagate
   - Use manual propagation for more control, especially when you need to propagate only specific items

4. **Propagation Timing**: Allow sufficient time for propagation operations to complete before attempting to access data.

5. **Cleanup**: Always close the HoloSphere instance when done to prevent resource leaks. 