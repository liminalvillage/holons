/**
 * @fileoverview Telegram UI for date and time selection.
 *
 * Pure date math (week-day rotation, days-in-month, time-step parsing) is
 * delegated to `@holons/core/calendar`. Inline-keyboard rendering and
 * Telegraf wiring stay here.
 *
 * @module src/Calendar
 */

import { readFile } from 'fs/promises';
import { createRequire } from 'module';
import dayjs from 'dayjs';

// NOTE: `@holons/core/calendar` is being extracted in parallel by Phase B
// Unit 10. Until it lands the import will fail to resolve. The structural
// delegation below is intentional so swap-in is a single-line change.
// @ts-expect-error -- target import; module appears once Unit 10 lands.
import type { CalendarService as CoreCalendarService } from '@holons/core/calendar';

const lang: Record<string, Record<string, any>> = JSON.parse(
  await readFile(new URL('../data/locales.json', import.meta.url), 'utf8'),
);

// ----------------------------------------------------------------------------
// Local types
// ----------------------------------------------------------------------------

interface CalendarOptions {
  language?: string;
  date_format?: string;
  bot_api?: 'node-telegram-bot-api' | 'telegraf' | 'telebot' | 'grammy';
  close_calendar?: boolean;
  start_week_day?: number;
  time_selector_mod?: boolean;
  time_range?: string;
  time_step?: string;
  start_date?: string | Date | false;
  stop_date?: string | Date | false;
  custom_start_msg?: string | false;
}

type ResolvedCalendarOptions = Required<CalendarOptions>;

interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

interface InlineKeyboard {
  resize_keyboard?: boolean;
  inline_keyboard: Array<Array<InlineKeyboardButton | Record<string, never>>>;
}

/**
 * Pure-domain helpers mirroring `@holons/core/calendar`.
 */
interface CalendarServiceLike {
  daysInMonth(year: number, month1Based: number): number;
  weekDay(day: number, startWeekDay: number): number;
  startWeekDay(day: number, startWeekDay: number): number;
  twoDigits(n: number): string;
  parseTimeStep(step: string): { value: number; unit: string };
}

const LocalCalendarService: CalendarServiceLike = {
  daysInMonth(year: number, month1Based: number): number {
    const date1 = new Date(year, month1Based - 1, 1);
    const date2 = new Date(year, month1Based, 1);
    return Math.round((+date2 - +date1) / 1000 / 3600 / 24);
  },
  weekDay(day: number, startWeekDay: number): number {
    return day + startWeekDay > 6 ? day + startWeekDay - 7 : day + startWeekDay;
  },
  startWeekDay(day: number, startWeekDay: number): number {
    return day - startWeekDay < 0 ? day - startWeekDay + 7 : day - startWeekDay;
  },
  twoDigits(n: number): string {
    return n < 10 ? ('0' + n).slice(-2) : String(n);
  },
  parseTimeStep(step: string) {
    return {
      value: Number(step.slice(0, -1)) || 0,
      unit: step.slice(-1),
    };
  },
};

// ----------------------------------------------------------------------------
// Calendar UI class
// ----------------------------------------------------------------------------

interface AnyTelegrafCtx {
  callbackQuery: { data: string; message: { chat: { id: number | string }; message_id: number } };
  chat?: { id: number | string };
  session?: unknown;
  telegram: any;
  update: any;
  reply: (text: string, extra?: unknown) => Promise<any>;
  editMessageReplyMarkup: (markup: unknown) => Promise<unknown>;
  deleteMessage: () => Promise<unknown>;
  answerCbQuery: () => Promise<unknown>;
}

interface BotLike {
  action: (
    pattern: string | RegExp,
    handler: (ctx: AnyTelegrafCtx) => Promise<unknown>,
  ) => unknown;
  editMessageReplyMarkup: (...args: any[]) => unknown;
  sendMessage: (chatId: any, text: string, extra?: any) => any;
  deleteMessage: (chatId: any, messageId: any) => unknown;
}

export class Calendar {
  /** Flag to track if bot actions have been registered */
  static actionsRegistered = false;

  options: ResolvedCalendarOptions;
  bot: BotLike | false;
  chats: Map<number, number>;
  questIds: Map<string | number, string>;
  /** Domain helpers. Type matches the future `@holons/core/calendar` API. */
  service: CalendarServiceLike;

