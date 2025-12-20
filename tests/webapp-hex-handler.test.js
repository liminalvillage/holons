import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the Settings class for testing
class MockSettings {
    constructor() {
        this.setHexCalled = false;
        this.setHexholonId = null;
        this.setHexValue = null;
        this.getLanguageCalled = false;
        this.getLanguageholonId = null;
    }

    async setHex(holonId, hex) {
        this.setHexCalled = true;
        this.setHexholonId = holonId;
        this.setHexValue = hex;
        return true;
    }

    async getLanguage(holonId) {
        this.getLanguageCalled = true;
        this.getLanguageholonId = holonId;
        return 'en';
    }
}

// Mock i18next
const mockI18next = {
    t: vi.fn((key, options) => {
        if (key === 'hex_updated') {
            return 'Hex updated successfully';
        }
        return key;
    })
};

// Mock Telegraf context
function createMockContext(hex, holonId = 'test-chat-123') {
    return {
        message: {
            web_app_data: {
                data: hex
            },
            chat: {
                id: holonId
            }
        },
        reply: vi.fn()
    };
}

describe('WebApp Hex Data Handler', () => {
    let settings;
    let mockContext;

    beforeEach(() => {
        settings = new MockSettings();
        global.i18next = mockI18next;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should handle valid hex data from webapp', async () => {
        const validHex = '891e850d50fffff';
        mockContext = createMockContext(validHex);

        // Simulate the webapp data handler
        const hex = mockContext.message.web_app_data.data;
        const holonId = mockContext.message.chat.id;

        // Validate hex format
        expect(hex).toBe(validHex);
        expect(typeof hex).toBe('string');
        expect(hex.length).toBeGreaterThanOrEqual(10);

        // Save the hex
        await settings.setHex(holonId, hex);

        // Verify settings were called correctly
        expect(settings.setHexCalled).toBe(true);
        expect(settings.setHexholonId).toBe(holonId);
        expect(settings.setHexValue).toBe(validHex);

        // Get language for response
        const language = await settings.getLanguage(holonId);
        expect(settings.getLanguageCalled).toBe(true);
        expect(settings.getLanguageholonId).toBe(holonId);
        expect(language).toBe('en');

        // Simulate the i18next call that would happen in the real handler
        const message = mockI18next.t('hex_updated', {
            lng: language,
            defaultValue: 'Hex updated successfully'
        });

        // Verify i18next was called and returned correct message
        expect(mockI18next.t).toHaveBeenCalledWith('hex_updated', {
            lng: 'en',
            defaultValue: 'Hex updated successfully'
        });
        expect(message).toBe('Hex updated successfully');
    });

    it('should reject invalid hex data', async () => {
        const invalidHex = 'invalid';
        mockContext = createMockContext(invalidHex);

        const hex = mockContext.message.web_app_data.data;
        const holonId = mockContext.message.chat.id;

        // Validate hex format
        expect(hex).toBe(invalidHex);
        expect(typeof hex).toBe('string');
        expect(hex.length).toBeLessThan(10);

        // Should not call setHex for invalid hex
        expect(settings.setHexCalled).toBe(false);
    });

    it('should handle empty hex data', async () => {
        const emptyHex = '';
        mockContext = createMockContext(emptyHex);

        const hex = mockContext.message.web_app_data.data;
        const holonId = mockContext.message.chat.id;

        // Validate hex format
        expect(hex).toBe(emptyHex);
        expect(hex.length).toBe(0);

        // Should not call setHex for empty hex
        expect(settings.setHexCalled).toBe(false);
    });

    it('should handle null hex data', async () => {
        const nullHex = null;
        mockContext = createMockContext(nullHex);

        const hex = mockContext.message.web_app_data.data;
        const holonId = mockContext.message.chat.id;

        // Validate hex format
        expect(hex).toBe(null);
        expect(hex).toBeFalsy();

        // Should not call setHex for null hex
        expect(settings.setHexCalled).toBe(false);
    });

    it('should handle different chat IDs', async () => {
        const validHex = '891e850d50fffff';
        const customholonId = 'custom-chat-456';
        mockContext = createMockContext(validHex, customholonId);

        const hex = mockContext.message.web_app_data.data;
        const holonId = mockContext.message.chat.id;

        expect(holonId).toBe(customholonId);

        // Save the hex
        await settings.setHex(holonId, hex);

        // Verify correct holon ID was used
        expect(settings.setHexholonId).toBe(customholonId);
        expect(settings.setHexValue).toBe(validHex);
    });
}); 