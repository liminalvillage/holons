// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Join requests reach the Telegram group.
//
// A person on the kiosk or the dashboard asks to link their key to a holon
// (a NIP-29 kind-9021, `@holons/core/holons` requestToJoin). For a holon that
// IS a Telegram group, this service answers on the group's behalf:
//
//   • They signed in with Telegram and are in the group → linked at once.
//     The request claims a Telegram id; the claim is proven because the key
//     that signed it is the one that id derives (describeApplicant), and
//     Telegram itself says whether that user is in the chat. No admin step.
//   • Anyone else (their own Nostr key, or a Telegram user outside the
//     group) → one post in the group naming them, with Approve / Decline
//     that only the chat's admins can press.
//
// One relay filter serves every chat (watchAllJoinRequests). What was
// announced and decided lives in the holon's `joinrequests` lens, so a
// restart or a replayed event never posts twice, and an approved key stays
// seated through the roster sync (createHoloSphere.js reads the same lens).
//
// JOIN_NOTICES=off silences the service — set it on one of two bots that
// share a namespace, or both would post.

import { Markup } from 'telegraf';
import i18next from 'i18next';
import {
  approveJoin,
  describeApplicant,
  joinRequestRecords,
  recordJoinRequest,
  settleJoinRequest,
  watchAllJoinRequests,
} from '@holons/core/holons';
import { holonMembers, isTelegramChatId } from '@holons/core/protocol';
import { toNpub } from '@holons/core/nostr';
import { holonSigner } from './createHoloSphere.js';
import { isAdmin as isChatAdmin } from './utilities.js';

const ACTION = { approve: 'joinok', decline: 'joinno' };
/** Callback data is capped at 64 bytes: the key's first half names the request. */
const PREFIX = 32;
const DAY = 86400;
const IN_CHAT = new Set(['creator', 'administrator', 'member', 'restricted']);

const esc = s =>
  String(s ?? '').replace(
    /[&<>]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]
  );
const shortNpub = pk => {
  try {
    const n = toNpub(pk);
    return `${n.slice(0, 12)}…${n.slice(-6)}`;
  } catch {
    return `${pk.slice(0, 8)}…${pk.slice(-4)}`;
  }
};

/** A translated line with an inline default (see Settings.ts `translated`). */
function translated(language, key, defaultValue, vars = {}) {
  const text = i18next.t(key, { lng: language, defaultValue, ...vars });
  if (typeof text === 'string' && text.trim()) return text;
  return defaultValue.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    String(vars[k] ?? '')
  );
}

/** Is this holon a Telegram group (a negative chat id)? */
export const isTelegramGroup = holon =>
  String(holon).startsWith('-') && isTelegramChatId(holon);

export default class JoinRequests {
  /**
   * @param {import('telegraf').Telegraf|null} bot
   * @param {object} db HoloSphere
   * @param {{getLanguage?: (holon: string) => Promise<string>}|null} settings
   * @param {object} [options]
   * @param {string} [options.derivationSecret]
   * @param {object} [options.signer] the holon key's signer (default: the bot's)
   * @param {boolean} [options.enabled] default: JOIN_NOTICES is not off
   * @param {number} [options.settleMs] wait before answering a request, so
   *   the bot's own seats and membership companions land first (default 20 s)
   * @param {number} [options.lookbackSec] how far back a start catches up (default 7 d)
   * @param {(ctx: object) => Promise<boolean>} [options.isAdmin]
   * @param {() => number} [options.now] unix seconds, for tests
   */
  constructor(bot, db, settings = null, options = {}) {
    this.bot = bot;
    this.db = db;
    this.settings = settings;
    this.secret = (
      options.derivationSecret ??
      process.env.NOSTR_DERIVATION_SECRET ??
      ''
    ).trim();
    this.signer = options.signer ?? null;
    this.enabled =
      options.enabled ??
      !['off', 'false', '0', 'no'].includes(
        (process.env.JOIN_NOTICES || 'on').trim().toLowerCase()
      );
    this.settleMs = options.settleMs ?? 20_000;
    this.lookbackSec = options.lookbackSec ?? 7 * DAY;
    this.isAdmin = options.isAdmin ?? isChatAdmin;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    /** Requests already taken in hand: the relay filter replays on every re-fire. */
    this.seen = new Set();
    this.timers = new Set();
    this.stop = null;

    if (bot) {
      bot.action(new RegExp(`^${ACTION.approve}:([0-9a-f]{${PREFIX}})$`), ctx =>
        this.decide(ctx, 'approved')
      );
      bot.action(new RegExp(`^${ACTION.decline}:([0-9a-f]{${PREFIX}})$`), ctx =>
        this.decide(ctx, 'declined')
      );
      if (this.enabled) this.start();
    }
  }

