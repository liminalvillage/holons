import HoloSphere from '../holosphere.js';
import { jest } from '@jest/globals';

// Set global timeout for all tests
jest.setTimeout(30000);

describe('Federation Operations', () => {
    const testAppName = 'test-app';
    const testHolon1 = 'test-holon-1';
    const testHolon2 = 'test-holon-2';
    const testLens = 'test-lens';
    const testPass1 = 'pass1pass1';
    const testPass2 = 'pass2pass2';
    
    let holoSphere;
    let strictHoloSphere;

    beforeAll(async () => {
        holoSphere = new HoloSphere(testAppName, false);
        strictHoloSphere = new HoloSphere(testAppName, true);

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
        
        // Set schema in both spaces
        await holoSphere.setSchema(testLens, baseSchema, testPass1);
        await holoSphere.setSchema(testLens, baseSchema, testPass2);

        // Initialize federation data in respective spaces
        await holoSphere.putGlobal('federation', { 
            id: testHolon1,
            federated: []
        }, testPass1);
        
        await holoSphere.putGlobal('federation', {
            id: testHolon2,
            federated: []
        }, testPass2);
    });

    describe('Federation Setup', () => {
        test('should create federation relationship between spaces', async () => {
            await holoSphere.federate(testHolon1, testPass1, testHolon2);

            const fedInfo = await holoSphere.getFederation(testHolon1, testPass1);
            expect(fedInfo).toBeDefined();
            expect(Array.isArray(fedInfo.federated)).toBe(true);
            expect(fedInfo.federated).toContain(testHolon2);
        });

        test('should establish bidirectional federation with space isolation', async () => {
            await holoSphere.federate(testHolon1, testPass1, testHolon2);

            const fedInfo1 = await holoSphere.getFederation(testHolon1, testPass1);
            const fedInfo2 = await holoSphere.getFederation(testHolon2, testPass2);

            // Verify federation info in respective spaces
            expect(fedInfo1.federated).toContain(testHolon2);
            expect(fedInfo2.federated).toContain(testHolon1);

            // Verify federation info is not accessible without password
            const noPassFed1 = await holoSphere.getFederation(testHolon1);
            const noPassFed2 = await holoSphere.getFederation(testHolon2);
            expect(noPassFed1).toBeNull();
            expect(noPassFed2).toBeNull();
        });
    });

    describe('Data Federation', () => {
        test('should handle federated data with space isolation', async () => {
            await holoSphere.federate(testHolon1, testPass1, testHolon2);

            const testData = { 
                id: 'fed-test1', 
                name: 'Federation Test',
                data: 'federated content' 
            };

            // Store data in first space
            await holoSphere.put(testHolon1, testLens, testData, testPass1);

            // Wait for federation propagation
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Data should be accessible in second space with correct password
            const federatedData = await holoSphere.get(testHolon2, testLens, testData.id, testPass2);
            expect(federatedData).toBeDefined();
            expect(federatedData.data).toBe(testData.data);
            expect(federatedData.federation).toBeDefined();
            expect(federatedData.federation.origin).toBe(testHolon1);

            // Data should not be accessible without password
            const noPassData = await holoSphere.get(testHolon2, testLens, testData.id);
            expect(noPassData).toBeNull();
        });

        test('should handle getFederated with different spaces', async () => {
            await holoSphere.federate(testHolon1, testPass1, testHolon2);

            const data1 = { 
                id: 'fed-data1', 
                name: 'Space One Data',
                data: 'content from space 1' 
            };

            const data2 = { 
                id: 'fed-data2',
                name: 'Space Two Data',
                data: 'content from space 2' 
            };

            // Store data in respective spaces
            await holoSphere.put(testHolon1, testLens, data1, testPass1);
            await holoSphere.put(testHolon2, testLens, data2, testPass2);

            // Wait for federation propagation
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Get federated data with space 1's password
            const federated1 = await holoSphere.getFederated(testHolon1, testLens, {
                removeDuplicates: true
            }, testPass1);

            expect(federated1).toBeDefined();
            expect(federated1.length).toBe(2);
            expect(federated1.find(item => item.id === 'fed-data1')).toBeDefined();
            expect(federated1.find(item => item.id === 'fed-data2')).toBeDefined();

            // Verify data is not accessible without password
            const noPassFederated = await holoSphere.getFederated(testHolon1, testLens, {
                removeDuplicates: true
            });
            expect(noPassFederated).toHaveLength(0);
        });
    });

    describe('Federation Management', () => {
        test('should handle unfederation with space isolation', async () => {
            await holoSphere.federate(testHolon1, testPass1, testHolon2);
            
            // Verify initial federation
            let fedInfo1 = await holoSphere.getFederation(testHolon1, testPass1);
            expect(fedInfo1.federated).toContain(testHolon2);

            // Unfederate
            await holoSphere.unfederate(testHolon1, testPass1, testHolon2);

            // Verify federation is removed in both spaces
            fedInfo1 = await holoSphere.getFederation(testHolon1, testPass1);
            const fedInfo2 = await holoSphere.getFederation(testHolon2, testPass2);

            expect(fedInfo1.federated || []).not.toContain(testHolon2);
            expect(fedInfo2.federated || []).not.toContain(testHolon1);
        });

        test('should handle federation subscriptions with space isolation', async () => {
            await holoSphere.federate(testHolon1, testPass1, testHolon2);

            const notifications = [];
            const subscription = await holoSphere.subscribeFederation(testHolon1, testPass1, 
                data => notifications.push(data)
            );

            // Add data to federated space
            const testData = {
                id: 'sub-test',
                name: 'Subscription Test',
                data: 'federation notification test'
            };
            await holoSphere.put(testHolon2, testLens, testData, testPass2);

            // Wait for notification
            await new Promise(resolve => setTimeout(resolve, 2000));

            expect(notifications.length).toBeGreaterThan(0);
            expect(notifications[0].id).toBe('sub-test');

            // Clean up subscription
            subscription.off();
        });
    });

    afterEach(async () => {
        // Clean up test data in both spaces
        await holoSphere.deleteAll(testHolon1, testLens, testPass1);
        await holoSphere.deleteAll(testHolon2, testLens, testPass2);
        await holoSphere.deleteAllGlobal('federation', testPass1);
        await holoSphere.deleteAllGlobal('federation', testPass2);

        // Re-initialize federation data
        await holoSphere.putGlobal('federation', { 
            id: testHolon1,
            federated: []
        }, testPass1);
        
        await holoSphere.putGlobal('federation', {
            id: testHolon2,
            federated: []
        }, testPass2);
    });

    afterAll(async () => {
        if (holoSphere.gun) {
            holoSphere.gun.off();
        }
        if (strictHoloSphere.gun) {
            strictHoloSphere.gun.off();
        }
    });
});