// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Telegraf, Telegram, Scenes, session } from 'telegraf';
import Onboarding from '../src/Onboarding.js';
import Settings from '../src/Settings.ts';
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
function harness(chat = privateChat, { withOnboarding = true } = {}) {
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
    getAll: async (holon, lens) =>
      [...records.entries()]
        .filter(([k]) => k.startsWith(`${holon}/${lens}/`))
        .map(([, v]) => v),
  };
  new InputScene(bot);
  const onboarding = withOnboarding ? new Onboarding(bot, db) : null;
  // Settings' /start dispatch for the onboarding deep link, on its own.
  bot.start(async ctx => {
    const handled =
      ctx.payload === 'onboarding' &&
      ctx.chat.type === 'private' &&
      (await Settings.prototype._startOnboardingDeeplink.call(
        { bot, db },
        ctx
      ));
    if (!handled) await ctx.reply('Welcome!');
  });
  void onboarding;

  const deliver = async update => {
    calls.length = 0;
    await bot.handleUpdate({ update_id: ++uid, ...update });
    return [...calls];
  };
  return {
    puts,
    errors,
    seed: (holon, lens, data) =>
      records.set(`${holon}/${lens}/${data.id}`, data),
    text: t =>
      deliver({
        message: {
          message_id: ++mid,
          from,
          chat,
          date: 0,
          text: t,
          entities: t.startsWith('/')
            ? [
                {
                  type: 'bot_command',
                  offset: 0,
                  length: t.split(' ')[0].length,
                },
              ]
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
    const valuesPrompt = await bot.tap('category_Steward');
    // The catalogue is data/values.json, ten to a page with their meaning.
    const picker = sent(valuesPrompt, 'select the values');
    expect(picker.payload.text).toContain('Accountability/Ethics — To act on');
    expect(buttons(picker)).toContain('value_Accountability/Ethics');
    await bot.tap('value_Creativity');
    await bot.tap('value_Responsibility');
    await bot.tap('value_Responsibility'); // changed their mind
    const ikigaiPrompt = await bot.tap('done_picking');
    expect(sent(ikigaiPrompt, 'What is your ikigai?')).toBeDefined();
    const linkedinPrompt = await bot.text('I hold space for people to grow.');
    expect(sent(linkedinPrompt, 'LinkedIn profile link')).toBeDefined();

    const wrong = await bot.text('my website is example.com');
    expect(sent(wrong, 'does not look like a LinkedIn')).toBeDefined();
    // The LinkedIn prompt is another scene's; its answer must land the
    // member in the next step, still listening — and no location is asked.
    const afterLinkedin = await bot.text('http://it.linkedin.com/in/t-person/');
    expect(sent(afterLinkedin, 'make your answers public')).toBeDefined();
    expect(sent(afterLinkedin, 'location')).toBeUndefined();
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
      values: ['Creativity'],
      ikigai: 'I hold space for people to grow.',
      linkedin: 'https://www.linkedin.com/in/t-person/',
      arrival: `${ym(nextMonth).replace('-', '/')}/10 00:00:00`,
      departure: `${ym(nextMonth).replace('-', '/')}/20 00:00:00`,
    });
    expect(profile).not.toHaveProperty('location');

    // …and the member is known the next time round.
    const again = await bot.text('/onboarding');
    expect(sent(again, 'Welcome back')).toBeDefined();
  });
});

describe('/onboarding — ikigai and LinkedIn', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('both can be skipped; nothing is invented for them', async () => {
    const bot = harness();
    await bot.text('/onboarding');
    await bot.tap(`n_${ym(nextMonth)}-10_0`);
    await bot.tap(`n_${ym(nextMonth)}-20_0`);
    await bot.tap('category_Steward');
    await bot.tap('done_picking');
    const afterIkigai = await bot.tap('input_scene_cancel');
    expect(sent(afterIkigai, 'LinkedIn profile link')).toBeDefined();
    const afterLinkedin = await bot.tap('input_scene_cancel');
    expect(sent(afterLinkedin, 'make your answers public')).toBeDefined();
    await bot.tap('public');

    expect(bot.errors).toEqual([]);
    const [, , profile] = bot.puts[0];
    expect(profile).not.toHaveProperty('ikigai');
    expect(profile).not.toHaveProperty('linkedin');
  });

  it('can be changed later from the welcome-back menu', async () => {
    const bot = harness();
    await bot.text('/onboarding');
    await bot.tap(`n_${ym(nextMonth)}-10_0`);
    await bot.tap(`n_${ym(nextMonth)}-20_0`);
    await bot.tap('category_Steward');
    await bot.tap('done_picking');
    await bot.tap('input_scene_cancel');
    await bot.tap('input_scene_cancel');
    await bot.tap('public');
    await bot.text('/done');

    await bot.text('/onboarding');
    const menu = await bot.tap('change');
    expect(buttons(sent(menu, 'What would you like to change?'))).toEqual(
      expect.arrayContaining(['ikigai', 'linkedin'])
    );
    await bot.tap('linkedin');
    await bot.text('linkedin.com/in/new-me');

    expect(bot.errors).toEqual([]);
    await vi.waitFor(() =>
      expect(bot.puts.at(-1)[2]).toMatchObject({
        category: 'Steward',
        linkedin: 'https://www.linkedin.com/in/new-me',
      })
    );
  });
});

