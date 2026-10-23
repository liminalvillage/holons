// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The pinned apps list (src/AppsPin.ts): posted on join, pinned once the bot
// may pin, re-posted by /apps (admins), edited in place when MINI_APPS moves.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import AppsPin, { appsMessage } from '../src/AppsPin.ts';
import { miniAppsKeyboard } from '../src/MiniApps.ts';

const GROUP = -1004438000774;
let dirs = [];
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function fakeBot({ canPin = true, status = 'administrator' } = {}) {
  const handlers = { command: {}, on: {} };
  let nextId = 100;
  const telegram = {
    getMe: vi.fn(async () => ({ username: 'HubsNetwork_bot' })),
    sendMessage: vi.fn(async () => ({ message_id: ++nextId })),
    pinChatMessage: vi.fn(async () => {
      if (!canPin) throw new Error('not enough rights');
      return true;
    }),
    unpinChatMessage: vi.fn(async () => true),
    editMessageText: vi.fn(async () => true),
    getChatMember: vi.fn(async () => ({ status })),
  };
  return {
    botInfo: { username: 'HubsNetwork_bot' },
    telegram,
    command: (name, fn) => (handlers.command[name] = fn),
    on: (ev, fn) => (handlers.on[ev] = fn),
    handlers,
  };
}

const settings = { getLanguage: async () => 'en' };

function setup(opts = {}, env = { MINI_APPS: 'tasks,calendar,library' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appspin-'));
  dirs.push(dir);
  const file = path.join(dir, 'appspins.json');
  const bot = fakeBot(opts);
  const pin = new AppsPin(bot, settings, { file, env });
  return { bot, pin, file, env };
}

const joined = (status, before = 'left') => ({
  myChatMember: {
    chat: { id: GROUP, type: 'supergroup' },
    old_chat_member: { status: before },
    new_chat_member: { status },
  },
});

describe('miniAppsKeyboard', () => {
  it('lists registered services in tab order, two to a row', () => {
    const rows = miniAppsKeyboard('HolonsBot', GROUP, 'en', {
      MINI_APPS: 'library,tasks,calendar',
    });
    expect(rows.map(r => r.length)).toEqual([2, 1]);
    expect(rows.flat().map(b => b.url)).toEqual([
      `https://t.me/HolonsBot/tasks?startapp=${GROUP}`,
      `https://t.me/HolonsBot/calendar?startapp=${GROUP}`,
      `https://t.me/HolonsBot/library?startapp=${GROUP}`,
    ]);
    expect(miniAppsKeyboard('HolonsBot', GROUP, 'en', {})).toEqual([]);
  });
});

describe('AppsPin', () => {
  it('registers nothing when no Mini App is registered', () => {
    const { bot } = setup({}, {});
    expect(bot.handlers.command.apps).toBeUndefined();
    expect(bot.handlers.on.my_chat_member).toBeUndefined();
    expect(appsMessage('HubsNetwork_bot', GROUP, 'en', {})).toBeNull();
  });

  it('posts and pins the list when added to a group, and passes the update on', async () => {
    const { bot, file } = setup();
    const next = vi.fn();
    await bot.handlers.on.my_chat_member(joined('member'), next);
    expect(next).toHaveBeenCalled();
    expect(bot.telegram.sendMessage).toHaveBeenCalledTimes(1);
    const [chat, , extra] = bot.telegram.sendMessage.mock.calls[0];
    expect(chat).toBe(GROUP);
    expect(extra.reply_markup.inline_keyboard.flat()).toHaveLength(3);
    expect(bot.telegram.pinChatMessage).toHaveBeenCalledWith(GROUP, 101, {
      disable_notification: true,
    });
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(saved.HubsNetwork_bot[String(GROUP)].messageId).toBe(101);
  });

  it('pins the same post once promoted, without posting again', async () => {
    const { bot } = setup({ canPin: false });
    await bot.handlers.on.my_chat_member(joined('member'), () => {});
    bot.telegram.pinChatMessage.mockImplementation(async () => true);
    await bot.handlers.on.my_chat_member(
      joined('administrator', 'member'),
      () => {}
    );
    expect(bot.telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(bot.telegram.pinChatMessage).toHaveBeenLastCalledWith(GROUP, 101, {
      disable_notification: true,
    });
  });

  it('/apps re-posts and moves the pin; members may not', async () => {
    const { bot } = setup();
    const ctx = {
      chat: { id: GROUP, type: 'supergroup' },
      from: { id: 1 },
      telegram: bot.telegram,
      reply: vi.fn(async () => {}),
    };
    await bot.handlers.command.apps(ctx);
    await bot.handlers.command.apps(ctx);
    expect(bot.telegram.sendMessage).toHaveBeenCalledTimes(2);
    expect(bot.telegram.unpinChatMessage).toHaveBeenCalledWith(GROUP, 101);
    expect(bot.telegram.pinChatMessage).toHaveBeenLastCalledWith(GROUP, 102, {
      disable_notification: true,
    });

    bot.telegram.getChatMember.mockImplementation(async () => ({
      status: 'member',
    }));
    await bot.handlers.command.apps(ctx);
    expect(bot.telegram.sendMessage).toHaveBeenCalledTimes(2);
    expect(ctx.reply).toHaveBeenCalled();
  });

  it('edits every pinned list in place when the registered apps change', async () => {
    const { bot, file } = setup();
    await bot.handlers.on.my_chat_member(joined('member'), () => {});

    const later = new AppsPin(bot, settings, {
      file,
      env: { MINI_APPS: 'tasks,calendar,library,stock' },
    });
    await later.ready;
    expect(bot.telegram.editMessageText).toHaveBeenCalledTimes(1);
    const [chat, messageId, , , extra] =
      bot.telegram.editMessageText.mock.calls[0];
    expect([chat, messageId]).toEqual([String(GROUP), 101]);
    expect(extra.reply_markup.inline_keyboard.flat()).toHaveLength(4);

    // Already current: no edit.
    await later.refreshAll();
    expect(bot.telegram.editMessageText).toHaveBeenCalledTimes(1);
  });

  it('forgets a list whose message is gone and posts a new one on the next join', async () => {
    const { bot, file, env } = setup();
    await bot.handlers.on.my_chat_member(joined('member'), () => {});
    bot.telegram.editMessageText.mockImplementation(async () => {
      throw { description: 'Bad Request: message to edit not found' };
    });
    const later = new AppsPin(bot, settings, {
      file,
      env: { ...env, MINI_APPS: 'tasks' },
    });
    await later.ready;
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(saved.HubsNetwork_bot[String(GROUP)]).toBeUndefined();
  });
});