  // Bound API method references (assigned by libraryInitialization).
  editMessageReplyMarkupCalendar: any;
  editMessageReplyMarkupTime: any;
  sendMessageCalendar: any;
  sendMessageTime: any;
  deleteMessage: any;
  replyMarkupObject: any;
  clickButtonCalendar: any;
  startNavCalendar: any;
  startTimeSelector: any;

  constructor(bot: BotLike | false = false, options: CalendarOptions = {}) {
    const opts: ResolvedCalendarOptions = {
      language: options.language ?? 'en',
      date_format: options.date_format ?? 'YYYY-MM-DD',
      bot_api: options.bot_api ?? 'node-telegram-bot-api',
      close_calendar: options.close_calendar ?? true,
      start_week_day: options.start_week_day ?? 0,
      time_selector_mod: options.time_selector_mod ?? false,
      time_range: options.time_range ?? '00:00-23:59',
      time_step: options.time_step ?? '30m',
      start_date: options.start_date ?? false,
      stop_date: options.stop_date ?? false,
      custom_start_msg: options.custom_start_msg ?? false,
    };
    this.options = opts;
    this.bot = bot;
    this.chats = new Map();
    this.questIds = new Map();
    this.service = LocalCalendarService;
    this.addCustomStartMsg();
    this.libraryInitialization();

    if (this.bot && !Calendar.actionsRegistered) {
      Calendar.actionsRegistered = true;
      this.bot.action(/n_(.+)_(?:--|\+\+|\+|-|0)/, async (ctx) => {
        const result = await this.clickButtonCalendar(ctx);
        if (result !== -1) {
          const timeMarkup = this.createTimeSelector(
            result,
            true,
            ctx.callbackQuery.message.chat.id,
          );
          await ctx.editMessageReplyMarkup(timeMarkup);
        }
        await ctx.answerCbQuery().catch(() => {});
      });
    }
  }

  // --------------------------------------------------------------------------
  // Bot-API specific adapters
  // --------------------------------------------------------------------------

