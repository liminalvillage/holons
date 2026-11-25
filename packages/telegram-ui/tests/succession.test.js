// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A group upgraded to a supergroup keeps its holon (src/Succession.ts): the
// service message moves it, /adopt brings over one that was split earlier —
// for the chat's admins, and only when the old id is provably this chat's.

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import i18next from 'i18next';
import { bytesToHex } from 'nostr-tools/utils';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { createHoloSphere } from '@holons/core/holosphere';
import { syncMembersLog } from '@holons/core/protocol';
import { readSuccessor } from '@holons/core/holons';
import Succession, { migratedTo } from '../src/Succession.ts';
import { shutdownAskMissing } from '../src/AskMissing.js';

const key = () => {
  const sk = generateSecretKey();
  return { sk: bytesToHex(sk), pk: getPublicKey(sk) };
};
const B = key(); // the bot
const OLD = '-4123456789';
const NEW = '-1002123456789';
const OTHER = '-4999';
let n = 0;

beforeAll(async () => {
  // No catalogue: every text is the default the module carries.
  await i18next.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: {} } },
  });
});

let open = [];
afterEach(async () => {
  for (const hs of open) await hs.close();
  open = [];
});

const upgraded = to =>
  Object.assign(
    new Error('Bad Request: group chat was upgraded to a supergroup chat'),
    {
      response: { parameters: { migrate_to_chat_id: Number(to) } },
    }
  );

async function setup({ admin = true, probe = async () => true } = {}) {
  const hs = createHoloSphere({
    appName: `succession-bot-test-${++n}`,
    privateKey: B.sk,
    store: { adapter: 'memory' },
    registry: false,
  });
  open.push(hs);
  hs.publishNostrEvents = () => {};
  await syncMembersLog(hs, OLD, new Map(), { prune: false });
  await hs.put(OLD, 'settings', {
    id: OLD,
    name: 'Orto',
    admin: '7',
    language: 'it',
  });
  await hs.put(OLD, 'quests', {
    id: '1',
    title: 'Water the beds',
    type: 'task',
    participants: [],
  });

  const handlers = { on: {}, command: {} };
  const telegram = {
    sendMessage: vi.fn(async () => ({ message_id: 1 })),
    sendChatAction: vi.fn(probe),
  };
  const bot = {
    telegram,
    on: (ev, fn) => (handlers.on[ev] = fn),
    command: (name, fn) => (handlers.command[name] = fn),
  };
  const cache = new Map([[NEW, { stale: true }]]);
  const settings = { getLanguage: async () => 'en', _settingsCache: cache };
  const service = new Succession(bot, hs, settings, {
    isAdmin: async () => admin,
  });
  const adopt = (text, from = { id: 7 }) =>
    handlers.command.adopt({
      chat: { id: Number(NEW), type: 'supergroup' },
      from,
      message: { text },
      telegram,
    });
  return { hs, telegram, handlers, service, cache, adopt };
}

const raw = (hs, holon, lens, id) =>
  hs.get(holon, lens, id, null, { resolveHolograms: false });

describe('migratedTo', () => {
  it('reads the id an upgraded group became from a Telegram error', () => {
    expect(migratedTo(upgraded(NEW))).toBe(NEW);
    expect(migratedTo({ parameters: { migrate_to_chat_id: -1001 } })).toBe(
      '-1001'
    );
    expect(migratedTo(new Error('chat not found'))).toBeNull();
    expect(migratedTo(null)).toBeNull();
  });
});