describe('/ikigai', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets the ikigai from the command text, keeping the rest of the DNA', async () => {
    const bot = harness();
    bot.seed('42', 'dna', { id: '42', category: 'Steward', public: true });

    const calls = await bot.text('/ikigai I make bread for the village.');

    expect(sent(calls, 'Your ikigai is saved')).toBeDefined();
    expect(bot.errors).toEqual([]);
    expect(bot.puts.at(-1)).toEqual([
      '42',
      'dna',
      {
        id: '42',
        category: 'Steward',
        public: true,
        ikigai: 'I make bread for the village.',
      },
    ]);
  });

  it('on its own shows the saved ikigai and updates it from the reply', async () => {
    const bot = harness();
    bot.seed('42', 'dna', { id: '42', ikigai: 'Old answer.' });

    const prompt = await bot.text('/ikigai');
    expect(sent(prompt, 'What is your ikigai?')).toBeDefined();
    expect(sent(prompt, 'Old answer.')).toBeDefined();

    const reply = await bot.text('I hold space for people to grow.');
    expect(sent(reply, 'Your ikigai is saved')).toBeDefined();
    expect(bot.puts.at(-1)[2]).toMatchObject({
      ikigai: 'I hold space for people to grow.',
    });

    // The scene is left: the next message is not taken as an ikigai.
    const puts = bot.puts.length;
    await bot.text('hello');
    expect(bot.puts.length).toBe(puts);
    expect(bot.errors).toEqual([]);
  });

  it('cancel leaves the ikigai unchanged', async () => {
    const bot = harness();
    bot.seed('42', 'dna', { id: '42', ikigai: 'Old answer.' });

    await bot.text('/ikigai');
    const cancelled = await bot.tap('input_scene_cancel');

    expect(sent(cancelled, 'unchanged')).toBeDefined();
    expect(bot.puts).toEqual([]);
    expect(bot.errors).toEqual([]);
  });

  it('refuses an ikigai that is too long', async () => {
    const bot = harness();
    const calls = await bot.text(`/ikigai ${'x'.repeat(1001)}`);

    expect(sent(calls, 'under 1000 characters')).toBeDefined();
    expect(bot.puts).toEqual([]);
  });
});

describe('t.me/<bot>?start=onboarding', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the /onboarding journey', async () => {
    const bot = harness();
    const calls = await bot.text('/start onboarding');
    expect(sent(calls, 'When would you like to arrive?')).toBeDefined();
    expect(sent(calls, 'Welcome!')).toBeUndefined();
    expect(bot.errors).toEqual([]);
  });

  it.each([
    [
      'an onboarding DNA',
      ['42', 'dna', { id: '42', category: 'Steward', public: true }],
    ],
    [
      'a profile in their own holon',
      ['42', 'users', { id: 42, username: 't' }],
    ],
    ['a hub they belong to', ['42', 'holons', { id: '-1003864542239' }]],
  ])(
    'someone known by %s only completes their public profile',
    async (_, [holon, lens, data]) => {
      const bot = harness();
      bot.seed(holon, lens, data);

      const opening = await bot.text('/start onboarding');
      expect(sent(opening, 'Welcome back! Let us complete')).toBeDefined();
      expect(sent(opening, 'What is your ikigai?')).toBeDefined();
      expect(sent(opening, 'arrive')).toBeUndefined();

      await bot.text('I make bread for the village.');
      const afterLinkedin = await bot.tap('input_scene_cancel');
      expect(sent(afterLinkedin, 'make your answers public')).toBeDefined();
      const done = await bot.tap('public');
      expect(sent(done, 'Thank you so much')).toBeDefined();

      expect(bot.errors).toEqual([]);
      const [h, l, profile] = bot.puts.at(-1);
      expect([h, l]).toEqual(['42', 'dna']);
      expect(profile).toMatchObject({
        id: '42',
        public: true,
        ikigai: 'I make bread for the village.',
      });
      expect(profile).not.toHaveProperty('arrival');
      if (lens === 'dna') expect(profile.category).toBe('Steward'); // kept
    }
  );

  it('falls back to the plain welcome when onboarding is not loaded', async () => {
    const bot = harness(privateChat, { withOnboarding: false });
    const calls = await bot.text('/start onboarding');
    expect(sent(calls, 'Welcome!')).toBeDefined();
    expect(bot.errors).toEqual([]);
  });

  it('is ignored in groups', async () => {
    const bot = harness(groupChat);
    const calls = await bot.text('/start onboarding');
    expect(sent(calls, 'Welcome!')).toBeDefined();
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
    await bot.tap('input_scene_cancel'); // skip ikigai
    await bot.tap('input_scene_cancel'); // skip LinkedIn
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