  NodeTelegramBotApi: any = {
    editMessageReplyMarkupCalendar(this: Calendar, date: any, query: any) {
      (this.bot as BotLike).editMessageReplyMarkup(
        this.createNavigationKeyboard(date, query.message.chat.id),
        { message_id: query.message.message_id, chat_id: query.message.chat.id },
      );
    },
    editMessageReplyMarkupTime(this: Calendar, date: any, query: any, from_calendar: boolean) {
      (this.bot as BotLike).editMessageReplyMarkup(
        this.createTimeSelector(date, from_calendar, query.message.chat.id),
        { message_id: query.message.message_id, chat_id: query.message.chat.id },
      );
    },
    sendMessageCalendar(this: Calendar, menu: any, msg: any) {
      const l =
        this.options.time_selector_mod === true
          ? lang.selectdatetime[this.options.language]
          : lang.select[this.options.language];
      (this.bot as BotLike)
        .sendMessage(msg.chat.id, l, menu)
        .then((msg_promise: any) =>
          this.chats.set(msg_promise.chat.id, msg_promise.message_id),
        );
    },
    sendMessageTime(this: Calendar, menu: any, msg: any) {
      (this.bot as BotLike)
        .sendMessage(msg.chat.id, lang.selecttime[this.options.language], menu)
        .then((msg_promise: any) =>
          this.chats.set(msg_promise.chat.id, msg_promise.message_id),
        );
    },
    deleteMessage(this: Calendar, query: any) {
      (this.bot as BotLike).deleteMessage(
        query.message.chat.id,
        query.message.message_id,
      );
    },
    replyMarkupObject(_this: Calendar, cnk: any) {
      const menu: any = {};
      menu.reply_markup = cnk;
      return menu;
    },
    clickButtonCalendar(this: Calendar, query: any) {
      if (query.data == ' ') return -1;
      const code = query.data.split('_');
      let date: Date;
      let res: any = -1;
      if (code[0] == 'n') {
        switch (code[2]) {
          case '++':
            date = new Date(code[1]);
            date.setFullYear(date.getFullYear() + 1);
            this.editMessageReplyMarkupCalendar(date, query);
            break;
          case '--':
            date = new Date(code[1]);
            date.setFullYear(date.getFullYear() - 1);
            this.editMessageReplyMarkupCalendar(date, query);
            break;
          case '+':
            date = new Date(code[1]);
            if (date.getMonth() + 1 == 12) {
              date.setFullYear(date.getFullYear() + 1);
              date.setMonth(0);
            } else {
              date.setMonth(date.getMonth() + 1);
            }
            this.editMessageReplyMarkupCalendar(date, query);
            break;
          case '-':
            date = new Date(code[1]);
            if (date.getMonth() - 1 == -1) {
              date.setFullYear(date.getFullYear() - 1);
              date.setMonth(11);
            } else {
              date.setMonth(date.getMonth() - 1);
            }
            this.editMessageReplyMarkupCalendar(date, query);
            break;
          case '0':
            if (
              this.options.close_calendar === true &&
              this.options.time_selector_mod === false
            ) {
              this.deleteMessage(query);
              this.chats.delete(query.message.chat.id);
            }
            if (this.options.time_selector_mod === true) {
              this.editMessageReplyMarkupTime(
                dayjs(code[1]).format('YYYY-MM-DD HH:mm'),
                query,
                true,
              );
            } else {
              const require = createRequire(import.meta.url);
              require('dayjs/locale/' + this.options.language);
              res = dayjs(code[1])
                .locale(this.options.language)
                .format(this.options.date_format);
            }
        }
      } else if (code[0] == 't') {
        switch (code[2]) {
          case 'back':
            date = new Date(code[1]);
            date.setDate(1);
            this.editMessageReplyMarkupCalendar(date, query);
            break;
          case '1+':
            this.editMessageReplyMarkupTime(dayjs(code[1]), query, true);
            break;
          case '1-': {
            const { value, unit } = this.service.parseTimeStep(this.options.time_step);
            const d = dayjs(code[1]).subtract(16 * value, unit as any);
            this.editMessageReplyMarkupTime(d, query, true);
            break;
          }
          case '0+':
            this.editMessageReplyMarkupTime(dayjs(code[1]), query, false);
            break;
          case '0-': {
            const { value, unit } = this.service.parseTimeStep(this.options.time_step);
            const d = dayjs(code[1]).subtract(16 * value, unit as any);
            this.editMessageReplyMarkupTime(d, query, false);
            break;
          }
          case '0': {
            console.log(
              'TIME SELECTION TRIGGERED:',
              dayjs(code[1]).format('YYYY-MM-DD HH:mm'),
            );
            const require = createRequire(import.meta.url);
            require('dayjs/locale/' + this.options.language);
            res = dayjs(code[1])
              .locale(this.options.language)
              .format(this.options.date_format);
            console.log('RETURNING SELECTED TIME:', res);
          }
        }
      }
      return res;
    },
    startTimeSelector(this: Calendar, msg: any, holonId: any = null) {
      this.sendMessageTime(
        this.replyMarkupObject(this.createTimeSelector(undefined, false, holonId)),
        msg,
      );
    },
  };

