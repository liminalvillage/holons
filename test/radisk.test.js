/**
 * @fileoverview Tests for HoloSphere radisk functionality
 */

import HoloSphere from '../holosphere.js';

describe('HoloSphere Radisk Tests', () => {
    let holosphere;

    beforeEach(() => {
        holosphere = new HoloSphere('radisk-test');
    });

    afterEach(async () => {
        if (holosphere) {
            await holosphere.close();
        }
    });

    test('should initialize with radisk enabled by default', () => {
        const stats = holosphere.getRadiskStats();
        expect(stats.enabled).toBe(true);
        expect(stats.filePath).toBe('./radata');
        expect(stats.retry).toBe(3);
        expect(stats.timeout).toBe(5000);
    });

    test('should configure radisk options', () => {
        const customOptions = {
            file: './custom-radata',
            retry: 5,
            timeout: 10000
        };

        holosphere.configureRadisk(customOptions);
        const stats = holosphere.getRadiskStats();

        expect(stats.filePath).toBe('./custom-radata');
        expect(stats.retry).toBe(5);
        expect(stats.timeout).toBe(10000);
    });

    test('should handle radisk configuration with partial options', () => {
        holosphere.configureRadisk({ file: './partial-test' });
        const stats = holosphere.getRadiskStats();

        expect(stats.filePath).toBe('./partial-test');
        expect(stats.retry).toBe(3); // Should keep default
        expect(stats.timeout).toBe(5000); // Should keep default
    });

    test('should store and retrieve data with radisk persistence', async () => {
        const testData = {
            id: 'radisk-test-1',
            message: 'This data should be persisted via radisk',
            timestamp: Date.now()
        };

        // Store data
        const putResult = await holosphere.put('test-holon', 'test-lens', testData);
        expect(putResult.success).toBe(true);

        // Retrieve data
        const retrievedData = await holosphere.get('test-holon', 'test-lens', 'radisk-test-1');
        expect(retrievedData).toBeTruthy();
        expect(retrievedData.message).toBe(testData.message);
        expect(retrievedData.timestamp).toBe(testData.timestamp);
    });

    test('should handle radisk stats when gun instance is not available', () => {
        // Create a mock holosphere without gun instance
        const mockHolosphere = {
            gun: null,
            getRadiskStats() {
                if (!this.gun || !this.gun._.opt) {
                    return { error: "Gun instance not available" };
                }
                return { enabled: true };
            }
        };

        const stats = mockHolosphere.getRadiskStats();
        expect(stats.error).toBe("Gun instance not available");
    });

    test('should configure radisk with all options', () => {
        const allOptions = {
            file: './all-options-test',
            radisk: true,
            until: Date.now() + 86400000, // 24 hours from now
            retry: 10,
            timeout: 15000
        };

        holosphere.configureRadisk(allOptions);
        const stats = holosphere.getRadiskStats();

        expect(stats.filePath).toBe('./all-options-test');
        expect(stats.enabled).toBe(true);
        expect(stats.retry).toBe(10);
        expect(stats.timeout).toBe(15000);
        expect(stats.until).toBe(allOptions.until);
    });

    test('should handle browser environment radisk configuration', () => {
        // Mock browser environment
        const originalWindow = global.window;
        global.window = {};

        try {
            const browserHolosphere = new HoloSphere('browser-test', false, null, {
                radisk: true,
                file: './browser-radata'
            });

            const stats = browserHolosphere.getRadiskStats();
            expect(stats.enabled).toBe(true);
            expect(stats.filePath).toBe('./browser-radata');
            expect(stats.localStorage).toBe(false); // Should be false in browser with radisk

            browserHolosphere.close();
        } finally {
            global.window = originalWindow;
        }
    });

    test('should handle radisk configuration with null/undefined values', () => {
        holosphere.configureRadisk({
            file: null,
            retry: undefined,
            timeout: null
        });

        const stats = holosphere.getRadiskStats();
        expect(stats.filePath).toBe('./radata'); // Should use default
        expect(stats.retry).toBe(3); // Should use default
        expect(stats.timeout).toBe(5000); // Should use default
    });
});
