// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

/**
 * @fileoverview Ask for a command's missing parameters in a dialogue.
 * @module src/AskMissing
 *
 * A command sent without its required parameters used to answer with a usage
 * line. With this helper the bot asks instead — "What is the title of the
 * task?" with a Cancel button underneath — and, once the person who sent the
 * command has answered, runs the command as if the parameter had been typed,
 * then removes the question and the answer.
 *
 * ```js
 * import { askArgs } from './AskMissing.js';
 *
 * if (!title)
 *   return askArgs(
 *     ctx,
 *     [{ key: 'title', question: 'What is the title of the task?' }],
 *     ctx => this.quest(type, ctx)
 *   );
 * ```
 *
 * Why a callback and not `const values = await ask(...)`: Telegraf's polling
 * loop waits for every handler of a batch before it fetches the next one, so
 * a handler that awaited the answer would wait for an update that can never
 * arrive. The command handler returns straight after asking; the answer
 * comes in as its own update and the callback runs there.
 *
 * Why not InputScene: Telegraf's session (and so the scene) is keyed by
 * `from.id:chat.id`, which gates the user, but a scene swallows every update
 * of that user in that chat — other commands, buttons, photos — until it is
 * left, and its callbacks live in session state. A small pending map keyed by
 * chat + user, with its own timeout, lets everything else flow through.
 *
 * Groups and privacy mode: a bot with privacy mode on (BotFather default) is
 * only sent commands, messages that mention it, and REPLIES to its own
 * messages. Telegram allows one `reply_markup` per message, so a question
 * cannot carry both the inline Cancel button and `force_reply`. The question
 * therefore keeps the Cancel button and, in groups where the bot does not
 * read everything (`botInfo.can_read_all_group_messages` is not true), adds a
 * one-line hint to reply to it. A plain message from the initiator is
 * accepted as well, which is what arrives when privacy mode is off or the
 * bot is a group admin.
 *
 * Wiring: `registerAskMissing(bot)` once, right after session/stage and
 * before any module registers its handlers (core/ServiceDefinitions.js,
 * `telebot` factory) so the answer is seen before other text handlers.
 */

import { Markup } from 'telegraf';
import i18next from 'i18next';

/** How long a question waits for its answer. */
export const ASK_TIMEOUT_MS = 5 * 60 * 1000;

const ACTION = { cancel: 'askmissing:cancel', skip: 'askmissing:skip' };
const ACTION_RE = /^askmissing:(cancel|skip):(-?\d+)$/;

const GROUP_TYPES = new Set(['group', 'supergroup']);

// Senders that are not one person: every anonymous group admin posts as
// GroupAnonymousBot, every "send as channel" member as Channel_Bot, and
// Telegram's own service account forwards linked-channel posts.
const SHARED_SENDER_IDS = new Set([1087968824, 136817688, 777000]);

/** Whether a command's sender cannot be told apart from other people. */
const isSharedSender = (ctx, message) =>
  Boolean(message?.sender_chat) || SHARED_SENDER_IDS.has(Number(ctx?.from?.id));

const keyOf = (chatId, userId) => `${chatId}:${userId}`;

/** The forum topic a message sits in (undefined outside topics). */
const threadOf = message =>
  message?.is_topic_message ? message.message_thread_id : undefined;

const isCommand = text => typeof text === 'string' && text.startsWith('/');

/**
 * The same ctx with the command text rewritten to carry `args`, so the
 * command's own handler can be run again and parse them as usual:
 * `/task` + `"do the dishes"` → `/task do the dishes`. The command word
 * (with any `@BotName`) is kept; `ctx.payload` / `ctx.args` follow.
 *
 * @param {object} ctx - the ORIGINAL command ctx
 * @param {...(string|number|undefined|null)} args - joined with one space;
 *   everything from the first undefined/null/empty value on is dropped
 * @returns {object} ctx
 */
export function withArgs(ctx, ...args) {
  const message =
    ctx?.message || ctx?.update?.message || ctx?.update?.channel_post;
  if (!message) return ctx;
  const kept = [];
  for (const a of args) {
    if (a === undefined || a === null || a === '') break;
    kept.push(String(a));
  }
  const payload = kept.join(' ');
  const original = message.text || message.caption || '';
  const command = original.split(/\s+/)[0] || '';
  const text = payload ? `${command} ${payload}` : command;
  message.text = text;
  if (message.caption !== undefined) message.caption = text;
  if ('payload' in ctx) {
    try {
      ctx.payload = payload;
      ctx.args = kept;
    } catch {}
  }
  return ctx;
}

