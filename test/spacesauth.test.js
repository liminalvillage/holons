import HoloSphere from '../holosphere.js';
import * as h3 from 'h3-js';

describe('Space Authentication and Authorization', () => {
    let holoSphere;
    const testAppName = 'test-auth-app';
    const testCredentials = {
        spacename: 'testspace@example.com',
        password: 'TestPassword123!'
    };
    const testHolon = h3.latLngToCell(40.7128, -74.0060, 7);
    const testLens = 'authTestLens';

    beforeAll(async () => {
        holoSphere = new HoloSphere(testAppName, false);
        
        // Clean up any existing test spaces
        try {
            await holoSphere.deleteGlobal('spaces', testCredentials.spacename);
            await holoSphere.deleteGlobal('spaces', 'newspace@example.com');
            await holoSphere.deleteGlobal('spaces', 'sharedspace@example.com');
        } catch (error) {
            console.log('Cleanup error (can be ignored):', error);
        }

        // Create a test space
        await holoSphere.createSpace(testCredentials.spacename, testCredentials.password);
    });

    describe('Space Management', () => {
        test('should create a new space', async () => {
            const newSpace = {
                spacename: 'newspace@example.com',
                password: 'NewPassword123!'
            };
            
            const result = await holoSphere.createSpace(newSpace.spacename, newSpace.password);
            expect(result).toBeTruthy();
            
            // Try creating the same space again should fail
            await expect(holoSphere.createSpace(newSpace.spacename, newSpace.password))
                .rejects.toThrow('Space already exists');
        });

        test('should login space with correct credentials', async () => {
            const result = await holoSphere.login(testCredentials.spacename, testCredentials.password);
            expect(result).toBeTruthy();
            expect(holoSphere.currentSpace).toBeDefined();
            expect(holoSphere.currentSpace.alias).toBe(testCredentials.spacename);
        });

        test('should reject login with incorrect credentials', async () => {
            await expect(holoSphere.login(testCredentials.spacename, 'wrongpassword'))
                .rejects.toThrow('Invalid spacename or password');
        });

        test('should logout space', async () => {
            await holoSphere.login(testCredentials.spacename, testCredentials.password);
            expect(holoSphere.currentSpace).toBeDefined();
            
            await holoSphere.logout();
            expect(holoSphere.currentSpace).toBeNull();
        });
    });

    describe('Authenticated Data Operations', () => {
        let authenticatedHoloSphere;
        let unauthenticatedHoloSphere;

        beforeEach(async () => {
            authenticatedHoloSphere = new HoloSphere(testAppName, false);
            unauthenticatedHoloSphere = new HoloSphere(testAppName, false);
            
            // Login with test space
            await authenticatedHoloSphere.login(testCredentials.spacename, testCredentials.password);
            
            // Set up schema
            const schema = {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    data: { type: 'string' },
                    owner: { type: 'string' }
                },
                required: ['id', 'data']
            };
            await authenticatedHoloSphere.setSchema(testLens, schema);
        });

        test('should store data with owner information', async () => {
            const testData = { 
                id: 'secured-data-1', 
                data: 'This is secured content' 
            };

            // Store data as authenticated space
            await authenticatedHoloSphere.put(testHolon, testLens, testData);

            // Retrieve data as authenticated space
            const result = await authenticatedHoloSphere.get(testHolon, testLens, testData.id);
            expect(result).toBeDefined();
            expect(result.data).toBe(testData.data);
            expect(result.owner).toBe(testCredentials.spacename);
        });

        test('should prevent unauthorized access to data', async () => {
            const testData = { 
                id: 'secured-data-2', 
                data: 'This is private content' 
            };

            // Store data as authenticated space
            await authenticatedHoloSphere.put(testHolon, testLens, testData);

            // Try to retrieve data as unauthenticated space
            const result = await unauthenticatedHoloSphere.get(testHolon, testLens, testData.id);
            expect(result).toBeNull();
        });

        test('should prevent unauthorized modification of data', async () => {
            const testData = { 
                id: 'secured-data-3', 
                data: 'Original content' 
            };

            // Store data as authenticated space
            await authenticatedHoloSphere.put(testHolon, testLens, testData);

            // Try to modify data as unauthenticated space
            const modifiedData = { 
                id: 'secured-data-3', 
                data: 'Modified content' 
            };
            
            await expect(unauthenticatedHoloSphere.put(testHolon, testLens, modifiedData))
                .rejects.toThrow('Unauthorized to modify this data');
        });

        test('should prevent unauthorized deletion of data', async () => {
            const testData = { 
                id: 'secured-data-4', 
                data: 'Content to protect' 
            };

            // Store data as authenticated space
            await authenticatedHoloSphere.put(testHolon, testLens, testData);

            // Try to delete data as unauthenticated space
            await expect(unauthenticatedHoloSphere.delete(testHolon, testLens, testData.id))
                .rejects.toThrow('Unauthorized to delete this data');
        });

        test('should allow data sharing between spaces', async () => {
            // Create another space
            const otherSpace = {
                spacename: 'sharedspace@example.com',
                password: 'SharedPass123!'
            };
            await holoSphere.createSpace(otherSpace.spacename, otherSpace.password);

            const sharedHoloSphere = new HoloSphere(testAppName, false);
            await sharedHoloSphere.login(otherSpace.spacename, otherSpace.password);

            const testData = { 
                id: 'shared-data-1', 
                data: 'This is shared content',
                shared: [otherSpace.spacename]
            };

            // Store data as authenticated space with sharing
            await authenticatedHoloSphere.put(testHolon, testLens, testData);

            // Retrieve data as shared space
            const result = await sharedHoloSphere.get(testHolon, testLens, testData.id);
            expect(result).toBeDefined();
            expect(result.data).toBe(testData.data);
        });

        afterEach(async () => {
            // Cleanup
            await authenticatedHoloSphere.deleteAll(testHolon, testLens);
            await authenticatedHoloSphere.logout();
            await unauthenticatedHoloSphere.logout();
        });
    });

    describe('Authentication Edge Cases', () => {
        test('should handle expired sessions', async () => {
            await holoSphere.login(testCredentials.spacename, testCredentials.password);
            
            // Simulate session expiration
            holoSphere.currentSpace.exp = Date.now() - 1000;

            // Attempt operation with expired session
            const testData = { id: 'test-expired', data: 'test' };
            await expect(holoSphere.put(testHolon, testLens, testData))
                .rejects.toThrow('Session expired');
        });

        test('should handle concurrent authentication requests', async () => {
            const promises = Array(5).fill().map(() => 
                holoSphere.login(testCredentials.spacename, testCredentials.password)
            );

            const results = await Promise.all(promises);
            expect(results.every(result => result === true)).toBeTruthy();
        });

        test('should handle malformed credentials', async () => {
            await expect(holoSphere.login(null, null))
                .rejects.toThrow('Invalid credentials format');
            
            await expect(holoSphere.login('', ''))
                .rejects.toThrow('Invalid credentials format');
            
            await expect(holoSphere.login(123, {}))
                .rejects.toThrow('Invalid credentials format');
        });
    });

    afterAll(async () => {
        // Final cleanup
        if (holoSphere.currentSpace) {
            await holoSphere.logout();
        }
        // Clear all test data
        await holoSphere.deleteAll(testHolon, testLens);
        
        // Clean up test spaces
        try {
            await holoSphere.deleteGlobal('spaces', testCredentials.spacename);
            await holoSphere.deleteGlobal('spaces', 'newspace@example.com');
            await holoSphere.deleteGlobal('spaces', 'sharedspace@example.com');
        } catch (error) {
            console.log('Cleanup error (can be ignored):', error);
        }
    });
}); 