// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Onboarding into a holon, answered from Telegram.
//
// A holon that switched an onboarding on (`settings.onboarding`, see
// @holons/core/onboarding) does not link a key the moment someone asks.
// JoinRequests hands the request here instead, and the person walks the
// holon's steps first:
//
//   • Their cards land in their own holon (their Telegram id), where every
//     surface shows them. The DM lists the step's cards with a ✅ Done
//     button for the ones they tick themselves.
//   • A card someone from the holon vouches for (the call, the buddy) is
//     posted in the group with a Confirm button only its admins can press.
//   • Every tick moves them on (core `refreshOnboarding`): the next step's
//     cards and a DM; once every step is done the key is linked.
//
// A tick on another screen reaches the bot as a nudge (POST
// /notify/onboarding) and through a sweep; either way the bot re-reads what
// the person did, so a nudge is only ever a hint.

import { Markup } from 'telegraf';
import i18next from 'i18next';
import {
  CARDS_LENS,
  confirmCard,
  onboardingCardId,
  onboardingHome,
  readOnboarding,
  refreshOnboarding,
  startOnboarding,
} from '@holons/core/onboarding';
import { joinRequestRecords } from '@holons/core/holons';
import { readHolonSettings } from '@holons/core/settings';
import { applyTaskCompletion } from '@holons/core/tasks';
import { miniAppUrl } from './MiniApps.js';

const ACTION = { done: 'onbdone', confirm: 'onbok' };
/** Callback data is capped at 64 bytes: a key prefix names the person. */
const PREFIX = 16;
const SWEEP_MS = 2 * 60 * 1000;

const esc = s =>
  String(s ?? '').replace(
    /[&<>]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]
  );

/** A translated line with an inline default (see Settings.ts `translated`). */
function translated(language, key, defaultValue, vars = {}) {
  const text = i18next.t(key, {
    lng: language,
    defaultValue,
    interpolation: { escapeValue: false },
    ...vars,
  });
  if (typeof text === 'string' && text.trim()) return text;
  return defaultValue.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    String(vars[k] ?? '')
  );
}

export default class HolonOnboarding {
  /**
   * @param {import('telegraf').Telegraf|null} bot
   * @param {object} db HoloSphere
   * @param {{getLanguage?: (holon: string) => Promise<string>}|null} settings
   * @param {object} [options]
   * @param {() => object|null} options.signer the holon key's signer
   * @param {(ctx: object) => Promise<boolean>} options.isAdmin
   * @param {number} [options.sweepMs] how often pending onboardings are re-read (0: never)
   */
  constructor(bot, db, settings, options) {
    this.bot = bot;
    this.db = db;
    this.settings = settings;
    this.signer = options.signer;
    this.isAdmin = options.isAdmin;
    /** holon → set of keys onboarding there, for the sweep. */
    this.tracked = new Map();
    this.timer = null;

    if (bot) {
      bot.action(new RegExp(`^${ACTION.done}:(-?\\d+):(\\d+):(\\d+)$`), ctx =>
        this.done(ctx)
      );
      bot.action(
        new RegExp(`^${ACTION.confirm}:([0-9a-f]{${PREFIX}}):(\\d+):(\\d+)$`),
        ctx => this.confirm(ctx)
      );
      const every = options.sweepMs ?? SWEEP_MS;
      if (every > 0) {
        this.timer = setInterval(
          () =>
            this.sweep().catch(e =>
              console.warn('[onboarding] sweep failed:', e?.message)
            ),
          every
        );
        this.timer.unref?.();
      }
    }
  }

  shutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Does this holon walk newcomers through an onboarding? */
  async enabled(holon) {
    try {
      return (await readOnboarding(this.db, holon)).enabled;
    } catch {
      return false;
    }
  }

  track(holon, pubkey) {
    const keys = this.tracked.get(holon) ?? new Set();
    keys.add(pubkey);
    this.tracked.set(holon, keys);
  }

  async language(holon) {
    try {
      return (await this.settings?.getLanguage?.(holon)) || 'en';
    } catch {
      return 'en';
    }
  }

  async holonName(holon) {
    try {
      return String((await readHolonSettings(this.db, holon))?.name || holon);
    } catch {
      return holon;
    }
  }

  opts() {
    return { signer: this.signer(), appName: this.db.appname };
  }

