// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { i18next } from '../src/utilities.js';
import Shopping from '../src/Shopping.js';

const CHAT = -100123;

/** Topic fields Telegram stamps on messages inside a forum topic. */
const inTopic = (name, threadId = 7) => ({
  message_thread_id: threadId,
  is_topic_message: true,
  reply_to_message: { forum_topic_created: { name } },
});

const list = () => ({
  items: [
    { id: 'a', text: 'milk', checked: false, category: '' },
    { id: 'b', text: 'nails', checked: false, category: 'Garden' },
    { id: 'c', text: 'seeds', checked: false, category: 'Garden' },
  ],
});

const labels = keyboard =>
  keyboard.reply_markup.inline_keyboard.map(row => row.map(b => b.text));

function make(items = list()) {
  const bot = { command: vi.fn(), action: vi.fn() };
  const store = { checklists: items };
  const db = {
    get: vi.fn(async (_h, bucket) => store[bucket]),
    put: vi.fn(async (_h, bucket, value) => {
      store[bucket] = value;
    }),
  };
  const shopping = new Shopping(bot, db, { getLanguage: async () => 'en' });
  return { bot, db, shopping };
}

describe('Shopping (telegram)', () => {
  beforeAll(async () => {
    const en = JSON.parse(
      readFileSync(new URL('../data/locales/en.json', import.meta.url), 'utf8')
    );
    await i18next.init({ lng: 'en', fallbackLng: 'en', resources: { en } });
  });

  it('has no per-item share button: rows are just the toggle', () => {
    const { shopping, bot } = make();
    const kb = shopping.getShoppingListKeyboard(list().items, 'en', true);
    for (const row of kb.reply_markup.inline_keyboard.slice(0, -1)) {
      expect(row).toHaveLength(1);
      expect(row[0].callback_data).toMatch(
        /^(toggle_shopping_|shopping_category_)/
      );
    }
    const actions = bot.action.mock.calls.map(([pattern]) => String(pattern));
    expect(actions.some(a => a.includes('share_need'))).toBe(false);
  });

  it('/shopping in a topic shows only that topic; in general shows everything', async () => {
    const { shopping } = make();
    const reply = vi.fn(async () => {});
    await shopping.shopping({
      chat: { id: CHAT },
      message: { text: '/shopping', ...inTopic('Garden') },
      reply,
    });
    expect(labels(reply.mock.calls[0][1])).toEqual([
      ['☑️ nails'],
      ['☑️ seeds'],
      ['➕ Add Item', 'Clear Checked ✅'],
    ]);

    reply.mockClear();
    await shopping.shopping({
      chat: { id: CHAT },
      message: { text: '/shopping' },
      reply,
    });
    expect(labels(reply.mock.calls[0][1]).flat()).toEqual(
      expect.arrayContaining(['☑️ milk', '— Garden —', '☑️ nails', '☑️ seeds'])
    );
  });

  it('toggling inside a topic re-renders that topic, not the general list', async () => {
    const { shopping } = make();
    const editMessageText = vi.fn(async () => {});
    await shopping.toggle({
      chat: { id: CHAT },
      match: ['toggle_shopping_b', 'b'],
      // A button tap: no ctx.message, the list message lives in the topic.
      callbackQuery: { message: inTopic('Garden') },
      editMessageText,
      answerCbQuery: async () => {},
    });
    expect(labels(editMessageText.mock.calls[0][1])).toEqual([
      ['✅ nails'],
      ['☑️ seeds'],
      ['➕ Add Item', 'Clear Checked ✅'],
    ]);
  });

  it('toggling in the general chat keeps the full, grouped list', async () => {
    const { shopping } = make();
    const editMessageText = vi.fn(async () => {});
    await shopping.toggle({
      chat: { id: CHAT },
      match: ['toggle_shopping_a', 'a'],
      callbackQuery: { message: { message_id: 1 } },
      editMessageText,
    });
    expect(labels(editMessageText.mock.calls[0][1]).flat()).toEqual(
      expect.arrayContaining(['✅ milk', '— Garden —', '☑️ nails', '☑️ seeds'])
    );
  });
});
