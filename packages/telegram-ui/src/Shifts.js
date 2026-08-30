// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

/**
 * @fileoverview Community shifts in the Elinor format
 * (https://elinor.commonshub.dev/docs): the bot reads kind-31923 shift
 * occurrences for this chat from a Nostr relay and lets members sign up /
 * cancel by publishing kind-31925 RSVPs under their own derived key.
 *
 * All protocol rules live in `@holons/core/shifts`; this module only renders
 * and wires Telegraf.
 *
 * Env:
 *   SHIFTS_RELAYS             comma-separated relay URLs (falls back to
 *                             HOLOSPHERE_RELAYS, then wss://relay.holons.io)
 *   SHIFTS_COORDINATOR_PUBKEY hex pubkey whose 31923 events are trusted
 *                             (unset → any author; set it in production)
 *   NOSTR_DERIVATION_SECRET   per-user signing keys — same secret as the web
 *                             login so members keep one identity
 *
 * @module src/Shifts
 */

import { Markup } from 'telegraf';
import { deriveTelegramNostrKey } from '@holons/core/auth';
import {
  createShiftRelayClient,
  enrolledPubkeys,
  formatShiftTime,
  hasCapacity,
  isEnrolled,
  latestRsvpFor,
  parseShiftDTag,
} from '@holons/core/shifts';
import { getDisplayName, getParseModeHTML, getholonId } from './utilities.js';

const DAY_S = 86400;
const DEFAULT_RELAY = 'wss://relay.holons.io';

const TAKE = 'shift_take_';
const DROP = 'shift_drop_';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Resolve the relay list from env at construction time. */
export function shiftRelaysFromEnv(env = process.env) {
  const raw = env.SHIFTS_RELAYS || env.HOLOSPHERE_RELAYS || DEFAULT_RELAY;
  return raw
    .split(',')
    .map(r => r.trim())
    .filter(Boolean);
}

export default class Shifts {
  /**
   * @param {import('telegraf').Telegraf} bot
   * @param {object} db - HoloSphere (users lens for name resolution)
   * @param {object} [options]
   * @param {import('@holons/core/shifts').ShiftRelayClient} [options.client]
   * @param {string} [options.derivationSecret]
   */
  constructor(bot, db, options = {}) {
    this.bot = bot;
    this.db = db;
    this.derivationSecret =
      options.derivationSecret ?? process.env.NOSTR_DERIVATION_SECRET ?? '';
    this.client =
      options.client ??
      createShiftRelayClient({
        relays: shiftRelaysFromEnv(),
        coordinatorPubkey: process.env.SHIFTS_COORDINATOR_PUBKEY || undefined,
      });

    if (bot) {
      bot.command('shifts', ctx => this.list(ctx));
      bot.command('myshifts', ctx => this.mine(ctx));
      bot.action(new RegExp(`^${TAKE}(.+)$`), ctx =>
        this.rsvp(ctx, 'accepted')
      );
      bot.action(new RegExp(`^${DROP}(.+)$`), ctx =>
        this.rsvp(ctx, 'declined')
      );
    }
  }

  // ---------------------------------------------------------------------
  // Identity helpers
  // ---------------------------------------------------------------------

  /** Derived keypair for a Telegram user, or null when signing is not configured. */
  keyFor(telegramId) {
    if (!this.derivationSecret) return null;
    return deriveTelegramNostrKey(telegramId, this.derivationSecret);
  }

  /** pubkey → display name for everyone known in this holon. */
  async nameMap(holonId) {
    const map = new Map();
    if (!this.derivationSecret) return map;
    let users = [];
    try {
      users = (await this.db.getAll(String(holonId), 'users')) || [];
    } catch {
      return map;
    }
    for (const user of users) {
      if (!user?.id) continue;
      try {
        map.set(this.keyFor(user.id).publicKey, getDisplayName(user));
      } catch {
        /* skip unusable user record */
      }
    }
    return map;
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  /** Parse `/shifts [today|tomorrow|week|YYYY-MM-DD]` into a [since, until] range. */
  static rangeFor(arg, now = Math.floor(Date.now() / 1000)) {
    const dayStart = d =>
      Math.floor(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000
      );
    const today = dayStart(new Date(now * 1000));
    switch ((arg || '').trim().toLowerCase()) {
      case 'today':
        return { since: today - DAY_S / 2, until: today + DAY_S * 1.5 };
      case 'tomorrow':
        return { since: today + DAY_S / 2, until: today + DAY_S * 2.5 };
      case '':
      case 'week':
        return { since: now - 3600, until: today + 7 * DAY_S };
      default: {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(arg.trim());
        if (!m) return null;
        const d = Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000);
        return {
          since: d - DAY_S / 2,
          until: d + DAY_S * 1.5,
          dateOnly: `${m[1]}-${m[2]}-${m[3]}`,
        };
      }
    }
  }

