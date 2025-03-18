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
await holoSphere.federate('space1', 'space2');

// Private federation (with passwords)
await holoSphere.federate('space1', 'space2', 'password1', 'password2');
```

### Setting Up Bidirectional Notification (Important!)

After creating a federation, you need to set up the notification settings for proper bidirectional data propagation:

```javascript
// 1. Get federation settings for first space
const fedSettings1 = await holoSphere.getGlobal('federation', 'space1');
if (fedSettings1) {
  // 2. Configure notify settings
  fedSettings1.notify = fedSettings1.notify || [];
  if (!fedSettings1.notify.includes('space2')) {
    fedSettings1.notify.push('space2');
  }
  // 3. Save updated settings
  await holoSphere.putGlobal('federation', fedSettings1);
}

// Repeat for the second space
const fedSettings2 = await holoSphere.getGlobal('federation', 'space2');
if (fedSettings2) {
  fedSettings2.notify = fedSettings2.notify || [];
  if (!fedSettings2.notify.includes('space1')) {
    fedSettings2.notify.push('space1');
  }
  await holoSphere.putGlobal('federation', fedSettings2);
}
```

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

To propagate data to all federated spaces:

```javascript
const data = { id: 'item1', value: 42 };

// 1. Store data locally first
await holoSphere.put('space1', 'items', data);

// 2. Explicitly propagate to federated spaces
await holoSphere.propagateToFederation('space1', 'items', data);

// 3. (Optional) Add a short delay to ensure propagation completes
await new Promise(resolve => setTimeout(resolve, 1000));
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
    
    // Step 1: Create federation
    await holoSphere.federate(space1, space2);
    
    // Step 2: Set up bidirectional notify settings (critical!)
    const fedSettings1 = await holoSphere.getGlobal('federation', space1);
    if (fedSettings1) {
      fedSettings1.notify = fedSettings1.notify || [];
      if (!fedSettings1.notify.includes(space2)) {
        fedSettings1.notify.push(space2);
        await holoSphere.putGlobal('federation', fedSettings1);
      }
    }
    
    const fedSettings2 = await holoSphere.getGlobal('federation', space2);
    if (fedSettings2) {
      fedSettings2.notify = fedSettings2.notify || [];
      if (!fedSettings2.notify.includes(space1)) {
        fedSettings2.notify.push(space1);
        await holoSphere.putGlobal('federation', fedSettings2);
      }
    }
    
    // Step 3: Verify federation is set up properly
    const updatedFedInfo = await holoSphere.getFederation(space1);
    console.log(`Federation info for ${space1}:`, updatedFedInfo);
    
    // Step 4: Store data in space1
    const item = { 
      id: 'item1', 
      title: 'Federation Test', 
      value: 42 
    };
    await holoSphere.put(space1, 'items', item);
    
    // Step 5: Propagate to federation
    await holoSphere.propagateToFederation(space1, 'items', item);
    
    // Step 6: Allow time for propagation
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 7: Access data from both spaces
    const itemFromSpace1 = await holoSphere.get(space1, 'items', 'item1');
    console.log('Item from space1:', itemFromSpace1);
    
    // Step 8: Access federated data
    // Method 1: Using getFederated
    const federatedData = await holoSphere.getFederated(space2, 'items');
    const itemFromFederation = federatedData.find(item => item.id === 'item1');
    console.log('Item from federation:', itemFromFederation);
    
    // Method 2: Direct access (if propagation worked correctly)
    const directAccess = await holoSphere.get(space2, 'items', 'item1');
    console.log('Direct access from space2:', directAccess);
    
    // Step 9: Clean up
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

1. **Missing Notify Settings**: The most common issue is not properly configuring notify settings. Always ensure both spaces have each other in their notify arrays.

2. **No Explicit Propagation**: Data doesn't automatically propagate between spaces. You must explicitly call `propagateToFederation()` after storing data.

3. **Authentication Errors**: When working with private federations, ensure passwords are correct and consistent.

4. **Timing Issues**: Data propagation is asynchronous. Add small delays (500-1000ms) between operations to allow propagation to complete.

5. **Missing Federation Metadata**: After propagation, federated items should have a `federation` property containing the origin space and timestamp.

### Best Practices

1. **Verify Federation Setup**: After creating a federation, always check the federation info to ensure it includes both the federation relationship and notify settings.

2. **Error Handling**: Wrap federation operations in try/catch blocks and handle errors gracefully.

3. **Bidirectional Setup**: For proper data sharing, both spaces need notify settings pointing to each other.

4. **Propagation Timing**: Allow sufficient time for propagation operations to complete before attempting to access data.

5. **Cleanup**: Always close the HoloSphere instance when done to prevent resource leaks. 