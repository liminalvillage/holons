/**
 * MultiSelectScene.js
 *
 * A reusable utility scene for multi-choice selection with pagination.
 * Follows the pattern of valuesScene.js but with configurable options.
 *
 * Features:
 * - Multi-choice with toggle selection (✅/☑️)
 * - Pagination for large option lists
 * - Optional "Other" with text input
 * - Configurable items per page
 * - Minimum/maximum selection validation
 *
 * Usage:
 * ```javascript
 * ctx.scene.enter('multi_select_scene', {
 *   prompt: 'Select your skills (choose all that apply):',
 *   options: [
 *     { value: 'coding', label: 'Coding' },
 *     { value: 'design', label: 'Design' },
 *     { value: 'writing', label: 'Writing' }
 *   ],
 *   allowOther: true,
 *   otherPrompt: 'Enter your custom skill:',
 *   itemsPerPage: 4,
 *   minSelections: 1,
 *   maxSelections: 5,
 *   onComplete: async (ctx, selectedValues) => {
 *     // selectedValues = ['coding', 'design'] or ['coding', 'other:My custom skill']
 *   }
 * });
 * ```
 */

import { Scenes, Markup } from 'telegraf';

export default class MultiSelectScene {
    constructor(bot) {
        this.bot = bot;
        this.scene = new Scenes.BaseScene('multi_select_scene');
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
                    console.error('MultiSelectScene: options array is required');
                    await ctx.reply('Error: Invalid scene configuration');
                    return ctx.scene.leave();
                }

                if (!state.onComplete || typeof state.onComplete !== 'function') {
                    console.error('MultiSelectScene: onComplete callback is required');
                    await ctx.reply('Error: Invalid scene configuration');
                    return ctx.scene.leave();
                }

                // Initialize selection state (preserve if re-entering)
                if (!ctx.session.mss) {
                    ctx.session.mss = {
                        page: 0,
                        selected: {},
                        customOthers: [],
                        itemsPerPage: state.itemsPerPage || 4
                    };
                }

