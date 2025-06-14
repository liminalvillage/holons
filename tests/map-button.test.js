import { describe, it, expect, beforeEach } from 'vitest';

// Mock the Settings class for testing
class MockSettings {
    constructor() {
        this.db = {
            getSettings: async () => ({
                language: 'en',
                hex: '891e850d50fffff'
            })
        };
    }

    async getLanguage(chatID) {
        return 'en';
    }

    getSettingIcon(type) {
        const icons = {
            hex: '✡️'
        };
        return icons[type] || '⚙️';
    }

    async showHexMenu(ctx, edit = false) {
        const chatID = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id || 'test-chat-123';
        const settings = await this.db.getSettings(chatID);
        const language = settings.language;
        const currentHex = settings.hex || '';

        const keyboard = {
            inline_keyboard: []
        };

        // Add header
        keyboard.inline_keyboard.push([{
            text: `${this.getSettingIcon('hex')} Hex`,
            callback_data: ' '
        }]);

        // Add current hex (if any)
        if (currentHex) {
            keyboard.inline_keyboard.push([{
                text: `• ${currentHex}`,
                callback_data: 'hex_view'
            }]);
        } else {
            keyboard.inline_keyboard.push([{
                text: 'Not set',
                callback_data: ' '
            }]);
        }

        // Add control buttons
        keyboard.inline_keyboard.push([{
            text: `✏️ Change`,
            callback_data: 'help_add_hex'
        }]);

        // Add map hexamap webapp button
        keyboard.inline_keyboard.push([{
            text: `🗺️ View on Map`,
            web_app: { url: `https://hexamap.holons.io/index.html?id=${chatID}` }
        }]);

        // Back button
        keyboard.inline_keyboard.push([{
            text: '« Back',
            callback_data: 'settings_back'
        }]);

        return keyboard;
    }
}

describe('Map Hexamap Webapp Button', () => {
    let settings;

    beforeEach(() => {
        settings = new MockSettings();
    });

    it('should add map button to hex menu', async () => {
        const mockCtx = {
            chat: { id: 'test-chat-123' }
        };

        const keyboard = await settings.showHexMenu(mockCtx);

        // Check that the keyboard has the expected structure
        expect(keyboard.inline_keyboard).toBeDefined();
        expect(keyboard.inline_keyboard.length).toBeGreaterThan(0);

        // Find the map button
        const mapButton = keyboard.inline_keyboard.find(row => 
            row.some(button => button.text && button.text.includes('🗺️'))
        );

        expect(mapButton).toBeDefined();
        expect(mapButton[0].text).toBe('🗺️ View on Map');
        expect(mapButton[0].web_app).toBeDefined();
        expect(mapButton[0].web_app.url).toBe('https://hexamap.holons.io/index.html?id=test-chat-123');
    });

    it('should include all required buttons in hex menu', async () => {
        const mockCtx = {
            chat: { id: 'test-chat-123' }
        };

        const keyboard = await settings.showHexMenu(mockCtx);

        const buttonTexts = keyboard.inline_keyboard.flat().map(button => button.text);

        // Check for required buttons
        expect(buttonTexts).toContain('✡️ Hex');
        expect(buttonTexts).toContain('• 891e850d50fffff');
        expect(buttonTexts).toContain('✏️ Change');
        expect(buttonTexts).toContain('🗺️ View on Map');
        expect(buttonTexts).toContain('« Back');
    });

    it('should generate correct webapp URL with chat ID', async () => {
        const mockCtx = {
            chat: { id: 'test-chat-123' }
        };

        const keyboard = await settings.showHexMenu(mockCtx);

        const mapButton = keyboard.inline_keyboard.find(row => 
            row.some(button => button.text && button.text.includes('🗺️'))
        );

        expect(mapButton[0].web_app.url).toBe('https://hexamap.holons.io/index.html?id=test-chat-123');
    });
}); 