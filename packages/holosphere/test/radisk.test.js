/**
 * @fileoverview Tests for HoloSphere radisk functionality
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import HoloSphere from '../holosphere.js';
import { testSphere, cleanupTestEnv } from './helpers/testenv.js';

describe('HoloSphere Radisk Tests', () => {
    let holosphere;
    // This suite exercises radisk persistence: every 'radisk-test' instance
    // must point at the SAME radisk dir so data survives instance restarts.
    const sharedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-radisk-test-'));
    const sharedFile = path.join(sharedDir, 'radata');

    afterAll(async () => {
        await cleanupTestEnv();
        fs.rmSync(sharedDir, { recursive: true, force: true });
    }, 30000);

    beforeEach(() => {
        holosphere = testSphere('radisk-test', { gunOptions: { file: sharedFile } });
    });

    afterEach(async () => {
        if (holosphere) {
            await holosphere.close();
        }
    });

    test('should initialize with radisk enabled by default', async () => {
        // This test pins the constructor's PRODUCTION defaults, so it
        // deliberately constructs without a file override — but stays
        // offline (no peers, no multicast) like every other test.
        const def = new HoloSphere('radisk-default-test', false, null, {
            peers: [],
            multicast: false,
        });
        try {
            const stats = def.getRadiskStats();
            expect(stats.enabled).toBe(true);
            // The constructor's default Gun store path (see defaultGunOptions).
            expect(stats.filePath).toBe('./holosphere');
            // Websocket reconnect budget — unlimited by default so long-lived
            // pages never stop reconnecting (see holosphere.js constructor).
            expect(stats.retry).toBe(Infinity);
            expect(stats.timeout).toBe(5000);
        } finally {
            await def.close();
        }
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
        expect(stats.retry).toBe(Infinity); // reconnect budget untouched
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
            const browserHolosphere = testSphere('browser-test', {
                gunOptions: {
                    radisk: true,
                    file: './browser-radata'
                }
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
        expect(stats.retry).toBe(Infinity); // undefined must not clobber the reconnect budget
        expect(stats.timeout).toBe(5000); // Should use default
    });
});
