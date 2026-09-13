// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// /key — a member's Nostr identity, in their private chat with the bot.
//
// Every Telegram member has a Nostr key the service DERIVES for them (from
// their Telegram id + NOSTR_DERIVATION_SECRET — the same key the web login
// and the kiosk's shift signups use). Whoever holds that secret can sign as
// the member, so the way out of that custody is the member's OWN key: this
// command lets them
//
//   • see their public key (npub) and which other keys are linked to them,
//   • export the derived secret key (nsec) — into this private chat only,
//     as a spoiler, with the warning it deserves — so they can use it in a
//     Nostr client of their choice,
//   • link a key they already hold, after proving control of it: they post
//     a one-time code from that key, the bot finds the note on the relays,
//     and `@holons/core/users` records the link. The kind-31926 attestation
//     the projection layer publishes then lists every key as one person
//     (see docs/shifts-elinor.md → Identity attestations),
//   • unlink a key.
//
// Everything is scoped to private chats: a group never sees a secret.

import { Markup } from 'telegraf';
import { deriveTelegramNostrKey } from '@holons/core/auth';
import { toNpub, toNsec } from '@holons/core/nostr';
import {
  buildKeyLinkChallenge,
  getLinkedKeys,
  keyLinkProofFilter,
  linkUserKey,
  normalizePubkey,
  unlinkUserKey,
  verifyKeyLinkProof,
  KEY_LINK_TTL_SEC,
} from '@holons/core/users';
import { shiftRelaysFromEnv } from './Shifts.js';

const ACTION = {
  export: 'key_export',
  link: 'key_link',
  verify: 'key_verify',
  cancel: 'key_cancel',
  unlink: 'key_unlink_', // + hex pubkey
  refresh: 'key_refresh',
};

/** Public relays most clients post to, checked besides the configured ones. */
const PUBLIC_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
];

/** Relays the proof lookup queries: KEY_LINK_RELAYS, else ours + the usual public ones. */
export function keyLinkRelaysFromEnv(env = process.env) {
  const own = (env.KEY_LINK_RELAYS || '')
    .split(',')
    .map(r => r.trim())
    .filter(Boolean);
  if (own.length) return own;
  return [...new Set([...shiftRelaysFromEnv(env), ...PUBLIC_RELAYS])];
}

const short = pk => `${pk.slice(0, 8)}…${pk.slice(-4)}`;

async function defaultPool() {
  const pool = await import('nostr-tools/pool');
  if (globalThis.WebSocket === undefined) {
    const { default: WS } = await import('ws');
    pool.useWebSocketImplementation(WS);
  }
  return new pool.SimplePool();
}

