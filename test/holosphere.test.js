import HoloSphere from '../holosphere.js';
import * as h3 from 'h3-js';

describe('HoloSphere', () => {
    const testAppName = 'test-app';
    const testCredentials = {
        spacename: 'testuser',
        password: 'testpass'
    };
    let holoSphere = new HoloSphere(testAppName, false);
    beforeAll(async () => {
        // Initialize HoloSphere once for all tests
       
        
        // Set up test space and authenticate
        try {
            await holoSphere.createSpace(testCredentials.spacename, testCredentials.password);
        } catch (error) {
            // Space might already exist, try to delete it first
            try {
                await holoSphere.deleteGlobal('spaces', testCredentials.spacename);
                await holoSphere.createSpace(testCredentials.spacename, testCredentials.password);
            } catch (error) {
                console.error('Failed to recreate space:', error);
                throw error;
            }
        }
        
        // Ensure we're logged in
        await holoSphere.login(testCredentials.spacename, testCredentials.password);
    });

    beforeEach(async () => {
        // Ensure we're logged in before each test
        if (!holoSphere.currentSpace || holoSphere.currentSpace.exp < Date.now()) {
            await holoSphere.login(testCredentials.spacename, testCredentials.password);
        }
    });

    describe('Constructor', () => {
        test('should have initialized with correct properties', () => {
            expect(holoSphere).toBeInstanceOf(HoloSphere);
            expect(holoSphere.gun).toBeDefined();
            expect(holoSphere.validator).toBeDefined();
            expect(holoSphere.openai).toBeUndefined();
        });

        test('should initialize with OpenAI when key provided', () => {
            const hsWithAI = new HoloSphere(testAppName, false, 'fake-key');
            expect(hsWithAI.openai).toBeDefined();
            // Clean up additional instance
            if (hsWithAI.gun) hsWithAI.gun.off();
        });
    });

    describe('Schema Operations', () => {
        const testLens = 'testLens';
        const validSchema = {
            type: 'object',
            properties: {
                id: { type: 'string' },
                data: { type: 'string' }
            },
            required: ['id', 'data']
        };

        beforeEach(async () => {
            // Ensure we're logged in before each schema test
            if (!holoSphere.currentSpace || holoSphere.currentSpace.exp < Date.now()) {
                await holoSphere.login(testCredentials.spacename, testCredentials.password);
            }
        });

        test('should set and get schema', async () => {
            await holoSphere.setSchema(testLens, validSchema);
            const retrievedSchema = await holoSphere.getSchema(testLens);
            expect(retrievedSchema).toBeDefined();
            expect(retrievedSchema).toEqual(validSchema);
        });

        test('should handle invalid schema parameters', async () => {
            await expect(holoSphere.setSchema(null, null))
                .rejects.toThrow('setSchema: Missing required parameters');
        });

        test('should enforce strict mode schema validation', async () => {
            const strictHoloSphere = new HoloSphere(testAppName, true);
            
            // Login to the strict instance
            await strictHoloSphere.login(testCredentials.spacename, testCredentials.password);
            
            const invalidSchema = {
                type: 'object',
                properties: {
                    id: { type: 'string' }
                }
            };

            await expect(strictHoloSphere.setSchema(testLens, invalidSchema))
                .rejects.toThrow();

            // Clean up
            await strictHoloSphere.logout();
        });

        test('should handle schema retrieval for non-existent lens', async () => {
            const result = await holoSphere.getSchema('nonexistent-lens');
            expect(result).toBeNull();
        });

        test('should maintain schema integrity across storage and retrieval', async () => {
            const testLens = 'schemaTestLens';
            const strictHoloSphere = new HoloSphere(testAppName, true); 
            
            // Login to the strict instance
            await strictHoloSphere.login(testCredentials.spacename, testCredentials.password);
            
            // Create test schemas of increasing complexity
            const testSchemas = [
                {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        data: { type: 'string' }
                    },
                    required: ['id', 'data']
                },
                {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        data: { type: 'object' },
                        metadata: {
                            type: 'object',
                            properties: {
                                timestamp: { type: 'number' },
                                tags: { 
                                    type: 'array',
                                    items: { type: 'string' }
                                }
                            }
                        }
                    },
                    required: ['id', 'data']
                }
            ];

            for (let i = 0; i < testSchemas.length; i++) {
                const testLensWithIndex = `${testLens}_${i}`;
                const schema = testSchemas[i];

                // Store schema
                await strictHoloSphere.setSchema(testLensWithIndex, schema);
                

                // Retrieve schema
                const retrievedSchema = await strictHoloSphere.getSchema(testLensWithIndex);

                // Verify schema is retrieved correctly
                expect(retrievedSchema).toBeDefined();
                expect(retrievedSchema).toEqual(schema);

                // Test schema validation with valid data
                const validData = {
                    id: 'test1',
                    data: i === 0 ? 'test' : { field: 'value' }
                };
                if (i === 1) {
                    validData.metadata = {
                        timestamp: Date.now(),
                        tags: ['test']
                    };
                }

                // Valid data should work
                await expect(strictHoloSphere.put('testHolon', testLensWithIndex, validData))
                    .resolves.toBe(true);

                // Invalid data should fail in strict mode
                const invalidData = {
                    id: 'test2'
                    // Missing required 'data' field
                };

                await expect(strictHoloSphere.put('testHolon', testLensWithIndex, invalidData))
                    .rejects.toThrow('Schema validation failed');

                // Clean up after each schema test
                await strictHoloSphere.deleteAll('testHolon', testLensWithIndex);
                await strictHoloSphere.gun.get(strictHoloSphere.appname)
                    .get(testLensWithIndex)
                    .get('schema')
                    .put(null);
            }

            // Clean up the strict instance
            if (strictHoloSphere.gun) {
                await strictHoloSphere.logout();
            }
        }, 10000); // Increase timeout to 10 seconds

        test('should handle concurrent schema operations', async () => {
            const baseLens = 'concurrentSchemaTest';
            const numOperations = 5;
            const promises = [];
            const expectedSchemas = [];

            // Create and store schemas concurrently
            for (let i = 0; i < numOperations; i++) {
                const lens = `${baseLens}_${i}`;
                const schema = {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        value: { type: 'string' }
                    },
                    required: ['id', 'value']
                };
                expectedSchemas.push({ lens, schema });
                promises.push(holoSphere.setSchema(lens, schema));
            }

            // Wait for all operations to complete
            await Promise.all(promises);


            // Verify each schema was stored correctly
            for (const { lens, schema } of expectedSchemas) {
                const retrievedSchema = await holoSphere.getSchema(lens);
                expect(retrievedSchema).toEqual(schema);
            }
        }, 10000); // Increase timeout to 10 seconds

        test('should handle schema updates correctly', async () => {
            const testLens = 'schemaUpdateTest';
            
            // Initial schema
            const initialSchema = {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    data: { type: 'string' }
                },
                required: ['id']
            };

            // Updated schema
            const updatedSchema = {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    data: { type: 'string' },
                    metadata: { type: 'object' }
                },
                required: ['id', 'data']
            };

            // Set initial schema
            await holoSphere.setSchema(testLens, initialSchema);

            // Verify initial schema
            let retrievedSchema = await holoSphere.getSchema(testLens);
            expect(retrievedSchema).toEqual(initialSchema);

            // Update schema
            await holoSphere.setSchema(testLens, updatedSchema);

            // Verify updated schema
            retrievedSchema = await holoSphere.getSchema(testLens);
            expect(retrievedSchema).toEqual(updatedSchema);
        });

        afterEach(async () => {
            // Clean up schemas after each test
            await holoSphere.gun.get(holoSphere.appname)
                    .get(testLens)
                    .get('schema')
                    .put(null);
        });
    });

    describe('Data Operations', () => {
        const testHolon = h3.latLngToCell(40.7128, -74.0060, 7);
        const testLens = 'testLens';
        const validData = { id: 'test1', data: 'test data' };
        const invalidData = { id: 'test456', wrongField: 'wrong data' };
        const expectedValidData = { 
            ...validData, 
            owner: testCredentials.spacename,
            federation: expect.objectContaining({
                origin: testCredentials.spacename,
                timestamp: expect.any(Number)
            })
        };

        beforeEach(async () => {
            // Set up schema for validation tests
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

        test('should put and get data with schema validation', async () => {
            // Test valid data
            await expect(holoSphere.put(testHolon, testLens, validData))
                .resolves.toBe(true);
            
            // Test invalid data
            await expect(holoSphere.put(testHolon, testLens, invalidData))
                .rejects.toThrow('Schema validation failed');

            // Verify the valid data was stored correctly
            const result = await holoSphere.get(testHolon, testLens, validData.id);
            expect(result).toEqual(expect.objectContaining(expectedValidData));

            // Verify the invalid data was not stored
            const invalidResult = await holoSphere.get(testHolon, testLens, invalidData.id);
            expect(invalidResult).toBeNull();
        });

        test('should get all data with schema validation', async () => {
            await holoSphere.put(testHolon, testLens, validData);
            await holoSphere.put(testHolon, testLens, { id: 'test789', data: 'more test data' });

            const results = await holoSphere.getAll(testHolon, testLens);
            expect(Array.isArray(results)).toBeTruthy();
            expect(results.length).toBeGreaterThan(0);
            expect(results.some(item => item.id === validData.id)).toBeTruthy();
        });

        test('should delete data', async () => {
            await holoSphere.put(testHolon, testLens, validData);
            await holoSphere.delete(testHolon, testLens, validData.id);
            
            const result = await holoSphere.get(testHolon, testLens, validData.id);
            expect(result).toBeNull();
        });

        test('should delete all data', async () => {
            await holoSphere.put(testHolon, testLens, validData);
            await holoSphere.put(testHolon, testLens, { id: 'test789', data: 'more test data' });
            
            const deleteResult = await holoSphere.deleteAll(testHolon, testLens);
            expect(deleteResult).toBe(true);
            
            const results = await holoSphere.getAll(testHolon, testLens);
            expect(results).toEqual([]);
        });

        test('should enforce strict mode data validation', async () => {
            const strictHoloSphere = new HoloSphere(testAppName, true);
            
            // Login to the strict instance
            await strictHoloSphere.login(testCredentials.spacename, testCredentials.password);
            
            // Define schema for strict mode tests
            const strictSchema = {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    data: { type: 'string' }
                },
                required: ['id', 'data']
            };
            
            // Set up schema
            await strictHoloSphere.setSchema(testLens, strictSchema);
            
            // Try to put data without schema in strict mode
            await expect(strictHoloSphere.put(testHolon, 'no-schema-lens', validData))
                .rejects.toThrow('Schema required in strict mode');

            // Clean up
            await strictHoloSphere.logout();
        });

        test('should maintain content integrity in holon storage', async () => {
            const testData = [
                { id: 'test1', data: 'content1' },
                { id: 'test2', data: 'content2' },
                { id: 'test3', data: 'content3' }
            ];

            const expectedData = testData.map(data => ({
                ...data,
                owner: testCredentials.spacename,
                federation: expect.objectContaining({
                    origin: testCredentials.spacename,
                    timestamp: expect.any(Number)
                })
            }));

            // Store all test data
            for (const data of testData) {
                await holoSphere.put(testHolon, testLens, data);
            }

            // Retrieve all data
            const retrievedData = await holoSphere.getAll(testHolon, testLens);

            // Sort both arrays by id for comparison
            const sortedExpectedData = [...expectedData].sort((a, b) => a.id.localeCompare(b.id));
            const sortedRetrievedData = [...retrievedData].sort((a, b) => a.id.localeCompare(b.id));

            // Verify no duplicates
            const uniqueIds = new Set(retrievedData.map(item => item.id));
            expect(uniqueIds.size).toBe(testData.length);

            // Verify all items are present and correct
            expect(sortedRetrievedData).toEqual(expect.arrayContaining(sortedExpectedData));

            // Verify individual item retrieval
            for (let i = 0; i < testData.length; i++) {
                const item = await holoSphere.get(testHolon, testLens, testData[i].id);
                expect(item).toEqual(expect.objectContaining(expectedData[i]));
            }
        });

        test('should handle data consistency in get operations', async () => {
            const testData = [
                { id: 'test1', data: 'content1' },
                { id: 'test2', data: 'content2' },
                { id: 'test3', data: 'content3' }
            ].map(data => ({
                ...data,
                owner: testCredentials.spacename,
                federation: expect.objectContaining({
                    origin: testCredentials.spacename,
                    timestamp: expect.any(Number)
                })
            }));

            // Store test data
            for (const data of testData) {
                const { federation, ...storeData } = data;
                await holoSphere.put(testHolon, testLens, storeData);
            }

            // Test individual get operations
            for (const expected of testData) {
                const result = await holoSphere.get(testHolon, testLens, expected.id);
                expect(result).toEqual(expect.objectContaining(expected));
            }

            // Multiple consecutive gets should return same data
            for (let i = 0; i < 5; i++) {
                const result = await holoSphere.get(testHolon, testLens, 'test1');
                expect(result).toEqual(expect.objectContaining(testData[0]));
            }
        });

        test('should handle data consistency in getAll operations', async () => {
            const testData = Array.from({ length: 10 }, (_, i) => ({
                id: `test${i}`,
                data: `content${i}`,
                owner: testCredentials.spacename,
                federation: expect.objectContaining({
                    origin: testCredentials.spacename,
                    timestamp: expect.any(Number)
                })
            }));

            // Store test data sequentially to ensure consistency
            for (const data of testData) {
                const { federation, ...storeData } = data;
                await holoSphere.put(testHolon, testLens, storeData);
            }

            // Get data multiple times
            const results = await Promise.all(
                Array.from({ length: 5 }, () => holoSphere.getAll(testHolon, testLens))
            );

            // Verify results
            results.forEach(result => {
                // Should have correct length
                expect(result.length).toBe(testData.length);

                // Should have no duplicates
                const ids = result.map(item => item.id);
                const uniqueIds = new Set(ids);
                expect(uniqueIds.size).toBe(testData.length);

                // Should contain all expected data
                const sortedResult = [...result].sort((a, b) => a.id.localeCompare(b.id));
                const sortedExpected = [...testData].sort((a, b) => a.id.localeCompare(b.id));
                sortedResult.forEach((item, idx) => {
                    expect(item).toEqual(expect.objectContaining(sortedExpected[idx]));
                });
            });
        }, 15000);

        test('should handle rapid concurrent getAll operations', async () => {
            const testData = Array.from({ length: 5 }, (_, i) => ({
                id: `concurrent${i}`,
                data: `data${i}`
            }));

            // Store test data
            for (const data of testData) {
                await holoSphere.put(testHolon, testLens, data);
            }

            // Perform multiple concurrent getAll operations
            const promises = Array.from({ length: 10 }, () => 
                holoSphere.getAll(testHolon, testLens)
            );

            const results = await Promise.all(promises);

            // Verify each result has the correct number of items
            results.forEach(result => {
                expect(result.length).toBe(testData.length);
                
                // Check for duplicates within each result
                const ids = result.map(item => item.id);
                const uniqueIds = new Set(ids);
                expect(uniqueIds.size).toBe(ids.length);
            });

            // Verify consistency across results
            const sortedResults = results.map(result => 
                [...result].sort((a, b) => a.id.localeCompare(b.id))
            );

            for (let i = 1; i < sortedResults.length; i++) {
                expect(sortedResults[i]).toEqual(sortedResults[0]);
            }
        });

        // Add cleanup after each test
        afterEach(async () => {
            await holoSphere.deleteAll(testHolon, testLens);
        });
    });

    describe('Node Operations', () => {
        const testHolon = h3.latLngToCell(40.7128, -74.0060, 7);
        const testLens = 'testLens';
        const testNode = { value: 'test node data' };

        test('should put and get node', async () => {
            await holoSphere.putNode(testHolon, testLens, testNode);

            const result = await holoSphere.getNode(testHolon, testLens, 'value');
            expect(result).toBeDefined();
            expect(result).toBe('test node data');
        });

        test('should delete node', async () => {
            // First put the node
            await holoSphere.putNode(testHolon, testLens, testNode);

            // Verify node exists
            const beforeDelete = await holoSphere.getNode(testHolon, testLens, 'value');
            expect(beforeDelete).toBe('test node data');

            // Delete the node
            const deleteResult = await holoSphere.deleteNode(testHolon, testLens, 'value');
            expect(deleteResult).toBe(true);

            // Verify node is deleted
            const afterDelete = await holoSphere.getNode(testHolon, testLens, 'value');
            expect(afterDelete).toBeNull();
        });

        test('should handle invalid node operations', async () => {
            await expect(holoSphere.deleteNode(null, null, null))
                .rejects.toThrow('deleteNode: Missing required parameters');
        });

        afterEach(async () => {
            // Clean up after each test
                await holoSphere.deleteNode(testHolon, testLens, 'value');
        });
    });

    describe('Geospatial Operations', () => {
        const lat = 40.7128;
        const lng = -74.0060;
        const resolution = 7;

        test('should get holon from coordinates', async () => {
            const holon = await holoSphere.getHolon(lat, lng, resolution);
            expect(holon).toBeDefined();
            expect(typeof holon).toBe('string');
        });

        test('should get scalespace from coordinates', () => {
            const scales = holoSphere.getScalespace(lat, lng);
            expect(Array.isArray(scales)).toBeTruthy();
            expect(scales.length).toBe(15); // 0-14 resolution levels
        });

        test('should get holon scalespace', () => {
            const holon = h3.latLngToCell(lat, lng, resolution);
            const scales = holoSphere.getHolonScalespace(holon);
            expect(Array.isArray(scales)).toBeTruthy();
            expect(scales.length).toBe(resolution + 1);
        });
    });

    describe('Subscription Operations', () => {
        const testHolon = h3.latLngToCell(40.7128, -74.0060, 7);
        const testLens = 'testLens';

        beforeEach(async () => {
            await holoSphere.deleteAll(testHolon, testLens);
        });

        test('should receive data through subscription', async () => {
            const testData = { id: 'test1', data: 'test data' };
            const expectedData = { 
                ...testData, 
                owner: testCredentials.spacename,
                federation: expect.objectContaining({
                    origin: testCredentials.spacename,
                    timestamp: expect.any(Number)
                })
            };
            let received = false;

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Subscription timeout'));
                }, 20000);

                holoSphere.subscribe(testHolon, testLens, (data) => {
                    if (!received && data.id === testData.id) {
                        try {
                            received = true;
                            expect(data).toEqual(expect.objectContaining(expectedData));
                            clearTimeout(timeout);
                            resolve();
                        } catch (error) {
                            clearTimeout(timeout);
                            reject(error);
                        }
                    }
                });

                // Put data after subscription
                setTimeout(async () => {
                    try {
                        await holoSphere.put(testHolon, testLens, testData);
                    } catch (error) {
                        clearTimeout(timeout);
                        reject(error);
                    }
                }, 1000);
            });
        }, 30000);

        test('should stop receiving data after unsubscribe', async () => {
            const testData1 = { id: 'test1', data: 'first' };
            const testData2 = { id: 'test2', data: 'second' };
            let receivedData = [];

            return new Promise(async (resolve, reject) => {
                const timeout = setTimeout(() => {
                    // If we only received the first piece of data, test passes
                    if (receivedData.length === 1 && receivedData[0].id === testData1.id) {
                        resolve();
                    } else {
                        reject(new Error('Test timeout or received unexpected data'));
                    }
                }, 5000);

                const subscription = await holoSphere.subscribe(testHolon, testLens, async (data) => {
                    receivedData.push(data);
                    
                    if (data.id === testData1.id) {
                        subscription.unsubscribe();
                        resolve();
                    } else if (data.id === testData2.id) {
                        clearTimeout(timeout);
                        reject(new Error('Received data after unsubscribe'));
                    }
                });

                // Put first piece of data
                await holoSphere.put(testHolon, testLens, testData1);
            });
        }, 10000);

        test('should handle multiple subscriptions', async () => {
            const testData = { id: 'test1', data: 'test data' };
            const expectedData = { 
                ...testData, 
                owner: testCredentials.spacename,
                federation: expect.objectContaining({
                    origin: testCredentials.spacename,
                    timestamp: expect.any(Number)
                })
            };
            let received1 = false;
            let received2 = false;

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Subscription timeout'));
                }, 20000);

                function checkDone() {
                    if (received1 && received2) {
                        clearTimeout(timeout);
                        resolve();
                    }
                }

                holoSphere.subscribe(testHolon, testLens, (data) => {
                    if (data.id === testData.id) {
                        try {
                            received1 = true;
                            expect(data).toEqual(expect.objectContaining(expectedData));
                            checkDone();
                        } catch (error) {
                            clearTimeout(timeout);
                            reject(error);
                        }
                    }
                });

                holoSphere.subscribe(testHolon, testLens, (data) => {
                    if (data.id === testData.id) {
                        try {
                            received2 = true;
                            expect(data).toEqual(expect.objectContaining(expectedData));
                            checkDone();
                        } catch (error) {
                            clearTimeout(timeout);
                            reject(error);
                        }
                    }
                });

                // Put data after both subscriptions
                setTimeout(async () => {
                    try {
                        await holoSphere.put(testHolon, testLens, testData);
                    } catch (error) {
                        clearTimeout(timeout);
                        reject(error);
                    }
                }, 1000);
            });
        }, 30000);

        afterEach(async () => {
            await holoSphere.deleteAll(testHolon, testLens);
        });
    });

    describe('Parse Operations', () => {
        test('should handle null input', async () => {
            await expect(holoSphere.parse(null))
                .rejects.toThrow('parse: No data provided');
        });

        test('should parse valid JSON string', async () => {
            const result = await holoSphere.parse('{"test": "data"}');
            expect(result).toEqual({ test: 'data' });
        });
    });

    describe('Global Operations', () => {
        test('should put and get global data', async () => {
            const testData = { id: 'global1', value: 'test' };
            await holoSphere.putGlobal('testTable', testData);
            
            const result = await holoSphere.getGlobal('testTable', 'global1');
            expect(result).toEqual(testData);
        });

        test('should handle missing parameters in global operations', async () => {
            await expect(holoSphere.putGlobal(null, null))
                .rejects.toThrow('Table name and data are required');
        });

        test('should handle getAllGlobal', async () => {
            await holoSphere.putGlobal('testTable', { id: 'g1', value: 'test1' });
            await holoSphere.putGlobal('testTable', { id: 'g2', value: 'test2' });
            
            const results = await holoSphere.getAllGlobal('testTable');
            expect(Array.isArray(results)).toBe(true);
            expect(results.length).toBeGreaterThan(0);
        });

        test('should maintain content integrity in global storage', async () => {
            const testTable = 'testGlobalTable';
            
            // Create test data with unique IDs and content
            const testData = [
                { id: 'global1', value: 'value1' },
                { id: 'global2', value: 'value2' },
                { id: 'global3', value: 'value3' }
            ];

            // Store all test data
            for (const data of testData) {
                await holoSphere.putGlobal(testTable, data);
            }

            // Retrieve all data
            const retrievedData = await holoSphere.getAllGlobal(testTable);

            // Sort both arrays by id for comparison
            const sortedTestData = [...testData].sort((a, b) => a.id.localeCompare(b.id));
            const sortedRetrievedData = [...retrievedData].sort((a, b) => a.id.localeCompare(b.id));

            // Verify no duplicates
            const uniqueIds = new Set(retrievedData.map(item => item.id));
            expect(uniqueIds.size).toBe(testData.length);

            // Verify all items are present and correct
            expect(sortedRetrievedData).toEqual(sortedTestData);

            // Verify individual item retrieval
            for (const data of testData) {
                const item = await holoSphere.getGlobal(testTable, data.id);
                expect(item).toEqual(data);
            }

            // Clean up test data
            await holoSphere.deleteAllGlobal(testTable);
        });

        test('should handle concurrent global operations without data corruption', async () => {
            const testTable = 'concurrentGlobalTest';
            const numOperations = 5;
            const promises = [];
            const expectedData = [];

            // Create and store data concurrently with small delays
            for (let i = 0; i < numOperations; i++) {
                const data = { id: `concurrent${i}`, value: `value${i}` };
                expectedData.push(data);
                promises.push(holoSphere.putGlobal(testTable, data));
            }

            // Wait for all operations to complete
            await Promise.all(promises);



            // Retrieve and verify data
            const retrievedData = await holoSphere.getAllGlobal(testTable);

            // Sort both arrays by id for comparison
            const sortedExpectedData = [...expectedData].sort((a, b) => a.id.localeCompare(b.id));
            const sortedRetrievedData = [...retrievedData].sort((a, b) => a.id.localeCompare(b.id));

            // Verify no duplicates
            const uniqueIds = new Set(retrievedData.map(item => item.id));
            expect(uniqueIds.size).toBe(numOperations);

            // Verify all items are present and correct
            expect(sortedRetrievedData).toEqual(sortedExpectedData);

            // Clean up test data
            await holoSphere.deleteAllGlobal(testTable);
        }, 15000); // Increase timeout to 15 seconds
    });

    describe('Compute Operations', () => {
        const testHolon = h3.latLngToCell(40.7128, -74.0060, 7);
        const testLens = 'testLens';

        beforeEach(async () => {
            // Set up schema for compute tests
            const schema = {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    content: { type: 'string' },
                    timestamp: { type: 'number' }
                },
                required: ['id', 'content']
            };
            await holoSphere.setSchema(testLens, schema);
        });

        test('should validate required parameters', async () => {
            await expect(holoSphere.compute(null, null, null))
                .rejects.toThrow('compute: Missing required parameters');
            
            await expect(holoSphere.compute(testHolon, null, null))
                .rejects.toThrow('compute: Missing required parameters');
            
            await expect(holoSphere.compute(testHolon, testLens, null))
                .rejects.toThrow('compute: Missing required parameters');
        });


        test('should validate holon resolution', async () => {
            const invalidHolon = h3.latLngToCell(40.7128, -74.0060, 0); // Resolution 0
            await expect(holoSphere.compute(invalidHolon, testLens, { operation: 'summarize' }))
                .rejects.toThrow('compute: Invalid holon resolution (must be between 1 and 15)');
        });

        test('should validate depth parameters', async () => {
            await expect(holoSphere.compute(testHolon, testLens, {
                operation: 'summarize',
                depth: -1
            })).rejects.toThrow('compute: Invalid depth parameter');

            await expect(holoSphere.compute(testHolon, testLens, {
                operation: 'summarize',
                maxDepth: 0
            })).rejects.toThrow('compute: Invalid maxDepth parameter (must be between 1 and 15)');

            await expect(holoSphere.compute(testHolon, testLens, {
                operation: 'summarize',
                maxDepth: 16
            })).rejects.toThrow('compute: Invalid maxDepth parameter (must be between 1 and 15)');
        });

        test('should validate operation type', async () => {
            await expect(holoSphere.compute(testHolon, testLens, {
                operation: 'invalid-operation'
            })).rejects.toThrow('compute: Invalid operation (must be one of summarize, aggregate, concatenate)');
        });

        afterEach(async () => {
            // Clean up test data
            await holoSphere.deleteAll(testHolon, testLens);
            await holoSphere.gun.get(holoSphere.appname)
                .get(testLens)
                .get('schema')
                .put(null);
        });
    });

    describe('Error Handling', () => {
        const testHolon = h3.latLngToCell(40.7128, -74.0060, 7);
        const testLens = 'testLens';

        beforeEach(async () => {
            // Clear all existing data
            await holoSphere.deleteAll(testHolon, testLens);
            
            // Set up fresh schema
            const schema = {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    data: { type: 'string' }
                },
                required: ['id', 'data']
            };
            await holoSphere.setSchema(testLens, schema);
        });

        test('should handle concurrent operations', async () => {
            const numOperations = 10;
            const promises = [];
            const expectedIds = new Set();

            // Create concurrent put operations with small delays between them
            for (let i = 0; i < numOperations; i++) {
                const id = `concurrent${i}`;
                expectedIds.add(id);
                promises.push(holoSphere.put(testHolon, testLens, { 
                    id: id, 
                    data: 'test' 
                }));
            }

            // Wait for all operations to complete
            await Promise.all(promises);

            // Get and verify results
            const results = await holoSphere.getAll(testHolon, testLens);
            const resultIds = new Set(results.map(r => r.id));

            // Verify we have exactly the expected number of unique results
            expect(resultIds.size).toBe(numOperations);
            
            // Verify all expected IDs are present
            expectedIds.forEach(id => {
                expect(resultIds.has(id)).toBe(true);
            });
        }, 15000); // Increase timeout to 15 seconds

        test('should handle large data sets', async () => {
            const largeData = { 
                id: 'large', 
                data: 'x'.repeat(1000000) 
            };
            
            // Put the data
            await holoSphere.put(testHolon, testLens, largeData);
            
            // Get the data back
            const result = await holoSphere.get(testHolon, testLens, 'large');
            
            // Verify the data
            expect(result).toBeDefined();
            expect(result.id).toBe(largeData.id);
            expect(result.data).toBe(largeData.data);
        });

        afterEach(async () => {
            // Clean up after each test
            await holoSphere.deleteAll(testHolon, testLens);
        });
    });

    describe('OpenAI Integration', () => {
        test('should handle missing OpenAI key', async () => {
            const noAIHoloSphere = new HoloSphere('test');
            const result = await noAIHoloSphere.summarize('test content');
            expect(result).toBe('OpenAI not initialized, please specify the API key in the constructor.');
        });

        test.skip('should summarize content with valid OpenAI key', async () => {
            const hsWithAI = new HoloSphere('test', false, process.env.OPENAI_API_KEY);
            const summary = await hsWithAI.summarize('Test content to summarize');
            expect(typeof summary).toBe('string');
            expect(summary.length).toBeGreaterThan(0);
        });
    });

    afterAll(async () => {
        // Clean up test data
        const testLens = 'testLens';
        const testHolon = h3.latLngToCell(40.7128, -74.0060, 7);
        await holoSphere.deleteAll(testHolon, testLens);
        
        // Clean up test tables
        await holoSphere.deleteAllGlobal('testTable');
        await holoSphere.deleteAllGlobal('testGlobalTable');
        await holoSphere.deleteAllGlobal('concurrentGlobalTest');
        
        // Clean up test space
        await holoSphere.deleteGlobal('spaces', testCredentials.spacename);
        
        // Logout
        if (holoSphere.currentSpace) {
            await holoSphere.logout();
        }
    });
}); 