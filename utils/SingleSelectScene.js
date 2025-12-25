/**
 * SingleSelectScene.js
 *
 * A reusable utility scene for single-choice selection with optional "Other" input.
 * Follows the pattern of categoriesScene.js but with configurable options.
 *
 * Features:
 * - Dynamic options from configuration
 * - Optional info buttons (ℹ️) for option descriptions
 * - "Other" option with text input fallback
 * - Consistent navigation with wizard flow support
 *
 * Usage:
 * ```javascript
 * ctx.scene.enter('single_select_scene', {
 *   prompt: 'What is your role?',
 *   options: [
 *     { value: 'developer', label: 'Developer' },
 *     { value: 'designer', label: 'Designer' },
 *     { value: 'other', label: 'Other' }
 *   ],
 *   allowOther: true,
 *   otherPrompt: 'Please describe your role:',
 *   infoDescriptions: {
 *     developer: 'Someone who writes code',
 *     designer: 'Someone who creates visual designs'
 *   },
 *   showInfoButtons: true,
 *   onComplete: async (ctx, result) => {
 *     // result = { value: 'developer' } or { value: 'other', customValue: 'My custom role' }
 *   }
 * });
 * ```
 */

import { Scenes, Markup } from 'telegraf';

export default class SingleSelectScene {
    constructor(bot) {
        this.bot = bot;
        this.scene = new Scenes.BaseScene('single_select_scene');
        this.setupScene();
        this.bot.stage.register(this.scene);
    }

    setupScene() {
        // Scene entry handler
        this.scene.enter(async (ctx) => {
            try {
                const state = ctx.scene.state;

                // Validate required parameters
                if (!state.options || !Array.isArray(state.options)) {
                    console.error('SingleSelectScene: options array is required');
                    await ctx.reply('Error: Invalid scene configuration');
                    return ctx.scene.leave();
                }

                if (!state.onComplete || typeof state.onComplete !== 'function') {
                    console.error('SingleSelectScene: onComplete callback is required');
                    await ctx.reply('Error: Invalid scene configuration');
                    return ctx.scene.leave();
                }

                const buttons = this.createButtons(state);
                const prompt = state.prompt || 'Please select an option:';

                await ctx.reply(prompt, Markup.inlineKeyboard(buttons));

            } catch (error) {
                console.error('SingleSelectScene enter error:', error);
                await ctx.reply('An error occurred. Please try again.');
                return ctx.scene.leave();
            }
        });

        // Handle option selection
        this.scene.action(/sss_select_(.+)/, async (ctx) => {
            try {
                await ctx.answerCbQuery();
                const state = ctx.scene.state;
                const value = ctx.match[1];

                // Check if "Other" was selected
                if (value === '__other__' && state.allowOther) {
                    // Enter InputScene for custom value
                    return ctx.scene.enter('input_scene', {
                        promptText: state.otherPrompt || 'Please enter your response:',
                        showCancelButton: true,
                        onComplete: async (inputCtx, input) => {
                            await state.onComplete(inputCtx, { value: 'other', customValue: input });
                        },
                        onCancel: async (inputCtx) => {
                            // Return to single select scene
                            return inputCtx.scene.enter('single_select_scene', state);
                        }
                    });
                }

                // Regular option selected
                await state.onComplete(ctx, { value });
                return ctx.scene.leave();

            } catch (error) {
                console.error('SingleSelectScene selection error:', error);
                await ctx.answerCbQuery('An error occurred').catch(() => {});
            }
        });

        // Handle info button clicks
        this.scene.action(/sss_info_(.+)/, async (ctx) => {
            try {
                const state = ctx.scene.state;
                const value = ctx.match[1];

                if (state.infoDescriptions && state.infoDescriptions[value]) {
                    await ctx.answerCbQuery(state.infoDescriptions[value], { show_alert: true });
                } else {
                    await ctx.answerCbQuery('No additional information available');
                }
            } catch (error) {
                console.error('SingleSelectScene info error:', error);
                await ctx.answerCbQuery('Error loading info').catch(() => {});
            }
        });

        // Handle cancel
        this.scene.action('sss_cancel', async (ctx) => {
            try {
                await ctx.answerCbQuery();
                const state = ctx.scene.state;

                if (state.onCancel && typeof state.onCancel === 'function') {
                    await state.onCancel(ctx);
                } else {
                    await ctx.reply('Selection cancelled.');
                }

                return ctx.scene.leave();
            } catch (error) {
                console.error('SingleSelectScene cancel error:', error);
            }
        });
    }

    /**
     * Create inline keyboard buttons from options
     * @param {object} state - Scene state with options configuration
     * @returns {array} - Array of button rows
     */
    createButtons(state) {
        const buttons = [];

        state.options.forEach(option => {
            const row = [Markup.button.callback(option.label, `sss_select_${option.value}`)];

            // Add info button if descriptions are available
            if (state.showInfoButtons && state.infoDescriptions && state.infoDescriptions[option.value]) {
                row.push(Markup.button.callback('ℹ️', `sss_info_${option.value}`));
            }

            buttons.push(row);
        });

        // Add "Other" option if allowed
        if (state.allowOther) {
            buttons.push([Markup.button.callback('Other (specify)', 'sss_select___other__')]);
        }

        // Add cancel button unless explicitly disabled
        if (state.showCancelButton !== false) {
            buttons.push([Markup.button.callback('Cancel', 'sss_cancel')]);
        }

        return buttons;
    }
}
