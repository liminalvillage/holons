// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Telegraf, Telegram, Scenes, session } from 'telegraf';
import Onboarding from '../src/Onboarding.js';
import InputScene from '../utils/InputScene.js';
import { Calendar } from '../src/Calendar.js';
import dnaData from '../data/dna.json' with { type: 'json' };
import {
  backToMenu,
  completeStep,
  editFromMenu,
  nextStep,
  startSequence,
} from '../scenes/flow.js';

const from = { id: 42, is_bot: false, first_name: 'T', username: 't' };
const privateChat = { id: 42, type: 'private' };
const groupChat = { id: -1001, type: 'supergroup', title: 'Village' };

/** A real Telegraf + stage + session with the network replaced by a recorder. */
function harness(chat = privateChat) {
  const calls = [];
  const puts = [];
  let mid = 100;
  let uid = 0;

  vi.spyOn(Telegram.prototype, 'callApi').mockImplementation(
    async (method, payload) => {
      calls.push({ method, payload });
      return { message_id: ++mid, chat: { id: payload.chat_id }, date: 0 };
    }
  );

  const bot = new Telegraf('1:test');
  bot.botInfo = { id: 1, is_bot: true, username: 'bot', first_name: 'bot' };
  bot.stage = new Scenes.Stage([]);
  bot.use(session());
  bot.use(bot.stage.middleware());
  const errors = [];
  bot.catch(err => errors.push(err));

  const records = new Map();
  const db = {
    get: async (holon, lens, key) =>
      records.get(`${holon}/${lens}/${key}`) ?? null,
    put: async (...args) => {
      const [holon, lens, data] = args;
      records.set(`${holon}/${lens}/${data.id}`, data);
      puts.push(args);
      return true;
    },
  };
  new InputScene(bot);
  new Onboarding(bot, db);

  const deliver = async update => {
    calls.length = 0;
    await bot.handleUpdate({ update_id: ++uid, ...update });
    return [...calls];
  };
  return {
    puts,
    errors,
    text: t =>
      deliver({
        message: {
          message_id: ++mid,
          from,
          chat,
          date: 0,
          text: t,
          entities: t.startsWith('/')
            ? [{ type: 'bot_command', offset: 0, length: t.length }]
            : undefined,
        },
      }),
    tap: data =>
      deliver({
        callback_query: {
          id: String(uid),
          from,
          chat_instance: 'c',
          data,
          message: { message_id: mid, chat, date: 0, text: 'x' },
        },
      }),
    location: () =>
      deliver({
        message: {
          message_id: ++mid,
          from,
          chat,
          date: 0,
          location: { latitude: 45.1, longitude: 9.2 },
        },
      }),
  };
}

const sent = (calls, text) =>
  calls.find(c => c.method === 'sendMessage' && c.payload.text.includes(text));
const buttons = call =>
  call.payload.reply_markup.inline_keyboard.flat().map(b => b.callback_data);

const pad = n => String(n).padStart(2, '0');
const ym = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const today = new Date();
const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);

describe('calendar keyboard', () => {
  it('startNavCalendar sends the keyboard with the message', async () => {
    const reply = vi.fn(async () => ({ chat: { id: 42 }, message_id: 1 }));
    const calendar = new Calendar(false, { bot_api: 'telegraf' });
    calendar.startNavCalendar({ chat: privateChat, session: {}, reply }, 'en');

    const [, extra] = reply.mock.calls[0];
    expect(extra.reply_markup.inline_keyboard.length).toBeGreaterThan(5);
  });

  it('closing the calendar deletes through the context it was given', () => {
    const ctx = { deleteMessage: vi.fn() };
    new Calendar(false, { bot_api: 'telegraf' }).deleteMessage(ctx);
    expect(ctx.deleteMessage).toHaveBeenCalled();
  });
});

