import HoloSphere from '../holosphere.js';
import { jest } from '@jest/globals';

// Increase the default test timeout
jest.setTimeout(30000);

describe('Subscription Tests', () => {
  let holosphere;
  let testAppName; // Make app name dynamic
  const testHolonBase = 'test_subscription_holon';
  const testLens = 'items';
  let testHolon; // Make holon dynamic
  
  beforeEach(async () => {
    // Create a fresh HoloSphere instance with unique names for each test
    testAppName = `testApp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    testHolon = `${testHolonBase}_${Date.now()}`;
    holosphere = new HoloSphere(testAppName, false);
    // Add a small delay after initialization
    await new Promise(resolve => setTimeout(resolve, 100));
  });
  
  afterEach(async () => {
    // Clean up resources and potentially test data
    try {
      if (holosphere) {
        // Attempt to delete data created in the test holon/lenses
        try {
           await holosphere.deleteAll(testHolon, testLens);
           await holosphere.deleteAll(testHolon, 'differentLens');
           // Wait a bit for deletes to process
           await new Promise(resolve => setTimeout(resolve, 200));
        } catch (deleteError) {
            console.warn(`Error during test cleanup deleteAll:`, deleteError);
        }
        await holosphere.close();
      }
    } catch (error) {
      console.warn('Error during afterEach cleanup:', error);
    }
    // jest.clearAllMocks(); // Not needed if not using jest.fn()
  });
  
  test('should return a synchronous { unsubscribe } object (not a Promise)', async () => {
    // Callers shouldn't need `await` to get their cleanup handle, and
    // `subscribe` must not be Promise-shaped — both styles produce the
    // same value, but the sync return lets components write
    // `const sub = holosphere.subscribe(...); onDestroy(() => sub.unsubscribe())`
    // without a stale `Promise<...>` slot.
    function noop() {}
    const sub = holosphere.subscribe(testHolon, testLens, noop);

    expect(sub).toBeDefined();
    expect(typeof sub).toBe('object');
    // Must not be a Promise — guards against accidental re-introduction of `async`.
    expect(typeof sub.then).not.toBe('function');
    expect(typeof sub.unsubscribe).toBe('function');

    // `await` on a non-Promise still works (resolves to the value), so
    // existing `await holosphere.subscribe(...)` call sites stay correct.
    const subAwaited = await sub;
    expect(subAwaited).toBe(sub);

    sub.unsubscribe();
    expect(Object.keys(holosphere.subscriptions).length).toBe(0);
  });

  test('subscribeGlobal should also return synchronously', () => {
    function noop() {}
    const sub = holosphere.subscribeGlobal('test_global_table', noop);
    expect(sub).toBeDefined();
    expect(typeof sub.then).not.toBe('function');
    expect(typeof sub.unsubscribe).toBe('function');
    sub.unsubscribe();
  });

  test('should properly clean up subscription when unsubscribing', async () => {
    // Create test data
    const testData = {
      id: 'test-item',
      value: 'Test value'
    };
    
    // Create a mock callback function
    function mockCallback (data) {
      console.log('Callback received:', data);
    }
    
    // Set up subscription
    const subscription = await holosphere.subscribe(testHolon, testLens, mockCallback);
    
    // Verify subscription was created and stored
    expect(Object.keys(holosphere.subscriptions).length).toBe(1);
    
    // Get the subscription ID (should be the only key in the subscriptions object)
    const subscriptionId = Object.keys(holosphere.subscriptions)[0];
    
    // Verify the subscription object has the expected structure
    expect(holosphere.subscriptions[subscriptionId]).toBeDefined();
    expect(holosphere.subscriptions[subscriptionId].holon).toBe(testHolon);
    expect(holosphere.subscriptions[subscriptionId].lens).toBe(testLens);
    expect(holosphere.subscriptions[subscriptionId].callback).toBe(mockCallback);
    expect(holosphere.subscriptions[subscriptionId].backendSub).toBeDefined();
    
    // Now unsubscribe
    await subscription.unsubscribe();
    
    // Verify the subscription was properly cleaned up
    expect(Object.keys(holosphere.subscriptions).length).toBe(0);
    expect(holosphere.subscriptions[subscriptionId]).toBeUndefined();
  });
  
  test('should not receive updates after unsubscribing', async () => {
    // Create test data
    const testData = {
      id: 'test-item-unsub',
      value: 'Initial value for unsub test'
    };

    // Use a flag to track callback execution
    let callbackFired = false;
    let receivedData = null;
    const dataCallback = (data) => {
      console.log('Callback received (unsub test):', data);
      callbackFired = true;
      receivedData = data;
    };

    // Set up subscription
    const subscription = await holosphere.subscribe(testHolon, testLens, dataCallback);

    // Store data to trigger subscription
    await holosphere.put(testHolon, testLens, testData);

    // Wait a bit for the subscription to trigger
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify callback was called
    expect(callbackFired).toBe(true);
    expect(receivedData).toEqual(expect.objectContaining(testData));

    // Reset the flag
    callbackFired = false;
    receivedData = null;

    // Unsubscribe
    await subscription.unsubscribe();

    // Store more data
    const newData = { ...testData, value: 'Updated value after unsub' };
    await holosphere.put(testHolon, testLens, newData);

    // Wait a bit to ensure no callbacks are triggered
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify callback was NOT called after unsubscribing
    expect(callbackFired).toBe(false);
    expect(receivedData).toBeNull();
  });
  
  test('should handle multiple subscriptions and unsubscriptions correctly', async () => {
    // Use flags to track callback execution
    let callback1Fired = false;
    let callback2Fired = false;
    let callback3Fired = false;
    let dataForCb1 = null;

    const cb1 = (data) => {
      console.log('Callback 1 received (multi test):', data);
      callback1Fired = true;
      dataForCb1 = data;
    };
    const cb2 = (data) => {
      console.log('Callback 2 received (multi test):', data);
      callback2Fired = true;
    };
    const cb3 = (data) => {
      console.log('Callback 3 received (multi test):', data);
      callback3Fired = true;
    };

    // Set up multiple subscriptions
    const subscription1 = await holosphere.subscribe(testHolon, testLens, cb1);
    const subscription2 = await holosphere.subscribe(testHolon, testLens, cb2);
    const subscription3 = await holosphere.subscribe(testHolon, 'differentLens', cb3);

    // Verify subscriptions were created
    expect(Object.keys(holosphere.subscriptions).length).toBe(3);

    // Unsubscribe from one subscription (subscription2)
    await subscription2.unsubscribe();

    // Verify only the correct subscription was removed
    expect(Object.keys(holosphere.subscriptions).length).toBe(2);

    // Create test data
    const testData = {
      id: 'test-item-multi',
      value: 'Test value for multi sub'
    };

    // Store data to trigger remaining subscriptions
    await holosphere.put(testHolon, testLens, testData);

    // Wait a bit for the subscription to trigger
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify only active callbacks were called
    expect(callback1Fired).toBe(true);
    expect(dataForCb1).toEqual(expect.objectContaining(testData));
    expect(callback2Fired).toBe(false); // This callback should not have fired
    expect(callback3Fired).toBe(false); // Different lens

    // Unsubscribe from all remaining subscriptions
    await subscription1.unsubscribe();
    await subscription3.unsubscribe();

    // Verify all subscriptions were removed
    expect(Object.keys(holosphere.subscriptions).length).toBe(0);
  });
  
  test('should clean up subscriptions when closing HoloSphere instance', async () => {
    // Use a flag - not strictly needed for assertion but good practice
    let callbackFired = false;
    const dataCallback = (data) => {
      console.log('Callback received (close test):', data);
      callbackFired = true;
    };

    // Set up subscription
    await holosphere.subscribe(testHolon, testLens, dataCallback);

    // Verify subscription was created
    expect(Object.keys(holosphere.subscriptions).length).toBe(1);
    
    // Close the HoloSphere instance
    await holosphere.close();
    
    // Verify subscriptions were cleaned up
    expect(Object.keys(holosphere.subscriptions).length).toBe(0);
  });
  
  test('should not leak memory after multiple subscription/unsubscription cycles', async () => {
    // Record initial memory usage
    const initialMemoryUsage = process.memoryUsage();
    
    // Create 100 subscriptions and immediately unsubscribe from them
    for (let i = 0; i < 100; i++) {
      // Create a proper callback function instead of a jest mock
      const mockCallback = (data) => {
        // Simple callback implementation
        console.log('Data received:', data);
      };
      
      const subscription = await holosphere.subscribe(testHolon, `${testLens}_${i}`, mockCallback);
      
      // Verify subscription was created
      expect(Object.keys(holosphere.subscriptions).length).toBe(1);
      
      // Unsubscribe
      await subscription.unsubscribe();
      
      // Verify subscription was removed
      expect(Object.keys(holosphere.subscriptions).length).toBe(0);
    }
    
    // Force garbage collection if possible (Node.js with --expose-gc flag)
    if (global.gc) {
      global.gc();
    }
    
    // Record final memory usage
    const finalMemoryUsage = process.memoryUsage();
    
    // Check if heap usage has significantly increased (more than 50MB would be suspicious)
    const heapIncrease = finalMemoryUsage.heapUsed - initialMemoryUsage.heapUsed;
    console.log(`Memory increase after subscriptions: ${heapIncrease / 1024 / 1024} MB`);
    
    // The exact threshold depends on your environment, but we expect it to be relatively small
    // This is a loose check, as garbage collection is unpredictable
    expect(heapIncrease).toBeLessThan(50 * 1024 * 1024); // Less than 50MB increase
    
    // Verify all subscriptions are cleaned up
    expect(Object.keys(holosphere.subscriptions).length).toBe(0);
  });
  
  test('should properly handle subscription to data with references', async () => {
    // Use simple holon names that don't require H3 formats
    const originHolon = `origin_${Date.now()}`;
    const referenceHolon = `reference_${Date.now()}`;
    
    // Create actual data to store in the origin holon
    const originalData = {
      id: `test-data-${Date.now()}`,
      title: 'Original Data',
      content: 'This is the original data content',
      timestamp: Date.now()
    };
    
    // Store the data in the origin holon
    await holosphere.put(originHolon, testLens, originalData);
    
    // Create a reference manually
    const soulPath = `${holosphere.appname}/${originHolon}/${testLens}/${originalData.id}`;
    const referenceData = {
      id: originalData.id,
      soul: soulPath
    };
    
    // Store the reference in the reference holon
    await holosphere.put(referenceHolon, testLens, referenceData);
    
    // Create a data collection to store received data
    const receivedData = [];
    
    // Create a real callback that stores the data
    const dataCallback = (data) => {
      if (data) {
        receivedData.push(data);
      }
    };
    
    // Subscribe to the reference holon
    const subscription = await holosphere.subscribe(referenceHolon, testLens, dataCallback);
    
    // Wait for subscription to receive data
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Update the original data
    const updatedData = {
      ...originalData,
      title: 'Updated Data',
      content: 'This content has been updated',
      timestamp: Date.now()
    };
    
    // Update the data in the original location
    await holosphere.put(originHolon, testLens, updatedData);
    
    // Wait for update to propagate through reference
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Unsubscribe to clean up
    await subscription.unsubscribe();
    
    // Verify the subscription was properly cleaned up
    expect(Object.keys(holosphere.subscriptions).length).toBe(0);
    
    // Verify that data was received
    console.log('Received data:', receivedData);
    expect(receivedData.length).toBeGreaterThan(0);
    
    // Get the data directly from the reference holon
    // This should be the reference object with a soul property
    const directData = await holosphere.get(referenceHolon, testLens, originalData.id);
    console.log('Direct data from reference holon:', directData);
    
    // Check if we got the reference back
    if (directData) {
      // The reference might be auto-resolved, in which case it carries the
      // canonical _hologram envelope instead of a bare soul property.
      if (directData._hologram) {
        expect(directData._hologram.isHologram).toBe(true);
        expect(directData._hologram.soul).toEqual(soulPath);
      } else if (directData.soul) {
        // Or it might be a direct unresolved reference
        expect(directData.soul).toBeTruthy();
        expect(directData.soul).toEqual(soulPath);
      }
    }
    
    // Try to resolve the reference to verify it works correctly
    const resolvedData = await holosphere.get(referenceHolon, testLens, originalData.id, null, { resolveHolograms: true });
    console.log('Resolved data:', resolvedData);
    
    // The resolved data should not be null
    expect(resolvedData).toBeTruthy();
    
    // If the data was properly resolved, it should match the updated data
    if (resolvedData && resolvedData.title) {
      expect(resolvedData.title).toBe(updatedData.title);
      expect(resolvedData.content).toBe(updatedData.content);
    }
    
    // Now try to get the original data directly
    const originalDataRetrieved = await holosphere.get(originHolon, testLens, originalData.id);
    console.log('Original data retrieved:', originalDataRetrieved);
    
    // Verify it was updated
    expect(originalDataRetrieved).toBeTruthy();
    if (originalDataRetrieved) {
      expect(originalDataRetrieved.title).toBe(updatedData.title);
      expect(originalDataRetrieved.content).toBe(updatedData.content);
    }
  });
}); 