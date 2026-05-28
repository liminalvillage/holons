/**
 * SectionScene.js
 *
 * A reusable utility scene for displaying informational section headers.
 * Used to break up forms into logical sections with title and description
 * before continuing to the next field.
 *
 * Features:
 * - Title and description display
 * - Optional icon/emoji prefix
 * - "Continue" button to advance
 * - Optional image attachment
 *
 * Usage:
 * ```javascript
 * ctx.scene.enter('section_scene', {
 *   title: 'Personal Information',
 *   description: 'Let us get to know you better. Please fill in the following details.',
 *   icon: '📌',  // Optional, defaults to 📌
 *   continueText: 'Continue →',  // Optional
 *   image: './data/section_image.png',  // Optional image path
 *   onContinue: async (ctx) => {
 *     ctx.scene.enter('next_scene');
 *   }
 * });
 * ```
 */

import { Scenes, Markup } from 'telegraf';
import fs from 'fs';

export default class SectionScene {
  constructor(bot) {
    this.bot = bot;
    this.scene = new Scenes.BaseScene('section_scene');
    this.setupScene();
    this.bot.stage.register(this.scene);
  }

  setupScene() {
    this.scene.enter(async ctx => {
      try {
        const state = ctx.scene.state;

        const title = state.title || 'Section';
        const description = state.description || '';
        const icon = state.icon || '📌';
        const continueText = state.continueText || 'Continue →';

        // Build the message
        let message = `${icon} *${this.escapeMarkdown(title)}*`;
        if (description) {
          message += `\n\n${this.escapeMarkdown(description)}`;
        }

        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback(continueText, 'section_continue')],
        ]);

        // Send with or without image
        if (state.image && fs.existsSync(state.image)) {
          await ctx.replyWithPhoto(
            { source: fs.createReadStream(state.image) },
            {
              caption: message,
              parse_mode: 'Markdown',
              ...keyboard,
            }
          );
        } else {
          await ctx.reply(message, {
            parse_mode: 'Markdown',
            ...keyboard,
          });
        }
      } catch (error) {
        console.error('SectionScene enter error:', error);
        await ctx.reply('An error occurred. Please try again.');
        return ctx.scene.leave();
      }
    });

    this.scene.action('section_continue', async ctx => {
      try {
        await ctx.answerCbQuery();
        const state = ctx.scene.state;

        if (state.onContinue && typeof state.onContinue === 'function') {
          await state.onContinue(ctx);
        }

        return ctx.scene.leave();
      } catch (error) {
        console.error('SectionScene continue error:', error);
        await ctx.answerCbQuery('Error continuing').catch(() => {});
      }
    });
  }

  /**
   * Escape special Markdown characters
   * @param {string} text - Text to escape
   * @returns {string} - Escaped text
   */
  escapeMarkdown(text) {
    if (!text) return '';
    // Escape Markdown special characters for Telegram
    return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
  }
}