  /**
   * Start a person's onboarding. `tgId`: their PROVEN Telegram id, when the
   * request has one — their cards land there and the bot DMs them.
   */
  async begin(request, { name, tgId = null }) {
    const holon = String(request.holon);
    const result = await startOnboarding(this.db, holon, request, {
      ...this.opts(),
      home: onboardingHome(request, tgId),
      name,
      ...(tgId ? { telegramId: tgId } : {}),
    });
    this.track(holon, result.record.id);
    const language = await this.language(holon);
    await this.post(
      holon,
      translated(
        language,
        'onbStarted',
        '🌱 <b>{{name}}</b> asked to link their key and started this holon’s onboarding.',
        { name: esc(result.view.name) }
      )
    );
    await this.announce(holon, result, true);
    return result;
  }

  /** Re-read one person's onboarding and say what changed. */
  async nudge(holon, pubkey) {
    const result = await refreshOnboarding(this.db, holon, pubkey, this.opts());
    if (!result) return null;
    if (result.view.status === 'pending') this.track(holon, result.record.id);
    if (result.passed.length || result.linked)
      await this.announce(holon, result, false);
    return result;
  }

  async sweep() {
    for (const [holon, keys] of this.tracked) {
      for (const pubkey of [...keys]) {
        const result = await this.nudge(holon, pubkey).catch(() => null);
        if (!result || result.view.status !== 'pending') keys.delete(pubkey);
      }
      if (!keys.size) this.tracked.delete(holon);
    }
  }

  async post(chat, text, extra = {}) {
    try {
      return await this.bot?.telegram.sendMessage(chat, text, {
        parse_mode: 'HTML',
        ...extra,
      });
    } catch (e) {
      console.info(`[onboarding] message to ${chat} failed:`, e?.message);
      return null;
    }
  }

  /**
   * Tell the person (a DM, when their holon is a Telegram id) and the group
   * where things stand: what to do next, or that they are linked.
   */
  async announce(holon, result, first) {
    const { view } = result;
    const language = await this.language(holon);
    const holonName = esc(await this.holonName(holon));
    const name = esc(view.name);
    const dmTo = /^\d+$/.test(view.home) ? view.home : null;

    if (result.linked || view.status === 'approved') {
      if (dmTo)
        await this.post(
          dmTo,
          translated(
            language,
            'onbLinkedDm',
            '✅ You finished the onboarding of <b>{{holon}}</b>. Your key is linked: welcome in!',
            { holon: holonName }
          )
        );
      await this.post(
        holon,
        translated(
          language,
          'onbLinkedGroup',
          '✅ <b>{{name}}</b> finished the onboarding and is linked to this holon.',
          { name }
        )
      );
      return;
    }

    const si = view.steps.findIndex(s => s.id === view.step);
    const step = view.steps[si];
    if (!step) return;

    if (dmTo) {
      const lines = [
        first
          ? translated(
              language,
              'onbWelcome',
              '🌱 To link your key to <b>{{holon}}</b>, walk its onboarding first.',
              { holon: holonName }
            )
          : translated(
              language,
              'onbNextStep',
              '➡️ Next step in <b>{{holon}}</b>:',
              {
                holon: holonName,
              }
            ),
        `<b>${esc(step.title)}</b>`,
        ...step.cards.map(c => {
          const mark = c.done ? '✅' : '▫️';
          const how =
            c.confirm === 'admin'
              ? translated(
                  language,
                  'onbAdminTicks',
                  '(someone from the holon ticks this)'
                )
              : c.confirm === 'profile'
                ? translated(
                    language,
                    'onbProfileHow',
                    '(send /onboarding to fill it in)'
                  )
                : '';
          const link = c.link ? ` — ${esc(c.link)}` : '';
          return `${mark} ${esc(c.title)}${link} ${how}`.trim();
        }),
      ];
      const buttons = step.cards
        .map((c, ci) => ({ c, ci }))
        .filter(({ c }) => !c.done && c.confirm === 'self')
        .map(({ c, ci }) => [
          Markup.button.callback(
            `✅ ${c.title}`.slice(0, 60),
            `${ACTION.done}:${holon}:${si}:${ci}`
          ),
        ]);
      const app = miniAppUrl(this.bot?.botInfo?.username, 'onboarding', holon);
      if (app)
        buttons.push([
          Markup.button.url(
            translated(language, 'openOnboardingApp', 'Open onboarding'),
            app
          ),
        ]);
      await this.post(dmTo, lines.join('\n'), Markup.inlineKeyboard(buttons));
    }

    const open = step.cards
      .map((c, ci) => ({ c, ci }))
      .filter(({ c }) => !c.done && c.confirm === 'admin');
    if (open.length) {
      const id = view.pubkey.slice(0, PREFIX);
      await this.post(
        holon,
        translated(
          language,
          'onbAdminAsk',
          '🌱 <b>{{name}}</b> is at “{{step}}”. An admin ticks a card once it happened:',
          { name, step: esc(step.title) }
        ),
        Markup.inlineKeyboard(
          open.map(({ c, ci }) => [
            Markup.button.callback(
              `☑️ ${c.title}`.slice(0, 60),
              `${ACTION.confirm}:${id}:${si}:${ci}`
            ),
          ])
        )
      );
    }
  }

