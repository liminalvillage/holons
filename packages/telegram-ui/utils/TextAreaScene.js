/**
 * TextAreaScene.js
 *
 * A reusable utility scene for extended text input.
 * Wrapper around InputScene with specific configuration for longer text.
 *
 * Features:
 * - Character count hints
 * - Min/max length validation
 * - Multi-line support indication
 *
 * Usage:
 * ```javascript
 * ctx.scene.enter('textarea_scene', {
 *   prompt: 'Tell us about yourself:',
 *   minLength: 50,
 *   maxLength: 2000,
 *   onComplete: async (ctx, text) => {
 *     console.log('User entered:', text);
 *   }
 * });
 * ```
 */

import { Scenes } from 'telegraf';

export default class TextAreaScene {
  constructor(bot) {
    this.bot = bot;
    this.scene = new Scenes.BaseScene('textarea_scene');
    this.setupScene();
    this.bot.stage.register(this.scene);
  }

  setupScene() {
    this.scene.enter(async ctx => {
      try {
        const state = ctx.scene.state;

        // Validate required parameters
        if (!state.onComplete || typeof state.onComplete !== 'function') {
          console.error('TextAreaScene: onComplete callback is required');
          await ctx.reply('Error: Invalid scene configuration');
          return ctx.scene.leave();
        }

        // Build prompt with length hints
        let prompt = state.prompt || 'Please enter your response:';

        // Add length hints
        if (state.minLength || state.maxLength) {
          const hints = [];
          if (state.minLength)
            hints.push(`minimum ${state.minLength} characters`);
          if (state.maxLength)
            hints.push(`maximum ${state.maxLength} characters`);
          prompt += `\n\n📝 (${hints.join(', ')})`;
        }

        // Create validation function
        const validate = input => {
          if (state.minLength && input.length < state.minLength) {
            return {
              valid: false,
              error: `Please write at least ${state.minLength} characters. You wrote ${input.length}.`,
            };
          }
          if (state.maxLength && input.length > state.maxLength) {
            return {
              valid: false,
              error: `Please keep your response under ${state.maxLength} characters. You wrote ${input.length}.`,
            };
          }
          // Run custom validation if provided
          if (state.validate && typeof state.validate === 'function') {
            return state.validate(input);
          }
          return { valid: true };
        };

        // Delegate to InputScene with textarea-specific config
        return ctx.scene.enter('input_scene', {
          promptText: prompt,
          allowEmpty: state.allowEmpty || false,
          validate: validate,
          onComplete: state.onComplete,
          onCancel: state.onCancel,
          showCancelButton: state.showCancelButton !== false,
        });
      } catch (error) {
        console.error('TextAreaScene enter error:', error);
        await ctx.reply('An error occurred. Please try again.');
        return ctx.scene.leave();
      }
    });
  }
}
