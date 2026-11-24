// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

/**
 * @fileoverview A group that becomes a supergroup keeps its holon.
 *
 * Telegram gives a group a new chat id when it is upgraded to a supergroup —
 * making it public, or showing its history to new members, is enough — and
 * the holon's id is the chat id. This module carries the holon across with
 * core's `succeedHolon` (`@holons/core/holons`): what the move means lives
 * there; this only decides WHEN it happens and tells the chat.
 *
 *   • The upgrade itself: Telegram posts a service message in each chat
 *     (`migrate_to_chat_id` in the old one, `migrate_from_chat_id` in the
 *     new). Either one moves the holon; the new chat is seconds old, so the
 *     old records replace whatever start-up defaults landed there.
 *   • /adopt <old id>, in the new group, for a holon that was split before
 *     this existed. Only the chat's admins may, and only when the old id is
 *     provably this chat's past: Telegram still answers for an upgraded
 *     group by naming the chat it became, and failing that the caller must
 *     be the old holon's admin. Records the new holon already has stand;
 *     `/adopt <old id> replace` lets the old ones win instead.
 *
 * @module src/Succession
 */

import i18next from 'i18next';
import type { Telegraf, Context } from 'telegraf';
import {
  succeedHolon,
  type SuccessionReport,
  type SuccessionResult,
} from '@holons/core/holons';
import { isAdmin as isChatAdmin } from './utilities.js';
import { askArgs } from './AskMissing.js';

interface SettingsLike {
  getLanguage?(holonId: string | number): Promise<string>;
  _settingsCache?: Map<string | number, unknown>;
}

interface TelegramLike {
  sendMessage(
    chatId: string | number,
    text: string,
    extra?: Record<string, unknown>
  ): Promise<unknown>;
  sendChatAction(chatId: string | number, action: string): Promise<unknown>;
}

export interface SuccessionOptions {
  /** Is the sender an admin of the chat? Injectable for tests. */
  isAdmin?: (ctx: Context) => Promise<boolean>;
}

type Db = Parameters<typeof succeedHolon>[0];

const CHAT_ID_RE = /^-\d{1,20}$/;
const esc = (s: unknown) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The chat an upgraded group became, when a Telegram error says so. */
export function migratedTo(error: unknown): string | null {
  const e = error as {
    parameters?: { migrate_to_chat_id?: unknown };
    response?: { parameters?: { migrate_to_chat_id?: unknown } };
  } | null;
  const id =
    e?.parameters?.migrate_to_chat_id ??
    e?.response?.parameters?.migrate_to_chat_id;
  return id == null ? null : String(id);
}

/** What the chat is told once its holon has moved. */
export function successionSummary(
  report: SuccessionReport,
  lng = 'en'
): string {
  const copied = Object.values(report.copied).reduce((a, b) => a + b, 0);
  const lines = [
    String(
      i18next.t('successionMoved', {
        lng,
        from: report.from,
        count: copied,
        defaultValue:
          '🧬 This group carries on {@the_holon} it had as <code>{{from}}</code>: {{count}} records brought over.',
      })
    ),
  ];
  if (report.conflicts.length)
    lines.push(
      String(
        i18next.t('successionConflicts', {
          lng,
          count: report.conflicts.length,
          from: report.from,
          defaultValue:
            "{{count}} records exist on both sides with different content — this group's were kept. /adopt {{from}} replace takes the old ones instead.",
        })
      )
    );
  const logs = report.skipped.filter(s => s.reason === 'log').map(s => s.lens);
  const sealed = report.skipped
    .filter(s => s.reason === 'sealed')
    .map(s => s.lens);
  if (logs.length)
    lines.push(
      String(
        i18next.t('successionLogs', {
          lng,
          lenses: logs.join(', '),
          defaultValue: 'Not brought over — signed logs: {{lenses}}.',
        })
      )
    );
  if (sealed.length || report.sealed.length)
    lines.push(
      String(
        i18next.t('successionSealed', {
          lng,
          count: report.sealed.length,
          lenses: sealed.join(', ') || '—',
          defaultValue:
            'Not brought over — private: {{lenses}} (and {{count}} single private items).',
        })
      )
    );
  if (report.failed.length)
    lines.push(
      String(
        i18next.t('successionFailed', {
          lng,
          count: report.failed.length,
          defaultValue:
            '{{count}} records could not be written; run /adopt again.',
        })
      )
    );
  return lines.join('\n');
}