  Telegraf: any = {
    editMessageReplyMarkupCalendar(this: Calendar, date: any, ctx: any) {
      ctx.editMessageReplyMarkup(
        this.createNavigationKeyboard(date, ctx.callbackQuery.message.chat.id),
      );
    },
    editMessageReplyMarkupTime(
      this: Calendar,
      date: any,
      ctx: any,
      from_calendar: boolean,
    ) {
      ctx.editMessageReplyMarkup(
        this.createTimeSelector(date, from_calendar, ctx.callbackQuery.message.chat.id),
      );
    },
    sendMessageCalendar(this: Calendar, menu: any, ctx: any, language: string) {
      const l =
        this.options.time_selector_mod === true
          ? lang.selectdatetime[language]
          : lang.select[language];
      if (!ctx.session)
        ctx.telegram
          .editMessageText(
            ctx.update.callback_query.message.chat.id,
            ctx.update.callback_query.message.message_id,
            null,
            l,
            menu,
          )
          .then((msg_promise: any) =>
            this.chats.set(msg_promise.chat.id, msg_promise.message_id),
          )
          .catch((err: any) => {
            console.log(err);
          });
      else
        ctx
          .reply(l, menu)
          .then((msg_promise: any) =>
            this.chats.set(msg_promise.chat.id, msg_promise.message_id),
          );
    },
    sendMessageTime(this: Calendar, menu: any, ctx: any) {
      ctx
        .reply(lang.selecttime[this.options.language], menu)
        .then((msg_promise: any) =>
          this.chats.set(msg_promise.chat.id, msg_promise.message_id),
        );
    },
    deleteMessage(_this: Calendar, ctx: any) {
      ctx.deleteMessage();
    },
    replyMarkupObject(_this: Calendar, cnk: any) {
      const menu: any = {};
      menu.reply_markup = cnk;
      return menu;
    },
    clickButtonCalendar(this: Calendar, ctx: any) {
      if (ctx.callbackQuery.data == ' ') return -1;
      const code = ctx.callbackQuery.data.split('_');
      let date: Date;
      let res: any = -1;
      if (code[0] == 'n') {
        switch (code[2]) {
          case '++':
            date = new Date(code[1]);
            date.setFullYear(date.getFullYear() + 1);
            this.editMessageReplyMarkupCalendar(date, ctx);
            break;
          case '--':
            date = new Date(code[1]);
            date.setFullYear(date.getFullYear() - 1);
            this.editMessageReplyMarkupCalendar(date, ctx);
            break;
          case '+':
            date = new Date(code[1]);
            if (date.getMonth() + 1 == 12) {
              date.setFullYear(date.getFullYear() + 1);
              date.setMonth(0);
            } else {
              date.setMonth(date.getMonth() + 1);
            }
            this.editMessageReplyMarkupCalendar(date, ctx);
            break;
          case '-':
            date = new Date(code[1]);
            if (date.getMonth() - 1 == -1) {
              date.setFullYear(date.getFullYear() - 1);
              date.setMonth(11);
            } else {
              date.setMonth(date.getMonth() - 1);
            }
            this.editMessageReplyMarkupCalendar(date, ctx);
            break;
          case '0':
            if (this.options.time_selector_mod === true) {
              this.editMessageReplyMarkupTime(
                dayjs(code[1]).format('YYYY-MM-DD HH:mm'),
                ctx,
                true,
              );
            } else {
              const require = createRequire(import.meta.url);
              require('dayjs/locale/' + this.options.language);
              res = dayjs(code[1])
                .locale(this.options.language)
                .format(this.options.date_format);
            }
        }
      } else if (code[0] == 't') {
        switch (code[2]) {
          case 'back':
            date = new Date(code[1]);
            date.setDate(1);
            this.editMessageReplyMarkupCalendar(date, ctx);
            break;
          case '1+':
            this.editMessageReplyMarkupTime(dayjs(code[1]), ctx, true);
            break;
          case '1-': {
            const { value, unit } = this.service.parseTimeStep(this.options.time_step);
            const d = dayjs(code[1]).subtract(16 * value, unit as any);
            this.editMessageReplyMarkupTime(d, ctx, true);
            break;
          }
          case '0+':
            this.editMessageReplyMarkupTime(dayjs(code[1]), ctx, false);
            break;
          case '0-': {
            const { value, unit } = this.service.parseTimeStep(this.options.time_step);
            const d = dayjs(code[1]).subtract(16 * value, unit as any);
            this.editMessageReplyMarkupTime(d, ctx, false);
            break;
          }
          case '0': {
            const require = createRequire(import.meta.url);
            require('dayjs/locale/' + this.options.language);
            res = dayjs(code[1])
              .locale(this.options.language)
              .format(this.options.date_format);
          }
        }
      }
      return res;
    },
    startNavCalendar(this: Calendar, ctx: any, language: string) {
      const now = new Date();
      now.setDate(1);
      now.setHours(0);
      now.setMinutes(0);
      now.setSeconds(0);
      this.sendMessageCalendar(
        this.replyMarkupObject(
          this.createNavigationKeyboard(
            now,
            ctx.chat ? ctx.chat.id : ctx.callbackQuery.message.chat.id,
          ),
        ),
        ctx,
        language,
      );
    },
    startTimeSelector(this: Calendar, ctx: any, holonId: any = null) {
      this.sendMessageTime(
        this.replyMarkupObject(
          this.createTimeSelector(undefined, false, holonId || ctx.chat.id),
        ),
        ctx,
      );
    },
  };

