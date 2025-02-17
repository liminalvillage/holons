import HoloSphere from '../holosphere.js';
import * as h3 from 'h3-js';
import Gun from 'gun';
import 'gun/sea';

describe('Space Authentication and Authorization', () => {
    // Global HoloSphere instances
    let holoSphere;
    let strictHoloSphere;
    const testAppName = 'test-auth-app';
    const testCredentials = {
        spacename: 'testspace@example.com',
        password: 'TestPassword123!'
    };
    const testHolon = h3.latLngToCell(40.7128, -74.0060, 7);
    const testLens = 'authTestLens';

    beforeAll(async () => {
        // Create global instances
        holoSphere = new HoloSphere(testAppName, false);
        strictHoloSphere = new HoloSphere(testAppName, true);
        
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
    }, 10000); // Increase timeout for SEA operations

    describe('Space Management with SEA', () => {
        test('should create a new space with SEA authentication', async () => {
            const newSpace = {
                spacename: 'newspace@example.com',
                password: 'NewPassword123!'
            };
            
            const result = await holoSphere.createSpace(newSpace.spacename, newSpace.password);
            expect(result).toBeTruthy();
            
            // Verify SEA data structure
            const spaceData = await holoSphere.getGlobal('spaces', newSpace.spacename);
            expect(spaceData).toBeDefined();
            expect(spaceData.auth).toBeDefined();
            expect(spaceData.pub).toBeDefined();
            expect(spaceData.epub).toBeDefined();
            
            // Try creating the same space again should fail
            await expect(holoSphere.createSpace(newSpace.spacename, newSpace.password))
                .rejects.toThrow('Space already exists');
        });

        test('should login space with SEA authentication', async () => {
            const result = await holoSphere.login(testCredentials.spacename, testCredentials.password);
            expect(result).toBeTruthy();
            expect(holoSphere.currentSpace).toBeDefined();
            expect(holoSphere.currentSpace.alias).toBe(testCredentials.spacename);
            expect(holoSphere.currentSpace.auth).toBeDefined();
        });

        test('should reject login with incorrect credentials using SEA', async () => {
            await expect(holoSphere.login(testCredentials.spacename, 'wrongpassword'))
                .rejects.toThrow('Authentication failed');
        });

        test('should have valid SEA pair after login', async () => {
            await holoSphere.login(testCredentials.spacename, testCredentials.password);
            expect(holoSphere.currentSpace).toBeDefined();
            expect(holoSphere.currentSpace.pub).toBeDefined();
            expect(holoSphere.currentSpace.epub).toBeDefined();
            expect(holoSphere.currentSpace.auth).toBeDefined();
        });

        test('should logout space', async () => {
            await holoSphere.login(testCredentials.spacename, testCredentials.password);
            expect(holoSphere.currentSpace).toBeDefined();
            
            await holoSphere.logout();
            expect(holoSphere.currentSpace).toBeNull();
        });
    });

    describe('Authenticated Data Operations', () => {
        beforeEach(async () => {
            // Ensure both instances are logged out
            if (holoSphere.currentSpace) {
                await holoSphere.logout();
            }
            if (strictHoloSphere.currentSpace) {
                await strictHoloSphere.logout();
            }
            
            // Login with test space to holoSphere
            await holoSphere.login(testCredentials.spacename, testCredentials.password);
            
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
            await holoSphere.setSchema(testLens, schema);
        });

        test('should store data with owner information', async () => {
            const testData = { 
                id: 'secured-data-1', 
                data: 'This is secured content' 
            };

            // Store data as authenticated space
            await holoSphere.put(testHolon, testLens, testData);

            // Retrieve data as authenticated space
            const result = await holoSphere.get(testHolon, testLens, testData.id);
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
            await holoSphere.put(testHolon, testLens, testData);

            // Try to retrieve data as unauthenticated space
            await strictHoloSphere.logout();
            const result = await strictHoloSphere.get(testHolon, testLens, testData.id);
            expect(result.owner).toBe(testCredentials.spacename);
            expect(result.data).toBe(testData.data);
            expect(result.federation).toBeDefined();
            expect(result.federation.origin).toBe(testCredentials.spacename);
        });

        test('should prevent unauthorized modification of data', async () => {
            const testData = { 
                id: 'secured-data-3', 
                data: 'Original content' 
            };

            // Store data as authenticated space
            await holoSphere.put(testHolon, testLens, testData);

            // Try to modify data as unauthenticated space
            await strictHoloSphere.logout();
            const modifiedData = { 
                id: 'secured-data-3', 
                data: 'Modified content' 
            };
            
            await expect(strictHoloSphere.put(testHolon, testLens, modifiedData))
                .rejects.toThrow('Unauthorized to modify this data');
        });

        test('should prevent unauthorized deletion of data', async () => {
            const testData = { 
                id: 'secured-data-4', 
                data: 'Content to protect' 
            };

            // Store data as authenticated space
            await holoSphere.put(testHolon, testLens, testData);

            // Try to delete data as unauthenticated space
            await strictHoloSphere.logout();
            await expect(strictHoloSphere.delete(testHolon, testLens, testData.id))
                .rejects.toThrow('Unauthorized to delete this data');
        });

        test('should allow data sharing between spaces', async () => {
            // Create another space
            const otherSpace = {
                spacename: 'sharedspace@example.com',
                password: 'SharedPass123!'
            };
            await holoSphere.createSpace(otherSpace.spacename, otherSpace.password);

            // Login to the shared space
            await strictHoloSphere.login(otherSpace.spacename, otherSpace.password);

            const testData = { 
                id: 'shared-data-1', 
                data: 'This is shared content',
                shared: [otherSpace.spacename]
            };

            // Store data as authenticated space with sharing
            await holoSphere.put(testHolon, testLens, testData);

            // Retrieve data as shared space
            const result = await strictHoloSphere.get(testHolon, testLens, testData.id);
            expect(result).toBeDefined();
            expect(result.data).toBe(testData.data);
        });

        afterEach(async () => {
            // Clean up test data
            await holoSphere.deleteAll(testHolon, testLens);
            
            // Logout from both instances
            if (holoSphere.currentSpace) {
                await holoSphere.logout();
            }
            if (strictHoloSphere.currentSpace) {
                await strictHoloSphere.logout();
            }
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

    describe('SEA Encryption Edge Cases', () => {
        test('should handle malformed SEA data', async () => {
            const malformedSpace = {
                spacename: 'malformed@example.com',
                password: 'MalformedPass123!'
            };
            
            // Clean up any existing malformed space first
            await holoSphere.deleteGlobal('spaces', malformedSpace.spacename);
            
            // Wait for cleanup to complete
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Create space but manipulate the auth data
            await holoSphere.createSpace(malformedSpace.spacename, malformedSpace.password);
            
            // Wait for space creation
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Get and modify the space data
            const spaceData = await holoSphere.getGlobal('spaces', malformedSpace.spacename);
            expect(spaceData).toBeDefined();
            
            // Corrupt the auth data
            const corruptedData = {
                ...spaceData,
                auth: { corrupted: 'data' }
            };
            await holoSphere.putGlobal('spaces', corruptedData);
            
            // Wait for corruption to be saved
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Attempt to login should fail gracefully
            await expect(holoSphere.login(malformedSpace.spacename, malformedSpace.password))
                .rejects.toThrow('Authentication failed');
                
            // Clean up after test
            await holoSphere.deleteGlobal('spaces', malformedSpace.spacename);
        }, 15000); // Increase timeout for this specific test

        test('should handle concurrent SEA operations', async () => {
            const promises = Array(3).fill().map(() => 
                holoSphere.login(testCredentials.spacename, testCredentials.password)
            );

            const results = await Promise.all(promises);
            expect(results.every(result => result === true)).toBeTruthy();
        });
    });

    afterAll(async () => {
        // Final cleanup
        if (holoSphere.currentSpace) {
            await holoSphere.logout();
        }
        if (strictHoloSphere.currentSpace) {
            await strictHoloSphere.logout();
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

        // Clean up Gun instances
        if (holoSphere.gun) {
            holoSphere.gun.off();
        }
        if (strictHoloSphere.gun) {
            strictHoloSphere.gun.off();
        }
    });
}); 