                await this.showPage(ctx, state);

            } catch (error) {
                console.error('MultiSelectScene enter error:', error);
                await ctx.reply('An error occurred. Please try again.');
                return ctx.scene.leave();
            }
        });

        // Handle option toggle
        this.scene.action(/mss_toggle_(.+)/, async (ctx) => {
            try {
                await ctx.answerCbQuery();
                const value = ctx.match[1];
                ctx.session.mss.selected[value] = !ctx.session.mss.selected[value];
                await this.updateKeyboard(ctx);
            } catch (error) {
                console.error('MultiSelectScene toggle error:', error);
            }
        });

        // Handle pagination - previous page
        this.scene.action('mss_prev', async (ctx) => {
            try {
                await ctx.answerCbQuery();
                ctx.session.mss.page--;
                await this.updateKeyboard(ctx);
            } catch (error) {
                console.error('MultiSelectScene prev error:', error);
            }
        });

        // Handle pagination - next page
        this.scene.action('mss_next', async (ctx) => {
            try {
                await ctx.answerCbQuery();
                ctx.session.mss.page++;
                await this.updateKeyboard(ctx);
            } catch (error) {
                console.error('MultiSelectScene next error:', error);
            }
        });

        // Handle no-op for page indicator
        this.scene.action('mss_noop', async (ctx) => {
            await ctx.answerCbQuery();
        });

        // Handle "Add Other" option
        this.scene.action('mss_other', async (ctx) => {
            try {
                await ctx.answerCbQuery();
                const state = ctx.scene.state;

                // Store current state to return after input
                const returnState = { ...state };

                return ctx.scene.enter('input_scene', {
                    promptText: state.otherPrompt || 'Please enter your custom option:',
                    showCancelButton: true,
                    onComplete: async (inputCtx, input) => {
                        // Add custom value to selections
                        const customKey = `other:${input}`;
                        inputCtx.session.mss.selected[customKey] = true;
                        inputCtx.session.mss.customOthers.push(input);

                        // Return to multi-select scene
                        return inputCtx.scene.enter('multi_select_scene', returnState);
                    },
                    onCancel: async (inputCtx) => {
                        return inputCtx.scene.enter('multi_select_scene', returnState);
                    }
                });
            } catch (error) {
                console.error('MultiSelectScene other error:', error);
            }
        });

        // Handle done selection
        this.scene.action('mss_done', async (ctx) => {
            try {
                await ctx.answerCbQuery();
                const state = ctx.scene.state;

                // Get selected values
                const selected = Object.keys(ctx.session.mss.selected)
                    .filter(k => ctx.session.mss.selected[k]);

                // Validate minimum selections
                if (state.minSelections && selected.length < state.minSelections) {
                    await ctx.reply(`Please select at least ${state.minSelections} option(s). You have selected ${selected.length}.`);
                    return;
                }

                // Validate maximum selections
                if (state.maxSelections && selected.length > state.maxSelections) {
                    await ctx.reply(`Please select no more than ${state.maxSelections} option(s). You have selected ${selected.length}.`);
                    return;
                }

                // Call completion callback
                await state.onComplete(ctx, selected);

                // Clean up session state
                delete ctx.session.mss;

                return ctx.scene.leave();

            } catch (error) {
                console.error('MultiSelectScene done error:', error);
                await ctx.reply('An error occurred. Please try again.');
            }
        });

        // Handle cancel
        this.scene.action('mss_cancel', async (ctx) => {
            try {
                await ctx.answerCbQuery();
                const state = ctx.scene.state;

                // Clean up session state
                delete ctx.session.mss;

                if (state.onCancel && typeof state.onCancel === 'function') {
                    await state.onCancel(ctx);
                } else {
                    await ctx.reply('Selection cancelled.');
                }

                return ctx.scene.leave();
            } catch (error) {
                console.error('MultiSelectScene cancel error:', error);
            }
        });
    }

    /**
     * Show the selection page with keyboard
     * @param {object} ctx - Telegraf context
     * @param {object} state - Scene state
     */
    async showPage(ctx, state) {
        const prompt = state.prompt || 'Select all that apply:';
        const keyboard = this.createKeyboard(ctx, state);

        await ctx.reply(prompt, Markup.inlineKeyboard(keyboard));
    }

    /**
     * Update the keyboard in place
     * @param {object} ctx - Telegraf context
     */
    async updateKeyboard(ctx) {
        const state = ctx.scene.state;
        const keyboard = this.createKeyboard(ctx, state);

        try {
            await ctx.editMessageReplyMarkup({ inline_keyboard: keyboard });
        } catch (e) {
            // If edit fails (message too old), send new message
            const prompt = state.prompt || 'Select all that apply:';
            await ctx.reply(prompt, Markup.inlineKeyboard(keyboard));
        }
    }

    /**
     * Create the inline keyboard with pagination
     * @param {object} ctx - Telegraf context
     * @param {object} state - Scene state
     * @returns {array} - Keyboard button rows
     */
    createKeyboard(ctx, state) {
        const { page, selected, itemsPerPage, customOthers } = ctx.session.mss;
        const options = state.options;
        const totalPages = Math.ceil(options.length / itemsPerPage);

        const start = page * itemsPerPage;
        const end = Math.min(start + itemsPerPage, options.length);
        const pageOptions = options.slice(start, end);

        const buttons = [];

        // Option buttons for current page
        pageOptions.forEach(opt => {
            const isSelected = selected[opt.value];
            const prefix = isSelected ? '✅ ' : '☑️ ';
            buttons.push([Markup.button.callback(prefix + opt.label, `mss_toggle_${opt.value}`)]);
        });

        // Show custom "other" selections on last page
        if (page === totalPages - 1 && customOthers.length > 0) {
            customOthers.forEach(customValue => {
                const customKey = `other:${customValue}`;
                const isSelected = selected[customKey];
                const prefix = isSelected ? '✅ ' : '☑️ ';
                buttons.push([Markup.button.callback(prefix + customValue, `mss_toggle_${customKey}`)]);
            });
        }

        // Navigation row (only if more than one page)
        if (totalPages > 1) {
            const navRow = [];
            if (page > 0) {
                navRow.push(Markup.button.callback('◀️', 'mss_prev'));
            }
            navRow.push(Markup.button.callback(`${page + 1}/${totalPages}`, 'mss_noop'));
            if (page < totalPages - 1) {
                navRow.push(Markup.button.callback('▶️', 'mss_next'));
            }
            buttons.push(navRow);
        }

        // "Add Other" button if allowed
        if (state.allowOther) {
            buttons.push([Markup.button.callback('+ Add Other', 'mss_other')]);
        }

        // Action buttons row
        const actionRow = [];
        if (state.showCancelButton !== false) {
            actionRow.push(Markup.button.callback('Cancel', 'mss_cancel'));
        }
        actionRow.push(Markup.button.callback('Done ✓', 'mss_done'));
        buttons.push(actionRow);

        return buttons;
    }
}
