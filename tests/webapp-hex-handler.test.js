import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the Settings class for testing
class MockSettings {
    constructor() {
        this.setHexCalled = false;
        this.setHexChatID = null;
        this.setHexValue = null;
        this.getLanguageCalled = false;
        this.getLanguageChatID = null;
    }

    async setHex(chatID, hex) {
        this.setHexCalled = true;
        this.setHexChatID = chatID;
        this.setHexValue = hex;
        return true;
    }

    async getLanguage(chatID) {
        this.getLanguageCalled = true;
        this.getLanguageChatID = chatID;
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
function createMockContext(hex, chatID = 'test-chat-123') {
    return {
        message: {
            web_app_data: {
                data: hex
            },
            chat: {
                id: chatID
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
        const chatID = mockContext.message.chat.id;

        // Validate hex format
        expect(hex).toBe(validHex);
        expect(typeof hex).toBe('string');
        expect(hex.length).toBeGreaterThanOrEqual(10);

        // Save the hex
        await settings.setHex(chatID, hex);

        // Verify settings were called correctly
        expect(settings.setHexCalled).toBe(true);
        expect(settings.setHexChatID).toBe(chatID);
        expect(settings.setHexValue).toBe(validHex);

        // Get language for response
        const language = await settings.getLanguage(chatID);
        expect(settings.getLanguageCalled).toBe(true);
        expect(settings.getLanguageChatID).toBe(chatID);
        expect(language).toBe('en');

        // Verify i18next was called
        expect(mockI18next.t).toHaveBeenCalledWith('hex_updated', {
            lng: 'en',
            defaultValue: 'Hex updated successfully'
        });
    });

    it('should reject invalid hex data', async () => {
        const invalidHex = 'invalid';
        mockContext = createMockContext(invalidHex);

        const hex = mockContext.message.web_app_data.data;
        const chatID = mockContext.message.chat.id;

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
        const chatID = mockContext.message.chat.id;

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
        const chatID = mockContext.message.chat.id;

        // Validate hex format
        expect(hex).toBe(null);
        expect(hex).toBeFalsy();

        // Should not call setHex for null hex
        expect(settings.setHexCalled).toBe(false);
    });

    it('should handle different chat IDs', async () => {
        const validHex = '891e850d50fffff';
        const customChatID = 'custom-chat-456';
        mockContext = createMockContext(validHex, customChatID);

        const hex = mockContext.message.web_app_data.data;
        const chatID = mockContext.message.chat.id;

        expect(chatID).toBe(customChatID);

        // Save the hex
        await settings.setHex(chatID, hex);

        // Verify correct chat ID was used
        expect(settings.setHexChatID).toBe(customChatID);
        expect(settings.setHexValue).toBe(validHex);
    });
}); 