describe('the upgrade itself', () => {
  it('moves the holon on the service message, old records winning over start-up defaults, and says so once', async () => {
    const { hs, telegram, handlers, cache } = await setup();
    // Something already wrote defaults for the new chat.
    await syncMembersLog(hs, NEW, new Map(), { prune: false });
    await hs.put(NEW, 'settings', { id: NEW, name: 'Orto', language: 'en' });

    const next = vi.fn(async () => {});
    // Both service messages arrive together.
    await Promise.all([
      handlers.on.migrate_to_chat_id(
        {
          chat: { id: Number(OLD), type: 'group' },
          message: { migrate_to_chat_id: Number(NEW) },
        },
        next
      ),
      handlers.on.migrate_from_chat_id(
        {
          chat: { id: Number(NEW), type: 'supergroup' },
          message: { migrate_from_chat_id: Number(OLD) },
        },
        next
      ),
    ]);
    expect(next).toHaveBeenCalledTimes(2);
    expect(await readSuccessor(hs, OLD)).toBe(NEW);
    expect(await raw(hs, NEW, 'quests', '1')).toMatchObject({
      title: 'Water the beds',
    });
    expect(await raw(hs, NEW, 'settings', NEW)).toMatchObject({
      id: NEW,
      language: 'it',
      admin: '7',
    });
    expect(cache.has(NEW)).toBe(false);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    const [chat, text] = telegram.sendMessage.mock.calls[0];
    expect(chat).toBe(NEW);
    expect(text).toContain(OLD);
  });

  it('stays quiet when the old chat never had a holon', async () => {
    const { hs, telegram, service } = await setup();
    const r = await service.migrated(OTHER, NEW);
    expect(r).toEqual({ ok: false, refused: 'not-ambassador' });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(await readSuccessor(hs, OTHER)).toBeNull();
  });
});

describe('/adopt', () => {
  it("is for the chat's admins, in a group, with an old id", async () => {
    const member = await setup({ admin: false });
    expect(await member.adopt(`/adopt ${OLD}`)).toBe('not-ambassador');
    expect(await readSuccessor(member.hs, OLD)).toBeNull();

    const { hs, adopt, handlers, telegram } = await setup();
    // No id: the bot asks for it (src/AskMissing.js) instead of the usage.
    telegram.sendMessage.mockClear();
    expect(await adopt('/adopt')).toBe('asked');
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage.mock.calls[0][1]).toMatch(/id of this group/);
    shutdownAskMissing();
    expect(await adopt('/adopt 12345')).toBe('usage');
    expect(await adopt(`/adopt ${NEW}`)).toBe('usage');
    expect(await adopt(`/adopt ${OLD}/settings`)).toBe('usage');
    expect(
      await handlers.command.adopt({
        chat: { id: 7, type: 'private' },
        from: { id: 7 },
        message: { text: `/adopt ${OLD}` },
      })
    ).toBe('private');
    expect(await readSuccessor(hs, OLD)).toBeNull();
  });

  it('moves a holon Telegram says this chat used to be', async () => {
    const { hs, adopt, telegram } = await setup({
      probe: async () => {
        throw upgraded(NEW);
      },
    });
    // Not the old holon's ambassador: Telegram's word is enough.
    expect(await adopt(`/adopt ${OLD}`, { id: 99 })).toBe('moved');
    expect(telegram.sendChatAction).toHaveBeenCalledWith(OLD, 'typing');
    expect(await readSuccessor(hs, OLD)).toBe(NEW);
  });

  it('refuses an old id that became another chat, whoever asks', async () => {
    const { hs, adopt } = await setup({
      probe: async () => {
        throw upgraded('-1005555555555');
      },
    });
    expect(await adopt(`/adopt ${OLD}`, { id: 7 })).toBe('unproven');
    expect(await readSuccessor(hs, OLD)).toBeNull();
  });

  it("without Telegram's word, only the old holon's ambassador may", async () => {
    const { hs, adopt } = await setup({
      probe: async () => {
        throw new Error('chat not found');
      },
    });
    expect(await adopt(`/adopt ${OLD}`, { id: 99 })).toBe('unproven');
    expect(await readSuccessor(hs, OLD)).toBeNull();
    expect(await adopt(`/adopt ${OLD}`, { id: 7 })).toBe('moved');
    expect(await readSuccessor(hs, OLD)).toBe(NEW);
  });

  it("keeps this group's records unless told to replace", async () => {
    const { hs, adopt, telegram } = await setup();
    await syncMembersLog(hs, NEW, new Map(), { prune: false });
    await hs.put(NEW, 'quests', {
      id: '1',
      title: 'Another quest',
      type: 'task',
      participants: [],
    });
    expect(await adopt(`/adopt ${OLD}`)).toBe('moved');
    expect(await raw(hs, NEW, 'quests', '1')).toMatchObject({
      title: 'Another quest',
    });
    expect(telegram.sendMessage.mock.calls.at(-1)[1]).toMatch(/replace/);
    expect(await adopt(`/adopt ${OLD} replace`)).toBe('moved');
    expect(await raw(hs, NEW, 'quests', '1')).toMatchObject({
      title: 'Water the beds',
    });
  });
});