  /** The step and card a button names, in the holon's current onboarding. */
  async cardAt(holon, si, ci) {
    const config = await readOnboarding(this.db, holon);
    const step = config.steps[Number(si)];
    const card = step?.cards[Number(ci)];
    return step && card ? { step, card } : null;
  }

  /** ✅ Done, pressed by the person in their DM: tick the card in their holon. */
  async done(ctx) {
    const [, holon, si, ci] = ctx.match ?? [];
    const language = await this.language(holon);
    const home = String(ctx.from?.id ?? '');
    const at = await this.cardAt(holon, si, ci);
    if (!at || at.card.confirm !== 'self' || String(ctx.chat?.id) !== home) {
      await ctx.answerCbQuery(
        translated(language, 'onbCardGone', 'This card is no longer open.')
      );
      return;
    }
    const id = onboardingCardId(holon, at.step.id, at.card.id);
    const card = await this.db.get(home, CARDS_LENS, id).catch(() => null);
    const ticked = card && applyTaskCompletion(card, home);
    if (!ticked?.ok && ticked?.reason !== 'already-completed') {
      // Not their card: it was dealt to someone else's holon.
      await ctx.answerCbQuery(
        translated(language, 'onbCardGone', 'This card is no longer open.')
      );
      return;
    }
    if (ticked.ok) await this.db.put(home, CARDS_LENS, ticked.task);
    await ctx.answerCbQuery('✅');
    const pubkey = await this.pubkeyOf(holon, home);
    if (pubkey) await this.nudge(holon, pubkey);
  }

  /** The key onboarding in `holon` from this Telegram id. */
  async pubkeyOf(holon, home) {
    for (const r of (await joinRequestRecords(this.db, holon)).values())
      if (r.home === home && r.status === 'pending') return r.id;
    return null;
  }

  /** ☑️ <card>, pressed in the group. Chat admins only. */
  async confirm(ctx) {
    const holon = String(ctx.chat?.id ?? '');
    const [, prefix, si, ci] = ctx.match ?? [];
    const language = await this.language(holon);
    if (!(await this.isAdmin(ctx))) {
      await ctx.answerCbQuery(
        translated(
          language,
          'joinAdminsOnly',
          'Only admins of this group can decide.'
        )
      );
      return;
    }
    const record = [
      ...(await joinRequestRecords(this.db, holon)).values(),
    ].find(r => r.id.startsWith(prefix) && r.home && r.status === 'pending');
    const at = await this.cardAt(holon, si, ci);
    const result =
      record && at
        ? await confirmCard(
            this.db,
            holon,
            record.id,
            at.step.id,
            at.card.id,
            this.opts()
          )
        : null;
    if (!result) {
      await ctx.answerCbQuery(
        translated(language, 'onbCardGone', 'This card is no longer open.')
      );
      return;
    }
    await ctx.answerCbQuery('✅');
    const by = ctx.from?.username
      ? `@${ctx.from.username}`
      : ctx.from?.first_name || String(ctx.from?.id ?? '');
    try {
      await ctx.editMessageText(
        translated(
          language,
          'onbConfirmed',
          '☑️ “{{card}}” for <b>{{name}}</b> — ticked by {{by}}.',
          {
            card: esc(at.card.title),
            name: esc(record.name),
            by: esc(by),
          }
        ),
        { parse_mode: 'HTML' }
      );
    } catch {
      /* the post is gone: the tick stands */
    }
    this.track(holon, record.id);
    if (result.passed.length || result.linked)
      await this.announce(holon, result, false);
  }
}
