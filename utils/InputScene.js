/**
 * InputScene.js
 *
 * A reusable utility scene for collecting user input with translation support.
 * This scene provides a consistent interface for requesting and validating user input
 * across the entire bot, reducing code duplication and ensuring UI consistency.
 *
 * Features:
 * - Translated prompts via i18next
 * - Custom validation functions
 * - Auto-cleanup of messages (when bot has admin rights)
 * - Type validation (text, number, email, etc.)
 * - Error message customization
 * - Callback-based result handling
 *
 * IMPORTANT: Context Handling
 * The ctx parameter passed to onComplete() is the FRESH context from when the user
 * sent their text response, NOT the original context from when scene.enter() was called.
 * Always get chat IDs, user info, etc. from the ctx parameter in your callback:
 *
 * ✅ CORRECT:
 *   onComplete: async (ctx, input) => {
 *     const chatID = ctx.chat.id;  // Get fresh from callback ctx
 *     await db.put(chatID + '/data', input);
 *   }
 *
 * ❌ WRONG:
 *   const chatID = ctx.chat.id;  // From original command ctx
 *   onComplete: async (ctx, input) => {
 *     await db.put(chatID + '/data', input);  // Uses stale closure variable
 *   }
 *
 * Usage:
 * ```javascript
 * import InputScene from './utils/InputScene.js';
 *
 * const inputScene = new InputScene(bot);
 *
 * // Simple text input
 * ctx.scene.enter('input_scene', {
 *   promptKey: 'enter_description',  // i18next translation key
 *   promptText: 'Please enter a description:',  // OR direct text
 *   onComplete: async (ctx, input) => {
 *     // ALWAYS get values from ctx parameter, not closure
 *     const chatID = ctx.chat.id;
 *     quest.description = input;
 *     await db.put(chatID + '/quests', quest);
 *   }
 * });
 *
 * // With validation
 * ctx.scene.enter('input_scene', {
 *   promptText: 'Please enter your email:',
 *   inputType: 'email',
 *   validate: (input) => input.includes('@'),
 *   errorText: 'Invalid email format',
 *   onComplete: async (ctx, input) => {
 *     const userID = ctx.from.id;  // Get fresh from callback ctx
 *     user.email = input;
 *     await db.put(userID + '/profile', user);
 *   }
 * });
 * ```
 */

import { Scenes } from 'telegraf';
import i18next from 'i18next';
import * as utils from '../utilities.js';

export default class InputScene {
    constructor(bot) {
        this.bot = bot;

        // Create the reusable input scene
        this.scene = new Scenes.BaseScene('input_scene');

        // Scene entry handler
        this.scene.enter(async (ctx) => {
            try {
                const state = ctx.scene.state;

                // Validate required parameters
                if (!state.onComplete || typeof state.onComplete !== 'function') {
                    console.error('InputScene: onComplete callback is required');
                    await ctx.reply('Error: Invalid scene configuration');
                    return ctx.scene.leave();
                }

                // Determine the prompt message
                let promptText;
                if (state.promptKey) {
                    // Use i18next translation
                    promptText = i18next.t(state.promptKey, state.promptParams || {});
                } else if (state.promptText) {
                    // Use direct text
                    promptText = state.promptText;
                } else {
                    // Default fallback
                    promptText = i18next.t('input_scene_default_prompt', 'Please enter your input:');
                }

                // Add format hint if provided
                if (state.formatHint) {
                    promptText += '\n\n' + (state.formatHintKey
                        ? i18next.t(state.formatHintKey, state.formatHintParams || {})
                        : state.formatHint);
                }

                // Add example if provided
                if (state.example) {
                    promptText += '\n\n' + i18next.t('input_scene_example', 'Example:') + ' ' + state.example;
                }

                // Send the prompt and store message ID for cleanup
                const promptMessage = await ctx.reply(promptText);
                ctx.scene.state.promptMessageId = promptMessage.message_id;

            } catch (error) {
                console.error('InputScene enter error:', error);
                await ctx.reply('An error occurred. Please try again.');
                return ctx.scene.leave();
            }
        });

        // Handle text input
        this.scene.on('text', async (ctx) => {
            try {
                const state = ctx.scene.state;
                const input = ctx.message.text.trim();

                // Check for cancel command
                if (input === '/cancel' || input.toLowerCase() === 'cancel') {
                    await this.cleanup(ctx);

                    const cancelText = state.cancelText || i18next.t('input_scene_cancelled', 'Input cancelled.');
                    await ctx.reply(cancelText);

                    if (state.onCancel && typeof state.onCancel === 'function') {
                        await state.onCancel(ctx);
                    }

                    return ctx.scene.leave();
                }

                // Validate empty input
                if (!state.allowEmpty && input === '') {
                    const errorText = state.emptyErrorText || i18next.t('input_scene_empty_error', 'Input cannot be empty. Please try again.');
                    await ctx.reply(errorText);
                    return;
                }

                // Type validation
                const typeValidation = this.validateType(input, state.inputType);
                if (!typeValidation.valid) {
                    const errorText = state.typeErrorText || typeValidation.error;
                    await ctx.reply(errorText);
                    return;
                }

                // Custom validation
                if (state.validate && typeof state.validate === 'function') {
                    const validationResult = await state.validate(input, ctx);

                    if (validationResult === false ||
                        (typeof validationResult === 'object' && !validationResult.valid)) {

                        const errorText = state.errorText ||
                            (typeof validationResult === 'object' ? validationResult.error : null) ||
                            i18next.t('input_scene_validation_error', 'Invalid input. Please try again.');

                        await ctx.reply(errorText);
                        return;
                    }
                }

                // Transform input if transformer provided
                let finalInput = input;
                if (state.transform && typeof state.transform === 'function') {
                    finalInput = await state.transform(input, ctx);
                }

                // Parse input based on type
                finalInput = this.parseInput(finalInput, state.inputType);

                // Clean up messages
                await this.cleanup(ctx);

                // Call the completion callback with the CURRENT context (from user's text response)
                // NOTE: The ctx here is the fresh context from when the user sent their text,
                // NOT the original context from when scene.enter() was called.
                // Always use ctx.chat.id, ctx.from, etc. from this ctx parameter in your callback.
                await state.onComplete(ctx, finalInput);

                // Leave the scene
                return ctx.scene.leave();

            } catch (error) {
                console.error('InputScene text handler error:', error);

                const errorText = ctx.scene.state.errorText ||
                    i18next.t('input_scene_error', 'An error occurred. Please try again.');

                await ctx.reply(errorText);

                // Call error callback if provided
                if (ctx.scene.state.onError && typeof ctx.scene.state.onError === 'function') {
                    await ctx.scene.state.onError(ctx, error);
                }

                return ctx.scene.leave();
            }
        });

        // Handle non-text messages
        this.scene.on('message', async (ctx) => {
            const state = ctx.scene.state;

            // Check if location is allowed and message is location
            if (state.allowLocation && ctx.message.location) {
                try {
                    await this.cleanup(ctx);
                    await state.onComplete(ctx, ctx.message.location);
                    return ctx.scene.leave();
                } catch (error) {
                    console.error('InputScene location handler error:', error);
                }
            }

            // Otherwise, request text input
            const errorText = state.nonTextErrorText ||
                i18next.t('input_scene_text_only', 'Please send text only.');

            await ctx.reply(errorText).catch(e => console.log('Error sending reply:', e));
        });

        // Register the scene
        this.bot.stage.register(this.scene);
    }

