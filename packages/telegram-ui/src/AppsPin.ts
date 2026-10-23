// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

/**
 * @fileoverview The pinned apps message: one post per chat with an Open
 * button for every registered Mini App (MiniApps.ts), pinned so the list
 * sits at the top of the chat — nobody has to type a command or open a menu.
 *
 *   • The bot is added to a group → it posts the list, and pins it once it
 *     may (pinning needs the admin right; promotion pins the same post).
 *   • /apps → posts a fresh list and pins it, replacing the old pin (in a
 *     group only its admins may: a member's ask would re-pin for everyone).
 *   • MINI_APPS changes → on start every pinned list is edited in place.
 *
 * Which message is the list is the bot's own Telegram state, not holon data:
 * it lives in a local JSON file per bot (APPS_PIN_FILE), never on the relays.
 *
 * @module src/AppsPin
 */

import fs from 'fs';
import path from 'path';
import i18next from 'i18next';
import type { Telegraf, Context } from 'telegraf';
import { miniApps, miniAppsKeyboard } from './MiniApps.js';
import { isAdmin } from './utilities.js';

/** One chat's pinned list: the message, and the keyboard it carries. */
export interface PinnedList {
  messageId: number;
  /** The buttons it was last sent or edited with, to skip no-op edits. */
  sig: string;
}

/** bot username → chat id → its pinned list. */
type PinFile = Record<string, Record<string, PinnedList>>;

interface LanguageSource {
  getLanguage(holonId: string | number): Promise<string>;
}

const DEFAULT_FILE = './data/appspins.json';
const IN_GROUP = new Set(['member', 'administrator']);
const GONE = new Set(['left', 'kicked']);

/** What the bot has to post in `chatId`: the text and its keyboard, or null. */
export function appsMessage(
  botUsername: string | undefined,
  chatId: string | number,
  lng: string,
  env: NodeJS.ProcessEnv = process.env
): {
  text: string;
  rows: ReturnType<typeof miniAppsKeyboard>;
  sig: string;
} | null {
  const rows = miniAppsKeyboard(botUsername, chatId, lng, env);
  if (!rows.length) return null;
  return {
    text: String(
      i18next.t('appsPinned', {
        lng,
        defaultValue: '📱 Apps for this holon — tap one to open it.',
      })
    ),
    rows,
    sig: JSON.stringify(rows),
  };
}

export default class AppsPin {
  private bot: Telegraf<Context>;
  private settings: LanguageSource;
  private file: string;
  private env: NodeJS.ProcessEnv;
  private username: string | undefined;
  /** Settles once the start-up refresh of every pinned list is done. */
  ready: Promise<void> = Promise.resolve();

  constructor(
    bot: Telegraf<Context>,
    settings: LanguageSource,
    { file, env = process.env }: { file?: string; env?: NodeJS.ProcessEnv } = {}
  ) {
    this.bot = bot;
    this.settings = settings;
    this.env = env;
    this.file = file ?? env.APPS_PIN_FILE ?? DEFAULT_FILE;
    if (!miniApps(env).size) return;

    bot.command('apps', async ctx => {
      const chatId = ctx.chat?.id;
      if (chatId == null) return;
      if (!(await isAdmin(ctx))) {
        const lng = await this.language(chatId);
        await ctx
          .reply(String(i18next.t('adminonly', { lng })))
          .catch(() => {});
        return;
      }
      const posted = await this.post(chatId).catch(e => {
        console.log('[AppsPin] /apps failed:', e?.message ?? e);
        return false;
      });
      if (!posted) {
        const lng = await this.language(chatId);
        await ctx
          .reply(
            String(
              i18next.t('appsNone', {
                lng,
                defaultValue: 'No apps are set up for this bot yet.',
              })
            )
          )
          .catch(() => {});
      }
    });

    // Added to a group → post; promoted to admin → pin what was posted.
    bot.on('my_chat_member', async (ctx, next) => {
      const update = ctx.myChatMember;
      const chatId = update.chat.id;
      const now = update.new_chat_member?.status;
      const before = update.old_chat_member?.status;
      if (update.chat.type !== 'private' && now && IN_GROUP.has(now)) {
        const joined = !before || GONE.has(before);
        const promoted = now === 'administrator' && before !== 'administrator';
        if (joined || promoted) {
          await this.ensure(chatId).catch(e =>
            console.log(
              '[AppsPin] could not post the apps list:',
              e?.message ?? e
            )
          );
        }
      }
      if (update.chat.type !== 'private' && now && GONE.has(now)) {
        this.forget(chatId);
      }
      return next();
    });

    this.ready = this.refreshAll().catch(e =>
      console.log('[AppsPin] refresh failed:', e?.message ?? e)
    );
  }