export default class Keys {
  /**
   * @param {import('telegraf').Telegraf|null} bot
   * @param {object} db HoloSphere (users lens)
   * @param {object} [options]
   * @param {string} [options.derivationSecret]
   * @param {string[]} [options.relays] where to look for link proofs
   * @param {{querySync: Function}} [options.pool] injectable relay pool
   * @param {(userId: string|number) => void} [options.onLinkedKeysChanged]
   *   called after a link/unlink so the projection host drops its cache
   * @param {() => number} [options.now] unix seconds, for tests
   */
  constructor(bot, db, options = {}) {
    this.bot = bot;
    this.db = db;
    this.secret = (
      options.derivationSecret ??
      process.env.NOSTR_DERIVATION_SECRET ??
      ''
    ).trim();
    this.relays = options.relays ?? keyLinkRelaysFromEnv();
    this.poolPromise = options.pool ? Promise.resolve(options.pool) : null;
    this.onLinkedKeysChanged = options.onLinkedKeysChanged ?? (() => {});
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    /** @type {Map<string, {challenge?: object, awaitingKey?: boolean, at: number}>} */
    this.pending = new Map();

    if (bot) {
      bot.command('key', ctx => this.command(ctx));
      bot.action(ACTION.export, ctx => this.exportKey(ctx));
      bot.action(ACTION.link, ctx => this.askForKey(ctx));
      bot.action(ACTION.verify, ctx => this.verify(ctx));
      bot.action(ACTION.cancel, ctx => this.cancel(ctx));
      bot.action(ACTION.refresh, ctx => this.overview(ctx, true));
      bot.action(new RegExp(`^${ACTION.unlink}([0-9a-f]{64})$`), ctx =>
        this.unlink(ctx)
      );
      // A pasted npub in the private chat while a link is pending.
      bot.hears(/^(?:nostr:)?(npub1[02-9ac-hj-np-z]+|[0-9a-fA-F]{64})$/i, ctx =>
        this.onKeyText(ctx)
      );
    }
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  /** Telegraf exposes answerCbQuery on every ctx; only a real callback may use it. */
  isCallback(ctx) {
    return Boolean(ctx.callbackQuery);
  }

  isPrivate(ctx) {
    const type = ctx.chat?.type ?? ctx.callbackQuery?.message?.chat?.type;
    return type === 'private';
  }

  user(ctx) {
    const from = ctx.from ?? ctx.callbackQuery?.from;
    return from
      ? {
          id: from.id,
          username: from.username,
          first_name: from.first_name,
          last_name: from.last_name,
        }
      : null;
  }

  derived(userId) {
    if (!this.secret) return null;
    try {
      return deriveTelegramNostrKey(userId, this.secret);
    } catch {
      return null;
    }
  }

  pendingFor(userId) {
    const p = this.pending.get(String(userId));
    if (!p) return null;
    if (this.now() - p.at > KEY_LINK_TTL_SEC) {
      this.pending.delete(String(userId));
      return null;
    }
    return p;
  }

  async pool() {
    return (this.poolPromise ??= defaultPool());
  }

  // ---------------------------------------------------------------------
  // /key
  // ---------------------------------------------------------------------

  async command(ctx) {
    if (!this.isPrivate(ctx)) {
      await ctx.reply(
        '🔑 Your key is personal — open a private chat with me and send /key there.'
      );
      return;
    }
    const text = ctx.message?.text ?? '';
    const [, verb, arg] = text.trim().split(/\s+/);
    if (verb === 'link' && arg) return this.startLink(ctx, arg);
    if (verb === 'unlink' && arg) return this.unlink(ctx, arg);
    return this.overview(ctx);
  }

  /** The member's identity: npub, linked keys, and what they can do about it. */
  async overview(ctx, edit = false) {
    const user = this.user(ctx);
    if (!user) return;
    const derived = this.derived(user.id);
    if (!derived) {
      const msg =
        'Signing keys are not configured on this bot (NOSTR_DERIVATION_SECRET missing).';
      return edit ? ctx.answerCbQuery(msg) : ctx.reply(msg);
    }
    const linked = await getLinkedKeys(this.db, user).catch(() => []);
    const lines = [
      '🔑 <b>Your Holons key</b>',
      '',
      'Your public key — share it, sign up to shifts with it in any Nostr client:',
      `<code>${toNpub(derived.publicKey)}</code>`,
    ];
    if (linked.length) {
      lines.push('', '<b>Linked keys</b> (count as you on every board):');
      for (const pk of linked) lines.push(`• <code>${toNpub(pk)}</code>`);
    } else {
      lines.push(
        '',
        'No other key linked yet. If you already use a Nostr client, link its key so both count as you.'
      );
    }
    const buttons = [
      [Markup.button.callback('📤 Export secret key', ACTION.export)],
      [Markup.button.callback('🔗 Link a key I hold', ACTION.link)],
      ...linked.map(pk => [
        Markup.button.callback(`✕ Unlink ${short(pk)}`, ACTION.unlink + pk),
      ]),
    ];
    const payload = {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons),
    };
    if (edit && ctx.editMessageText) {
      await ctx.answerCbQuery?.();
      await ctx
        .editMessageText(lines.join('\n'), payload)
        .catch(() => ctx.reply(lines.join('\n'), payload));
    } else {
      await ctx.reply(lines.join('\n'), payload);
    }
  }

  /** The derived secret, into the private chat, as a spoiler. */
  async exportKey(ctx) {
    if (!this.isPrivate(ctx))
      return ctx.answerCbQuery?.('Only in a private chat.');
    const user = this.user(ctx);
    const derived = user && this.derived(user.id);
    if (!derived)
      return ctx.answerCbQuery?.('Signing keys are not configured.');
    await ctx.answerCbQuery?.();
    await ctx.reply(
      [
        '⚠️ <b>Anyone with this key can act as you.</b> Paste it into your Nostr client, then delete this message.',
        '',
        `<tg-spoiler><code>${toNsec(derived.privateKey)}</code></tg-spoiler>`,
        '',
        'This key is derived by the Holons service; the service can always sign as it. For a key nobody else can derive, link one of your own (🔗 Link a key I hold).',
      ].join('\n'),
      { parse_mode: 'HTML' }
    );
  }

  /** Button: ask for the key to link. */
  async askForKey(ctx) {
    if (!this.isPrivate(ctx))
      return ctx.answerCbQuery?.('Only in a private chat.');
    const user = this.user(ctx);
    if (!user) return;
    this.pending.set(String(user.id), { awaitingKey: true, at: this.now() });
    await ctx.answerCbQuery?.();
    await ctx.reply(
      'Send me the public key to link — an <code>npub1…</code> or 64-hex pubkey — or use <code>/key link npub1…</code>.',
      { parse_mode: 'HTML' }
    );
  }

