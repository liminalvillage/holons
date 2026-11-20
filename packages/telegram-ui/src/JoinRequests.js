// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Join requests reach the Telegram group.
//
// A person on the kiosk or the dashboard asks to link their key to a holon
// (a NIP-29 kind-9021, `@holons/core/holons` applyToHolon, carrying the DNA
// hash they agreed to). For a holon that IS a Telegram group, this service
// answers on the group's behalf:
//
//   • They signed in with Telegram, are in the group, and agreed to the
//     holon's DNA as it is now (core `mayLink`) → linked at once. The
//     request claims a Telegram id; the claim is proven because the key
//     that signed it is the one that id derives (describeApplicant), and
//     Telegram itself says whether that user is in the chat. No admin step.
//   • Anyone else (their own Nostr key, or a Telegram user outside the
//     group) → one post in the group naming them, with Approve / Decline
//     that only the chat's admins can press — unless the holon switched an
//     onboarding on: then they walk its steps first (HolonOnboarding.js)
//     and the key is linked when they finish.
//
// One relay filter serves every chat (watchAllJoinRequests). What was
// announced and decided lives in the holon's `joinrequests` lens, so a
// restart or a replayed event never posts twice, and an approved key stays
// seated through the roster sync (createHoloSphere.js reads the same lens).
// A newer request on a pending record (the person walked a changed DNA and
// asked again) updates that record (core `recordJoinRequest`): the
// onboarding re-checks it, and a proven group member is linked then.
//
// A holon founded from a screen (`holon_…`) has no group to post in, and the
// bot holds no seat there: it can only TELL the holon's admins that someone
// is waiting (tellAdmins). Each admin gets a card on their own board — an
// ordinary task in their holon, "Link Kamala to Solstice" (core
// `dealJoinReview`) — and a message in their chat with the bot, both with a
// link to the holon, where an admin links the person. Once the key is
// linked the cards are closed (sweepReviews). An admin is reached when
// their key is the one a Telegram user known to this bot derives. What was
// told is noted in the bot's local store only, so a restart does not tell
// twice.
//
// JOIN_NOTICES=off silences the service — set it on one of two bots that
// share a namespace, or both would post.

import { Markup } from 'telegraf';
import i18next from 'i18next';
import {
  DnaChanged,
  DnaNotAcknowledged,
  applyToHolon,
  approveJoin,
  dealJoinReview,
  describeApplicant,
  holonDnaHash,
  joinRequestRecords,
  mayLink,
  parseJoinRequest,
  recordJoinRequest,
  settleJoinRequest,
  settleJoinReview,
  watchAllJoinRequests,
} from '@holons/core/holons';
import { deriveTelegramNostrKey } from '@holons/core/auth';
import { signerFromSecretKey, writeAcceptance } from '@holons/core/holosphere';
import {
  holonMembers,
  isHolonId,
  isTelegramChatId,
} from '@holons/core/protocol';
import { readHolonSettings } from '@holons/core/settings';
import { toNpub } from '@holons/core/nostr';
import { holonSigner } from './createHoloSphere.js';
import HolonOnboarding from './HolonOnboarding.js';
import { isAdmin as isChatAdmin } from './utilities.js';