export default class Succession {
  bot: { telegram: TelegramLike } | null;
  private db: Db;
  private settings: SettingsLike | null;
  private isAdmin: (ctx: Context) => Promise<boolean>;
  /** One move per pair at a time: both service messages arrive together. */
  private running = new Map<string, Promise<SuccessionResult>>();

  constructor(
    bot: Telegraf<Context> | null,
    db: Db,
    settings: SettingsLike | null = null,
    opts: SuccessionOptions = {}
  ) {
    this.bot = bot as unknown as { telegram: TelegramLike } | null;
    this.db = db;
    this.settings = settings;
    this.isAdmin =
      opts.isAdmin ?? (ctx => isChatAdmin(ctx) as Promise<boolean>);
    if (!bot) return;

    bot.on(
      'migrate_to_chat_id' as never,
      async (ctx: Context, next: () => Promise<void>) => {
        const to = (ctx.message as { migrate_to_chat_id?: number } | undefined)
          ?.migrate_to_chat_id;
        if (ctx.chat && to != null)
          await this.migrated(String(ctx.chat.id), String(to));
        return next();
      }
    );
    bot.on(
      'migrate_from_chat_id' as never,
      async (ctx: Context, next: () => Promise<void>) => {
        const from = (
          ctx.message as { migrate_from_chat_id?: number } | undefined
        )?.migrate_from_chat_id;
        if (ctx.chat && from != null)
          await this.migrated(String(from), String(ctx.chat.id));
        return next();
      }
    );
    bot.command('adopt', ctx => this.adopt(ctx));
  }

  private async language(chatId: string | number): Promise<string> {
    return (
      (await this.settings?.getLanguage?.(chatId).catch(() => 'en')) || 'en'
    );
  }

  private async say(chatId: string | number, text: string): Promise<void> {
    await this.bot?.telegram
      .sendMessage(chatId, text, { parse_mode: 'HTML' })
      .catch(e =>
        console.log('[succession] could not post:', (e as Error)?.message ?? e)
      );
  }

  /** Move the holon, once per pair however many callers ask at the same moment. */
  move(
    from: string,
    to: string,
    opts: { overwrite?: boolean } = {}
  ): Promise<SuccessionResult> {
    const key = `${from}>${to}`;
    const inFlight = this.running.get(key);
    if (inFlight) return inFlight;
    const run = succeedHolon(this.db, { from, to, overwrite: opts.overwrite })
      .then(result => {
        // The settings service may hold the new chat's start-up defaults.
        for (const id of [to, Number(to)])
          this.settings?._settingsCache?.delete(id);
        return result;
      })
      .finally(() => this.running.delete(key));
    this.running.set(key, run);
    return run;
  }

  /** Telegram said `from` became `to`. Returns what happened, for tests. */
  async migrated(from: string, to: string): Promise<SuccessionResult | null> {
    try {
      const already = this.running.has(`${from}>${to}`);
      const result = await this.move(from, to, { overwrite: true });
      if (already) return result; // the other service message reports
      if (result.ok) {
        console.log(
          `[succession] ${from} → ${to}:`,
          JSON.stringify({
            copied: result.copied,
            skipped: result.skipped,
            sealed: result.sealed.length,
            failed: result.failed.length,
          })
        );
        const copied = Object.keys(result.copied).length > 0;
        if (
          copied ||
          result.skipped.some(
            s => s.reason === 'log' || s.reason === 'sealed'
          ) ||
          result.sealed.length ||
          result.failed.length
        )
          await this.say(
            to,
            successionSummary(result, await this.language(to))
          );
      } else if (result.refused !== 'not-admin') {
        // `not-admin`: the old chat never had a holon — nothing to carry.
        console.warn(`[succession] ${from} → ${to} refused: ${result.refused}`);
      }
      return result;
    } catch (e) {
      console.error(`[succession] ${from} → ${to} failed:`, e);
      return null;
    }
  }