  /** Listen for requests: one filter for every chat. */
  start() {
    if (this.stop) return;
    this.stop = watchAllJoinRequests(
      this.db,
      { appName: this.db.appname, since: this.now() - this.lookbackSec },
      request => this.onRequest(request)
    );
  }

  shutdown() {
    this.stop?.();
    this.stop = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  onRequest(request) {
    if (!isTelegramGroup(request.holon) || this.seen.has(request.eventId))
      return;
    this.seen.add(request.eventId);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.handle(request).catch(e =>
        console.warn('[join] request not answered:', e?.message)
      );
    }, this.settleMs);
    this.timers.add(timer);
  }

  async language(holon) {
    try {
      return (await this.settings?.getLanguage?.(holon)) || 'en';
    } catch {
      return 'en';
    }
  }

  _signer() {
    return this.signer ?? holonSigner();
  }

  /**
   * Answer one request. Returns what was done:
   * 'seated' | 'known' | 'limited' | 'linked' | 'posted'.
   */
  async handle(request) {
    const holon = String(request.holon);
    const telegram = this.bot?.telegram;
    if ((await holonMembers(this.db, holon)).has(request.pubkey))
      return 'seated';
    const cur = (await joinRequestRecords(this.db, holon)).get(request.pubkey);
    if (cur) {
      // One post stands per asking key; a settled key may ask again a day on.
      if (cur.eventId === request.eventId || cur.status === 'pending')
        return 'known';
      if (this.now() - cur.at < DAY) return 'limited';
    }

    const who = await describeApplicant(this.db, request, {
      secret: this.secret,
    });
    // An unproven claim is no identity at all: the person is their key.
    const tgId = who.telegram?.verified ? who.telegram.id : null;
    let tgUser = null;
    if (tgId && telegram) {
      try {
        const member = await telegram.getChatMember(holon, Number(tgId));
        tgUser = member?.user ?? null;
        const inChat =
          IN_CHAT.has(member?.status) &&
          (member.status !== 'restricted' || member.is_member !== false);
        if (inChat && (await this.autoLink(holon, request, tgId, tgUser)))
          return 'linked';
      } catch {
        /* Telegram does not know them here: ask the admins */
      }
    }

    const language = await this.language(holon);
    const name = esc(
      [tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(' ') ||
        who.name
    );
    const handle = tgUser?.username ? ` (@${esc(tgUser.username)})` : '';
    const lines = [
      translated(
        language,
        'joinAsks',
        '🔑 <b>{{name}}</b>{{handle}} asks to link their key to this holon.',
        { name, handle, interpolation: { escapeValue: false } }
      ),
      tgId
        ? translated(
            language,
            'joinFromTelegram',
            'They signed in with Telegram, but are not in this group.'
          )
        : translated(
            language,
            'joinFromKey',
            'They signed in with their own Nostr key: {{key}}',
            {
              key: `<code>${shortNpub(request.pubkey)}</code>`,
              interpolation: { escapeValue: false },
            }
          ),
      translated(
        language,
        'joinAdminsDecide',
        'An admin of this group decides.'
      ),
    ];
    const id = request.pubkey.slice(0, PREFIX);
    const sent = await telegram.sendMessage(holon, lines.join('\n'), {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        Markup.button.callback(
          translated(language, 'joinApprove', '✅ Link'),
          `${ACTION.approve}:${id}`
        ),
        Markup.button.callback(
          translated(language, 'joinDecline', '✖️ Decline'),
          `${ACTION.decline}:${id}`
        ),
      ]),
    });
    await recordJoinRequest(this.db, holon, request, {
      name: who.name,
      messageId: sent?.message_id,
      ...(tgId ? { telegramId: tgId } : {}),
      now: this.now,
    });
    return 'posted';
  }

  /**
   * A proven Telegram member of the group: write their `users` record when
   * the holon has none (the roster sync derives their key from it, so the
   * seat holds) and seat the key now.
   */
  async autoLink(holon, request, tgId, user) {
    const signer = this._signer();
    if (!signer) return false;
    let existing = null;
    try {
      existing = await this.db.get(holon, 'users', String(tgId));
    } catch {
      existing = null;
    }
    if (!existing) {
      await this.db.put(holon, 'users', {
        id: Number(tgId),
        first_name: user?.first_name || request.reason || '',
        ...(user?.last_name ? { last_name: user.last_name } : {}),
        ...(user?.username ? { username: user.username } : {}),
      });
    }
    await approveJoin(this.db, holon, request.pubkey, signer, {
      appName: this.db.appname,
    });
    console.log(`[join] ${holon}: linked Telegram member ${tgId} by proof`);
    return true;
  }

  /** Approve / Decline, pressed in the group. Chat admins only. */
  async decide(ctx, status) {
    const holon = String(ctx.chat?.id ?? '');
    const language = await this.language(holon);
    if (!isTelegramGroup(holon) || !(await this.isAdmin(ctx))) {
      await ctx.answerCbQuery(
        translated(
          language,
          'joinAdminsOnly',
          'Only admins of this group can decide.'
        )
      );
      return;
    }
    const prefix = ctx.match?.[1] ?? '';
    const record = [
      ...(await joinRequestRecords(this.db, holon)).values(),
    ].find(r => r.id.startsWith(prefix));
    if (!record || record.status !== 'pending') {
      await ctx.answerCbQuery(
        translated(language, 'joinClosed', 'This request is no longer open.')
      );
      return;
    }
    const by = ctx.from?.username
      ? `@${ctx.from.username}`
      : ctx.from?.first_name || String(ctx.from?.id ?? '');
    const name = esc(record.name || shortNpub(record.id));
    if (status === 'approved') {
      const signer = this._signer();
      try {
        if (!signer) throw new Error('no signing key');
        await approveJoin(this.db, holon, record.id, signer, {
          appName: this.db.appname,
          name: record.name,
        });
      } catch (e) {
        console.warn(`[join] ${holon}: could not seat a key:`, e?.message);
        await ctx.answerCbQuery(
          translated(
            language,
            'joinFailed',
            "Couldn't link that key. Try again."
          )
        );
        return;
      }
    }
    await settleJoinRequest(this.db, holon, record.id, status, {
      by: ctx.from?.id,
      now: this.now,
    });
    await ctx.answerCbQuery();
    const line =
      status === 'approved'
        ? translated(
            language,
            'joinLinked',
            '✅ <b>{{name}}</b> is linked to this holon — by {{by}}.',
            { name, by: esc(by), interpolation: { escapeValue: false } }
          )
        : translated(
            language,
            'joinDeclined',
            '✖️ <b>{{name}}</b> was not linked — declined by {{by}}.',
            { name, by: esc(by), interpolation: { escapeValue: false } }
          );
    try {
      await ctx.editMessageText(line, { parse_mode: 'HTML' });
    } catch {
      /* the post is gone or unchanged: the decision stands */
    }
  }
}
