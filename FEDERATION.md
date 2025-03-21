# HoloSphere Federation

This document explains how to use the federation functionality in HoloSphere, which allows different spaces to share data with each other.

## What is Federation?

Federation in HoloSphere allows different spaces (data stores) to connect and share data with each other. This enables:

- Creating networks of connected spaces
- Propagating data across these networks
- Subscribing to changes in federated spaces

Federation can be either public (no authentication required) or private (password-protected).

## Core Federation Functions

### Creating a Federation

To create a federation between two spaces:

```javascript
// Public federation (no passwords)
// By default, sets up bidirectional notifications automatically
await holoSphere.federate('space1', 'space2');

// Private federation (with passwords)
await holoSphere.federate('space1', 'space2', 'password1', 'password2');

// One-way federation (set bidirectional=false)
await holoSphere.federate('space1', 'space2', null, null, false);
```

The `federate` function now automatically sets up the bidirectional notify settings for proper data propagation. The optional `bidirectional` parameter (defaults to `true`) controls whether notifications are set up in both directions.

### Getting Federation Information

To retrieve information about a space's federation:

```javascript
// Public space
const fedInfo = await holoSphere.getFederation('space1');

// Private space
const fedInfo = await holoSphere.getFederation('space1', 'password1');
```

The returned object contains:
- `id`: The space ID
- `name`: The space name
- `federation`: Array of space IDs that this space is federated with
- `notify`: Array of space IDs that this space will propagate data to

### Propagating Data to Federated Spaces

There are two ways to propagate data to federated spaces:

#### Method 1: Manual Propagation

This is the original method where you explicitly call the propagation function:

```javascript
const data = { id: 'item1', value: 42 };

// 1. Store data locally first
await holoSphere.put('space1', 'items', data);

// 2. Explicitly propagate to federated spaces
await holoSphere.propagateToFederation('space1', 'items', data);

// 3. (Optional) Add a short delay to ensure propagation completes
await new Promise(resolve => setTimeout(resolve, 1000));
```

#### Method 2: Automatic Propagation

With this method, data is automatically propagated when stored:

```javascript
const data = { id: 'item1', value: 42 };

// Store data and automatically propagate to federated spaces
await holoSphere.put('space1', 'items', data, null, {
  autoPropagateToFederation: true
});

// Add a short delay to ensure propagation completes
await new Promise(resolve => setTimeout(resolve, 1000));
```

You can also customize the propagation options:

```javascript
await holoSphere.put('space1', 'items', data, null, {
  autoPropagateToFederation: true,
  propagationOptions: {
    targetSpaces: ['specific-space-id'],  // Only propagate to specific spaces
    addFederationMetadata: true  // Add federation metadata
  }
});
```

### Using References Instead of Data Duplication

By default, HoloSphere now supports a reference-based approach to federation, which creates links to original data rather than duplicating it:

```javascript
const data = { id: 'item1', value: 42 };

// Store data locally first
await holoSphere.put('space1', 'items', data);

// Propagate using references (default behavior)
await holoSphere.propagateToFederation('space1', 'items', data);

// To use the legacy approach with data duplication
await holoSphere.propagateToFederation('space1', 'items', data, {
  useReferences: false
});
```

References provide several key advantages:
- **Single Source of Truth**: Data exists in one place only, eliminating synchronization issues
- **Automatic Updates**: Changes to original data are immediately reflected when references are accessed
- **Reduced Storage**: Only stores a small reference object in federated spaces
- **Preserved Origin**: Clear tracking of where data originated from

When you access data through a reference, HoloSphere automatically resolves it to retrieve the original data. This is handled transparently when using `get()` or `getFederated()`:

```javascript
// Automatically resolves the reference to return the actual data
const resolvedData = await holoSphere.get('space2', 'items', 'item1');

// Access raw reference without resolving (if needed)
const rawReference = await holoSphere.get('space2', 'items', 'item1', null, {
  resolveReferences: false
});

// Federation metadata is preserved when references are resolved
console.log('Original source:', resolvedData.federation.origin);
```

### Accessing Data Across Federated Spaces

There are multiple ways to access data across federated spaces:

#### Method 1: Using getFederated (Recommended)

This retrieves data from both the local space and all federated spaces:

```javascript
// Get all items from local and federated spaces
const allItems = await holoSphere.getFederated('space2', 'items');

// Find a specific item by ID
const item1 = allItems.find(item => item.id === 'item1');
```

#### Method 2: Direct Access

After propagation, data may also be accessible directly:

```javascript
// Attempt to get item1 from space2 directly
const item1FromSpace2 = await holoSphere.get('space2', 'items', 'item1');
```

### Subscribing to Federation Changes

To subscribe to changes in a federation:

```javascript
// Subscribe
const subscription = await holoSphere.subscribeFederation('space1', null, (data, originSpace, lens) => {
  console.log(`Received data from ${originSpace}/${lens}:`, data);
});

// Later, unsubscribe
subscription.unsubscribe();
```

### Removing a Federation

To remove a federation between two spaces:

```javascript
// Public federation
await holoSphere.unfederate('space1', 'space2');

// Private federation
await holoSphere.unfederate('space1', 'space2', 'password1', 'password2');
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
      autoPropagateToFederation: true
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
      autoPropagateToFederation: true
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
   - **Automatic**: Set `autoPropagateToFederation: true` in the `put()` options (simplest approach)
   - **Manual**: Explicitly call `propagateToFederation()` after storing data

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