    /**
     * Validate input based on type
     * @param {string} input - The input to validate
     * @param {string} type - The type to validate against
     * @returns {object} - Validation result { valid: boolean, error: string }
     */
    validateType(input, type) {
        if (!type) {
            return { valid: true };
        }

        switch (type.toLowerCase()) {
            case 'number':
            case 'numeric':
                if (isNaN(input) || input.trim() === '') {
                    return {
                        valid: false,
                        error: i18next.t('input_scene_number_error', 'Please enter a valid number.')
                    };
                }
                return { valid: true };

            case 'integer':
            case 'int':
                if (!Number.isInteger(Number(input)) || input.trim() === '') {
                    return {
                        valid: false,
                        error: i18next.t('input_scene_integer_error', 'Please enter a valid integer.')
                    };
                }
                return { valid: true };

            case 'email':
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(input)) {
                    return {
                        valid: false,
                        error: i18next.t('input_scene_email_error', 'Please enter a valid email address.')
                    };
                }
                return { valid: true };

            case 'url':
                try {
                    new URL(input);
                    return { valid: true };
                } catch {
                    return {
                        valid: false,
                        error: i18next.t('input_scene_url_error', 'Please enter a valid URL.')
                    };
                }

            case 'array':
            case 'list':
                // Will be parsed later
                return { valid: true };

            default:
                return { valid: true };
        }
    }

    /**
     * Parse input based on type
     * @param {string} input - The input to parse
     * @param {string} type - The type to parse to
     * @returns {any} - Parsed input
     */
    parseInput(input, type) {
        if (!type) {
            return input;
        }

        switch (type.toLowerCase()) {
            case 'number':
            case 'numeric':
                return Number(input);

            case 'integer':
            case 'int':
                return parseInt(input, 10);

            case 'array':
            case 'list':
                return input
                    .split(/[,\n]/)
                    .map(item => item.trim())
                    .filter(item => item !== '');

            case 'boolean':
            case 'bool':
                return input.toLowerCase() === 'true' || input === '1' || input.toLowerCase() === 'yes';

            default:
                return input;
        }
    }

    /**
     * Clean up messages (prompt and user input)
     * @param {object} ctx - Telegraf context
     */
    async cleanup(ctx) {
        try {
            const botHasAdminRights = await utils.isBotAdmin(ctx);

            if (botHasAdminRights) {
                // Delete prompt message
                if (ctx.scene.state.promptMessageId) {
                    await ctx.deleteMessage(ctx.scene.state.promptMessageId).catch(() => {});
                }

                // Delete user input message
                if (ctx.message?.message_id) {
                    await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
                }
            }
        } catch (error) {
            console.error('InputScene cleanup error:', error);
        }
    }
}