  Telebot: any = {
    editMessageReplyMarkupCalendar(this: Calendar, date: any, query: any) {
      (this.bot as any).editMessageReplyMarkup(
        { messageId: query.message.message_id, holonId: query.message.chat.id },
        this.replyMarkupObject(
          this.createNavigationKeyboard(date, query.message.chat.id),
        ),
      );
    },
    editMessageReplyMarkupTime(
      this: Calendar,
      date: any,
      query: any,
      from_calendar: boolean,
    ) {
      (this.bot as any).editMessageReplyMarkup(
        { messageId: query.message.message_id, holonId: query.message.chat.id },
        this.replyMarkupObject(
          this.createTimeSelector(date, from_calendar, query.message.chat.id),
        ),
      );
    },
    sendMessageCalendar(this: Calendar, menu: any, msg: any) {
      const l =
        this.options.time_selector_mod === true
          ? lang.selectdatetime[this.options.language]
          : lang.select[this.options.language];
      (this.bot as any)
        .sendMessage(msg.chat.id, l, menu)
        .then((msg_promise: any) =>
          this.chats.set(msg_promise.chat.id, msg_promise.message_id),
        );
    },
    sendMessageTime(this: Calendar, menu: any, msg: any) {
      (this.bot as any)
        .sendMessage(msg.chat.id, lang.selecttime[this.options.language], menu)
        .then((msg_promise: any) =>
          this.chats.set(msg_promise.chat.id, msg_promise.message_id),
        );
    },
    deleteMessage(this: Calendar, query: any) {
      (this.bot as any).deleteMessage(
        query.message.chat.id,
        query.message.message_id,
      );
    },
    replyMarkupObject(_this: Calendar, cnk: any) {
      const menu: any = {};
      menu.replyMarkup = cnk;
      return menu;
    },
  };

  Grammy: any = {
    editMessageReplyMarkupCalendar(this: Calendar, date: any, ctx: any) {
      ctx.editMessageReplyMarkup(
        this.replyMarkupObject(
          this.createNavigationKeyboard(date, ctx.callbackQuery.message.chat.id),
        ),
      );
    },
    editMessageReplyMarkupTime(
      this: Calendar,
      date: any,
      ctx: any,
      from_calendar: boolean,
    ) {
      ctx.editMessageReplyMarkup(
        this.replyMarkupObject(
          this.createTimeSelector(date, from_calendar, ctx.callbackQuery.message.chat.id),
        ),
      );
    },
    sendMessageCalendar(this: Calendar, menu: any, ctx: any) {
      const l =
        this.options.time_selector_mod === true
          ? lang.selectdatetime[this.options.language]
          : lang.select[this.options.language];
      ctx
        .reply(l, menu)
        .then((msg_promise: any) =>
          this.chats.set(msg_promise.chat.id, msg_promise.message_id),
        );
    },
    sendMessageTime(this: Calendar, menu: any, ctx: any) {
      ctx
        .reply(lang.selecttime[this.options.language], menu)
        .then((msg_promise: any) =>
          this.chats.set(msg_promise.chat.id, msg_promise.message_id),
        );
    },
    deleteMessage(_this: Calendar, ctx: any) {
      ctx.deleteMessage();
    },
    replyMarkupObject(_this: Calendar, cnk: any) {
      const menu: any = {};
      menu.reply_markup = cnk;
      return menu;
    },
  };

  addCustomStartMsg() {
    if (this.options.custom_start_msg !== false) {
      lang.select[this.options.language] = this.options.custom_start_msg;
      lang.selectdatetime[this.options.language] = this.options.custom_start_msg;
      lang.selecttime[this.options.language] = this.options.custom_start_msg;
    }
  }

