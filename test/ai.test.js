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
    const testPassword = 'AiTest123!';

    beforeAll(async () => {
        holoSphere = new HoloSphere(testAppName, false, process.env.OPENAI_API_KEY);
        
        // Set up base schema for compute tests
        const baseSchema = {
            type: 'object',
            properties: {
                id: { type: 'string' },
                content: { type: 'string' },
                value: { type: 'number' },
                tags: { type: 'array', items: { type: 'string' } },
                timestamp: { type: 'number' },
                summary: { type: 'string' }
            },
            required: ['id', 'content']
        };
        
        await holoSphere.setSchema(testLens, baseSchema);
    });

    describe('Summarize Operations', () => {
        test('should generate summary from text content', async () => {
            const testContent = `
                The HoloSphere project is a decentralized data management system.
                It uses Gun.js for peer-to-peer data synchronization and SEA for encryption.
                The system supports federation between spaces and implements schema validation.
                Data can be organized in holons and viewed through different lenses.
            `;

            const summary = await holoSphere.summarize(testContent);
            expect(summary).toBeDefined();
            expect(typeof summary).toBe('string');
            expect(summary.length).toBeGreaterThan(0);
        });

        test('should handle empty content gracefully', async () => {
            const summary = await holoSphere.summarize('');
            expect(summary).toBeDefined();
            expect(typeof summary).toBe('string');
        });

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
        });

        test('should fail gracefully without API key', async () => {
            const noKeyHoloSphere = new HoloSphere(testAppName, false);
            const result = await noKeyHoloSphere.summarize('Test content');
            expect(result).toBe('OpenAI not initialized, please specify the API key in the constructor.');
        });
    });

    describe('Compute Operations', () => {
        beforeEach(async () => {
            await holoSphere.deleteAll(testHolon, testLens, testPassword);
        });

        test('should compute summaries for nested holons', async () => {
            const childHolon = h3.cellToChildren(testHolon, 8)[0];
            const testData = {
                id: 'test1',
                content: 'This is test content for the child holon that should be summarized.',
                timestamp: Date.now()
            };

            await holoSphere.put(childHolon, testLens, testData, testPassword);

            const result = await holoSphere.compute(childHolon, testLens, {
                operation: 'summarize',
                fields: ['content'],
                targetField: 'summary'
            }, testPassword);

            expect(result).toBeDefined();
            expect(result.id).toMatch(/_summarize$/);
            expect(result.summary).toBeDefined();
            expect(typeof result.summary).toBe('string');
        });

        test('should compute aggregations for numeric fields', async () => {
            const childHolon = h3.cellToChildren(testHolon, 8)[0];
            const testData = [
                { id: 'test1', content: 'test content 1', value: 10, timestamp: Date.now() },
                { id: 'test2', content: 'test content 2', value: 20, timestamp: Date.now() }
            ];

            await Promise.all(testData.map(data => 
                holoSphere.put(childHolon, testLens, data, testPassword)
            ));

            const result = await holoSphere.compute(childHolon, testLens, {
                operation: 'aggregate',
                fields: ['value'],
                targetField: 'value'
            }, testPassword);

            expect(result).toBeDefined();
            expect(result.id).toMatch(/_aggregate$/);
            expect(result.value).toBe(30);
        });

        test('should compute concatenations for array fields', async () => {
            const childHolon = h3.cellToChildren(testHolon, 8)[0];
            const testData = [
                { id: 'test1', content: 'test content 1', tags: ['tag1', 'tag2'], timestamp: Date.now() },
                { id: 'test2', content: 'test content 2', tags: ['tag2', 'tag3'], timestamp: Date.now() }
            ];

            await Promise.all(testData.map(data => 
                holoSphere.put(childHolon, testLens, data, testPassword)
            ));

            const result = await holoSphere.compute(childHolon, testLens, {
                operation: 'concatenate',
                fields: ['tags'],
                targetField: 'tags'
            }, testPassword);

            expect(result).toBeDefined();
            expect(result.id).toMatch(/_concatenate$/);
            expect(result.tags).toEqual(['tag1', 'tag2', 'tag3']);
        });

        test('should handle empty holons', async () => {
            await holoSphere.deleteAll(testHolon, testLens, testPassword);
       
            const result = await holoSphere.compute(testHolon, testLens, {
                operation: 'summarize',
                fields: ['content'],
                targetField: 'summary'
            }, testPassword);
    
            expect(result).toBeNull();
        });

        test('should compute hierarchy across multiple levels', async () => {
            const childHolon = h3.cellToChildren(testHolon, 9)[0];
            const testData = {
                id: 'test-hierarchy',
                content: 'Content for testing hierarchy computation',
                value: 42,
                tags: ['test', 'hierarchy'],
                timestamp: Date.now()
            };

            await holoSphere.put(childHolon, testLens, testData, testPassword);
      
            const results = await holoSphere.computeHierarchy(childHolon, testLens, {
                operation: 'summarize',
                fields: ['content'],
                targetField: 'summary'
            }, testPassword, 3);
         
            expect(Array.isArray(results)).toBe(true);
            expect(results.length).toBeGreaterThan(0);
            results.forEach(result => {
                expect(result.id).toMatch(/_summarize$/);
                expect(result.summary).toBeDefined();
                expect(typeof result.summary).toBe('string');
            });
        });
    });

    afterEach(async () => {
        await holoSphere.deleteAll(testHolon, testLens, testPassword);
    });

    afterAll(async () => {
        await holoSphere.deleteAll(testHolon, testLens, testPassword);
        await holoSphere.deleteAllGlobal('federation', testPassword);

        if (holoSphere.gun) {
            holoSphere.gun.off();
        }
    });
}); 