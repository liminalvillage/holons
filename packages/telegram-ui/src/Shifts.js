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
 * Participant names resolve in this order: the holon's own `users` lens
 * (freshest for our members), then kind-31926 identity attestations from the
 * relay — the coordinator's directory outranking other providers — and
 * finally an 8-hex pubkey prefix.
 *
 * Env:
 *   SHIFTS_RELAYS             comma-separated relay URLs (falls back to
 *                             HOLOSPHERE_RELAYS, then wss://relay.holons.io)
 *   SHIFTS_COORDINATOR_PUBKEY hex pubkey whose 31923 events are trusted
 *                             (unset → any author; set it in production)
 *   SHIFTS_IDENTITY_BLACKLIST comma-separated provider pubkeys whose 31926
 *                             attestations are ignored (spec's blacklist
 *                             governance; default: honor everyone)
 *   NOSTR_DERIVATION_SECRET   per-user signing keys — same secret as the web
 *                             login so members keep one identity
 *
 * @module src/Shifts
 */

import { Markup } from 'telegraf';
import { createIdentityContext } from '@holons/core/holosphere';
import {
  SHIFTS_LENS,
  SHIFT_IDENTITY_LENS,
  SHIFT_RSVP_LENS,
  attestationIdentityMap,
  attestationNameMap,
  attestationsFrom,
  createShiftRelayClient,
  enrolledPubkeys,
  formatShiftTime,
  hasCapacity,
  isEnrolled,
  latestRsvpFor,
  parseShiftDTag,
  recordShiftRsvp,
  sortOccurrences,
  toOccurrence,
  toRsvp,
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
    this.identity = createIdentityContext({
      derivationSecret:
        options.derivationSecret ?? process.env.NOSTR_DERIVATION_SECRET ?? '',
    });
    this.coordinatorPubkey =
      options.coordinatorPubkey ??
      (process.env.SHIFTS_COORDINATOR_PUBKEY || undefined);
    this.blockedProviders = (process.env.SHIFTS_IDENTITY_BLACKLIST || '')
      .split(',')
      .map(p => p.trim())
      .filter(Boolean);
    // Publishing only. The schedule is lens data (see `readSchedule`); a
    // signup still goes out through the protocol, because the rule behind it
    // — newest across a person's linked keys — is not a per-address write.
    this.client =
      options.client ??
      createShiftRelayClient({
        relays: shiftRelaysFromEnv(),
        coordinatorPubkey: this.coordinatorPubkey,
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

  /**
   * The schedule for a holon, read from the lenses.
   *
   * Occurrences, signups and the kind-31926 identity directory are ordinary
   * Holosphere records now (see the wires in `@holons/core/shifts`), so this
   * reads the store instead of holding a second relay client. The shape is
   * exactly what `fetchSchedule` returned, so rendering is untouched.
   *
   * @param {string|number} holonId
   * @param {{since?: number, until?: number}} [range]
   * @returns {Promise<{occurrences: object[], rsvps: object[], attestations: object[]}>}
   */
  async readSchedule(holonId, range = {}) {
    const holon = String(holonId);
    const [occ, rsv, dir] = await Promise.all([
      this.db.getAll(holon, SHIFTS_LENS).catch(() => []),
      this.db.getAll(holon, SHIFT_RSVP_LENS).catch(() => []),
      this.db.getAllGlobal(SHIFT_IDENTITY_LENS).catch(() => []),
    ]);
    const since = range.since ?? 0;
    const until = range.until ?? Infinity;
    return {
      // The window is applied here rather than in a subscription: the lens
      // holds the whole schedule, and each command asks for its own range.
      occurrences: sortOccurrences(
        (occ || [])
          .filter(o => o && o.start >= since && o.start <= until)
          .map(toOccurrence)
      ),
      // A request published on someone's behalf is not occupancy — the real
      // signup follows under that member's own key.
      rsvps: (rsv || []).filter(r => r && !r.request).map(toRsvp),
      attestations: attestationsFrom(dir || []),
    };
  }

  /**
   * The shift directory for a schedule:
   *  - `names`: pubkey → display name — the holon's `users` lens first
   *    (freshest for our members), then kind-31926 attestations; a failed
   *    fetch degrades to hex prefixes.
   *  - `identity`: pubkey → person identifier from the same attestations —
   *    the collapse map for person-level RSVP resolution (one person may
   *    hold an Elinor key AND the Holons-derived key; their status is the
   *    newest RSVP across all of them, so a cancel in Elinor clears a
   *    signup made here and vice versa).
   *
   * @returns {Promise<{names: Map<string,string>, identity: Map<string,string>}>}
   */
  async directory(holonId, schedule) {
    const names = new Map();
    let identity = new Map();
    let users = [];
    try {
      users = (await this.db.getAll(String(holonId), 'users')) || [];
    } catch {
      users = [];
    }
    for (const user of users) {
      if (!user?.id) continue;
      const pubkey = this.identity.memberPubkey(user.id);
      if (pubkey) names.set(pubkey, getDisplayName(user));
    }
    // Attestations ride the schedule now — they are lens records read
    // alongside the occurrences, so no second lookup is needed. Every signup
    // author matters here, not just our members: a lens-named member still
    // needs their sibling keys linked for the identity collapse to work.
    const atts = schedule?.attestations || [];
    if (atts.length) {
      const opts = {
        coordinatorPubkey: this.coordinatorPubkey,
        blockedProviders: this.blockedProviders,
      };
      for (const [pk, name] of attestationNameMap(atts, opts)) {
        if (!names.has(pk)) names.set(pk, name);
      }
      identity = attestationIdentityMap(atts, opts);
    }
    return { names, identity };
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

  /** Text + keyboard for a schedule; `identity` collapses a person's keys. */
  render(
    { occurrences, rsvps },
    names,
    title = 'Shifts',
    identity = undefined
  ) {
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
      const enrolled = enrolledPubkeys(occ, rsvps, identity);
      const who = enrolled.map(pk =>
        escapeHtml(names.get(pk) || `${pk.slice(0, 8)}…`)
      );
      const cap =
        occ.capacity !== undefined
          ? `${enrolled.length}/${occ.capacity}`
          : `${enrolled.length}`;
      const time = `${formatShiftTime(occ.start, occ.startTzid)}–${formatShiftTime(occ.end, occ.startTzid)}`;
      const full = !hasCapacity(occ, rsvps, identity);
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
      const schedule = await this.readSchedule(holonId, range);
      const { names, identity } = await this.directory(holonId, schedule);
      const title = range.dateOnly
        ? `Shifts on ${range.dateOnly}`
        : arg
          ? `Shifts ${arg}`
          : 'Shifts this week';
      const { text, keyboard } = this.render(schedule, names, title, identity);
      await ctx.reply(text, {
        ...getParseModeHTML(),
        ...Markup.inlineKeyboard(keyboard),
      });
    } catch (err) {
      console.error('[Shifts] list failed', err);
      await ctx.reply(`Could not read shifts for this holon.`);
    }
  }

  async mine(ctx) {
    const holonId = getholonId(ctx);
    const pubkey = this.identity.memberPubkey(ctx.from.id);
    if (!pubkey)
      return ctx.reply(
        'Shift signup is not configured on this bot (NOSTR_DERIVATION_SECRET missing).'
      );
    try {
      const now = Math.floor(Date.now() / 1000);
      const schedule = await this.readSchedule(holonId, {
        since: now - 3600,
        until: now + 14 * DAY_S,
      });
      const { names, identity } = await this.directory(holonId, schedule);
      const mineOcc = schedule.occurrences.filter(o =>
        isEnrolled(o, pubkey, schedule.rsvps, identity)
      );
      const { text, keyboard } = this.render(
        { occurrences: mineOcc, rsvps: schedule.rsvps },
        names,
        'My shifts',
        identity
      );
      await ctx.reply(text, {
        ...getParseModeHTML(),
        ...Markup.inlineKeyboard(keyboard),
      });
    } catch (err) {
      console.error('[Shifts] myshifts failed', err);
      await ctx.reply(`Could not read shifts for this holon.`);
    }
  }

  /** Inline "Take"/"Drop" handler — signs the RSVP with the user's own key. */
  async rsvp(ctx, status) {
    const holonId = getholonId(ctx);
    const dTag = ctx.match[1];
    const signer = this.identity.memberSigner(ctx.from.id);
    if (!signer)
      return ctx.answerCbQuery('Signup is not configured on this bot.', {
        show_alert: true,
      });
    const parsed = parseShiftDTag(dTag);
    if (!parsed || parsed.kind !== 'shift' || parsed.groupId !== holonId) {
      return ctx.answerCbQuery('Unknown shift.');
    }
    try {
      // The whole schedule, unwindowed: a callback can name a shift that has
      // scrolled out of any command's range. The gates below all filter by
      // the occurrence's own address, so handing them every signup is exact.
      const schedule = await this.readSchedule(holonId);
      const occ = schedule.occurrences.find(o => o.dTag === dTag);
      if (!occ) return ctx.answerCbQuery('That shift is no longer published.');
      const rsvps = schedule.rsvps;
      // Person-level view: the member may have signed up (or cancelled)
      // under an attestation-linked sibling key — via Elinor, say — and the
      // gates below must judge the PERSON, not this bot's derived key.
      const { identity } = await this.directory(holonId, schedule);
      const previous = latestRsvpFor(occ, signer.pubkey, rsvps, identity);
      if (status === 'accepted') {
        if (previous?.status === 'accepted')
          return ctx.answerCbQuery('You are already on this shift.');
        if (!hasCapacity(occ, rsvps, identity))
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
        signer,
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
      // The signup lives on the relays as a kind-31925 event, out of sight
      // of the ledger projection; account it explicitly as the member's
      // commitment of the shift hours (retracted on a drop).
      const ledger = await recordShiftRsvp(this.db, holonId, {
        occurrence: occ,
        member: ctx.from,
        status,
      });
      if (!ledger.ok) console.warn('[Shifts] ledger not updated', ledger.error);
      await ctx.answerCbQuery(
        status === 'accepted'
          ? `You're on ${occ.title} ${occ.date}`
          : `Dropped ${occ.title} ${occ.date}`
      );
      await this.refresh(ctx, holonId, signer.pubkey);
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
      const schedule = await this.readSchedule(holonId, range);
      const { names, identity } = await this.directory(holonId, schedule);
      if (/^My shifts/.test(title)) {
        schedule.occurrences = schedule.occurrences.filter(o =>
          isEnrolled(o, viewerPubkey, schedule.rsvps, identity)
        );
      }
      const { text, keyboard } = this.render(schedule, names, title, identity);
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