  libraryInitialization() {
    if (this.options.bot_api == 'node-telegram-bot-api') {
      this.editMessageReplyMarkupCalendar = this.NodeTelegramBotApi.editMessageReplyMarkupCalendar;
      this.editMessageReplyMarkupTime = this.NodeTelegramBotApi.editMessageReplyMarkupTime;
      this.sendMessageCalendar = this.NodeTelegramBotApi.sendMessageCalendar;
      this.sendMessageTime = this.NodeTelegramBotApi.sendMessageTime;
      this.deleteMessage = this.NodeTelegramBotApi.deleteMessage;
      this.replyMarkupObject = this.NodeTelegramBotApi.replyMarkupObject;
      this.clickButtonCalendar = this.NodeTelegramBotApi.clickButtonCalendar;
      this.startNavCalendar = (this.NodeTelegramBotApi as any).startNavCalendar;
      this.startTimeSelector = this.NodeTelegramBotApi.startTimeSelector;
    } else if (this.options.bot_api == 'telegraf') {
      this.editMessageReplyMarkupCalendar = this.Telegraf.editMessageReplyMarkupCalendar;
      this.editMessageReplyMarkupTime = this.Telegraf.editMessageReplyMarkupTime;
      this.sendMessageCalendar = this.Telegraf.sendMessageCalendar;
      this.sendMessageTime = this.Telegraf.sendMessageTime;
      this.deleteMessage = this.Telegraf.deleteMessage;
      this.replyMarkupObject = this.Telegraf.replyMarkupObject;
      this.clickButtonCalendar = this.Telegraf.clickButtonCalendar;
      this.startNavCalendar = this.Telegraf.startNavCalendar;
      this.startTimeSelector = this.Telegraf.startTimeSelector;
    } else if (this.options.bot_api == 'telebot') {
      this.editMessageReplyMarkupCalendar = this.Telebot.editMessageReplyMarkupCalendar;
      this.editMessageReplyMarkupTime = this.Telebot.editMessageReplyMarkupTime;
      this.sendMessageCalendar = this.Telebot.sendMessageCalendar;
      this.sendMessageTime = this.Telebot.sendMessageTime;
      this.deleteMessage = this.Telebot.deleteMessage;
      this.replyMarkupObject = this.Telebot.replyMarkupObject;
      this.clickButtonCalendar = this.NodeTelegramBotApi.clickButtonCalendar;
      this.startNavCalendar = (this.NodeTelegramBotApi as any).startNavCalendar;
      this.startTimeSelector = this.NodeTelegramBotApi.startTimeSelector;
    } else if (this.options.bot_api == 'grammy') {
      this.editMessageReplyMarkupCalendar = this.Grammy.editMessageReplyMarkupCalendar;
      this.editMessageReplyMarkupTime = this.Grammy.editMessageReplyMarkupTime;
      this.sendMessageCalendar = this.Grammy.sendMessageCalendar;
      this.sendMessageTime = this.Grammy.sendMessageTime;
      this.deleteMessage = this.Grammy.deleteMessage;
      this.replyMarkupObject = this.Grammy.replyMarkupObject;
      this.clickButtonCalendar = this.Telegraf.clickButtonCalendar;
      this.startNavCalendar = this.Telegraf.startNavCalendar;
      this.startTimeSelector = this.Telegraf.startTimeSelector;
    }
  }

  // --------------------------------------------------------------------------
  // Pure-domain helpers (delegate to service for date math)
  // --------------------------------------------------------------------------

  weekDaysButtons(day: number) {
    return this.service.weekDay(day, this.options.start_week_day);
  }

  startWeekDay(day: number) {
    return this.service.startWeekDay(day, this.options.start_week_day);
  }

  twoDigits(num: number) {
    return this.service.twoDigits(num);
  }

  colRowNavigation(date: Date, cd: number) {
    const tmp = cd - 7 + this.startWeekDay(date.getDay());
    return Math.ceil(tmp / 7) + 4;
  }

  howMuchDays(year: number, month: number) {
    return this.service.daysInMonth(year, month);
  }

  // --------------------------------------------------------------------------
  // Inline-keyboard builders (UI)
  // --------------------------------------------------------------------------