  /** Text + keyboard for a schedule. */
  render({ occurrences, rsvps }, names, title = 'Shifts') {
    if (!occurrences.length) {
      return {
        text: `📅 <b>${escapeHtml(title)}</b>\n\nNo shifts published for this period.`,
        keyboard: [],
      };
    }
    const lines = [`📅 <b>${escapeHtml(title)}</b>`];
    const keyboard = [];
    let currentDate = '';
    for (const occ of occurrences) {
      if (occ.date !== currentDate) {
        currentDate = occ.date;
        lines.push('', `<b>${escapeHtml(occ.date)}</b>`);
      }
      const enrolled = enrolledPubkeys(occ, rsvps);
      const who = enrolled.map(pk =>
        escapeHtml(names.get(pk) || `${pk.slice(0, 8)}…`)
      );
      const cap =
        occ.capacity !== undefined
          ? `${enrolled.length}/${occ.capacity}`
          : `${enrolled.length}`;
      const time = `${formatShiftTime(occ.start, occ.startTzid)}–${formatShiftTime(occ.end, occ.startTzid)}`;
      const full = !hasCapacity(occ, rsvps);
      lines.push(
        `${full ? '🔒' : '☑️'} ${time} <b>${escapeHtml(occ.title)}</b> (${cap})${who.length ? ': ' + who.join(', ') : ''}`
      );
      // Group messages are shared, so the buttons cannot depend on who is
      // looking: offer Take while there is room and Drop while anyone is on.
      const label = `${occ.date.slice(5)} ${occ.code}`;
      const row = [];
      if (!full)
        row.push(Markup.button.callback(`✋ Take ${label}`, TAKE + occ.dTag));
      if (enrolled.length)
        row.push(Markup.button.callback(`❌ Drop ${label}`, DROP + occ.dTag));
      if (row.length) keyboard.push(row);
    }
    if (occurrences[0]?.startTzid)
      lines.push('', `<i>Times in ${escapeHtml(occurrences[0].startTzid)}</i>`);
    return { text: lines.join('\n'), keyboard };
  }

  // ---------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------

  async list(ctx) {
    const holonId = getholonId(ctx);
    const arg = (ctx.message?.text || '').split(' ').slice(1).join(' ');
    const range = Shifts.rangeFor(arg);
    if (!range) {
      return ctx.reply('Usage: /shifts [today|tomorrow|week|YYYY-MM-DD]');
    }
    try {
      const schedule = await this.client.fetchSchedule(holonId, range);
      const names = await this.nameMap(holonId);
      const title = range.dateOnly
        ? `Shifts on ${range.dateOnly}`
        : arg
          ? `Shifts ${arg}`
          : 'Shifts this week';
      const { text, keyboard } = this.render(schedule, names, title);
      await ctx.reply(text, {
        ...getParseModeHTML(),
        ...Markup.inlineKeyboard(keyboard),
      });
    } catch (err) {
      console.error('[Shifts] list failed', err);
      await ctx.reply(
        `Could not read shifts from ${this.client.relays.join(', ')}.`
      );
    }
  }

  async mine(ctx) {
    const holonId = getholonId(ctx);
    const key = this.keyFor(ctx.from.id);
    if (!key)
      return ctx.reply(
        'Shift signup is not configured on this bot (NOSTR_DERIVATION_SECRET missing).'
      );
    try {
      const now = Math.floor(Date.now() / 1000);
      const schedule = await this.client.fetchSchedule(holonId, {
        since: now - 3600,
        until: now + 14 * DAY_S,
      });
      const mineOcc = schedule.occurrences.filter(o =>
        isEnrolled(o, key.publicKey, schedule.rsvps)
      );
      const names = await this.nameMap(holonId);
      const { text, keyboard } = this.render(
        { occurrences: mineOcc, rsvps: schedule.rsvps },
        names,
        'My shifts'
      );
      await ctx.reply(text, {
        ...getParseModeHTML(),
        ...Markup.inlineKeyboard(keyboard),
      });
    } catch (err) {
      console.error('[Shifts] myshifts failed', err);
      await ctx.reply(
        `Could not read shifts from ${this.client.relays.join(', ')}.`
      );
    }
  }