  /** The bot's username — from the launch when there, else asked once. */
  private async botUsername(): Promise<string | undefined> {
    if (!this.username) {
      this.username =
        this.bot.botInfo?.username ??
        (await this.bot.telegram.getMe().catch(() => null))?.username;
    }
    return this.username;
  }

  private async language(chatId: string | number): Promise<string> {
    return (await this.settings.getLanguage(chatId).catch(() => 'en')) || 'en';
  }

  private read(): PinFile {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8')) as PinFile;
    } catch {
      return {};
    }
  }

  private write(all: PinFile): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(all, null, 2));
  }

  private async entries(): Promise<
    [string, Record<string, PinnedList>, PinFile]
  > {
    const name = (await this.botUsername()) ?? '';
    const all = this.read();
    return [name, all[name] ?? {}, all];
  }

  private async remember(chatId: string | number, list: PinnedList | null) {
    const [name, mine, all] = await this.entries();
    if (list) mine[String(chatId)] = list;
    else delete mine[String(chatId)];
    all[name] = mine;
    this.write(all);
  }

  private forget(chatId: string | number): void {
    void this.remember(chatId, null).catch(() => {});
  }

  /** Pin a message quietly; false when the bot may not pin here. */
  private async pin(chatId: string | number, messageId: number) {
    return this.bot.telegram
      .pinChatMessage(chatId, messageId, { disable_notification: true })
      .then(() => true)
      .catch(() => false);
  }

  /** Post a fresh list in `chatId` and pin it, unpinning the old one. */
  async post(chatId: string | number): Promise<boolean> {
    const message = appsMessage(
      await this.botUsername(),
      chatId,
      await this.language(chatId),
      this.env
    );
    if (!message) return false;
    const [, mine] = await this.entries();
    const old = mine[String(chatId)];
    const sent = await this.bot.telegram.sendMessage(chatId, message.text, {
      reply_markup: { inline_keyboard: message.rows },
    });
    if (old) {
      await this.bot.telegram
        .unpinChatMessage(chatId, old.messageId)
        .catch(() => {});
    }
    await this.pin(chatId, sent.message_id);
    await this.remember(chatId, {
      messageId: sent.message_id,
      sig: message.sig,
    });
    return true;
  }

  /** The chat has a list, current and pinned — editing or posting as needed. */
  async ensure(chatId: string | number): Promise<void> {
    const [, mine] = await this.entries();
    const old = mine[String(chatId)];
    if (!old) {
      await this.post(chatId);
      return;
    }
    if (!(await this.refresh(chatId, old))) {
      await this.post(chatId);
      return;
    }
    await this.pin(chatId, old.messageId);
  }

  /**
   * Bring one pinned list up to date in place. False when the message is
   * gone (deleted, or the bot was removed): the caller posts a new one.
   */
  private async refresh(chatId: string | number, list: PinnedList) {
    const message = appsMessage(
      await this.botUsername(),
      chatId,
      await this.language(chatId),
      this.env
    );
    if (!message) return true;
    if (message.sig === list.sig) return true;
    try {
      await this.bot.telegram.editMessageText(
        chatId,
        list.messageId,
        undefined,
        message.text,
        { reply_markup: { inline_keyboard: message.rows } }
      );
    } catch (e) {
      const desc = String((e as { description?: string })?.description ?? e);
      if (!/not modified/i.test(desc)) {
        await this.remember(chatId, null);
        return false;
      }
    }
    await this.remember(chatId, { ...list, sig: message.sig });
    return true;
  }

  /** On start: every pinned list follows the services registered now. */
  async refreshAll(): Promise<void> {
    const [, mine] = await this.entries();
    for (const [chatId, list] of Object.entries(mine)) {
      await this.refresh(chatId, list).catch(() => {});
    }
  }
}