  /** A pasted key while a link is pending. */
  async onKeyText(ctx) {
    if (!this.isPrivate(ctx)) return;
    const user = this.user(ctx);
    const p = user && this.pendingFor(user.id);
    if (!p?.awaitingKey) return;
    return this.startLink(ctx, ctx.message.text);
  }

  /** Issue the challenge for a key. */
  async startLink(ctx, input) {
    if (!this.isPrivate(ctx)) return ctx.reply('Only in a private chat.');
    const user = this.user(ctx);
    if (!user) return;
    const pk = normalizePubkey(input);
    if (!pk) {
      return ctx.reply(
        "That doesn't look like a public key — send an npub1… or a 64-hex pubkey."
      );
    }
    const derived = this.derived(user.id);
    if (derived && pk === derived.publicKey) {
      return ctx.reply('That is already your Holons key — nothing to link.');
    }
    const linked = await getLinkedKeys(this.db, user).catch(() => []);
    if (linked.includes(pk))
      return ctx.reply('That key is already linked to you.');

    const challenge = buildKeyLinkChallenge(user.id, pk, { now: this.now() });
    this.pending.set(String(user.id), { challenge, at: challenge.issuedAt });
    await ctx.reply(
      [
        `To prove you hold <code>${toNpub(pk)}</code>, post a note from that key containing exactly:`,
        '',
        `<code>${challenge.code}</code>`,
        '',
        `Any Nostr client will do. Then tap <b>Verify</b> (within ${Math.round(KEY_LINK_TTL_SEC / 60)} minutes). You can delete the note afterwards.`,
      ].join('\n'),
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Verify', ACTION.verify),
            Markup.button.callback('Cancel', ACTION.cancel),
          ],
        ]),
      }
    );
  }

  /** Look for the proof note and record the link. */
  async verify(ctx) {
    if (!this.isPrivate(ctx))
      return ctx.answerCbQuery?.('Only in a private chat.');
    const user = this.user(ctx);
    const p = user && this.pendingFor(user.id);
    if (!p?.challenge) {
      return ctx.answerCbQuery?.('No link in progress — use /key link npub1…', {
        show_alert: true,
      });
    }
    let events = [];
    try {
      const pool = await this.pool();
      events = await pool.querySync(
        this.relays,
        keyLinkProofFilter(p.challenge),
        {
          maxWait: 6000,
        }
      );
    } catch (err) {
      console.error('[keys] proof lookup failed:', err);
    }
    if (!verifyKeyLinkProof(events, p.challenge, { now: this.now() })) {
      return ctx.answerCbQuery?.(
        'Not found yet. Posted? Give the relays a moment and tap Verify again.',
        { show_alert: true }
      );
    }
    this.pending.delete(String(user.id));
    const keys = await linkUserKey(this.db, user, p.challenge.pubkey);
    this.onLinkedKeysChanged(user.id);
    await ctx.answerCbQuery?.('Linked ✓');
    await ctx.reply(
      `🔗 Linked <code>${toNpub(p.challenge.pubkey)}</code>. ${keys.length} linked key${keys.length === 1 ? '' : 's'} now count as you on every board.`,
      { parse_mode: 'HTML' }
    );
    return this.overview(ctx);
  }

  async cancel(ctx) {
    const user = this.user(ctx);
    if (user) this.pending.delete(String(user.id));
    await ctx.answerCbQuery?.('Cancelled');
    await ctx.editMessageReplyMarkup?.(undefined).catch(() => {});
  }

  /** Unlink a key — from the button (match) or `/key unlink <key>`. */
  async unlink(ctx, input) {
    const fromButton = this.isCallback(ctx);
    const say = msg => (fromButton ? ctx.answerCbQuery(msg) : ctx.reply(msg));
    if (!this.isPrivate(ctx)) return say('Only in a private chat.');
    const user = this.user(ctx);
    if (!user) return;
    const pk = normalizePubkey(input ?? ctx.match?.[1]);
    if (!pk) return say("That doesn't look like a public key.");
    const before = await getLinkedKeys(this.db, user).catch(() => []);
    if (!before.includes(pk)) return say('That key is not linked to you.');
    await unlinkUserKey(this.db, user, pk);
    this.onLinkedKeysChanged(user.id);
    if (fromButton) {
      await ctx.answerCbQuery('Unlinked');
      return this.overview(ctx, true);
    }
    await ctx.reply(`Unlinked <code>${toNpub(pk)}</code>.`, {
      parse_mode: 'HTML',
    });
    return this.overview(ctx);
  }
}
