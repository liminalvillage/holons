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
 *     const holonId = ctx.chat.id;  // Get fresh from callback ctx
 *     await db.put(holonId + '/data', input);
 *   }
 *
 * ❌ WRONG:
 *   const holonId = ctx.chat.id;  // From original command ctx
 *   onComplete: async (ctx, input) => {
 *     await db.put(holonId + '/data', input);  // Uses stale closure variable
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
 *     const holonId = ctx.chat.id;
 *     quest.description = input;
 *     await db.put(holonId + '/quests', quest);
 *   }
 * });
 *
 * // With onConfirm callback for UI refresh after async operations
 * ctx.scene.enter('input_scene', {
 *   promptText: 'Enter role name:',
 *   onComplete: async (ctx, input) => {
 *     const holonId = ctx.chat.id;
 *     await db.put(holonId + '/roles', { id: input, title: input });
 *     // Return value will be passed to onConfirm
 *     return { holonId: holonId, roleId: input };
 *   },
 *   onConfirm: async (ctx, result) => {
 *     // Called after onComplete finishes - use this to refresh UI
 *     // The result is whatever onComplete returned
 *     await refreshRoleList(ctx, result.holonId);
 *   }
 * });
 *
 * // With validation
 * ctx.scene.enter('input_scene', {
 *   promptText: 'Please enter your email:',
 *   inputType: 'email',
 *   validate: (input) => input.includes('@'),
 *   errorText: 'Invalid email format',
 *   showCancelButton: true,  // Default: true (shown automatically)
 *   onComplete: async (ctx, input) => {
 *     const userID = ctx.from.id;  // Get fresh from callback ctx
 *     user.email = input;
 *     await db.put(userID + '/profile', user);
 *   }
 * });
 *
 * // To disable cancel button
 * ctx.scene.enter('input_scene', {
 *   promptText: 'Enter required data:',
 *   showCancelButton: false,  // Explicitly disable
 *   onComplete: async (ctx, input) => { }
 * });
 * ```
 */

import { Scenes, Markup } from 'telegraf';
import i18next from 'i18next';
import * as utils from '../src/utilities.js';

/**
 * Reusable input scene for collecting user input with validation and translation support.
 *
 * @class InputScene
 * @module utils/InputScene
 * @description Provides a consistent interface for requesting and validating user input
 * across the entire bot. Supports text, number, email validation, custom validation,
 * array parsing, and auto-cleanup of messages.
 *
 * @property {Telegraf} bot - The Telegraf bot instance
 * @property {Scenes.BaseScene} scene - The Telegraf scene instance
 *
 * @example
 * const inputScene = new InputScene(bot);
 * ctx.scene.enter('input_scene', {
 *     promptText: 'Please enter a description:',
 *     onComplete: async (ctx, input) => {
 *         await saveData(ctx.chat.id, input);
 *     }
 * });
 */
export default class InputScene {
  /**
   * Creates a new InputScene instance and sets up the scene handlers.
   * @constructor
   * @param {Telegraf} bot - The Telegraf bot instance
   */
  constructor(bot) {
    this.bot = bot;

    this.scene = new Scenes.BaseScene('input_scene');

    // Scene entry handler
    this.scene.enter(async ctx => {
      try {
        const state = ctx.scene.state;

        // Validate required parameters
        if (!state.onComplete || typeof state.onComplete !== 'function') {
          console.error('InputScene: onComplete callback is required');
          await ctx.reply('Error: Invalid scene configuration');
          return ctx.scene.leave();
        }

        // Store array configuration if provided
        if (state.separator || state.customSeparator) {
          this.arrayConfig = {
            separator: state.separator,
            customSeparator: state.customSeparator,
            trimItems: state.trimItems,
            filterEmpty: state.filterEmpty,
          };
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
          promptText = i18next.t(
            'input_scene_default_prompt',
            'Please enter your input:'
          );
        }

        // Add format hint if provided
        if (state.formatHint) {
          promptText +=
            '\n\n' +
            (state.formatHintKey
              ? i18next.t(state.formatHintKey, state.formatHintParams || {})
              : state.formatHint);
        }

        // Add example if provided
        if (state.example) {
          promptText +=
            '\n\n' +
            i18next.t('input_scene_example', 'Example:') +
            ' ' +
            state.example;
        }

        // Build reply markup with cancel button (default: true)
        let replyMarkup = {};

        // Show cancel button by default unless explicitly disabled
        if (state.showCancelButton !== false) {
          const cancelText = state.cancelButtonKey
            ? i18next.t(state.cancelButtonKey, state.cancelButtonParams || {})
            : state.cancelButtonText || i18next.t('input_scene_cancel_button');

          replyMarkup = Markup.inlineKeyboard([
            Markup.button.callback(cancelText, 'input_scene_cancel'),
          ]);
        }

        // Send the prompt and store message ID for cleanup
        const promptMessage = await ctx.reply(promptText, replyMarkup);
        ctx.scene.state.promptMessageId = promptMessage.message_id;
      } catch (error) {
        console.error('InputScene enter error:', error);
        await ctx.reply('An error occurred. Please try again.');
        return ctx.scene.leave();
      }
    });

    // Handle text input
    this.scene.on('text', async ctx => {
      try {
        const state = ctx.scene.state;
        const input = ctx.message.text.trim();

        // Check for cancel command
        if (input === '/cancel' || input.toLowerCase() === 'cancel') {
          return this.handleCancel(ctx);
        }

        // Check if media is required
        if (state.requireMedia) {
          const errorText =
            state.requireMediaErrorText ||
            i18next.t(
              'input_scene_media_required',
              'Please send a file or media.'
            );
          await ctx.reply(errorText);
          return;
        }

        // Validate empty input
        if (!state.allowEmpty && input === '') {
          const errorText =
            state.emptyErrorText ||
            i18next.t(
              'input_scene_empty_error',
              'Input cannot be empty. Please try again.'
            );
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

          if (
            validationResult === false ||
            (typeof validationResult === 'object' && !validationResult.valid)
          ) {
            const errorText =
              state.errorText ||
              (typeof validationResult === 'object'
                ? validationResult.error
                : null) ||
              i18next.t(
                'input_scene_validation_error',
                'Invalid input. Please try again.'
              );

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
        const result = await state.onComplete(ctx, finalInput);

        // Call the onConfirm callback if provided (for UI refresh after async operations)
        // This is called after onComplete finishes, ensuring data is saved before UI update
        if (state.onConfirm && typeof state.onConfirm === 'function') {
          await state.onConfirm(ctx, result);
        }

        // Leave the scene
        return ctx.scene.leave();
      } catch (error) {
        console.error('InputScene text handler error:', error);

        const errorText =
          ctx.scene.state.errorText ||
          i18next.t(
            'input_scene_error',
            'An error occurred. Please try again.'
          );

        await ctx.reply(errorText);

        // Call error callback if provided
        if (
          ctx.scene.state.onError &&
          typeof ctx.scene.state.onError === 'function'
        ) {
          await ctx.scene.state.onError(ctx, error);
        }

        return ctx.scene.leave();
      }
    });

    // Handle non-text messages
    this.scene.on('message', async ctx => {
      try {
        const state = ctx.scene.state;
        const message = ctx.message;

        // Check if location is allowed and message is location
        if (state.allowLocation && message.location) {
          await this.cleanup(ctx);
          const result = await state.onComplete(ctx, message.location);

          // Call the onConfirm callback if provided
          if (state.onConfirm && typeof state.onConfirm === 'function') {
            await state.onConfirm(ctx, result);
          }
          return ctx.scene.leave();
        }

        // Check for media
        const media = this.detectMedia(message);

        if (media) {
          // Media found - check if allowed
          if (!state.allowMedia && !state.allowedMediaTypes) {
            const errorText =
              state.nonMediaErrorText ||
              i18next.t('input_scene_text_only', 'Please send text only.');
            return ctx.reply(errorText);
          }

          // Validate media
          const validation = await this.validateMediaInput(media, state, ctx);
          if (!validation.valid) {
            return ctx.reply(validation.error);
          }

          // Process media
          await this.cleanup(ctx);
          const result = await state.onComplete(ctx, media);

          // Call the onConfirm callback if provided
          if (state.onConfirm && typeof state.onConfirm === 'function') {
            await state.onConfirm(ctx, result);
          }
          return ctx.scene.leave();
        }

        // No recognized input
        if (state.requireMedia) {
          const errorText =
            state.requireMediaErrorText ||
            i18next.t(
              'input_scene_media_required',
              'Please send a file or media.'
            );
          return ctx.reply(errorText);
        }

        // Default: text only error
        const errorText =
          state.nonTextErrorText ||
          i18next.t('input_scene_text_only', 'Please send text only.');
        return ctx.reply(errorText);
      } catch (error) {
        console.error('InputScene message handler error:', error);
        await ctx.reply('An error occurred processing your input.');
      }
    });

    // Handle cancel button action
    this.scene.action('input_scene_cancel', async ctx => {
      try {
        await this.handleCancel(ctx);
      } catch (error) {
        console.error('InputScene cancel button error:', error);
        await ctx.answerCbQuery('Error cancelling input').catch(() => {});
      }
    });

    // Register the scene
    this.bot.stage.register(this.scene);
  }

  /**
   * Detect media in a Telegram message
   * @param {object} message - Telegram message object
   * @returns {object|null} - Media object or null
   */
  detectMedia(message) {
    const mediaTypes = [
      { type: 'photo', getter: msg => msg.photo?.[msg.photo.length - 1] },
      { type: 'document', getter: msg => msg.document },
      { type: 'video', getter: msg => msg.video },
      { type: 'audio', getter: msg => msg.audio },
      { type: 'voice', getter: msg => msg.voice },
      { type: 'sticker', getter: msg => msg.sticker },
      { type: 'animation', getter: msg => msg.animation },
    ];

    for (const { type, getter } of mediaTypes) {
      const file = getter(message);
      if (file) {
        return {
          type,
          fileId: file.file_id,
          file,
          caption: message.caption || null,
          message,
        };
      }
    }

    return null;
  }

  /**
   * Validate media input
   * @param {object} media - Media object from detectMedia
   * @param {object} state - Scene state
   * @param {object} ctx - Telegraf context
   * @returns {object} - Validation result { valid: boolean, error?: string }
   */
  async validateMediaInput(media, state, ctx) {
    // Check allowed types
    if (
      state.allowedMediaTypes &&
      !state.allowedMediaTypes.includes(media.type)
    ) {
      const allowed = state.allowedMediaTypes.join(', ');
      return {
        valid: false,
        error: i18next.t(
          'input_scene_media_type_error',
          `Please send one of: ${allowed}`,
          { allowed }
        ),
      };
    }

    // Custom validation
    if (state.validateMedia && typeof state.validateMedia === 'function') {
      const result = await state.validateMedia(media, ctx);
      if (result === false) {
        return { valid: false, error: 'Invalid media input' };
      }
      if (typeof result === 'object' && !result.valid) {
        return result;
      }
    }

    return { valid: true };
  }

  /**
   * Get file download link
   * @param {string} fileId - Telegram file_id
   * @param {object} ctx - Telegraf context
   * @returns {string} - File download URL
   */
  async getFileLink(fileId, ctx) {
    const fileLink = await ctx.telegram.getFileLink(fileId);
    return fileLink.href;
  }

  /**
   * Download file as Buffer
   * @param {string} fileId - Telegram file_id
   * @param {object} ctx - Telegraf context
   * @returns {Buffer} - File content as Buffer
   */
  async downloadFile(fileId, ctx) {
    try {
      // Use node's built-in fetch if available (Node 18+), otherwise use https
      const url = await this.getFileLink(fileId, ctx);

      if (typeof fetch !== 'undefined') {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      } else {
        // Fallback for older Node versions
        const https = await import('https');
        return new Promise((resolve, reject) => {
          https.get(url, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
          });
        });
      }
    } catch (error) {
      console.error('InputScene downloadFile error:', error);
      throw error;
    }
  }

  /**
   * Handle cancellation (from button or text command)
   * @param {object} ctx - Telegraf context
   */
  async handleCancel(ctx) {
    const state = ctx.scene.state;

    // Answer callback query if from button
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery().catch(() => {});
    }

    // Cleanup messages
    await this.cleanup(ctx);

    // Send confirmation
    const cancelText =
      state.cancelText ||
      i18next.t('input_scene_cancelled', 'Input cancelled.');
    await ctx.reply(cancelText);

    // Call custom handler
    if (state.onCancel && typeof state.onCancel === 'function') {
      await state.onCancel(ctx);
    }

    return ctx.scene.leave();
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
            error: i18next.t(
              'input_scene_number_error',
              'Please enter a valid number.'
            ),
          };
        }
        return { valid: true };

      case 'integer':
      case 'int':
        if (!Number.isInteger(Number(input)) || input.trim() === '') {
          return {
            valid: false,
            error: i18next.t(
              'input_scene_integer_error',
              'Please enter a valid integer.'
            ),
          };
        }
        return { valid: true };

      case 'email': {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(input)) {
          return {
            valid: false,
            error: i18next.t(
              'input_scene_email_error',
              'Please enter a valid email address.'
            ),
          };
        }
        return { valid: true };
      }

      case 'url':
        try {
          new URL(input);
          return { valid: true };
        } catch {
          return {
            valid: false,
            error: i18next.t(
              'input_scene_url_error',
              'Please enter a valid URL.'
            ),
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
   * Parse array input with flexible separator support
   * @param {string} input - The input string to parse
   * @param {object} config - Configuration object
   * @returns {array} - Parsed array
   */
  parseArray(input, config = {}) {
    const {
      separator = 'comma,newline', // Backward compatible default
      customSeparator = null,
      trimItems = true,
      filterEmpty = true,
    } = config;

    let regex;

    if (customSeparator) {
      // Escape special regex characters to prevent injection
      const escaped = customSeparator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      regex = new RegExp(escaped);
    } else if (separator === 'auto') {
      // Auto-detect common separators
      regex = /[,\n|\t;]/;
    } else {
      // Map separator names to regex patterns
      const SEPARATORS = {
        comma: ',',
        newline: '\\n',
        pipe: '\\|',
        tab: '\\t',
        semicolon: ';',
      };

      const separators = separator.split(',').map(s => s.trim());
      const patterns = separators.map(s => SEPARATORS[s] || s);
      regex = new RegExp(`[${patterns.join('')}]`);
    }

    let items = input.split(regex);

    if (trimItems) {
      items = items.map(item => item.trim());
    }

    if (filterEmpty) {
      items = items.filter(item => item !== '');
    }

    // Security: Limit max items to prevent DoS attacks
    const MAX_ITEMS = 1000;
    if (items.length > MAX_ITEMS) {
      console.warn(
        `InputScene: Truncating array from ${items.length} to ${MAX_ITEMS} items`
      );
      items = items.slice(0, MAX_ITEMS);
    }

    return items;
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
      case 'list': {
        // Use new parseArray method with config from scene state
        const arrayConfig = {
          separator: this.arrayConfig?.separator,
          customSeparator: this.arrayConfig?.customSeparator,
          trimItems: this.arrayConfig?.trimItems,
          filterEmpty: this.arrayConfig?.filterEmpty,
        };
        return this.parseArray(input, arrayConfig);
      }

      case 'boolean':
      case 'bool':
        return (
          input.toLowerCase() === 'true' ||
          input === '1' ||
          input.toLowerCase() === 'yes'
        );

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
          await ctx
            .deleteMessage(ctx.scene.state.promptMessageId)
            .catch(() => {});
        }

        // Delete user input message
        if (ctx.message?.message_id) {
          await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
        }
      }

      // Clear array configuration to prevent state leakage
      this.arrayConfig = null;
    } catch (error) {
      console.error('InputScene cleanup error:', error);
    }
  }
}
