// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Telegraf, Telegram, session } from 'telegraf';
import { createAskMissing, withArgs } from '../src/AskMissing.js';

const CHAT = -1001;
const ALICE = 11;
const BOB = 22;

/** A fake Bot API: records what is sent and deleted. */
function fakeTelegram({ failDelete = false } = {}) {
  let nextId = 500;
  const t = {
    sent: [],
    deleted: [],
    sendMessage: vi.fn(async (chatId, text, extra) => {
      const message = { message_id: nextId++, chat: { id: chatId }, text };
      t.sent.push({ ...message, extra });
      return message;
    }),
    deleteMessage: vi.fn(async (chatId, id) => {
      if (failDelete) throw new Error('message can not be deleted');
      t.deleted.push(id);
      return true;
    }),
  };
  return t;
}

let messageId = 100;

function textCtx(
  telegram,
  {
    from = ALICE,
    text,
    chat = CHAT,
    type = 'supergroup',
    thread,
    replyTo,
    botInfo,
  } = {}
) {
  const message = {
    message_id: messageId++,
    chat: { id: chat, type },
    from: { id: from },
    text,
  };
  if (thread !== undefined) {
    message.is_topic_message = true;
    message.message_thread_id = thread;
  }
  if (replyTo !== undefined) message.reply_to_message = { message_id: replyTo };
  return {
    update: { message },
    message,
    chat: message.chat,
    from: message.from,
    telegram,
    botInfo: botInfo ?? { id: 1, can_read_all_group_messages: true },
    reply: vi.fn(async () => ({ message_id: 999 })),
  };
}

function buttonCtx(telegram, { from = ALICE, question, data, chat = CHAT }) {
  const message = {
    message_id: question,
    chat: { id: chat, type: 'supergroup' },
  };
  return {
    update: { callback_query: { data, message, from: { id: from } } },
    callbackQuery: { data, message, from: { id: from } },
    chat: message.chat,
    from: { id: from },
    telegram,
    answerCbQuery: vi.fn(async () => true),
  };
}

const buttons = sent => sent.extra.reply_markup.inline_keyboard.flat();
const cancelData = sent =>
  buttons(sent).find(b => b.callback_data.includes(':cancel:')).callback_data;

const TITLE = [{ key: 'title', question: 'What is the title of the task?' }];