/**
 * One dialogue engine: its own pending map and timers. The module exports a
 * shared instance (`askMissing`, `askArgs`, `registerAskMissing`); tests
 * build their own.
 *
 * @param {{ timeoutMs?: number }} [options]
 */
export function createAskMissing(options = {}) {
  const timeoutMs = options.timeoutMs ?? ASK_TIMEOUT_MS;
  /** @type {Map<string, object>} chat:user → pending dialogue */
  const pending = new Map();

  const remove = async (telegram, chatId, ids) => {
    await Promise.all(
      ids.filter(Boolean).map(id =>
        Promise.resolve()
          .then(() => telegram.deleteMessage(chatId, id))
          .catch(() => {})
      )
    );
  };

  /** Drop a dialogue: timer, map entry, and the messages it left behind. */
  const close = async p => {
    clearTimeout(p.timer);
    if (pending.get(p.key) === p) pending.delete(p.key);
    const trail = p.trail;
    p.trail = [];
    await remove(p.telegram, p.chatId, trail);
  };

  const arm = p => {
    clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      close(p).catch(() => {});
    }, timeoutMs);
    p.timer.unref?.();
  };

  // i18next answers undefined until it is initialised (tests, early boot).
  const label = (key, fallback, lng) => {
    const text = i18next.t(key, { lng, defaultValue: fallback });
    return typeof text === 'string' && text && text !== key ? text : fallback;
  };

  /** Who decides the language of a dialogue: set once in the bot wiring. */
  let languageOf = null;
  const setLanguageResolver = resolver => {
    languageOf = typeof resolver === 'function' ? resolver : null;
  };
  const resolveLanguage = async (chatId, given) => {
    if (given) return given;
    try {
      return (await languageOf?.(chatId)) || 'en';
    } catch {
      return 'en';
    }
  };

  /**
   * A question or error line in the dialogue's language. With a locale key
   * the English `fallback` is the default text and the answers so far (plus
   * `vars`) fill its `{{placeholders}}`; without a key the text is literal.
   */
  const phrase = (key, fallback, p, vars) => {
    const english =
      typeof fallback === 'function' ? fallback(p.values) : fallback;
    if (!key) return english;
    const more = typeof vars === 'function' ? vars(p.values) : vars;
    const options = {
      ...p.values,
      ...more,
      lng: p.lng,
      interpolation: { escapeValue: false },
    };
    if (english) options.defaultValue = english;
    const text = i18next.t(key, options);
    if (typeof text === 'string' && text && text !== key) return text;
    // i18next not initialised: fill the English default by hand.
    return String(english ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) =>
      String({ ...p.values, ...more }[name] ?? '')
    );
  };

  /** Send the current question (optionally under an error line). */
  const prompt = async (p, error) => {
    const q = p.questions[p.index];
    let text = phrase(q.ask, q.question, p, q.vars);
    if (error) text = `⚠️ ${error}\n\n${text}`;
    if (p.replyHint)
      text += `\n\n↩️ ${label('askmissing_reply_hint', 'Reply to this message to answer.', p.lng)}`;
    const buttons = [];
    if (q.optional)
      buttons.push(
        Markup.button.callback(
          label('askmissing_skip', '⏭ Skip', p.lng),
          `${ACTION.skip}:${p.userId}`
        )
      );
    buttons.push(
      Markup.button.callback(
        label('cancel', '❌ Cancel', p.lng),
        `${ACTION.cancel}:${p.userId}`
      )
    );
    const extra = { ...Markup.inlineKeyboard([buttons]) };
    if (p.threadId !== undefined) extra.message_thread_id = p.threadId;
    if (p.commandMessageId)
      extra.reply_parameters = {
        message_id: p.commandMessageId,
        allow_sending_without_reply: true,
      };
    const sent = await p.telegram.sendMessage(p.chatId, text, extra);
    p.questionId = sent?.message_id;
    if (p.questionId) p.trail.push(p.questionId);
    arm(p);
  };

  /** Move on after a value (or a skip): next question, or run the command. */
  const advance = async p => {
    const trail = p.trail;
    p.trail = [];
    await remove(p.telegram, p.chatId, trail);
    p.index += 1;
    if (p.index < p.questions.length) {
      await prompt(p);
      return;
    }
    clearTimeout(p.timer);
    if (pending.get(p.key) === p) pending.delete(p.key);
    try {
      await p.run(p.values, p.ctx);
    } catch (e) {
      console.error('[askMissing] command failed after dialogue:', e);
      // The answer is already deleted: never leave the person with nothing.
      const extra = {};
      if (p.threadId !== undefined) extra.message_thread_id = p.threadId;
      try {
        await p.telegram.sendMessage(
          p.chatId,
          label(
            'askmissing_failed',
            '⚠️ An error occurred. Please try again.',
            p.lng
          ),
          extra
        );
      } catch {}
    }
  };

  /** No dialogue possible: fall back to the usage line, when given. */
  const usage = async (ctx, opts) => {
    if (!opts.usage || !ctx?.reply) return;
    try {
      await ctx.reply(opts.usage);
    } catch {}
  };

  /**
   * Ask for what a command is missing, then run it.
   *
   * @param {object} ctx - the command's Telegraf ctx
   * @param {Array<{
   *   key: string,
   *   ask?: string,
   *   question?: string | ((values: object) => string),
   *   vars?: object | ((values: object) => object),
   *   error?: string,
   *   validate?: (input: string, values: object, ctx: object) =>
   *     boolean | string | Promise<boolean | string>,
   *   errorText?: string,
   *   optional?: boolean
   * }>} questions - asked in order. `ask` is the locale key of the
   *   question and `question` its English default (`{{key}}` placeholders
   *   are filled from the answers so far and `vars`); `error`/`errorText`
   *   are the same pair for the retry line; `validate` gets a translator
   *   `t(key, english, vars?)` as its 4th argument for its own messages. Without `ask` the `question` is
   *   sent as written. `validate` returns true to accept; false
   *   (→ `errorText`) or a string (→ that message) to ask again. `optional`
   *   adds a Skip button; a skipped value is left undefined.
   * @param {(values: object, ctx: object) => any} run - called with the
   *   collected values and the ORIGINAL command ctx once every question is
   *   answered. Never called on cancel or timeout.
   * @param {{ lng?: string, usage?: string }} [opts] - `lng` overrides the
   *   chat's language (normally resolved by the wiring's `setAskLanguage`); `usage` is replied when no dialogue can be held (no sender, as
   *   in a channel post, or a shared one: anonymous admin, "as channel").
   * @returns {Promise<boolean>} whether a dialogue was started
   */
  async function askMissing(ctx, questions, run, opts = {}) {
    const message =
      ctx?.message || ctx?.update?.message || ctx?.callbackQuery?.message;
    const chat = ctx?.chat || message?.chat;
    const user = ctx?.from;
    const telegram = ctx?.telegram;
    if (
      !chat?.id ||
      !user?.id ||
      !telegram?.sendMessage ||
      !questions?.length
    ) {
      await usage(ctx, opts);
      return false;
    }
    // An anonymous admin (or a member posting as a channel) shares one
    // sender id with everybody else doing the same, and the buttons they
    // press arrive under their real id: the dialogue could be answered by
    // another person and never cancelled by its own. Usage line instead.
    if (isSharedSender(ctx, ctx.message)) {
      await usage(ctx, opts);
      return false;
    }
    const key = keyOf(chat.id, user.id);
    const previous = pending.get(key);
    if (previous) await close(previous);

    const p = {
      key,
      chatId: chat.id,
      userId: user.id,
      threadId: threadOf(message),
      // Only a real command message is replied to (not a button's message).
      commandMessageId: ctx.message?.message_id,
      telegram,
      ctx,
      questions,
      run,
      lng: await resolveLanguage(chat.id, opts.lng),
      replyHint:
        GROUP_TYPES.has(chat.type) &&
        ctx.botInfo?.can_read_all_group_messages !== true,
      index: 0,
      values: {},
      trail: [],
      questionId: undefined,
      busy: false,
      timer: undefined,
    };
    pending.set(key, p);
    try {
      await prompt(p);
    } catch (e) {
      await close(p);
      console.warn('[askMissing] could not ask:', e?.message);
      await usage(ctx, opts);
      return false;
    }
    return true;
  }

  /**
   * `askMissing` for the common case: the answers are the command's
   * arguments. When all are in, `handler` is run again with the original
   * ctx, its text rewritten to `/<command> <answer1> <answer2> …` (see
   * {@link withArgs}) — the handler parses it exactly as if it had been
   * typed, so nothing of the command is duplicated.
   *
   * @param {object} ctx
   * @param {Array<object>} questions - as for `askMissing`, in argument order
   * @param {(ctx: object) => any} handler - the command's own handler
   * @param {{ lng?: string, usage?: string, prefix?: string }} [opts] -
   *   `prefix`: arguments the user DID give, put before the answers
   */
  function askArgs(ctx, questions, handler, opts = {}) {
    return askMissing(
      ctx,
      questions,
      (values, original) => {
        const args = questions.map(q => values[q.key]);
        if (opts.prefix) args.unshift(opts.prefix);
        return handler(withArgs(original, ...args));
      },
      opts
    );
  }

  /** A button under a question: Cancel or Skip, initiator only. */
  const onButton = async (ctx, action, userId) => {
    const answer = text => ctx.answerCbQuery?.(text).catch(() => {});
    const presser = ctx.from?.id;
    const message = ctx.callbackQuery?.message;
    const chatId = message?.chat?.id ?? ctx.chat?.id;
    if (String(presser) !== String(userId)) {
      await answer(
        label(
          'askmissing_not_yours',
          'Only the person who sent the command can do that.'
        )
      );
      return;
    }
    const p = pending.get(keyOf(chatId, userId));
    if (!p || p.questionId !== message?.message_id || p.busy) {
      // A button left over from an expired or replaced question.
      await answer();
      if (!p || p.questionId !== message?.message_id)
        await remove(ctx.telegram, chatId, [message?.message_id]);
      return;
    }
    if (action === 'skip' && p.questions[p.index]?.optional) {
      await answer();
      p.busy = true;
      try {
        await advance(p);
      } finally {
        p.busy = false;
      }
      return;
    }
    await answer(label('askmissing_cancelled', 'Cancelled', p.lng));
    await close(p);
  };

  /** A plain text message: the answer, when it is the initiator's. */
  const onText = async (ctx, next) => {
    const message = ctx.message;
    const p = pending.get(
      keyOf(message.chat?.id ?? ctx.chat?.id, ctx.from?.id)
    );
    if (!p) return next();
    if (isCommand(message.text)) {
      // A new command from the initiator ends the dialogue; the command
      // itself is handled as usual.
      await close(p);
      return next();
    }
    if (p.busy || threadOf(message) !== p.threadId) return next();
    const repliedTo = message.reply_to_message?.message_id;
    if (
      repliedTo !== undefined &&
      repliedTo !== p.questionId &&
      repliedTo !== p.commandMessageId &&
      repliedTo !== p.threadId // a topic's root: not a reply at all
    )
      return next(); // talking to someone else

    p.busy = true;
    try {
      const q = p.questions[p.index];
      const input = message.text.trim();
      p.trail.push(message.message_id);
      let verdict = input.length > 0;
      if (verdict && q.validate) {
        try {
          verdict = await q.validate(
            input,
            p.values,
            ctx,
            (key, english, vars) => phrase(key, english, p, vars)
          );
        } catch (e) {
          verdict = e?.message || false;
        }
      }
      if (pending.get(p.key) !== p) return; // cancelled or expired meanwhile
      if (verdict === true || verdict === undefined) {
        p.values[q.key] = input;
        await advance(p);
        return;
      }
      const error =
        typeof verdict === 'string' && verdict
          ? verdict
          : (q.error || q.errorText
              ? phrase(q.error, q.errorText, p, q.vars)
              : '') ||
            label('askmissing_invalid', 'That does not look right.', p.lng);
      const trail = p.trail;
      p.trail = [];
      await remove(p.telegram, p.chatId, trail);
      try {
        await prompt(p, error);
      } catch (e) {
        console.warn('[askMissing] could not ask again:', e?.message);
        await close(p);
      }
    } finally {
      p.busy = false;
    }
  };

  /** The Telegraf middleware; see {@link registerAskMissing}. */
  const middleware = async (ctx, next) => {
    const data = ctx.callbackQuery?.data;
    if (typeof data === 'string') {
      const m = ACTION_RE.exec(data);
      if (!m) return next();
      return onButton(ctx, m[1], m[2]);
    }
    if (typeof ctx.message?.text === 'string' && ctx.from?.id && pending.size)
      return onText(ctx, next);
    return next();
  };

  /**
   * Install the middleware. Call once per bot, after session/stage and
   * before any command, text or AI handler is registered.
   */
  const registerAskMissing = bot => {
    bot.use(middleware);
    return bot;
  };

  /** Drop every pending dialogue and its timer (shutdown, tests). */
  const shutdown = () => {
    for (const p of pending.values()) clearTimeout(p.timer);
    pending.clear();
  };

  return {
    askMissing,
    askArgs,
    middleware,
    registerAskMissing,
    setLanguageResolver,
    pending,
    shutdown,
  };
}

const shared = createAskMissing();

export const askMissing = shared.askMissing;
export const askArgs = shared.askArgs;
export const registerAskMissing = shared.registerAskMissing;
export const setAskLanguage = shared.setLanguageResolver;
export const askMissingMiddleware = shared.middleware;
export const shutdownAskMissing = shared.shutdown;

export default shared;
