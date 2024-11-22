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
            expect(holoSphere.gunDb).toBeDefined();
            expect(holoSphere.validator).toBeDefined();
            expect(holoSphere.aiClient).toBeUndefined();
        });

        test('should initialize with OpenAI when key provided', () => {
            const hsWithAI = new HoloSphere(testAppName, 'fake-key');
            expect(hsWithAI.aiClient).toBeDefined();
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

        test('should set and get lens schema', async () => {
            await holoSphere.setLensSchema(testLens, validSchema);
            const result = await holoSphere.getLensSchema(testLens);
            expect(result).toEqual(validSchema);
        });

        test('should validate data against schema', async () => {
            const validData = { id: 'test123', data: 'test data' };
            const invalidData = { id: 123, data: ['wrong type'] };

            await holoSphere.setLensSchema(testLens, validSchema);

            const validResult = holoSphere.validator.validate(validSchema, validData);
            expect(validResult).toBe(true);

            const invalidResult = holoSphere.validator.validate(validSchema, invalidData);
            expect(invalidResult).toBe(false);
        });
    });

    describe('Data Operations', () => {
        const testHex = h3.latLngToCell(40.7128, -74.0060, 7);
        const testLens = 'testLens';
        const testContent = { id: '123', data: 'test' };

        test('should put and get hex data', async () => {
            await holoSphere.putHexData(testHex, testLens, testContent);
            const result = await holoSphere.getHexData(testHex, testLens);
            expect(Array.isArray(result)).toBeTruthy();
            expect(result.some(item => item.id === testContent.id)).toBeTruthy();
        }, 10000);

        test('should get hex key', async () => {
            await holoSphere.putHexData(testHex, testLens, testContent);
            const result = await holoSphere.getHexKey(testHex, testLens, testContent.id);
            expect(result).toBeDefined();
            expect(result.id).toBe(testContent.id);
        }, 10000);

        test('should delete hex data', async () => {
            await holoSphere.putHexData(testHex, testLens, testContent);
            await holoSphere.deleteHexData(testHex, testLens, testContent.id);
            const result = await holoSphere.getHexKey(testHex, testLens, testContent.id);
            expect(result).toBeNull();
        }, 10000);
    });

    describe('Global Data Operations', () => {
        const tableName = 'testTable';
        const testData = { id: 'test1', value: 'testValue' };

        test('should put and get global data', async () => {
            await holoSphere.putGlobalData(tableName, testData);
            // Add delay to allow Gun to process
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const result = await holoSphere.getGlobalData(tableName);
            expect(result).toBeDefined();
            if (result) {
                expect(result.id).toBe(testData.id);
            }
        }, 15000);

        test('should get global data key', async () => {
            await holoSphere.putGlobalData(tableName, testData);
            // Add delay to allow Gun to process
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const result = await holoSphere.getGlobalDataKey(tableName, testData.id);
            expect(result).toBeDefined();
            if (result) {
                expect(result.id).toBe(testData.id);
            }
        }, 15000);

        test('should delete global data', async () => {
            await holoSphere.putGlobalData(tableName, testData);
            // Add delay to allow Gun to process
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            await holoSphere.deleteGlobalData(tableName);
            // Add delay to allow Gun to process
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const result = await holoSphere.getGlobalData(tableName);
            expect(result).toBeNull();
        }, 15000);

        afterEach(async () => {
            // Clean up after each test
            await holoSphere.deleteGlobalData(tableName);
            await new Promise(resolve => setTimeout(resolve, 1000));
        });
    });

    describe('Encryption Operations', () => {
        const testSecret = 'secret123';
        const testData = { message: 'secret message' };

        test('should encrypt and decrypt data', async () => {
            const encrypted = await holoSphere.encrypt(testData, testSecret);
            expect(encrypted).toBeDefined();
            
            const decrypted = await holoSphere.decrypt(encrypted, testSecret);
            expect(decrypted).toEqual(testData);
        });

        test('should handle encrypted hex data', async () => {
            const testHex = h3.latLngToCell(40.7128, -74.0060, 7);
            const testLens = 'testLens';
            const testContent = { id: 'test123', data: 'secret data' };

            // Create and login test user
            try {
                await holoSphere.createUser('testuser', 'testpass');
                await holoSphere.login('testuser', 'testpass');
            } catch (error) {
                console.log('User already exists or login failed');
            }

            await holoSphere.putHexData(testHex, testLens, testContent, true, testSecret);
            const result = await holoSphere.getHexData(testHex, testLens, testSecret);
            
            expect(Array.isArray(result)).toBeTruthy();
            await holoSphere.logout();
        }, 15000);
    });

    describe('Geospatial Operations', () => {
        const lat = 40.7128;
        const lng = -74.0060;
        const resolution = 7;

        test('should get hex from coordinates', async () => {
            const hex = await holoSphere.getHex(lat, lng, resolution);
            expect(hex).toBeDefined();
            expect(typeof hex).toBe('string');
        });

        test('should get scalespace from coordinates', () => {
            const scales = holoSphere.getScalespace(lat, lng);
            expect(Array.isArray(scales)).toBeTruthy();
            expect(scales.length).toBe(15);
        });

        test('should get hex scalespace', () => {
            const hex = h3.latLngToCell(lat, lng, resolution);
            const scales = holoSphere.getHexScalespace(hex);
            expect(Array.isArray(scales)).toBeTruthy();
            expect(scales.length).toBe(resolution + 1);
        });
    });

    afterAll(async () => {
        // Clean up test data
        const testLens = 'testLens';
        const testHex = h3.latLngToCell(40.7128, -74.0060, 7);
        await holoSphere.clearlens(testHex, testLens);
        
        // Allow time for Gun to process
        await new Promise(resolve => setTimeout(resolve, 1000));
    });
}); 