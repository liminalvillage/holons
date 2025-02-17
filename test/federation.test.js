import HoloSphere from '../holosphere.js';
import * as h3 from 'h3-js';
import { jest } from '@jest/globals';

// Set global timeout for all tests
jest.setTimeout(30000);

describe('Federation Operations', () => {
    const testAppName = 'test-app';
    const testHolon = 'test-holon';
    const testLens = 'test-lens';
    
    // Global HoloSphere instances
    let holoSphere; // Non-strict instance
    let strictHoloSphere; // Strict instance
    let space1, space2;

    beforeAll(async () => {
        // Create global instances
        holoSphere = new HoloSphere(testAppName, false);
        strictHoloSphere = new HoloSphere(testAppName, true);
        
        space1 = { spacename: 'space1', password: 'pass1' };
        space2 = { spacename: 'space2', password: 'pass2' };

        // Clean up any existing test spaces and federation data
        try {
            await holoSphere.deleteAllGlobal('federation');
            await holoSphere.deleteGlobal('spaces', space1.spacename);
            await holoSphere.deleteGlobal('spaces', space2.spacename);
            // Wait for cleanup
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            // Ignore errors during cleanup
            console.log('Cleanup error (expected):', error.message);
        }

        // Create fresh test spaces with retries
        for (let i = 0; i < 3; i++) {
            try {
                await holoSphere.createSpace(space1.spacename, space1.password);
                await holoSphere.createSpace(space2.spacename, space2.password);
                break;
            } catch (error) {
                console.log('Space creation attempt', i + 1, 'failed:', error.message);
                if (i === 2) throw error;
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        // Wait for space creation to complete
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Verify spaces were created
        const space1Created = await holoSphere.getGlobal('spaces', space1.spacename);
        const space2Created = await holoSphere.getGlobal('spaces', space2.spacename);
        
        if (!space1Created || !space2Created) {
            throw new Error('Failed to create test spaces');
        }

        // Wait for everything to settle
        await new Promise(resolve => setTimeout(resolve, 2000));
    }, 30000);

    beforeEach(async () => {
        // Clean up any existing federation data
        await holoSphere.deleteAllGlobal('federation');
        
        // Clean up any existing test data
        await holoSphere.deleteAll(testHolon, testLens);
        
        // Set up base schema for all tests
        const baseSchema = {
            type: 'object',
            properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                data: { type: 'string' },
                federation: {
                    type: 'object',
                    properties: {
                        origin: { type: 'string' },
                        timestamp: { type: 'number' }
                    }
                }
            },
            required: ['id']
        };
        
        await holoSphere.setSchema(testLens, baseSchema);
        await strictHoloSphere.setSchema(testLens, baseSchema);
        
        // Wait for schema to be set
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Verify spaces exist before proceeding
        const space1Exists = await holoSphere.getGlobal('spaces', space1.spacename);
        const space2Exists = await holoSphere.getGlobal('spaces', space2.spacename);
        
        // If spaces don't exist, recreate them
        if (!space1Exists) {
            try {
                await holoSphere.createSpace(space1.spacename, space1.password);
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                if (error.message !== 'Space already exists') {
                    throw error;
                }
            }
        }
        if (!space2Exists) {
            try {
                await holoSphere.createSpace(space2.spacename, space2.password);
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                if (error.message !== 'Space already exists') {
                    throw error;
                }
            }
        }
        
        // Wait for space creation to complete
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Verify spaces again
        const space1Verified = await holoSphere.getGlobal('spaces', space1.spacename);
        const space2Verified = await holoSphere.getGlobal('spaces', space2.spacename);
        
        if (!space1Verified || !space2Verified) {
            throw new Error('Test spaces not found - test environment not properly set up');
        }
        
        // Ensure both instances are logged out
        if (holoSphere.currentSpace) {
            await holoSphere.logout();
        }
        if (strictHoloSphere.currentSpace) {
            await strictHoloSphere.logout();
        }
        
        // Login as first space to holoSphere
        await holoSphere.login(space1.spacename, space1.password);
        
        // Wait for login to complete
        await new Promise(resolve => setTimeout(resolve, 2000));
    }, 20000);

    test('should create federation relationship between spaces', async () => {
        // Create federation relationship
        await holoSphere.federate(space1.spacename, space2.spacename);

        // Wait for federation to be established
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Verify federation was created
        const fedInfo = await holoSphere.getFederation(space1.spacename);
        expect(fedInfo).toBeDefined();
        expect(fedInfo.federation).toContain(space2.spacename);
    }, 10000);

    test('should establish bidirectional federation', async () => {
        // Create bidirectional federation
        await holoSphere.federate(space1.spacename, space2.spacename);

        // Wait for federation to be established
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Login to space1 to verify federation
        await holoSphere.login(space1.spacename, space1.password);

        // Verify both spaces are federated with each other
        const fedInfo1 = await holoSphere.getFederation(space1.spacename);
        const fedInfo2 = await holoSphere.getFederation(space2.spacename);

        expect(fedInfo1).toBeDefined();
        expect(fedInfo2).toBeDefined();
        expect(fedInfo1.federation).toContain(space2.spacename);
        expect(fedInfo2.notify).toContain(space1.spacename);
    }, 10000);

    test('should prevent duplicate federation relationships', async () => {
        // Login to space1
        await holoSphere.login(space1.spacename, space1.password);

        // Create initial federation
        await holoSphere.federate(space1.spacename, space2.spacename);

        // Wait for federation to be established
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Verify federation exists
        const fedInfo = await holoSphere.getFederation(space1.spacename);
        expect(fedInfo).toBeDefined();
        expect(fedInfo.federation).toBeDefined();
        expect(fedInfo.federation).toContain(space2.spacename);

        // Attempt to create duplicate federation
        await expect(holoSphere.federate(space1.spacename, space2.spacename))
            .rejects.toThrow('Federation already exists');
    }, 15000);

    test('should handle federation data propagation', async () => {
        // Login to space1
        await holoSphere.login(space1.spacename, space1.password);

        const testData = { 
            id: 'test1', 
            name: 'Test Item',
            data: 'federated content' 
        };

        // Set up federation
        await holoSphere.federate(space1.spacename, space2.spacename);

        // Wait for federation to be established
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Login to space2 with strict instance
        await strictHoloSphere.login(space2.spacename, space2.password);

        // Put data in first space
        await holoSphere.put(testHolon, testLens, testData);

        // Wait for propagation
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Verify data was propagated to federated space
        const federatedData = await strictHoloSphere.get(testHolon, testLens, testData.id);
        expect(federatedData).toBeDefined();
        expect(federatedData).not.toBeNull();
        expect(federatedData.data).toEqual(testData.data);
        expect(federatedData.federation).toBeDefined();
        expect(federatedData.federation.origin).toEqual(space1.spacename);
        expect(federatedData.federation.timestamp).toBeGreaterThan(0);
    }, 20000);

    test('should handle different getFederated modalities', async () => {
        // Clean up any existing test data first
        await holoSphere.deleteAll(testHolon, testLens);
        await strictHoloSphere.deleteAll(testHolon, testLens);
        
        // Wait for cleanup to complete
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Set up federation using non-strict instance (already logged in as space1)
        await holoSphere.federate(space1.spacename, space2.spacename);

        // Login to space2 with strict instance
        await strictHoloSphere.login(space2.spacename, space2.password);

        // Wait for federation to be established
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Test data with overlapping IDs and different fields
        const testData1 = { 
            id: 'user1', 
            name: 'User One',
            received: 10,
            sent: 5,
            wants: ['item1', 'item2'],
            offers: ['service1']
        };
        const testData2 = { 
            id: 'user1',  // Same ID as testData1
            name: 'User One Updated',
            received: 15,
            sent: 8,
            wants: ['item3'],
            offers: ['service2']
        };
        const testData3 = { 
            id: 'user2',
            name: 'User Two',
            received: 20,
            sent: 12,
            wants: ['item4'],
            offers: ['service3']
        };

        // Put data using both instances and wait between puts
        console.log('Putting test data 1:', JSON.stringify(testData1, null, 2));
        await holoSphere.put(testHolon, testLens, testData1);
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        console.log('Putting test data 2:', JSON.stringify(testData2, null, 2));
        await strictHoloSphere.put(testHolon, testLens, testData2);
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        console.log('Putting test data 3:', JSON.stringify(testData3, null, 2));
        await holoSphere.put(testHolon, testLens, testData3);

        // Wait longer for data propagation
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Test 1: Simple concatenation without deduplication
        const concatenatedResults = await holoSphere.getFederated(testHolon, testLens, {
            aggregate: false,
            removeDuplicates: false
        });
        console.log('Concatenated results:', JSON.stringify(concatenatedResults, null, 2));
        
        // Verify we have all items including duplicates
        expect(concatenatedResults.filter(item => item.id === 'user1').length).toBeGreaterThanOrEqual(1);
        expect(concatenatedResults.filter(item => item.id === 'user2').length).toBe(1);

        // Test 2: With deduplication
        const dedupedResults = await strictHoloSphere.getFederated(testHolon, testLens, {
            aggregate: false,
            removeDuplicates: true
        });
        console.log('Deduped results:', JSON.stringify(dedupedResults, null, 2));
        expect(dedupedResults.length).toBe(2);
        const user1Deduped = dedupedResults.find(item => item.id === 'user1');
        expect(user1Deduped.name).toBe('User One Updated');

        // Test 3: With aggregation
        const aggregationOptions = {
            aggregate: true,
            idField: 'id',
            sumFields: ['received', 'sent'],
            concatArrays: ['wants', 'offers'],
            removeDuplicates: true
        };
        console.log('Aggregation options:', JSON.stringify(aggregationOptions, null, 2));
        const aggregatedResults = await holoSphere.getFederated(testHolon, testLens, aggregationOptions);
        console.log('Aggregated results:', JSON.stringify(aggregatedResults, null, 2));
        
        // Sort results by ID for consistent testing
        const sortedResults = aggregatedResults.sort((a, b) => a.id.localeCompare(b.id));
        expect(sortedResults.length).toBe(2);

        const user1Aggregated = sortedResults.find(item => item.id === 'user1');
        expect(user1Aggregated).toBeDefined();
        expect(user1Aggregated.received).toBe(15); // Latest value
        expect(user1Aggregated.sent).toBe(8); // Latest value
        expect(user1Aggregated.wants).toEqual(['item3']); // Latest value
        expect(user1Aggregated.offers).toEqual(['service2']); // Latest value

        const user2Aggregated = sortedResults.find(item => item.id === 'user2');
        expect(user2Aggregated).toBeDefined();
        expect(user2Aggregated.received).toBe(20);
        expect(user2Aggregated.sent).toBe(12);
        expect(user2Aggregated.wants).toEqual(['item4']);
        expect(user2Aggregated.offers).toEqual(['service3']);
    }, 60000);

    test('should handle unfederation', async () => {
        // Login to space1
        await holoSphere.login(space1.spacename, space1.password);

        // Set up federation
        await holoSphere.federate(space1.spacename, space2.spacename);

        // Wait for federation to be established
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Verify federation exists
        let fedInfo1 = await holoSphere.getFederation(space1.spacename);
        expect(fedInfo1).toBeDefined();
        expect(fedInfo1.federation).toBeDefined();
        expect(fedInfo1.federation).toContain(space2.spacename);

        // Remove federation
        await holoSphere.unfederate(space1.spacename, space2.spacename);

        // Wait for unfederation to complete
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Verify federation is removed
        fedInfo1 = await holoSphere.getFederation(space1.spacename);
        const fedInfo2 = await holoSphere.getFederation(space2.spacename);

        expect(fedInfo1).toBeDefined();
        expect(fedInfo2).toBeDefined();
        expect(fedInfo1.federation || []).not.toContain(space2.spacename);
        expect(fedInfo2.notify || []).not.toContain(space1.spacename);
    }, 20000);

    afterEach(async () => {
        // Clean up test data
        await holoSphere.deleteAll(testHolon, testLens);
        
        // Clean up federation data while still logged in
        await holoSphere.deleteAllGlobal('federation');
        
        // Logout from both instances
        if (holoSphere.currentSpace) {
            await holoSphere.logout();
        }
        if (strictHoloSphere.currentSpace) {
            await strictHoloSphere.logout();
        }
        
        // Wait for cleanup
        await new Promise(resolve => setTimeout(resolve, 1000));
    });

    afterAll(async () => {
        // Clean up test spaces
        try {
            await holoSphere.deleteGlobal('spaces', space1.spacename);
            await holoSphere.deleteGlobal('spaces', space2.spacename);
            // Wait for cleanup
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.error('Error during final cleanup:', error.message);
        }
        
        // Clean up Gun instances
        if (holoSphere.gun) {
            holoSphere.gun.off();
        }
        if (strictHoloSphere.gun) {
            strictHoloSphere.gun.off();
        }
    });
});