describe('/onboarding', () => {
  let bot;
  beforeEach(() => {
    bot = harness();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens on the arrival question with a calendar under it', async () => {
    const calls = await bot.text('/onboarding');
    const question = sent(calls, 'When would you like to arrive?');
    expect(question).toBeDefined();
    expect(buttons(question)).toContain(`n_${ym(today)}_+`);
  });

  it('a month arrow or a blank button keeps the member on the calendar', async () => {
    await bot.text('/onboarding');

    const arrow = await bot.tap(`n_${ym(today)}_+`);
    expect(arrow.some(c => c.method === 'editMessageReplyMarkup')).toBe(true);
    expect(sent(arrow, 'depart')).toBeUndefined();

    const blank = await bot.tap(' ');
    expect(sent(blank, 'depart')).toBeUndefined();
  });

  it('departure cannot be earlier than the arrival just picked', async () => {
    await bot.text('/onboarding');
    const calls = await bot.tap(`n_${ym(nextMonth)}-10_0`);

    const question = sent(calls, 'When would you like to depart?');
    const days = buttons(question);
    expect(days).toContain(`n_${ym(nextMonth)}-10_0`);
    expect(days).not.toContain(`n_${ym(nextMonth)}-09_0`);
  });

  it('runs to the end and saves what the member answered', async () => {
    await bot.text('/onboarding');
    await bot.tap(`n_${ym(nextMonth)}-10_0`);
    await bot.tap(`n_${ym(nextMonth)}-20_0`);
    await bot.tap('category_Steward');
    await bot.tap('value_Courage');
    await bot.tap('value_Honesty');
    await bot.tap('value_Honesty'); // changed their mind
    await bot.tap('done_picking');

    // The location prompt is another scene's; its answer must land the member
    // in the next step, still listening.
    const afterLocation = await bot.location();
    expect(sent(afterLocation, 'make your answers public')).toBeDefined();
    const afterPublic = await bot.tap('public');
    expect(sent(afterPublic, 'Do you have any questions')).toBeDefined();

    const done = await bot.text('/done');
    expect(sent(done, 'Thank you so much')).toBeDefined();

    expect(bot.errors).toEqual([]);
    // One record, the one the welcome-back check reads.
    expect(bot.puts).toHaveLength(1);
    const [holon, lens, profile] = bot.puts[0];
    expect([holon, lens]).toEqual(['42', 'dna']);
    expect(profile).toMatchObject({
      id: '42',
      username: 't',
      public: true,
      category: 'Steward',
      values: ['Courage'],
      arrival: `${ym(nextMonth).replace('-', '/')}/10 00:00:00`,
      departure: `${ym(nextMonth).replace('-', '/')}/20 00:00:00`,
      location: { latitude: 45.1, longitude: 9.2 },
    });

    // …and the member is known the next time round.
    const again = await bot.text('/onboarding');
    expect(sent(again, 'Welcome back')).toBeDefined();
  });
});

describe('/onboarding — keeping answers private', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes nothing and says so', async () => {
    const bot = harness();
    await bot.text('/onboarding');
    await bot.tap(`n_${ym(nextMonth)}-10_0`);
    await bot.tap(`n_${ym(nextMonth)}-20_0`);
    await bot.tap('category_Steward');
    await bot.tap('done_picking');
    await bot.location();
    await bot.tap('private');
    const done = await bot.text('/done');

    expect(bot.puts).toEqual([]);
    expect(sent(done, 'Nothing was saved')).toBeDefined();
    expect(sent(done, 'is saved')).toBeUndefined();
    expect(bot.errors).toEqual([]);
  });
});

describe('/onboarding in a group', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves the community's answers in the group's holon and stops there", async () => {
    const bot = harness(groupChat);
    const opening = await bot.text('/onboarding');
    expect(sent(opening, 'community perspective')).toBeDefined();
    expect(sent(opening, 'Open to visitors')).toBeDefined();

    let last;
    for (let i = 0; i < dnaData.dna.length; i++) last = await bot.tap('dna_0');

    expect(sent(last, "community's DNA is saved")).toBeDefined();
    expect(sent(last, 'arrive')).toBeUndefined();
    expect(bot.errors).toEqual([]);

    expect(bot.puts).toHaveLength(1);
    const [holon, lens, record] = bot.puts[0];
    expect([holon, lens]).toEqual(['-1001', 'dna']);
    expect(Object.keys(record.community)).toHaveLength(dnaData.dna.length);
    expect(record.community.open_to_visitors).toBe('Yes');
  });
});

describe('scene flow', () => {
  const ctxWith = sessionState => ({
    from,
    session: sessionState,
    scene: { enter: vi.fn(), leave: vi.fn() },
  });

  it('walks the sequence and ends on done', () => {
    const ctx = ctxWith({});
    startSequence(ctx, ['a', 'b']);
    nextStep(ctx);
    nextStep(ctx);
    expect(ctx.scene.enter.mock.calls.map(c => c[0])).toEqual([
      'a',
      'b',
      'done',
    ]);
  });

  it('leaves rather than throwing when there is no run or no menu', () => {
    const noRun = ctxWith({});
    nextStep(noRun);
    expect(noRun.scene.leave).toHaveBeenCalled();

    const noMenu = ctxWith({});
    backToMenu(noMenu);
    expect(noMenu.scene.leave).toHaveBeenCalled();
    expect(noMenu.scene.enter).not.toHaveBeenCalled();
  });

  it('a single edit is saved at once and returns to the menu', async () => {
    const put = vi.fn(async () => true);
    const ctx = ctxWith({
      db: { get: async () => ({ id: '42', hex: 'h' }), put },
    });
    editFromMenu(ctx, 'welcome', 'values');
    completeStep(ctx, { values: ['Courage'] });
    await vi.waitFor(() => expect(put).toHaveBeenCalled());

    expect(put).toHaveBeenCalledWith('42', 'dna', {
      id: '42',
      hex: 'h',
      values: ['Courage'],
    });
    expect(ctx.scene.enter.mock.calls.map(c => c[0])).toEqual([
      'values',
      'welcome',
    ]);
  });
});
