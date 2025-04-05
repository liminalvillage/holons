import HoloSphere from '../holosphere.js';
import { jest } from '@jest/globals';

// Increase the default test timeout
jest.setTimeout(30000);

describe('Subscription Tests', () => {
  let holosphere;
  const testHolon = `test_subscription_${Date.now()}`;
  const testLens = 'items';
  
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
    expect(holosphere.subscriptions[subscriptionId].active).toBe(true);
    expect(holosphere.subscriptions[subscriptionId].holon).toBe(testHolon);
    expect(holosphere.subscriptions[subscriptionId].lens).toBe(testLens);
    expect(holosphere.subscriptions[subscriptionId].callback).toBe(mockCallback);
    expect(holosphere.subscriptions[subscriptionId].gunSubscription).toBeDefined();
    
    // Now unsubscribe
    await subscription.unsubscribe();
    
    // Verify the subscription was properly cleaned up
    expect(Object.keys(holosphere.subscriptions).length).toBe(0);
    expect(holosphere.subscriptions[subscriptionId]).toBeUndefined();
  });
  
  test('should not receive updates after unsubscribing', async () => {
    // Create test data
    const testData = {
      id: 'test-item',
      value: 'Test value'
    };
    
    // Create a mock callback function
    const mockCallback = jest.fn((data) => {
      console.log('Callback received:', data);
    });
    
    // Set up subscription
    const subscription = await holosphere.subscribe(testHolon, testLens, mockCallback);
    
    // Store data to trigger subscription
    await holosphere.put(testHolon, testLens, testData);
    
    // Wait a bit for the subscription to trigger
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Verify callback was called
    expect(mockCallback).toHaveBeenCalled();
    
    // Reset the mock
    mockCallback.mockClear();
    
    // Unsubscribe
    await subscription.unsubscribe();
    
    // Store more data
    const newData = { ...testData, value: 'Updated value' };
    await holosphere.put(testHolon, testLens, newData);
    
    // Wait a bit to ensure no callbacks are triggered
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Verify callback was NOT called after unsubscribing
    expect(mockCallback).not.toHaveBeenCalled();
  });
  
  test('should handle multiple subscriptions and unsubscriptions correctly', async () => {
    // Create mock callbacks
    const mockCallback1 = jest.fn((data) => {
      console.log('Callback 1 received:', data);
    });
    const mockCallback2 = jest.fn((data) => {
      console.log('Callback 2 received:', data);
    });
    const mockCallback3 = jest.fn((data) => {
      console.log('Callback 3 received:', data);
    });
    
    // Set up multiple subscriptions
    const subscription1 = await holosphere.subscribe(testHolon, testLens, mockCallback1);
    const subscription2 = await holosphere.subscribe(testHolon, testLens, mockCallback2);
    const subscription3 = await holosphere.subscribe(testHolon, 'differentLens', mockCallback3);
    
    // Verify subscriptions were created
    expect(Object.keys(holosphere.subscriptions).length).toBe(3);
    
    // Unsubscribe from one subscription
    await subscription2.unsubscribe();
    
    // Verify only the correct subscription was removed
    expect(Object.keys(holosphere.subscriptions).length).toBe(2);
    
    // Create test data
    const testData = {
      id: 'test-item',
      value: 'Test value'
    };
    
    // Store data to trigger remaining subscriptions
    await holosphere.put(testHolon, testLens, testData);
    
    // Wait a bit for the subscription to trigger
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Verify only active callbacks were called
    expect(mockCallback1).toHaveBeenCalled();
    expect(mockCallback2).not.toHaveBeenCalled();
    expect(mockCallback3).not.toHaveBeenCalled(); // Different lens
    
    // Unsubscribe from all remaining subscriptions
    await subscription1.unsubscribe();
    await subscription3.unsubscribe();
    
    // Verify all subscriptions were removed
    expect(Object.keys(holosphere.subscriptions).length).toBe(0);
  });
  
  test('should clean up subscriptions when closing HoloSphere instance', async () => {
    // Create mock callback
    const mockCallback = jest.fn((data) => {
      console.log('Callback received:', data);
    });
    
    // Set up subscription
    await holosphere.subscribe(testHolon, testLens, mockCallback);
    
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
      // The reference might be auto-resolved, in which case it will have a _federation property
      // instead of a direct soul property
      if (directData._federation) {
        expect(directData._federation).toBeTruthy();
        expect(directData._federation.soul).toEqual(soulPath);
        expect(directData._federation.resolved).toBe(true);
      } else if (directData.soul) {
        // Or it might be a direct reference
        expect(directData.soul).toBeTruthy();
        expect(directData.soul).toEqual(soulPath);
      }
    }
    
    // Try to resolve the reference to verify it works correctly
    const resolvedData = await holosphere.get(referenceHolon, testLens, originalData.id, null, { resolveReferences: true });
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