  /**
   * Is `from` this chat's own past? Telegram answers a call to an upgraded
   * group with the id it became; otherwise the caller must be the admin the
   * old holon names.
   */
  private async proven(
    from: string,
    to: string,
    userId: number | undefined
  ): Promise<boolean> {
    try {
      await this.bot?.telegram.sendChatAction(from, 'typing');
    } catch (e) {
      const became = migratedTo(e);
      if (became) return became === to;
    }
    if (userId == null) return false;
    try {
      const settings = (await this.db.get(from, 'settings', from)) as {
        admin?: unknown;
      } | null;
      const admin = String(settings?.admin ?? '').trim();
      return !!admin && admin === String(userId);
    } catch {
      return false;
    }
  }

  /** /adopt <old id> [replace] */
  async adopt(ctx: Context): Promise<string> {
    const chat = ctx.chat;
    if (!chat) return 'ignored';
    const to = String(chat.id);
    const lng = await this.language(to);
    const reply = (
      key: string,
      defaultValue: string,
      vars: Record<string, unknown> = {}
    ) => this.say(to, String(i18next.t(key, { lng, defaultValue, ...vars })));

    if (chat.type === 'private') {
      await reply(
        'adoptGroupOnly',
        'Use /adopt in the group whose earlier {@holon} you want to bring over.'
      );
      return 'private';
    }
    if (!(await this.isAdmin(ctx))) {
      await reply('adminonly', 'Only admins can do that.');
      return 'not-admin';
    }
    const text = String(
      (ctx.message as { text?: string } | undefined)?.text ?? ''
    );
    const [, arg = '', mode = ''] = text.trim().split(/\s+/);
    if (!arg) {
      // No id given: ask for it, then run the command again with the answer.
      const asked = await askArgs(
        ctx,
        [
          {
            key: 'from',
            ask: 'ask_adopt_from',
            question:
              'What was the id of this group before Telegram upgraded it? It is a negative number, as in its old board link.',
            validate: (s: string) => CHAT_ID_RE.test(s) && s !== to,
            error: 'ask_err_adopt_from',
            errorText:
              "Please send the old group's id: a negative number (for example -4123456789), not this group's own id.",
          },
        ],
        (c: object) => this.adopt(c as Context),
        { lng }
      );
      if (asked) return 'asked';
    }
    if (!CHAT_ID_RE.test(arg) || arg === to) {
      await reply(
        'adoptUsage',
        'Usage: /adopt <old holon id> — the id this group had before Telegram upgraded it (a negative number, as in its old board link). Add "replace" to let the old records win where both sides differ.'
      );
      return 'usage';
    }
    if (!(await this.proven(arg, to, ctx.from?.id))) {
      await reply(
        'adoptUnproven',
        'I cannot tell that <code>{{from}}</code> was this group. Ask the person who first added me to it to run /adopt here.',
        { from: esc(arg) }
      );
      return 'unproven';
    }
    let result: SuccessionResult;
    try {
      result = await this.move(arg, to, {
        overwrite: mode.toLowerCase() === 'replace',
      });
    } catch (e) {
      console.error(`[succession] /adopt ${arg} → ${to} failed:`, e);
      await reply(
        'adoptFailed',
        'Something went wrong bringing that {@holon} over. Nothing was removed; try again.'
      );
      return 'failed';
    }
    if (result.ok) {
      await this.say(to, successionSummary(result, lng));
      return 'moved';
    }
    const why: Record<string, string> = {
      'not-admin': 'I do not hold that {@holon}, so I cannot bring it over.',
      moved: 'That {@holon} already carries on in another group.',
      taken:
        "This group's {@holon} is held by another key, so I cannot write into it.",
      cycle: "This group's {@holon} already carries on as that one.",
      same: 'That is this group.',
      'not-holon': 'That is not {@a_holon} id.',
    };
    await reply(
      `adoptRefused_${result.refused}`,
      why[result.refused] ?? 'That {@holon} cannot be brought over.'
    );
    return result.refused;
  }
}