describe('askMissing', () => {
  let ask, telegram, next;

  beforeEach(() => {
    vi.useFakeTimers();
    ask = createAskMissing({ timeoutMs: 60_000 });
    telegram = fakeTelegram();
    next = vi.fn(async () => {});
  });

  afterEach(() => {
    ask.shutdown();
    vi.useRealTimers();
  });

  it('asks the question with a Cancel button under it', async () => {
    const run = vi.fn();
    const command = textCtx(telegram, { text: '/task' });
    expect(await ask.askMissing(command, TITLE, run)).toBe(true);

    expect(telegram.sent).toHaveLength(1);
    const [q] = telegram.sent;
    expect(q.text).toBe('What is the title of the task?');
    expect(buttons(q)).toHaveLength(1);
    expect(buttons(q)[0].callback_data).toBe(`askmissing:cancel:${ALICE}`);
    expect(buttons(q)[0].text).toMatch(/cancel/i);
    // tied to the command, and survives the command being deleted
    expect(q.extra.reply_parameters).toEqual({
      message_id: command.message.message_id,
      allow_sending_without_reply: true,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('ignores an answer from another user', async () => {
    const run = vi.fn();
    await ask.askMissing(textCtx(telegram, { text: '/task' }), TITLE, run);

    await ask.middleware(
      textCtx(telegram, { from: BOB, text: 'not mine' }),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    expect(telegram.deleted).toEqual([]);
    expect(ask.pending.size).toBe(1);
  });

  it('ignores the initiator in another chat', async () => {
    const run = vi.fn();
    await ask.askMissing(textCtx(telegram, { text: '/task' }), TITLE, run);

    await ask.middleware(
      textCtx(telegram, { chat: -2002, text: 'elsewhere' }),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it('runs the command with the initiator answer and deletes question + answer', async () => {
    const run = vi.fn();
    const command = textCtx(telegram, { text: '/task' });
    await ask.askMissing(command, TITLE, run);
    const question = telegram.sent[0].message_id;

    const answer = textCtx(telegram, { text: '  do the dishes ' });
    await ask.middleware(answer, next);

    expect(next).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toEqual({ title: 'do the dishes' });
    expect(run.mock.calls[0][1]).toBe(command);
    expect(telegram.deleted.sort()).toEqual(
      [question, answer.message.message_id].sort()
    );
    // the command message itself is left to the command
    expect(telegram.deleted).not.toContain(command.message.message_id);
    expect(ask.pending.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('askArgs re-enters the handler with the text as if typed', async () => {
    const handler = vi.fn();
    const command = textCtx(telegram, { text: '/task@HolonsBot' });
    await ask.askArgs(command, TITLE, handler);

    await ask.middleware(textCtx(telegram, { text: 'do the dishes' }), next);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toBe(command);
    expect(command.message.text).toBe('/task@HolonsBot do the dishes');
  });

  it('rejects Cancel pressed by another user', async () => {
    const run = vi.fn();
    await ask.askMissing(textCtx(telegram, { text: '/task' }), TITLE, run);
    const q = telegram.sent[0];

    const press = buttonCtx(telegram, {
      from: BOB,
      question: q.message_id,
      data: cancelData(q),
    });
    await ask.middleware(press, next);

    expect(press.answerCbQuery).toHaveBeenCalledTimes(1);
    expect(press.answerCbQuery.mock.calls[0][0]).toMatch(/only/i);
    expect(telegram.deleted).toEqual([]);
    expect(ask.pending.size).toBe(1);
    expect(next).not.toHaveBeenCalled();
  });

  it('cancels for the initiator: question removed, command never run', async () => {
    const run = vi.fn();
    await ask.askMissing(textCtx(telegram, { text: '/task' }), TITLE, run);
    const q = telegram.sent[0];

    const press = buttonCtx(telegram, {
      question: q.message_id,
      data: cancelData(q),
    });
    await ask.middleware(press, next);

    expect(press.answerCbQuery).toHaveBeenCalled();
    expect(telegram.deleted).toEqual([q.message_id]);
    expect(ask.pending.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    await ask.middleware(textCtx(telegram, { text: 'too late' }), next);
    expect(run).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('asks again on an invalid answer, then cleans every retry', async () => {
    const run = vi.fn();
    const questions = [
      {
        key: 'amount',
        question: 'How much?',
        validate: input => !Number.isNaN(Number(input)),
        errorText: 'Please send a number.',
      },
    ];
    await ask.askMissing(textCtx(telegram, { text: '/spent' }), questions, run);

    const bad = textCtx(telegram, { text: 'lots' });
    await ask.middleware(bad, next);
    expect(run).not.toHaveBeenCalled();
    expect(telegram.sent).toHaveLength(2);
    expect(telegram.sent[1].text).toContain('Please send a number.');
    expect(telegram.sent[1].text).toContain('How much?');
    expect(buttons(telegram.sent[1])[0].callback_data).toBe(
      `askmissing:cancel:${ALICE}`
    );

    const good = textCtx(telegram, { text: '12.5' });
    await ask.middleware(good, next);

    expect(run).toHaveBeenCalledWith({ amount: '12.5' }, expect.anything());
    expect(telegram.deleted.sort()).toEqual(
      [
        telegram.sent[0].message_id,
        bad.message.message_id,
        telegram.sent[1].message_id,
        good.message.message_id,
      ].sort()
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('uses the string a validator returns as the error', async () => {
    const questions = [
      { key: 'n', question: 'N?', validate: async () => 'Too big.' },
    ];
    await ask.askMissing(textCtx(telegram, { text: '/x' }), questions, vi.fn());
    await ask.middleware(textCtx(telegram, { text: '9' }), next);
    expect(telegram.sent[1].text).toContain('Too big.');
  });

  it('asks several parameters one after another', async () => {
    const handler = vi.fn();
    const command = textCtx(telegram, { text: '/spent' });
    const questions = [
      { key: 'amount', question: 'How much?' },
      {
        key: 'what',
        question: values => `What were the ${values.amount} for?`,
      },
    ];
    await ask.askArgs(command, questions, handler);

    const a1 = textCtx(telegram, { text: '20' });
    await ask.middleware(a1, next);
    expect(handler).not.toHaveBeenCalled();
    expect(telegram.sent).toHaveLength(2);
    expect(telegram.sent[1].text).toBe('What were the 20 for?');
    expect(telegram.deleted.sort()).toEqual(
      [telegram.sent[0].message_id, a1.message.message_id].sort()
    );

    const a2 = textCtx(telegram, { text: 'bread and wine' });
    await ask.middleware(a2, next);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(command.message.text).toBe('/spent 20 bread and wine');
    expect(telegram.deleted).toHaveLength(4);
    expect(ask.pending.size).toBe(0);
  });

  it('offers Skip on an optional question, initiator only', async () => {
    const run = vi.fn();
    const questions = [
      { key: 'title', question: 'Title?' },
      { key: 'note', question: 'A note?', optional: true },
    ];
    await ask.askMissing(textCtx(telegram, { text: '/x' }), questions, run);
    await ask.middleware(textCtx(telegram, { text: 'hello' }), next);
    const q = telegram.sent[1];
    const skip = buttons(q).find(b =>
      b.callback_data.includes(':skip:')
    ).callback_data;

    await ask.middleware(
      buttonCtx(telegram, { from: BOB, question: q.message_id, data: skip }),
      next
    );
    expect(run).not.toHaveBeenCalled();

    await ask.middleware(
      buttonCtx(telegram, { question: q.message_id, data: skip }),
      next
    );
    expect(run).toHaveBeenCalledWith({ title: 'hello' }, expect.anything());
    expect(telegram.deleted).toContain(q.message_id);
  });

  it('expires: question removed, timer gone, later text flows on', async () => {
    const run = vi.fn();
    await ask.askMissing(textCtx(telegram, { text: '/task' }), TITLE, run);

    await vi.advanceTimersByTimeAsync(60_001);

    expect(ask.pending.size).toBe(0);
    expect(telegram.deleted).toEqual([telegram.sent[0].message_id]);
    expect(vi.getTimerCount()).toBe(0);

    await ask.middleware(textCtx(telegram, { text: 'do the dishes' }), next);
    expect(run).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('tolerates messages that cannot be deleted', async () => {
    telegram = fakeTelegram({ failDelete: true });
    const run = vi.fn();
    await ask.askMissing(textCtx(telegram, { text: '/task' }), TITLE, run);

    await expect(
      ask.middleware(textCtx(telegram, { text: 'do the dishes' }), next)
    ).resolves.toBeUndefined();

    expect(telegram.deleteMessage).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledWith(
      { title: 'do the dishes' },
      expect.anything()
    );

    // cancel path as well
    await ask.askMissing(textCtx(telegram, { text: '/task' }), TITLE, run);
    const q = telegram.sent[1];
    await expect(
      ask.middleware(
        buttonCtx(telegram, { question: q.message_id, data: cancelData(q) }),
        next
      )
    ).resolves.toBeUndefined();
    expect(ask.pending.size).toBe(0);
  });

  it('does not let a failing command escape the middleware', async () => {
    const run = vi.fn(async () => {
      throw new Error('boom');
    });
    await ask.askMissing(textCtx(telegram, { text: '/task' }), TITLE, run);
    await expect(
      ask.middleware(textCtx(telegram, { text: 'x' }), next)
    ).resolves.toBeUndefined();
    expect(ask.pending.size).toBe(0);
  });

  it('tells the person when the command fails after their answer is gone', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = vi.fn(async () => {
      throw new Error('boom');
    });
    await ask.askMissing(
      textCtx(telegram, { text: '/task', thread: 7 }),
      TITLE,
      run
    );
    await ask.middleware(textCtx(telegram, { text: 'x', thread: 7 }), next);

    const last = telegram.sent.at(-1);
    expect(last.text).toMatch(/error occurred/i);
    expect(last.extra.message_thread_id).toBe(7);
    error.mockRestore();
  });

  it('a new command from the initiator ends the dialogue and is handled as usual', async () => {
    const run = vi.fn();
    await ask.askMissing(textCtx(telegram, { text: '/task' }), TITLE, run);

    await ask.middleware(textCtx(telegram, { text: '/tasks' }), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    expect(ask.pending.size).toBe(0);
    expect(telegram.deleted).toEqual([telegram.sent[0].message_id]);
  });

  it('a second dialogue by the same user replaces the first', async () => {
    const first = vi.fn();
    const second = vi.fn();
    await ask.askMissing(textCtx(telegram, { text: '/task' }), TITLE, first);
    await ask.askMissing(
      textCtx(telegram, { text: '/event' }),
      [{ key: 't', question: 'Event?' }],
      second
    );

    expect(telegram.deleted).toEqual([telegram.sent[0].message_id]);
    expect(ask.pending.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    await ask.middleware(textCtx(telegram, { text: 'party' }), next);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ t: 'party' }, expect.anything());
  });

  it('two users in one chat hold separate dialogues', async () => {
    const a = vi.fn();
    const b = vi.fn();
    await ask.askMissing(textCtx(telegram, { text: '/task' }), TITLE, a);
    await ask.askMissing(
      textCtx(telegram, { from: BOB, text: '/task' }),
      TITLE,
      b
    );

    await ask.middleware(
      textCtx(telegram, { from: BOB, text: 'bob task' }),
      next
    );
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith({ title: 'bob task' }, expect.anything());
    expect(ask.pending.size).toBe(1);
  });

  it('keeps the topic: asks in the thread, answers only from it', async () => {
    const run = vi.fn();
    await ask.askMissing(
      textCtx(telegram, { text: '/task', thread: 7 }),
      TITLE,
      run
    );
    expect(telegram.sent[0].extra.message_thread_id).toBe(7);

    await ask.middleware(
      textCtx(telegram, { text: 'other topic', thread: 8 }),
      next
    );
    expect(run).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);

    // in a topic every message "replies" to the topic root
    await ask.middleware(
      textCtx(telegram, { text: 'here', thread: 7, replyTo: 7 }),
      next
    );
    expect(run).toHaveBeenCalledWith({ title: 'here' }, expect.anything());
  });

  it('leaves a reply to someone else alone, takes a reply to the question', async () => {
    const run = vi.fn();
    await ask.askMissing(textCtx(telegram, { text: '/task' }), TITLE, run);

    await ask.middleware(
      textCtx(telegram, { text: 'lol', replyTo: 4242 }),
      next
    );
    expect(run).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);

    await ask.middleware(
      textCtx(telegram, {
        text: 'the title',
        replyTo: telegram.sent[0].message_id,
      }),
      next
    );
    expect(run).toHaveBeenCalledWith({ title: 'the title' }, expect.anything());
  });

  it('hints to reply in a group when the bot runs in privacy mode', async () => {
    await ask.askMissing(
      textCtx(telegram, {
        text: '/task',
        botInfo: { id: 1, can_read_all_group_messages: false },
      }),
      TITLE,
      vi.fn()
    );
    expect(telegram.sent[0].text).toMatch(/reply to this message/i);

    await ask.askMissing(
      textCtx(telegram, {
        text: '/task',
        chat: ALICE,
        type: 'private',
        botInfo: { id: 1, can_read_all_group_messages: false },
      }),
      TITLE,
      vi.fn()
    );
    expect(telegram.sent[1].text).toBe('What is the title of the task?');
  });

  it('falls back to usage when there is nobody to ask', async () => {
    const ctx = textCtx(telegram, { text: '/task' });
    ctx.from = undefined;
    const started = await ask.askMissing(ctx, TITLE, vi.fn(), {
      usage: 'Usage: /task <title>',
    });
    expect(started).toBe(false);
    expect(ctx.reply).toHaveBeenCalledWith('Usage: /task <title>');
    expect(telegram.sent).toEqual([]);
  });

  it('does not open a dialogue for an anonymous admin: the id is shared', async () => {
    const ctx = textCtx(telegram, { text: '/task', from: 1087968824 });
    ctx.message.sender_chat = { id: CHAT, type: 'supergroup' };
    const started = await ask.askMissing(ctx, TITLE, vi.fn(), {
      usage: 'Usage: /task <title>',
    });
    expect(started).toBe(false);
    expect(ctx.reply).toHaveBeenCalledWith('Usage: /task <title>');
    expect(telegram.sent).toEqual([]);
    expect(ask.pending.size).toBe(0);
  });

  it('does not open a dialogue for a member posting as a channel', async () => {
    const ctx = textCtx(telegram, { text: '/task', from: 136817688 });
    const started = await ask.askMissing(ctx, TITLE, vi.fn(), {
      usage: 'Usage: /task <title>',
    });
    expect(started).toBe(false);
    expect(ctx.reply).toHaveBeenCalledWith('Usage: /task <title>');
    expect(telegram.sent).toEqual([]);
  });

  it('passes unrelated updates straight through', async () => {
    await ask.middleware(
      buttonCtx(telegram, { question: 1, data: 'participate_quest_5' }),
      next
    );
    await ask.middleware(textCtx(telegram, { text: 'hello' }), next);
    expect(next).toHaveBeenCalledTimes(2);
  });
});

describe('withArgs', () => {
  it('drops everything from the first skipped value on', () => {
    const ctx = { message: { text: '/x' } };
    withArgs(ctx, 'a', undefined, 'c');
    expect(ctx.message.text).toBe('/x a');
  });

  it('rewrites a photo caption too', () => {
    const ctx = { message: { caption: '/task', photo: [{}] } };
    withArgs(ctx, 'paint the fence');
    expect(ctx.message.text).toBe('/task paint the fence');
    expect(ctx.message.caption).toBe('/task paint the fence');
  });
});

describe('wired into a real Telegraf bot', () => {
  it('/task alone asks, the answer re-enters the command, others never see it', async () => {
    const ask = createAskMissing();
    const bot = new Telegraf('1:test');
    bot.botInfo = {
      id: 1,
      is_bot: true,
      username: 'HolonsBot',
      can_read_all_group_messages: false,
    };
    const calls = [];
    let id = 900;
    // Telegraf builds a fresh Telegram client per update: stub the prototype.
    const callApi = vi
      .spyOn(Telegram.prototype, 'callApi')
      .mockImplementation(async (method, payload) => {
        calls.push({ method, payload });
        return method === 'sendMessage'
          ? { message_id: id++, chat: { id: payload.chat_id } }
          : true;
      });

    bot.use(session());
    ask.registerAskMissing(bot);

    const created = [];
    const task = ctx => {
      const title = ctx.message.text.split(' ').slice(1).join(' ');
      if (!title) return ask.askArgs(ctx, TITLE, task);
      created.push({ title, by: ctx.from.id, command: ctx.message.message_id });
    };
    bot.command('task', task);
    const seenByOthers = [];
    bot.on('text', ctx => seenByOthers.push(ctx.message.text));

    const update = (message_id, from, text, extra = {}) => ({
      update_id: message_id,
      message: {
        message_id,
        date: 0,
        chat: { id: CHAT, type: 'supergroup' },
        from: { id: from, is_bot: false, first_name: 'x' },
        text,
        ...(text.startsWith('/')
          ? {
              entities: [
                {
                  type: 'bot_command',
                  offset: 0,
                  length: text.split(' ')[0].length,
                },
              ],
            }
          : {}),
        ...extra,
      },
    });

    await bot.handleUpdate(update(1, ALICE, '/task'));
    const question = calls.find(c => c.method === 'sendMessage');
    expect(question.payload.text).toContain('What is the title of the task?');
    expect(question.payload.text).toMatch(/reply to this message/i);
    expect(
      question.payload.reply_markup.inline_keyboard[0][0].callback_data
    ).toBe(`askmissing:cancel:${ALICE}`);

    await bot.handleUpdate(update(2, BOB, 'someone else talking'));
    expect(created).toEqual([]);
    expect(seenByOthers).toEqual(['someone else talking']);

    await bot.handleUpdate(
      update(3, ALICE, 'do the dishes', {
        reply_to_message: { message_id: 900 },
      })
    );
    expect(created).toEqual([
      { title: 'do the dishes', by: ALICE, command: 1 },
    ]);
    expect(seenByOthers).toEqual(['someone else talking']);
    const deleted = calls
      .filter(c => c.method === 'deleteMessage')
      .map(c => c.payload.message_id);
    expect(deleted.sort()).toEqual([3, 900]);
    expect(ask.pending.size).toBe(0);
    callApi.mockRestore();
  });
});

describe('askMissing language', () => {
  it('asks in the language the wiring resolves, filling placeholders from earlier answers', async () => {
    const i18next = (await import('i18next')).default;
    await i18next.init({
      lng: 'en',
      resources: {
        it: { translation: { ask_test_what: 'A cosa servono {{amount}}?' } },
      },
    });
    const { createAskMissing } = await import('../src/AskMissing.js');
    const ask = createAskMissing();
    ask.setLanguageResolver(async () => 'it');
    const sent = [];
    const telegram = {
      sendMessage: async (_chat, text) => {
        sent.push(text);
        return { message_id: 100 + sent.length };
      },
      deleteMessage: async () => true,
    };
    const ctx = {
      chat: { id: -5, type: 'private' },
      from: { id: 7 },
      message: { message_id: 1, text: '/spent', chat: { id: -5 } },
      telegram,
    };
    let got;
    await ask.askMissing(
      ctx,
      [
        { key: 'amount', ask: 'ask_test_amount', question: 'How much?' },
        {
          key: 'what',
          ask: 'ask_test_what',
          question: 'What was the {{amount}} for?',
        },
      ],
      values => {
        got = values;
      }
    );
    // No Italian entry for the first key: English default.
    expect(sent[0]).toContain('How much?');
    await ask.middleware(
      {
        ...ctx,
        message: {
          message_id: 2,
          text: '12',
          chat: { id: -5 },
          from: { id: 7 },
        },
      },
      async () => {}
    );
    expect(sent[1]).toContain('A cosa servono 12?');
    await ask.middleware(
      {
        ...ctx,
        message: {
          message_id: 3,
          text: 'pizza',
          chat: { id: -5 },
          from: { id: 7 },
        },
      },
      async () => {}
    );
    expect(got).toEqual({ amount: '12', what: 'pizza' });
    ask.shutdown();
  });
});
