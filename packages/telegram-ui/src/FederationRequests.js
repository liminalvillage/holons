// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Federation requests reach the Telegram group.
//
// When an admin of holon A links A ↔ B and cannot speak for B, A's half is
// written and B is ASKED (@holons/core/federation requests.ts: a record in
// B's `fedrequests` lens). For a B that IS a Telegram group whose key the bot
// holds, this service posts the request in the group once, with Accept /
// Decline that only the chat's admins can press. Accepting writes B's own
// half; declining leaves it alone.
//
// One relay filter serves every chat (watchAllFederationRequests). The post's
// message id is written back on the request (`markFederationRequestAnnounced`),
// so a restart or a replayed event never posts twice; a NEW proposal from A
// replaces the record and is announced afresh.
//
// FED_NOTICES=off silences the service — set it on one of two bots that
// share a namespace, or both would post.

import { Markup } from 'telegraf';
import {
  answerFederationRequest,
  markFederationRequestAnnounced,
  pendingFederationRequests,
  watchAllFederationRequests,
} from '@holons/core/federation';
import { may, writeAcceptance } from '@holons/core/holosphere';
import { createNameResolver } from '@holons/core/identity';
import { isTelegramGroup } from './JoinRequests.js';
import { translated } from './federationLinks.js';
import { isAdmin as isChatAdmin } from './utilities.js';

const ACTION = { accept: 'fedok', decline: 'fedno' };
const DAY = 86400;
/** Callback data is capped at 64 bytes: the asking holon's id must fit after the prefix. */
const MAX_ID = 64 - ACTION.accept.length - 1;

const esc = s =>
  String(s ?? '').replace(
    /[&<>]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]
  );

export default class FederationRequests {
  /**
   * @param {import('telegraf').Telegraf|null} bot
   * @param {object} db HoloSphere
   * @param {{getLanguage?: (holon: string) => Promise<string>}|null} settings
   * @param {object} [options]
   * @param {boolean} [options.enabled] default: FED_NOTICES is not off
   * @param {number} [options.settleMs] wait before announcing, so a burst of
   *   edits from the asker lands as one post (default 20 s)
   * @param {number} [options.lookbackSec] how far back a start catches up (default 7 d)
   * @param {(ctx: object) => Promise<boolean>} [options.isAdmin]
   * @param {() => number} [options.now] unix seconds, for tests
   */
  constructor(bot, db, settings = null, options = {}) {
    this.bot = bot;
    this.db = db;
    this.settings = settings;
    this.enabled =
      options.enabled ??
      !['off', 'false', '0', 'no'].includes(
        (process.env.FED_NOTICES || 'on').trim().toLowerCase()
      );
    this.settleMs = options.settleMs ?? 20_000;
    this.lookbackSec = options.lookbackSec ?? 7 * DAY;
    this.isAdmin = options.isAdmin ?? isChatAdmin;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    /** Envelopes already taken in hand: the relay filter replays on every re-fire. */
    this.seen = new Set();
    /** One pending announcement per asked holon: a burst of sightings collapses into it. */
    this.timers = new Map();
    /** `${to} ${from} ${proposedAt}` already posted by this process. */
    this.posted = new Set();
    this.stop = null;

    if (bot) {
      bot.action(new RegExp(`^${ACTION.accept}:(.{1,${MAX_ID}})$`), ctx =>
        this.decide(ctx, 'accept')
      );
      bot.action(new RegExp(`^${ACTION.decline}:(.{1,${MAX_ID}})$`), ctx =>
        this.decide(ctx, 'decline')
      );
      if (this.enabled) this.start();
    }
  }

  /** Listen for requests: one filter for every chat. */
  start() {
    if (this.stop) return;
    this.stop = watchAllFederationRequests(
      this.db,
      { appName: this.db.appname, since: this.now() - this.lookbackSec },
      sighting => this.onSighting(sighting)
    );
  }

