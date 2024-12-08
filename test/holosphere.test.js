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
            // Set the schema
            const setResult = await holoSphere.setSchema(testLens, validSchema);
            expect(setResult).toBe(true);

            // Wait for GunDB to process
            await new Promise(resolve => setTimeout(resolve, 100));

            // Get and verify the schema
            const retrievedSchema = await holoSphere.getSchema(testLens);
            expect(retrievedSchema).toBeDefined();
            expect(retrievedSchema).toEqual(validSchema);
        }, 5000);

        test('should handle invalid schema parameters', async () => {
            const nullResult = await holoSphere.setSchema(null, null);
            expect(nullResult).toBe(false);

            const missingLensResult = await holoSphere.setSchema(undefined, validSchema);
            expect(missingLensResult).toBe(false);

            const missingSchemaResult = await holoSphere.setSchema(testLens, null);
            expect(missingSchemaResult).toBe(false);
        });

        test('should enforce strict mode schema validation', async () => {
            const strictHoloSphere = new HoloSphere(testAppName, true);
            
            // Test cases for invalid schemas
            const invalidSchemas = [
                {
                    // Missing type field
                    properties: {
                        id: { type: 'string' }
                    }
                },
                {
                    // Missing properties
                    type: 'object'
                },
                {
                    // Missing required fields
                    type: 'object',
                    properties: {
                        id: { type: 'string' }
                    }
                },
                {
                    // Invalid property type
                    type: 'object',
                    properties: {
                        id: { type: 123 } // Should be string
                    },
                    required: ['id']
                }
            ];

            // Test each invalid schema
            for (const invalidSchema of invalidSchemas) {
                const setResult = await strictHoloSphere.setSchema(testLens, invalidSchema);
                expect(setResult).toBe(false);
            }

            // Valid schema should work in strict mode
            const validSchema = {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    data: { type: 'string' }
                },
                required: ['id', 'data']
            };

            const validResult = await strictHoloSphere.setSchema(testLens, validSchema);
            expect(validResult).toBe(true);

            // Verify schema was stored correctly
            const retrievedSchema = await strictHoloSphere.getSchema(testLens);
            expect(retrievedSchema).toEqual(validSchema);
        }, 5000);

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
            // Test valid data
            const putResult = await holoSphere.put(testHolon, testLens, validData);
            expect(putResult).toBe(true);

            const getResult = await holoSphere.get(testHolon, testLens, validData.id);
            expect(getResult).toEqual(validData);

            // Test invalid data
            const invalidPutResult = await holoSphere.put(testHolon, testLens, invalidData);
            expect(invalidPutResult).toBe(false);
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
            const noSchemaResult = await strictHoloSphere.put(testHolon, 'no-schema-lens', validData);
            expect(noSchemaResult).toBe(false);
            
            // Try to get data without schema in strict mode
            const noSchemaData = await strictHoloSphere.getAll(testHolon, 'no-schema-lens');
            expect(noSchemaData).toEqual([]);
            
            // Invalid data should be removed in strict mode
            await strictHoloSphere.put(testHolon, testLens, invalidData);
            const results = await strictHoloSphere.getAll(testHolon, testLens);
            expect(results.some(item => item.id === invalidData.id)).toBe(false);
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
            // Test missing parameters
            const nullResult = await holoSphere.deleteNode(null, null, null);
            expect(nullResult).toBe(false);

            const nullGet = await holoSphere.getNode(null, null, null);
            expect(nullGet).toBeNull();
        });

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

    afterAll(async () => {
        // Clean up test data
        const testLens = 'testLens';
        const testHolon = h3.latLngToCell(40.7128, -74.0060, 7);
        await holoSphere.deleteAll(testHolon, testLens);
        
        // Allow time for Gun to process
        await new Promise(resolve => setTimeout(resolve, 1000));
    });
}); 