  /** Inline "Take"/"Drop" handler — signs the RSVP with the user's own key. */
  async rsvp(ctx, status) {
    const holonId = getholonId(ctx);
    const dTag = ctx.match[1];
    const key = this.keyFor(ctx.from.id);
    if (!key)
      return ctx.answerCbQuery('Signup is not configured on this bot.', {
        show_alert: true,
      });
    const parsed = parseShiftDTag(dTag);
    if (!parsed || parsed.kind !== 'shift' || parsed.groupId !== holonId) {
      return ctx.answerCbQuery('Unknown shift.');
    }
    try {
      const occurrences = await this.client.fetchOccurrences(holonId, {
        since: 0,
        until: Number.MAX_SAFE_INTEGER,
      });
      const occ = occurrences.find(o => o.dTag === dTag);
      if (!occ) return ctx.answerCbQuery('That shift is no longer published.');
      const rsvps = await this.client.fetchRsvps([occ]);
      const previous = latestRsvpFor(occ, key.publicKey, rsvps);
      if (status === 'accepted') {
        if (previous?.status === 'accepted')
          return ctx.answerCbQuery('You are already on this shift.');
        if (!hasCapacity(occ, rsvps))
          return ctx.answerCbQuery('This shift is already full.', {
            show_alert: true,
          });
      } else if (previous?.status !== 'accepted') {
        return ctx.answerCbQuery('You are not on this shift.');
      }
      const { results } = await this.client.publishRsvp({
        occurrence: occ,
        status,
        previous,
        participantPrivateKey: key.privateKey,
      });
      const ok = results.some(r => r.status === 'fulfilled');
      if (!ok) {
        const reason = results
          .map(r =>
            r.status === 'rejected' ? String(r.reason?.message || r.reason) : ''
          )
          .join('; ');
        console.warn('[Shifts] relay rejected RSVP', reason);
        return ctx.answerCbQuery(
          `Relay rejected the signup: ${reason || 'unknown error'}`,
          { show_alert: true }
        );
      }
      await ctx.answerCbQuery(
        status === 'accepted'
          ? `You're on ${occ.title} ${occ.date}`
          : `Dropped ${occ.title} ${occ.date}`
      );
      await this.refresh(ctx, holonId, key.publicKey);
    } catch (err) {
      console.error('[Shifts] rsvp failed', err);
      await ctx.answerCbQuery('Something went wrong talking to the relay.', {
        show_alert: true,
      });
    }
  }

  /** Re-render the message the button lives on, keeping its date range. */
  async refresh(ctx, holonId, viewerPubkey) {
    const msg = ctx.callbackQuery?.message;
    if (!msg) return;
    const title = (msg.text || '').split('\n')[0].replace(/^📅\s*/, '');
    const now = Math.floor(Date.now() / 1000);
    let range = {
      since: now - 3600,
      until: Math.floor(now / DAY_S) * DAY_S + 7 * DAY_S,
    };
    const m = /(\d{4}-\d{2}-\d{2})$/.exec(title);
    if (m) range = Shifts.rangeFor(m[1]);
    else if (/today$/i.test(title)) range = Shifts.rangeFor('today');
    else if (/tomorrow$/i.test(title)) range = Shifts.rangeFor('tomorrow');
    try {
      const schedule = await this.client.fetchSchedule(holonId, range);
      if (/^My shifts/.test(title)) {
        schedule.occurrences = schedule.occurrences.filter(o =>
          isEnrolled(o, viewerPubkey, schedule.rsvps)
        );
      }
      const names = await this.nameMap(holonId);
      const { text, keyboard } = this.render(schedule, names, title);
      await ctx.editMessageText(text, {
        ...getParseModeHTML(),
        ...Markup.inlineKeyboard(keyboard),
      });
    } catch (err) {
      // "message is not modified" is benign; anything else is worth a log line.
      if (!/not modified/.test(String(err?.message)))
        console.warn('[Shifts] refresh failed', err?.message || err);
    }
  }
}