  createTimeSelector(
    date: any = 'undefined',
    from_calendar = false,
    holonId: any = null,
  ): InlineKeyboard {
    let i: number;
    let j: number;
    let start: Date = new Date();
    const time_range = this.options.time_range.split('-');
    let datetime: Date =
      date === 'undefined' ? new Date(2100, 1, 1, 0, 0, 0) : new Date(date);
    const { value: stepValue, unit: type } = this.service.parseTimeStep(
      this.options.time_step,
    );
    const cnk: InlineKeyboard = { resize_keyboard: true, inline_keyboard: [] };
    let d = 0;
    let flag_start = 0;
    let flag_stop = 0;
    let fc = 0;

    if (from_calendar === true) {
      cnk.inline_keyboard.push([{}, {}, {}]);
      cnk.inline_keyboard[d][0] = {
        text: lang.back[this.options.language],
        callback_data: 't_' + dayjs(datetime).format('YYYY-MM-DD') + '_back',
      };
      cnk.inline_keyboard[d][1] = {
        text: dayjs(datetime).format('YYYY-MM-DD'),
        callback_data: ' ',
      };
      cnk.inline_keyboard[d][2] = { text: ' ', callback_data: ' ' };
      fc++;
      d++;
    }
    if (
      Number(dayjs(datetime).format('HH')) < Number(time_range[0].split(':')[0]) ||
      (Number(dayjs(datetime).format('HH')) ==
        Number(time_range[0].split(':')[0]) &&
        Number(dayjs(datetime).format('mm')) <=
          Number(time_range[0].split(':')[1]))
    ) {
      datetime.setHours(Number(time_range[0].split(':')[0]));
      datetime.setMinutes(Number(time_range[0].split(':')[1]));
      datetime.setSeconds(0);
      flag_start++;
    }
    const stop = new Date(datetime);
    stop.setHours(Number(time_range[1].split(':')[0]));
    stop.setMinutes(Number(time_range[1].split(':')[1]));
    stop.setSeconds(0);

    for (i = d; i < d + 4; i++) {
      cnk.inline_keyboard.push([{}, {}, {}, {}]);
      for (j = 0; j < 4; j++) {
        if (i === d && j === 0) {
          start = new Date(datetime);
        }
        cnk.inline_keyboard[i][j] =
          dayjs(stop).diff(
            dayjs(datetime).format('YYYY-MM-DD HH:mm'),
            type as any,
          ) < 0
            ? { text: ' ', callback_data: ' ' }
            : {
                text: dayjs(datetime).format('HH:mm'),
                callback_data:
                  't_' + dayjs(datetime).format('YYYY-MM-DD HH:mm') + '_0',
              };
        datetime = new Date(
          dayjs(datetime).add(stepValue, type as any).format('YYYY-MM-DD HH:mm'),
        );
      }
      if (
        dayjs(stop).diff(
          dayjs(datetime).format('YYYY-MM-DD HH:mm'),
          type as any,
        ) < 0
      ) {
        flag_stop++;
        i++;
        break;
      }
    }
    d = i;
    cnk.inline_keyboard.push([{}, {}, {}]);
    cnk.inline_keyboard[d][0] =
      flag_start === 1
        ? { text: ' ', callback_data: ' ' }
        : {
            text: '<',
            callback_data:
              't_' + dayjs(start).format('YYYY-MM-DD HH:mm') + '_' + fc + '-',
          };

    const hasQuestToReturn =
      holonId && this.questIds && this.questIds.has(holonId);
    if (hasQuestToReturn) {
      cnk.inline_keyboard[d][1] = {
        text: lang.back[this.options.language],
        callback_data: 'calendar_back_to_quest',
      };
    } else {
      cnk.inline_keyboard[d][1] = { text: ' ', callback_data: ' ' };
    }

    cnk.inline_keyboard[d][2] =
      flag_stop === 1
        ? { text: ' ', callback_data: ' ' }
        : {
            text: '>',
            callback_data:
              't_' + dayjs(datetime).format('YYYY-MM-DD HH:mm') + '_' + fc + '+',
          };
    return cnk;
  }