  shutdown() {
    this.stop?.();
    this.stop = null;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  onSighting(sighting) {
    const to = String(sighting.to);
    if (!isTelegramGroup(to) || this.seen.has(sighting.eventId)) return;
    this.seen.add(sighting.eventId);
    if (this.timers.has(to)) return;
    const timer = setTimeout(() => {
      this.timers.delete(to);
      this.announce(to).catch(e =>
        console.warn('[fed] request not announced:', e?.message)
      );
    }, this.settleMs);
    this.timers.set(to, timer);
  }

  async language(holon) {
    try {
      return (await this.settings?.getLanguage?.(holon)) || 'en';
    } catch {
      return 'en';
    }
  }

  async nameOf(holon, fallback) {
    if (fallback) return fallback;
    try {
      const names = await createNameResolver(this.db, {}).resolve([holon]);
      return names.get(holon) || holon;
    } catch {
      return holon;
    }
  }

  /**
   * Post every pending request of `to` not announced yet. Returns how many
   * were posted. Nothing when the bot does not speak for `to`: its Accept
   * could not write the group's half anyway.
   */
  async announce(to) {
    const telegram = this.bot?.telegram;
    if (!telegram) return 0;
    if (!may(await writeAcceptance(this.db, to), 'federation')) return 0;
    const language = await this.language(to);
    let posted = 0;
    for (const req of await pendingFederationRequests(this.db, to)) {
      const mark = `${to} ${req.from} ${req.proposedAt}`;
      if (req.messageId || this.posted.has(mark)) continue;
      if (String(req.from).length > MAX_ID) continue; // no button can name it
      this.posted.add(mark);
      const name = esc(await this.nameOf(req.from, req.fromName));
      const lines = [];
      if (req.kind === 'unlink') {
        lines.push(
          translated(
            language,
            'fedEndedAsk',
            '✂️ <b>{{name}}</b> ended its federation link with this holon. Remove it on this side too?',
            { name, interpolation: { escapeValue: false } }
          )
        );
      } else {
        lines.push(
          translated(
            language,
            'fedAsks',
            '🔗 <b>{{name}}</b> asks to federate with this holon.',
            { name, interpolation: { escapeValue: false } }
          )
        );
        const none = translated(language, 'fedNone', 'nothing');
        lines.push(
          translated(
            language,
            'fedWouldReceive',
            'This holon would receive: {{lenses}}',
            {
              lenses: req.inbound.join(', ') || none,
            }
          ),
          translated(
            language,
            'fedWouldSend',
            'This holon would send: {{lenses}}',
            {
              lenses: req.outbound.join(', ') || none,
            }
          )
        );
      }
      lines.push(
        translated(
          language,
          'fedAdminsDecide',
          'An admin of this group decides.'
        )
      );
      const sent = await telegram.sendMessage(to, lines.join('\n'), {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          Markup.button.callback(
            translated(language, 'fedAccept', '✅ Accept'),
            `${ACTION.accept}:${req.from}`
          ),
          Markup.button.callback(
            translated(language, 'fedDecline', '✖️ Decline'),
            `${ACTION.decline}:${req.from}`
          ),
        ]),
      });
      if (typeof sent?.message_id === 'number') {
        await markFederationRequestAnnounced(
          this.db,
          to,
          req.from,
          sent.message_id,
          {
            now: this.now,
          }
        );
      }
      posted++;
    }
    return posted;
  }

  /** Accept / Decline, pressed in the group. Chat admins only. */
  async decide(ctx, decision) {
    const to = String(ctx.chat?.id ?? '');
    const language = await this.language(to);
    if (!isTelegramGroup(to) || !(await this.isAdmin(ctx))) {
      await ctx.answerCbQuery(
        translated(
          language,
          'fedAdminsOnly',
          'Only admins of this group can decide.'
        )
      );
      return;
    }
    const from = String(ctx.match?.[1] ?? '');
    const pending = (await pendingFederationRequests(this.db, to)).find(
      r => r.from === from
    );
    if (!pending) {
      await ctx.answerCbQuery(
        translated(language, 'fedClosed', 'This request is no longer open.')
      );
      return;
    }
    try {
      await answerFederationRequest(this.db, to, from, decision, {
        by: ctx.from?.id,
        now: this.now,
      });
    } catch (e) {
      console.warn(`[fed] ${to}: could not answer ${from}:`, e?.message);
      await ctx.answerCbQuery(
        translated(
          language,
          'fedFailed',
          "Couldn't change the federation. Try again."
        )
      );
      return;
    }
    await ctx.answerCbQuery();
    const by = esc(
      ctx.from?.username
        ? `@${ctx.from.username}`
        : ctx.from?.first_name || String(ctx.from?.id ?? '')
    );
    const name = esc(await this.nameOf(from, pending.fromName));
    const vars = { name, by, interpolation: { escapeValue: false } };
    const line =
      decision === 'decline'
        ? translated(
            language,
            'fedDeclinedBy',
            '✖️ Declined <b>{{name}}</b> — by {{by}}.',
            vars
          )
        : pending.kind === 'unlink'
          ? translated(
              language,
              'fedRemovedBy',
              '✂️ Unlinked from <b>{{name}}</b> on this side too — by {{by}}.',
              vars
            )
          : translated(
              language,
              'fedAcceptedBy',
              '🔗 Federated with <b>{{name}}</b> — accepted by {{by}}.',
              vars
            );
    try {
      await ctx.editMessageText(line, { parse_mode: 'HTML' });
    } catch {
      /* the post is gone or unchanged: the decision stands */
    }
  }
}
