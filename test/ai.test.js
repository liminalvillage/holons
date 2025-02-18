import HoloSphere from '../holosphere.js';
import * as h3 from 'h3-js';
import { jest } from '@jest/globals';
import 'dotenv/config';

// Set global timeout for all tests
jest.setTimeout(120000);

describe('AI Operations', () => {
    let holoSphere;
    const testAppName = 'test-ai-app';
    const testHolon = h3.latLngToCell(40.7128, -74.0060, 7);
    const testLens = 'aiTestLens';
    const testCredentials = {
        spacename: 'aitest@example.com',
        password: 'AiTest123!'
    };

    beforeAll(async () => {
        holoSphere = new HoloSphere(testAppName, false, process.env.OPENAI_API_KEY);
        
        // Clean up any existing test space and data
        try {
            await holoSphere.deleteAllGlobal('federation');
            await holoSphere.deleteGlobal('spaces', testCredentials.spacename);
        } catch (error) {
            console.log('Cleanup error (can be ignored):', error);
        }
        // Create and login to test space
        await holoSphere.createSpace(testCredentials.spacename, testCredentials.password);
        await holoSphere.login(testCredentials.spacename, testCredentials.password);
        // Set up base schema for compute tests
        const baseSchema = {
            type: 'object',
            properties: {
                id: { type: 'string' },
                content: { type: 'string' },
                value: { type: 'number' },
                tags: { type: 'array', items: { type: 'string' } },
                timestamp: { type: 'number' }
            },
            required: ['id']
        };
        
        await holoSphere.setSchema(testLens, baseSchema);
    }, 30000);

    describe('Summarize Operations', () => {
        test('should generate summary from text content', async () => {
            const testContent = `
                The HoloSphere project is a decentralized data management system.
                It uses Gun.js for peer-to-peer data synchronization and SEA for encryption.
                The system supports federation between spaces and implements schema validation.
                Data can be organized in holons and viewed through different lenses.
            `;

            const summary = await holoSphere.summarize(testContent);
            console.log("summary",summary);
            expect(summary).toBeDefined();
            expect(typeof summary).toBe('string');
            expect(summary.length).toBeGreaterThan(0);
        }, 15000);

        test('should handle empty content gracefully', async () => {
            const summary = await holoSphere.summarize('');
            expect(summary).toBeDefined();
            expect(typeof summary).toBe('string');
        }, 10000);

        test('should handle long content', async () => {
            const longContent = Array(10).fill(
                'This is a long paragraph of text that needs to be summarized. ' +
                'It contains multiple sentences with various information. ' +
                'The summary should capture the key points while remaining concise.'
            ).join('\n');

            const summary = await holoSphere.summarize(longContent);
            expect(summary).toBeDefined();
            expect(typeof summary).toBe('string');
            expect(summary.length).toBeLessThan(longContent.length);
        }, 20000);

        test('should fail gracefully without API key', async () => {
            const noKeyHoloSphere = new HoloSphere(testAppName, false);
            const result = await noKeyHoloSphere.summarize('Test content');
            expect(result).toBe('OpenAI not initialized, please specify the API key in the constructor.');
        });
    });

    describe('Compute Operations', () => {
        beforeEach(async () => {
            // Ensure we're logged in
            if (!holoSphere.currentSpace) {
                await holoSphere.login(testCredentials.spacename, testCredentials.password);
            }
            
            // Clean up any existing test data
            await holoSphere.deleteAll(testHolon, testLens);
        }, 15000);

        test('should compute summaries for nested holons', async () => {
            const childHolon = h3.cellToChildren(testHolon, 8)[0];
            const testData = {
                id: 'test1',
                content: 'This is test content for the child holon that should be summarized.',
                timestamp: Date.now()
            };

            // Put data in child holon
            await holoSphere.put(childHolon, testLens, testData);

            // Compute summaries
            const result = await holoSphere.compute(childHolon, testLens, {
                operation: 'summarize',
                fields: ['content'],
                targetField: 'summary'
            });

            expect(result).toBeDefined();
            expect(result.id).toMatch(/_summarize$/);
            expect(result.summary).toBeDefined();
            expect(typeof result.summary).toBe('string');
        }, 60000);

        test('should compute aggregations for numeric fields', async () => {
            const childHolon = h3.cellToChildren(testHolon, 8)[0];
            const testData = [
                { id: 'test1', value: 10, timestamp: Date.now() },
                { id: 'test2', value: 20, timestamp: Date.now() }
            ];

            // Put test data
            await Promise.all(testData.map(data => holoSphere.put(childHolon, testLens, data)));

            // Compute aggregation
            const result = await holoSphere.compute(childHolon, testLens, {
                operation: 'aggregate',
                fields: ['value']
            });

            expect(result).toBeDefined();
            expect(result.id).toMatch(/_aggregate$/);
            expect(result.value).toBe(30);
        }, 30000);

        test('should compute concatenations for array fields', async () => {
            const childHolon = h3.cellToChildren(testHolon, 8)[0];
            const testData = [
                { id: 'test1', tags: ['tag1', 'tag2'], timestamp: Date.now() },
                { id: 'test2', tags: ['tag2', 'tag3'], timestamp: Date.now() }
            ];

            // Put test data
            await Promise.all(testData.map(data => holoSphere.put(childHolon, testLens, data)));

            // Compute concatenation
            const result = await holoSphere.compute(childHolon, testLens, {
                operation: 'concatenate',
                fields: ['tags']
            });

            expect(result).toBeDefined();
            expect(result.id).toMatch(/_concatenate$/);
            expect(result.tags).toEqual(['tag1', 'tag2', 'tag3']);
        }, 30000);


        test('should handle empty holons', async () => {
            // Clean up any existing data first
            await holoSphere.deleteAll(testHolon, testLens);
       
            // Try to compute on empty holon
            const result = await holoSphere.compute(testHolon, testLens, {
                operation: 'summarize',
                fields: ['content']
            });
    
            expect(result).toBeNull();
        }, 30000);

        test('should compute hierarchy across multiple levels', async () => {
            const childHolon = h3.cellToChildren(testHolon, 9)[0];
            const testData = {
                id: 'test-hierarchy',
                content: 'Content for testing hierarchy computation',
                value: 42,
                tags: ['test', 'hierarchy'],
                timestamp: Date.now()
            };

            // Put test data
            await holoSphere.put(childHolon, testLens, testData);
      
            // Compute hierarchy
            const results = await holoSphere.computeHierarchy(childHolon, testLens, {
                operation: 'summarize',
                fields: ['content'],
                targetField: 'summary'
            }, 3);
         
            expect(Array.isArray(results)).toBe(true);
            expect(results.length).toBeGreaterThan(0);
            results.forEach(result => {
                expect(result.id).toMatch(/_summarize$/);
                expect(result.summary).toBeDefined();
                expect(typeof result.summary).toBe('string');
            });
        }, 60000);
    });

    afterEach(async () => {
        // Clean up test data
        if (holoSphere.currentSpace) {
            await holoSphere.deleteAll(testHolon, testLens);
        }
    }, 15000);

    afterAll(async () => {
        // Clean up test space and data
        try {
            await holoSphere.deleteAll(testHolon, testLens);
            await holoSphere.deleteGlobal('spaces', testCredentials.spacename);
            await holoSphere.deleteAllGlobal('federation');
        } catch (error) {
            console.log('Cleanup error (can be ignored):', error);
        }

        // Clean up Gun instance
        if (holoSphere.gun) {
            holoSphere.gun.off();
        }
    }, 30000);
}); 