  createNavigationKeyboard(date: Date, holonId: any = null): InlineKeyboard {
    let i: number;
    let j: number;
    const cnk: InlineKeyboard = { resize_keyboard: true, inline_keyboard: [] };
    const cd = this.howMuchDays(date.getFullYear(), date.getMonth() + 1);
    const cr = this.colRowNavigation(date, cd);

    // Narrow optional bounds (false sentinel → undefined for dayjs).
    const startDate: Date | string | undefined =
      this.options.start_date === false ? undefined : this.options.start_date;
    const stopDate: Date | string | undefined =
      this.options.stop_date === false ? undefined : this.options.stop_date;

    cnk.inline_keyboard.push([{}, {}, {}]);
    if (
      !startDate ||
      (startDate && dayjs(date).format('YYYY') > dayjs(startDate).format('YYYY'))
    ) {
      if (
        dayjs(date).subtract(1, 'year').format('YYYY') ==
        dayjs(startDate).format('YYYY')
      ) {
        cnk.inline_keyboard[0][0] = {
          text: '<<',
          callback_data:
            'n_' +
            dayjs(startDate).add(1, 'year').format('YYYY-MM') +
            '_--',
        };
      } else {
        cnk.inline_keyboard[0][0] = {
          text: '<<',
          callback_data: 'n_' + dayjs(date).format('YYYY-MM') + '_--',
        };
      }
    } else {
      cnk.inline_keyboard[0][0] = { text: ' ', callback_data: ' ' };
    }
    cnk.inline_keyboard[0][1] = {
      text:
        lang.month3[this.options.language][date.getMonth()] +
        ' ' +
        date.getFullYear(),
      callback_data: ' ',
    };
    if (
      !stopDate ||
      (stopDate && dayjs(stopDate).format('YYYY') > dayjs(date).format('YYYY'))
    ) {
      if (
        dayjs(date).add(1, 'year').format('YYYY') ==
        dayjs(stopDate).format('YYYY')
      ) {
        cnk.inline_keyboard[0][2] = {
          text: '>>',
          callback_data:
            'n_' +
            dayjs(stopDate).subtract(1, 'year').format('YYYY-MM') +
            '_++',
        };
      } else {
        cnk.inline_keyboard[0][2] = {
          text: '>>',
          callback_data: 'n_' + dayjs(date).format('YYYY-MM') + '_++',
        };
      }
    } else {
      cnk.inline_keyboard[0][2] = { text: ' ', callback_data: ' ' };
    }
    cnk.inline_keyboard.push([{}, {}, {}, {}, {}, {}, {}]);
    for (j = 0; j < 7; j++) {
      cnk.inline_keyboard[1][j] = {
        text: lang.week[this.options.language][this.weekDaysButtons(j)],
        callback_data: ' ',
      };
    }

    const today = new Date();
    const isCurrentMonth =
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth();
    const currentDay = today.getDate();

    let d = 1;
    for (i = 2; i <= cr - 2; i++) {
      cnk.inline_keyboard.push([{}, {}, {}, {}, {}, {}, {}]);
      for (j = 0; j < 7; j++) {
        if ((i == 2 && j < this.startWeekDay(date.getDay())) || d > cd) {
          cnk.inline_keyboard[i][j] = { text: ' ', callback_data: ' ' };
        } else {
          if (
            (!startDate ||
              (startDate &&
                dayjs(date)
                  .date(d)
                  .hour(0)
                  .diff(dayjs(startDate).hour(0), 'day') >= 0)) &&
            (!stopDate ||
              (stopDate &&
                dayjs(stopDate)
                  .hour(0)
                  .diff(dayjs(date).date(d).hour(0), 'day') >= 0))
          ) {
            const dayText =
              isCurrentMonth && d === currentDay ? '(' + d + ')' : String(d);
            cnk.inline_keyboard[i][j] = {
              text: String(dayText),
              callback_data:
                'n_' +
                date.getFullYear() +
                '-' +
                this.twoDigits(date.getMonth() + 1) +
                '-' +
                this.twoDigits(d) +
                '_0',
            };
          } else {
            cnk.inline_keyboard[i][j] = { text: ' ', callback_data: ' ' };
          }
          d++;
        }
      }
    }
    cnk.inline_keyboard.push([{}, {}, {}]);
    if (
      !startDate ||
      (startDate &&
        Math.round(
          dayjs(date).date(1).diff(dayjs(startDate).date(1), 'month', true),
        ) > 0)
    ) {
      cnk.inline_keyboard[cr - 1][0] = {
        text: '<',
        callback_data: 'n_' + dayjs(date).format('YYYY-MM') + '_-',
      };
    } else {
      cnk.inline_keyboard[cr - 1][0] = { text: ' ', callback_data: ' ' };
    }

    const hasQuestToReturn =
      holonId && this.questIds && this.questIds.has(holonId);
    if (hasQuestToReturn) {
      cnk.inline_keyboard[cr - 1][1] = {
        text: lang.back[this.options.language],
        callback_data: 'calendar_back_to_quest',
      };
    } else {
      cnk.inline_keyboard[cr - 1][1] = { text: ' ', callback_data: ' ' };
    }

    if (
      !stopDate ||
      (stopDate &&
        Math.round(
          dayjs(stopDate).date(1).diff(dayjs(date).date(1), 'month', true),
        ) > 0)
    ) {
      cnk.inline_keyboard[cr - 1][2] = {
        text: '>',
        callback_data: 'n_' + dayjs(date).format('YYYY-MM') + '_+',
      };
    } else {
      cnk.inline_keyboard[cr - 1][2] = { text: ' ', callback_data: ' ' };
    }
    return cnk;
  }
}

export type { CalendarServiceLike, CoreCalendarService, CalendarOptions };