const ACTION = { approve: 'joinok', decline: 'joinno' };
/** Callback data is capped at 64 bytes: the key's first half names the request. */
const PREFIX = 32;
const DAY = 86400;
/** The bot's own note of the admins it told: local store only, never published. */
const TOLD = { holon: 'joinnotices', lens: 'told' };
/** How long the known key owners are trusted before the bot looks again. */
const OWNERS_FRESH_SEC = 600;
/** How often the admins' review cards are checked against who is linked. */
const REVIEW_SWEEP_MS = 2 * 60 * 1000;
const KIOSK_ADDRESS = () =>
  (process.env.KIOSK_ADDRESS || 'https://hubs.network').replace(/\/+$/, '');
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
   * @param {number} [options.onboardingSweepMs] see HolonOnboarding
   * @param {number} [options.reviewSweepMs] how often open review cards are
   *   checked against who is linked (0: never)
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
    /** Derived key → the Telegram user it belongs to (see telegramIdsOf). */
    this.keyOwners = new Map();
    this.ownersAt = 0;
    this.reviewTimer = null;
    this.onboarding = new HolonOnboarding(bot, db, settings, {
      signer: () => this._signer(),
      isAdmin: ctx => this.isAdmin(ctx),
      sweepMs: this.enabled ? options.onboardingSweepMs : 0,
    });

    if (bot) {
      bot.action(new RegExp(`^${ACTION.approve}:([0-9a-f]{${PREFIX}})$`), ctx =>
        this.decide(ctx, 'approved')
      );
      bot.action(new RegExp(`^${ACTION.decline}:([0-9a-f]{${PREFIX}})$`), ctx =>
        this.decide(ctx, 'declined')
      );
      if (this.enabled) {
        this.start();
        const every = options.reviewSweepMs ?? REVIEW_SWEEP_MS;
        if (every > 0) {
          this.reviewTimer = setInterval(
            () =>
              this.sweepReviews().catch(e =>
                console.warn('[join] review sweep failed:', e?.message)
              ),
            every
          );
          this.reviewTimer.unref?.();
        }
      }
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
    if (this.reviewTimer) clearInterval(this.reviewTimer);
    this.reviewTimer = null;
    this.onboarding.shutdown();
  }

  onRequest(request) {
    const group = isTelegramGroup(request.holon);
    if ((!group && !isHolonId(request.holon)) || this.seen.has(request.eventId))
      return;
    this.seen.add(request.eventId);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      (group ? this.handle(request) : this.tellAdmins(request)).catch(e =>
        console.warn('[join] request not answered:', e?.message)
      );
    }, this.settleMs);
    this.timers.add(timer);
  }

  /**
   * The Telegram users behind `keys`, for the ones this bot can know: a
   * Telegram login's key is derived from the id, so the owner of a key is
   * found among the people the bot has met (every personal holon it knows).
   * A key someone brought themselves has no Telegram user behind it.
   */
  async telegramIdsOf(keys) {
    const want = [...new Set(keys.map(k => String(k).toLowerCase()))];
    if (!this.secret || !want.length) return [];
    const found = () => want.map(k => this.keyOwners.get(k)).filter(Boolean);
    if (
      found().length < want.length &&
      this.now() - this.ownersAt >= OWNERS_FRESH_SEC
    ) {
      this.ownersAt = this.now();
      let known = [];
      try {
        known = await this.db.listHolons();
      } catch {
        /* the owners already learned stand */
      }
      for (const id of known) {
        if (!/^\d{1,20}$/.test(String(id))) continue;
        try {
          this.keyOwners.set(
            deriveTelegramNostrKey(String(id), this.secret).publicKey,
            String(id)
          );
        } catch {
          /* not an id a key derives from */
        }
      }
    }
    return found();
  }

  /**
   * Tell the admins of a holon that has no Telegram group that someone asks
   * to be linked: a card on each admin's own board and a message in their
   * chat with the bot. The bot cannot link there itself (it holds no seat):
   * both open the holon, where an admin does. Returns what was done:
   * 'seated' | 'known' | 'told' | 'unreachable'.
   */
  async tellAdmins(request) {
    const holon = String(request.holon);
    const members = await holonMembers(this.db, holon);
    if (members.has(request.pubkey)) return 'seated';
    const noted = await this.db
      .get(TOLD.holon, TOLD.lens, request.eventId)
      .catch(() => null);
    if (noted) return 'known';

    const admins = [...members]
      .filter(([, role]) => role === 'admin')
      .map(([key]) => key);
    const chats = await this.telegramIdsOf(admins);
    if (!chats.length) {
      console.info(`[join] no admin of ${holon} is reachable on Telegram`);
      return 'unreachable';
    }

    const who = await describeApplicant(this.db, request, {
      secret: this.secret,
    });
    const tgId = who.telegram?.verified ? who.telegram.id : null;
    const language = await this.language(holon);
    let holonName = holon;
    try {
      holonName = String(
        (await readHolonSettings(this.db, holon))?.name || holon
      );
    } catch {
      /* the id names it */
    }
    const shown = esc(who.name || shortNpub(request.pubkey));
    const name = tgId ? `<a href="tg://user?id=${tgId}">${shown}</a>` : shown;
    const lines = [
      translated(
        language,
        'joinAsksHolon',
        '🔑 <b>{{name}}</b> asks to link their key to <b>{{holon}}</b>.',
        {
          name,
          holon: esc(holonName),
          interpolation: { escapeValue: false },
        }
      ),
      tgId
        ? translated(
            language,
            'joinFromTelegramLogin',
            'They signed in with Telegram.'
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
      ...this.dnaLines(language, who.dna),
      translated(
        language,
        'joinAdminsOpen',
        'You are an admin of this holon: open its Settings → Members to link them.'
      ),
    ];
    const url = `${KIOSK_ADDRESS()}/${encodeURIComponent(holon)}`;
    const plainName = who.name || shortNpub(request.pubkey);
    const review = {
      name: plainName,
      holonName,
      link: url,
      title: translated(
        language,
        'joinReviewTitle',
        'Link {{name}} to {{holon}}',
        {
          name: plainName,
          holon: holonName,
          interpolation: { escapeValue: false },
        }
      ),
      description: translated(
        language,
        'joinReviewHow',
        '{{name}} asks to link their key to {{holon}}. Open the holon, then Settings → Members, to link them: {{url}}',
        {
          name: plainName,
          holon: holonName,
          url,
          interpolation: { escapeValue: false },
        }
      ),
    };
    const extra = {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        Markup.button.url(
          translated(language, 'joinOpenHolon', 'Open {{holon}}', {
            holon: holonName,
            interpolation: { escapeValue: false },
          }).slice(0, 60),
          url
        ),
      ]),
    };
    let told = 0;
    const homes = [];
    for (const chat of chats) {
      let reached = false;
      try {
        // The card lands only where the bot's key counts (a person's holon
        // it keeps); an open one it already dealt is left as it is.
        if ((await writeAcceptance(this.db, chat)).status !== 'held') {
          await dealJoinReview(this.db, holon, chat, request, review);
          homes.push(chat);
          reached = true;
        }
      } catch (e) {
        console.info(`[join] no review card for admin ${chat}:`, e?.message);
      }
      try {
        await this.bot.telegram.sendMessage(chat, lines.join('\n'), extra);
        reached = true;
      } catch (e) {
        // They never started the bot, or blocked it.
        console.info(`[join] admin ${chat} not messaged:`, e?.message);
      }
      if (reached) told += 1;
    }
    if (!told) return 'unreachable';
    await this.db.put(
      TOLD.holon,
      TOLD.lens,
      {
        id: request.eventId,
        holon,
        key: request.pubkey,
        homes,
        open: homes.length > 0,
        at: this.now(),
      },
      { local: true }
    );
    return 'told';
  }

  /**
   * Close the review cards of everyone who was linked since they were
   * dealt. Read from the bot's own notes, so it survives a restart.
   * Returns how many cards were closed.
   */
  async sweepReviews() {
    let notes = [];
    try {
      notes = (await this.db.getAll(TOLD.holon, TOLD.lens)) ?? [];
    } catch {
      return 0;
    }
    let closed = 0;
    for (const note of notes) {
      if (!note?.open || !note.holon || !note.key) continue;
      if (!(await holonMembers(this.db, note.holon)).has(note.key)) continue;
      for (const home of note.homes ?? [])
        if (await settleJoinReview(this.db, note.holon, home, note.key))
          closed += 1;
      await this.db.put(
        TOLD.holon,
        TOLD.lens,
        { ...note, open: false },
        { local: true }
      );
    }
    return closed;
  }

  /** Where a request stands with the holon's DNA, as a line (none when it asks for nothing). */
  dnaLines(language, dna) {
    if (dna === 'none-required') return [];
    return [
      dna === 'acknowledged'
        ? translated(language, 'readyAcknowledged', 'DNA acknowledged')
        : dna === 'outdated'
          ? translated(language, 'readyOutdated', 'DNA outdated')
          : dna === 'unknown'
            ? translated(language, 'readyUnknown', 'DNA not readable')
            : translated(language, 'readyMissing', 'DNA not acknowledged'),
    ];
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
   * 'seated' | 'known' | 'limited' | 'linked' | 'onboarding' | 'posted'.
   */
  async handle(request) {
    const holon = String(request.holon);
    if ((await holonMembers(this.db, holon)).has(request.pubkey))
      return 'seated';
    const cur = (await joinRequestRecords(this.db, holon)).get(request.pubkey);
    if (cur) {
      // One post stands per asking key; a settled key may ask again a day on.
      if (cur.eventId === request.eventId) {
        // An onboarding under way survives a restart: keep re-reading it.
        if (cur.home && cur.status === 'pending')
          this.onboarding.track(holon, cur.id);
        return 'known';
      }
      if (cur.status === 'pending') return this.reask(holon, cur, request);
      if (this.now() - cur.at < DAY) return 'limited';
    }

    const who = await describeApplicant(this.db, request, {
      secret: this.secret,
    });
    // An unproven claim is no identity at all: the person is their key.
    const tgId = who.telegram?.verified ? who.telegram.id : null;
    const { linked, tgUser, inChat } = await this.tryAutoLink(
      holon,
      request,
      tgId,
      who.dna
    );
    if (linked) return 'linked';

    const fullName =
      [tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(' ') ||
      who.name;
    if (await this.onboarding.enabled(holon)) {
      await this.onboarding.begin(request, { name: fullName, tgId });
      return 'onboarding';
    }

    const telegram = this.bot?.telegram;
    const language = await this.language(holon);
    const name = esc(fullName);
    const handle = tgUser?.username ? ` (@${esc(tgUser.username)})` : '';
    const lines = [
      translated(
        language,
        'joinAsks',
        '🔑 <b>{{name}}</b>{{handle}} asks to link their key to this holon.',
        { name, handle, interpolation: { escapeValue: false } }
      ),
      tgId && inChat
        ? who.dna === 'unknown'
          ? translated(
              language,
              'joinInChatDnaUnknown',
              "They are in this group, but the holon's DNA could not be read to check their request."
            )
          : translated(
              language,
              'joinInChatDna',
              'They are in this group, but their request does not carry the current DNA.'
            )
        : tgId
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
      ...this.dnaLines(language, who.dna),
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
   * A newer request on a pending record: the record takes its DNA hash
   * (core `recordJoinRequest`), an onboarding re-checks it at once, and a
   * proven group member who now agreed to the current DNA is linked.
   */
  async reask(holon, cur, request) {
    const record = await recordJoinRequest(this.db, holon, request, {
      now: this.now,
    });
    if (cur.home) {
      this.onboarding.track(holon, cur.id);
      await this.onboarding.nudge(holon, cur.id).catch(() => null);
      return 'known';
    }
    const who = await describeApplicant(this.db, request, {
      secret: this.secret,
    });
    const tgId = who.telegram?.verified ? who.telegram.id : null;
    const { linked } = await this.tryAutoLink(holon, request, tgId, who.dna);
    if (!linked) return 'known';
    await settleJoinRequest(this.db, holon, record.id, 'approved', {
      by: 'proof',
      now: this.now,
    });
    return 'linked';
  }

  /**
   * Link a proven Telegram member of the group whose request agreed to the
   * holon's DNA as it is now. Returns whether it linked, and who Telegram
   * says they are.
   */
  async tryAutoLink(holon, request, tgId, readiness) {
    const telegram = this.bot?.telegram;
    let tgUser = null;
    let inChat = false;
    if (!tgId || !telegram) return { linked: false, tgUser, inChat };
    try {
      const member = await telegram.getChatMember(holon, Number(tgId));
      tgUser = member?.user ?? null;
      inChat =
        IN_CHAT.has(member?.status) &&
        (member.status !== 'restricted' || member.is_member !== false);
      if (
        inChat &&
        (await this.autoLink(holon, request, tgId, tgUser, readiness))
      )
        return { linked: true, tgUser, inChat };
    } catch {
      /* Telegram does not know them here: ask the admins */
    }
    return { linked: false, tgUser, inChat };
  }

  /**
   * A proven Telegram member of the group: write their `users` record when
   * the holon has none (the roster sync derives their key from it, so the
   * seat holds) and seat the key now — only when their request agreed to
   * the holon's DNA as it is now (core `mayLink`); otherwise an admin
   * decides, with the readiness shown. `readiness` comes from
   * `describeApplicant`: only 'acknowledged' and 'none-required' (both from
   * a successful read of the genes) link; 'unknown' (unreadable genes) and
   * anything else never do.
   */
  async autoLink(holon, request, tgId, user, readiness) {
    const signer = this._signer();
    if (!signer) return false;
    if (readiness === undefined) {
      let current = null;
      try {
        current = await holonDnaHash(this.db, holon);
      } catch {
        return false;
      }
      if (!mayLink(request, current)) return false;
    } else if (readiness !== 'acknowledged' && readiness !== 'none-required')
      return false;
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

  /**
   * The person asks from Telegram itself (HolonDna.js walks them through
   * the holon's DNA first, then calls this). Their request is signed with
   * the key their Telegram id derives, so it is proven like a kiosk login's,
   * and answered at once. `acknowledged` is the DNA hash they agreed to (the
   * walk's); a holon with a DNA they have not agreed to (or that changed
   * since) gets no request: `onDna` runs (the walk, again) or, without it,
   * they are pointed at the holon's DNA.
   */
  async askFromTelegram(ctx, holon, acknowledged = null, { onDna } = {}) {
    const language = await this.language(holon);
    const from = ctx.from;
    if (!from?.id || !this.secret || !isTelegramGroup(holon)) {
      await ctx.reply(
        translated(
          language,
          'onbCannotAsk',
          "This holon can't be joined from here."
        )
      );
      return 'refused';
    }
    const key = deriveTelegramNostrKey(String(from.id), this.secret);
    let event;
    try {
      event = await applyToHolon(
        this.db,
        holon,
        signerFromSecretKey(key.privateKey),
        {
          appName: this.db.appname,
          acknowledged,
          reason: [from.first_name, from.last_name].filter(Boolean).join(' '),
          telegramId: from.id,
        }
      );
    } catch (e) {
      if (!(e instanceof DnaNotAcknowledged || e instanceof DnaChanged))
        throw e;
      if (onDna) await onDna(e);
      else
        await ctx.reply(
          translated(
            language,
            'onbDnaFirst',
            'Before asking to join, read and agree to the DNA of this holon: {{url}}',
            { url: `https://hubs.network/${encodeURIComponent(holon)}/apply` }
          )
        );
      return 'dna';
    }
    const request = parseJoinRequest(event, holon);
    if (!request) return 'refused';
    this.seen.add(request.eventId);
    const outcome = await this.handle(request);
    if (outcome === 'known') await this.continueFromTelegram(ctx, holon);
    else if (outcome === 'seated' || outcome === 'linked') {
      await ctx.reply(
        translated(
          language,
          'onbAlreadyIn',
          '✅ Your key is linked to this holon.'
        )
      );
    } else if (outcome === 'posted') {
      await ctx.reply(
        translated(
          language,
          'onbAsked',
          'Asked: the admins of this holon decide.'
        )
      );
    } else if (outcome === 'limited') {
      await ctx.reply(
        translated(
          language,
          'onbLimited',
          'You asked recently; try again tomorrow.'
        )
      );
    }
    return outcome;
  }

  /**
   * Their request is already in: re-read their onboarding and say where it
   * stands (or that the admins decide).
   */
  async continueFromTelegram(ctx, holon) {
    const language = await this.language(holon);
    const from = ctx.from;
    if (!from?.id || !this.secret) return null;
    const { publicKey } = deriveTelegramNostrKey(String(from.id), this.secret);
    const result = await this.onboarding.nudge(holon, publicKey);
    if (result) await this.onboarding.announce(holon, result, true);
    else
      await ctx.reply(
        translated(
          language,
          'onbAlreadyAsked',
          'You already asked; the admins of this holon decide.'
        )
      );
    return result;
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
