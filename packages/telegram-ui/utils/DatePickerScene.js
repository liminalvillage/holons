/**
 * DatePickerScene.js
 *
 * A reusable utility scene for date selection.
 * Wrapper around the existing Calendar component.
 *
 * Features:
 * - Calendar-based date selection
 * - Relative date constraints (minDate: "today", maxDate: "+365days")
 * - Reference to other fields (minDate: "arrival_date")
 * - Optional time selection
 *
 * Usage:
 * ```javascript
 * ctx.scene.enter('date_picker_scene', {
 *   prompt: 'When would you like to arrive?',
 *   dateConfig: {
 *     minDate: 'today',
 *     maxDate: '+365days',
 *     includeTime: false
 *   },
 *   onComplete: async (ctx, dateString) => {
 *     console.log('Selected date:', dateString);  // e.g., "2024-03-15"
 *   }
 * });
 * ```
 */

import { Scenes } from 'telegraf';
import { Calendar } from '../src/Calendar.js';

export default class DatePickerScene {
  constructor(bot) {
    this.bot = bot;
    this.scene = new Scenes.BaseScene('date_picker_scene');
    this.setupScene();
    this.bot.stage.register(this.scene);
  }

  setupScene() {
    this.scene.enter(async ctx => {
      try {
        const state = ctx.scene.state;

        // Validate required parameters
        if (!state.onComplete || typeof state.onComplete !== 'function') {
          console.error('DatePickerScene: onComplete callback is required');
          await ctx.reply('Error: Invalid scene configuration');
          return ctx.scene.leave();
        }

        // Store callback in session for calendar handler
        ctx.session.datePickerCallback = state.onComplete;
        ctx.session.datePickerConfig = state.dateConfig || {};

        // Send prompt
        const prompt = state.prompt || 'Please select a date:';
        await ctx.reply(prompt);

        // Build calendar options
        const calendarOptions = {
          date_format: 'YYYY-MM-DD',
          time_selector_mod: state.dateConfig?.includeTime || false,
          language: state.language || 'en',
          bot_api: 'telegraf',
        };

        // Apply date constraints
        if (state.dateConfig?.minDate) {
          calendarOptions.start_date = this.resolveDate(
            state.dateConfig.minDate,
            ctx
          );
        }
        if (state.dateConfig?.maxDate) {
          calendarOptions.stop_date = this.resolveDate(
            state.dateConfig.maxDate,
            ctx
          );
        }

        // Store calendar instance in session
        ctx.session.datePickerCalendar = new Calendar(
          ctx.telegraf,
          calendarOptions
        );
        ctx.session.datePickerCalendar.startNavCalendar(
          ctx,
          calendarOptions.language
        );
      } catch (error) {
        console.error('DatePickerScene enter error:', error);
        await ctx.reply('An error occurred. Please try again.');
        return ctx.scene.leave();
      }
    });

    // Handle calendar selection
    this.scene.on('callback_query', async ctx => {
      try {
        const data = ctx.callbackQuery.data;

        // Check if this is a date selection callback from Calendar
        // Calendar uses pattern: n_YYYY-MM-DD_0 for date selection
        if (data && ctx.session.datePickerCalendar) {
          const result =
            ctx.session.datePickerCalendar.clickButtonCalendar(ctx);

          // Result is -1 for navigation, date string for selection
          if (result && result !== -1) {
            const callback = ctx.session.datePickerCallback;

            // Clean up session
            delete ctx.session.datePickerCallback;
            delete ctx.session.datePickerConfig;
            delete ctx.session.datePickerCalendar;

            // Call completion callback
            if (callback) {
              await callback(ctx, result);
            }

            return ctx.scene.leave();
          }
        }
      } catch (error) {
        console.error('DatePickerScene callback error:', error);
      }
    });
  }

  /**
   * Resolve a date specification to a Date object
   * @param {string} dateSpec - Date specification (e.g., "today", "+30days", "2024-01-01")
   * @param {object} ctx - Telegraf context for accessing session data
   * @returns {Date} - Resolved date
   */
  resolveDate(dateSpec, ctx) {
    if (!dateSpec) return null;

    // Handle "today"
    if (dateSpec === 'today') {
      return new Date();
    }

    // Handle relative dates like "+365days", "-30days", "+6months", "+1year"
    const relativeMatch = dateSpec.match(/^([+-])(\d+)(days?|months?|years?)$/);
    if (relativeMatch) {
      const sign = relativeMatch[1] === '+' ? 1 : -1;
      const amount = parseInt(relativeMatch[2]) * sign;
      const unit = relativeMatch[3].replace(/s$/, ''); // Remove plural 's'
      const date = new Date();

      switch (unit) {
        case 'day':
          date.setDate(date.getDate() + amount);
          break;
        case 'month':
          date.setMonth(date.getMonth() + amount);
          break;
        case 'year':
          date.setFullYear(date.getFullYear() + amount);
          break;
      }

      return date;
    }

    // Handle field reference (e.g., "arrival_date" - get from session booking data)
    if (ctx.session?.booking?.data?.[dateSpec]) {
      return new Date(ctx.session.booking.data[dateSpec]);
    }

    // Handle ISO date string
    const parsedDate = new Date(dateSpec);
    if (!isNaN(parsedDate.getTime())) {
      return parsedDate;
    }

    // Default to today if parsing fails
    console.warn(
      `DatePickerScene: Could not parse date spec "${dateSpec}", defaulting to today`
    );
    return new Date();
  }
}
