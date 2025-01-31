import HoloSphere from '../holosphere.js';
import * as h3 from 'h3-js';

describe('HoloSphere', () => {
    let holoSphere;
    const testAppName = 'test-app';
    
    beforeEach(() => {
        holoSphere = new HoloSphere(testAppName);
    });

    describe('Constructor', () => {
        test('should create instance with app name', () => {
            expect(holoSphere).toBeInstanceOf(HoloSphere);
            expect(holoSphere.gun).toBeDefined();
            expect(holoSphere.validator).toBeDefined();
            expect(holoSphere.openai).toBeUndefined();
        });

        test('should initialize with OpenAI when key provided', () => {
            const hsWithAI = new HoloSphere(testAppName, false, 'fake-key');
            expect(hsWithAI.openai).toBeDefined();
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

        test('should set and get schema', async () => {
            await holoSphere.setSchema(testLens, validSchema);
            
            // Wait for GunDB to process
            await new Promise(resolve => setTimeout(resolve, 500));

            const retrievedSchema = await holoSphere.getSchema(testLens);
            expect(retrievedSchema).toBeDefined();
            expect(retrievedSchema).toEqual(validSchema);
        }, 10000);

        test('should handle invalid schema parameters', async () => {
            await expect(holoSphere.setSchema(null, null))
                .rejects.toThrow('setSchema: Missing required parameters');
        }, 10000);

        test('should enforce strict mode schema validation', async () => {
            const strictHoloSphere = new HoloSphere(testAppName, true);
            
            const invalidSchema = {
                type: 'object',
                properties: {
                    id: { type: 'string' }
                }
            };

            await expect(strictHoloSphere.setSchema(testLens, invalidSchema))
                .rejects.toThrow();
        }, 10000);

        test('should handle schema retrieval for non-existent lens', async () => {
            const result = await holoSphere.getSchema('nonexistent-lens');
            expect(result).toBeNull();
        });

        afterEach(async () => {
            // Clean up schemas after each test
            await holoSphere.gun.get(holoSphere.appname)
                    .get(testLens)
                    .get('schema')
                    .put(null);
                
                // Wait for GunDB to process
            await new Promise(resolve => setTimeout(resolve, 100));
        });
    });

    describe('Data Operations', () => {
        const testHolon = h3.latLngToCell(40.7128, -74.0060, 7);
        const testLens = 'testLens';
        const validData = { id: 'test123', data: 'test data' };
        const invalidData = { id: 'test456', wrongField: 'wrong data' };

        beforeEach(async () => {
            // Set up schema for validation tests
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

        test('should put and get data with schema validation', async () => {
            const validData = { id: 'test1', data: 'test data' };
            const invalidData = { id: 'test2' }; // Missing required 'data' field

            // Test valid data
            await holoSphere.put(testHolon, testLens, validData);
            
            // Test invalid data
            try {
                await holoSphere.put(testHolon, testLens, invalidData);
                fail('Expected validation error but operation succeeded');
            } catch (error) {
                expect(error.message).toContain('Schema validation failed');
            }
        }, 10000);

        test('should get all data with schema validation', async () => {
            await holoSphere.put(testHolon, testLens, validData);
            await holoSphere.put(testHolon, testLens, { id: 'test789', data: 'more test data' });

            const results = await holoSphere.getAll(testHolon, testLens);
            expect(Array.isArray(results)).toBeTruthy();
            expect(results.length).toBeGreaterThan(0);
            expect(results.some(item => item.id === validData.id)).toBeTruthy();
        }, 10000);

        test('should delete data', async () => {
            await holoSphere.put(testHolon, testLens, validData);
            await holoSphere.delete(testHolon, testLens, validData.id);
            
            const result = await holoSphere.get(testHolon, testLens, validData.id);
            expect(result).toBeNull();
        }, 10000);

        test('should delete all data', async () => {
            await holoSphere.put(testHolon, testLens, validData);
            await holoSphere.put(testHolon, testLens, { id: 'test789', data: 'more test data' });
            
            const deleteResult = await holoSphere.deleteAll(testHolon, testLens);
            expect(deleteResult).toBe(true);
            
            const results = await holoSphere.getAll(testHolon, testLens);
            expect(results).toEqual([]);
        }, 10000);

        test('should enforce strict mode data validation', async () => {
            const strictHoloSphere = new HoloSphere(testAppName, true);
            
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
        }, 10000);
    });

    describe('Node Operations', () => {
        const testHolon = h3.latLngToCell(40.7128, -74.0060, 7);
        const testLens = 'testLens';
        const testNode = { value: 'test node data' };

        test('should put and get node', async () => {
            await holoSphere.putNode(testHolon, testLens, testNode);

            // Wait for GunDB to process
            await new Promise(resolve => setTimeout(resolve, 100));

            const result = await holoSphere.getNode(testHolon, testLens, 'value');
            expect(result).toBeDefined();
            expect(result).toBe('test node data');
        }, 10000);

        test('should delete node', async () => {
            // First put the node
            await holoSphere.putNode(testHolon, testLens, testNode);
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify node exists
            const beforeDelete = await holoSphere.getNode(testHolon, testLens, 'value');
            expect(beforeDelete).toBe('test node data');

            // Delete the node
            const deleteResult = await holoSphere.deleteNode(testHolon, testLens, 'value');
            expect(deleteResult).toBe(true);

            // Wait for deletion to process
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify node is deleted
            const afterDelete = await holoSphere.getNode(testHolon, testLens, 'value');
            expect(afterDelete).toBeNull();
        }, 10000);

        test('should handle invalid node operations', async () => {
            await expect(holoSphere.deleteNode(null, null, null))
                .rejects.toThrow('deleteNode: Missing required parameters');
        }, 10000);

        afterEach(async () => {
            // Clean up after each test
                await holoSphere.deleteNode(testHolon, testLens, 'value');
            await new Promise(resolve => setTimeout(resolve, 100));
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
            // Clear any existing subscriptions and data
            holoSphere.cleanup();
            await holoSphere.deleteAll(testHolon, testLens);
            // Wait for cleanup to complete
            await new Promise(resolve => setTimeout(resolve, 500));
        });

        test('should subscribe to changes', async () => {
            const changes = [];
            const subscription = await holoSphere.subscribe(testHolon, testLens, (data) => {
                changes.push(data);
            });

            expect(subscription.id).toBeDefined();
            expect(typeof subscription.unsubscribe).toBe('function');

            await holoSphere.put(testHolon, testLens, { id: 'test1', data: 'test data' });
            
            // Wait longer for subscription to process
            await new Promise(resolve => setTimeout(resolve, 500));
            
            expect(changes.length).toBeGreaterThan(0);
        }, 10000);

        test('should unsubscribe properly', async () => {
            const changes = [];
            let subscription;

            // Create a promise that resolves after receiving the first change
            const firstChangePromise = new Promise(resolve => {
                subscription = holoSphere.subscribe(testHolon, testLens, (data) => {
                    changes.push(data);
                    if (changes.length === 1) resolve();
                });
            });

            // Put initial data and wait for first change
            await holoSphere.put(testHolon, testLens, { id: 'test1', data: 'test data' });
            await firstChangePromise;
            
            // Clear changes and unsubscribe
            changes.length = 0;
            subscription.unsubscribe();
            
            // Wait longer for unsubscribe to take effect
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Put new data
            await holoSphere.put(testHolon, testLens, { id: 'test2', data: 'new data' });
            
            // Wait to ensure no new changes are received
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            expect(changes.length).toBe(0);
        }, 20000);

        test('should cleanup all subscriptions', async () => {
            const subs = [];
            for (let i = 0; i < 3; i++) {
                subs.push(await holoSphere.subscribe(testHolon, testLens, () => {}));
                // Wait between subscriptions
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            expect(holoSphere.subscriptions.size).toBe(3);
            holoSphere.cleanup();
            expect(holoSphere.subscriptions.size).toBe(0);
        }, 10000);
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
                    data: { type: 'string' }
                },
                required: ['id', 'data']
            };
            await holoSphere.setSchema(testLens, schema);
        });

        test('should validate compute parameters', async () => {
            await expect(holoSphere.compute(null, null))
                .rejects.toThrow('compute: Missing required parameters');
        });

        test('should validate holon resolution', async () => {
            const invalidHolon = 'invalid';
            await expect(holoSphere.compute(invalidHolon, 'testLens'))
                .rejects.toThrow('compute: Invalid holon resolution');
        });

        test('should compute with valid parameters', async () => {
            await holoSphere.put(testHolon, testLens, { 
                id: 'test1',
                data: 'test data',
                content: 'test content'
            });
            
            await expect(holoSphere.compute(testHolon, testLens, 'summarize'))
                .resolves.not.toThrow();
        }, 15000);
    });

    describe('Error Handling', () => {
        const testHolon = h3.latLngToCell(40.7128, -74.0060, 7);
        const testLens = 'testLens';

        beforeEach(async () => {
            // Clear all existing data
            await holoSphere.deleteAll(testHolon, testLens);
            await new Promise(resolve => setTimeout(resolve, 1000));
            
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
            await new Promise(resolve => setTimeout(resolve, 500));
        });

        test('should handle concurrent operations', async () => {
            const numOperations = 10;
            const promises = [];
            const expectedIds = new Set();

            // Create concurrent put operations
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
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Get and verify results
            const results = await holoSphere.getAll(testHolon, testLens);
            const resultIds = new Set(results.map(r => r.id));

            // Verify we have exactly the expected number of unique results
            expect(resultIds.size).toBe(numOperations);
            
            // Verify all expected IDs are present
            expectedIds.forEach(id => {
                expect(resultIds.has(id)).toBe(true);
            });
        }, 20000);

        test('should handle large data sets', async () => {
            const largeData = { 
                id: 'large', 
                data: 'x'.repeat(1000000) 
            };
            
            // Put the data
            await holoSphere.put(testHolon, testLens, largeData);
            
            // Wait for data to be stored
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Get the data back
            const result = await holoSphere.get(testHolon, testLens, 'large');
            
            // Verify the data
            expect(result).toBeDefined();
            expect(result.id).toBe(largeData.id);
            expect(result.data).toBe(largeData.data);
        }, 20000);

        afterEach(async () => {
            // Clean up after each test
            await holoSphere.deleteAll(testHolon, testLens);
            await new Promise(resolve => setTimeout(resolve, 1000));
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
            
            // Allow time for Gun to process
        await new Promise(resolve => setTimeout(resolve, 1000));
    });
}); 