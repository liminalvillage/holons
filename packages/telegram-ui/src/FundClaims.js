// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Fund claims over the signed claims log (`flow_claims`, kind 1808 — see
// @holons/core/flows claims and @holons/core/protocol).
//
//   /fundclaim <amount> [UNIT] [memo]   raise a claim on the fund, signed with
//                                       the member's own derived key (or, with
//                                       no derivation secret, by the holon key
//                                       on the member's behalf — `delegated`)
//   /fundgive <amount> [UNIT] <@user|id> [memo]
//                                       give part of your access to another
//                                       party — burns yours, opens theirs;
//                                       judged like a claim, never taken back
//   /fundbalance                        your balances here, every unit at once:
//                                       what the fund opens to you, what you
//                                       may still claim, what is open between
//                                       you and others in mutual credit
//   /fundclaims                         the holon's claims and gives, judged:
//                                       approved, pending, disputed, over, settled …
//   /fundattest <id> · /funddispute <id> [reason]   an attester's word
//   /fundpaid <id> [amount]             an attester records the payout
//   /fundmint <amount> [UNIT] [memo]    an attester brings value into the fund
//                                       (a harvest in L, a grant in EUR …) —
//                                       the pot the rights are cut from
//   /fundmints                          what the fund holds, judged
//   /fundpolicy                         the rules in force for the claims log
//   /fundpolicy quorum N | conflict earliest|quorum | pin <holon> | unpin <holon>
//                                       an admin sets one rule (a signed _policy entry)
//
// Every reader folds the same log the same way; the bot adds nothing a
// kiosk or the web would not derive. What the bot alone can do is sign the
// holon key: at each new moon it appends a CHECKPOINT per log lens — the
// merkle root of the entries that counted in the closed lunar cycle — so
// other readers can compare their fold with the holon's.

import { Markup } from 'telegraf';
import { getholonId, getUserId } from './utilities.js';
import { miniAppButton } from './MiniApps.js';
import { createIdentityContext } from '@holons/core/holosphere';
import { ethers } from 'ethers';
import {
  FLOW_CLAIMS_LENS,
  FLOW_MINTS_LENS,
  FLOW_RIGHTS_LENS,
  POT_ABI,
  POT_ETH,
  buildClaim,
  buildClaimVerdict,
  buildMint,
  buildPayout,
  buildRightsEntry,
  buildTransfer,
  claimHeadroom,
  cutRights,
  describeChain,
  fitsHeadroom,
  foldClaimsFromLenses,
  foldMintsFromLenses,
  loadClaimCeilings,
  loadPotRecord,
  loadRights,
  loadWallet,
  lunationAt,
  rightsByRef,
  scoreAllocationMembers,
} from '@holons/core/flows';
import {
  GOVERNANCE_VOTES_LENS,
  foldVotesFromLenses,
} from '@holons/core/governance';
import {
  CHECKPOINTS_LENS,
  POLICY_LENS,
  buildCheckpoint,
  epochOf,
  foldCheckpoints,
  normalizePolicy,
  policyRecord,
  samePolicy,
} from '@holons/core/protocol';
import {
  appendAsMember,
  partyNames,
  readLogContext,
} from './protocolContext.js';
import { askArgs, askMissing, withArgs } from './AskMissing.js';
import { holonText } from '../utils/holonNoun.js';

const HEX64 = /^[0-9a-f]{64}$/i;
/** A word that names a party: an @mention, a Telegram id, a hex key, a keyed holon. */
const isPartyWord = w =>
  w.startsWith('@') || /^-?\d+$/.test(w) || HEX64.test(w) || /^holon_/.test(w);

// A unit is a currency code or a measure: EUR, L, KG, KWH — one to five letters.
const UNIT_RE = /^[A-Za-z]{1,5}$/;
/** `12`, `12,5` → a number above zero. */
const isAmount = w => Number(String(w || '').replace(',', '.')) > 0;
/** An amount, then anything: `50`, `50 EUR`, `50 EUR tools`. */
const startsWithAmount = s => isAmount(s.split(/\s+/)[0]);
/** The English as written, its {{placeholders}} filled: `find` outside a dialogue. */
const plain = (_key, english, vars = {}) =>
  english.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars[name] ?? ''));
/** An amount and at most a unit: `5`, `5 L` — nothing that could shift what follows. */
const isAmountAndUnit = s => {
  const [amount, unit, ...more] = s.split(/\s+/);
  return isAmount(amount) && (!unit || UNIT_RE.test(unit)) && !more.length;
};
/** A reply to someone's message — not the topic root every topic message points at. */
const repliedAuthor = ctx => {
  const replied = ctx.message?.reply_to_message;
  return replied && !replied.forum_topic_created ? replied.from?.id : undefined;
};

const STATUS_MARK = {
  approved: '✅',
  settled: '💸',
  pending: '⏳',
  disputed: '⚠️',
  over: '⛔',
  conflict: '⚡',
  rejected: '✖️',
};

const escapeHtml = s =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default class FundClaims {
  /**
   * @param {import('telegraf').Telegraf|null} bot
   * @param {object} db HoloSphere (the holon key)
   * @param {object} [options]
   * @param {string} [options.derivationSecret]
   * @param {boolean} [options.checkpoints] run the new-moon checkpoint job (default true)
   * @param {number} [options.checkpointEveryMs]
   * @param {() => number} [options.now] ms, for tests
   */
  constructor(bot, db, options = {}) {
    this.bot = bot;
    this.db = db;
    this.now = options.now ?? Date.now;
    this.secret = (
      options.derivationSecret ??
      process.env.NOSTR_DERIVATION_SECRET ??
      ''
    ).trim();
    this.identity = createIdentityContext({ derivationSecret: this.secret });
    this.timer = null;
    if (bot) {
      bot.command('fundclaim', ctx => this.claim(ctx));
      bot.command('fundgive', ctx => this.give(ctx));
      bot.command('fundbalance', ctx => this.balance(ctx));
      bot.command('fundclaims', ctx => this.list(ctx));
      bot.command('fundattest', ctx => this.verdict(ctx, 'attest'));
      bot.command('funddispute', ctx => this.verdict(ctx, 'dispute'));
      bot.command('fundpaid', ctx => this.payout(ctx));
      bot.command('fundmint', ctx => this.mint(ctx));
      bot.command('fundmints', ctx => this.mints(ctx));
      bot.command('fundpolicy', ctx => this.policy(ctx));
    }
    if (options.checkpoints !== false)
      this.startCheckpoints(options.checkpointEveryMs ?? 60 * 60_000);
  }

  // ---------------------------------------------------------------- fold

  /**
   * Everything the fold reads, plus the derived keys only the bot knows —
   * folded the way every board folds it: once for the shape, then under the
   * ceilings that shape, the pot and the usage give (core), so a claim past
   * a right is held as `over`. The ceilings ride along for the pre-check.
   */
  async context(holon) {
    const base = await readLogContext(this.db, holon, FLOW_CLAIMS_LENS, {
      secret: this.secret,
    });
    const shape = foldClaimsFromLenses(base);
    const { ceilings } = await loadClaimCeilings(this.db, holon, {
      claims: shape.folded,
      scoreOf: id => scoreAllocationMembers(this.db, id),
      now: this.now(),
    });
    return { ...foldClaimsFromLenses({ ...base, rights: ceilings }), ceilings };
  }

  /** The mints log folded: what the fund holds to divide, per unit. */
  async mintsContext(holon) {
    return foldMintsFromLenses(
      await readLogContext(this.db, holon, FLOW_MINTS_LENS, {
        secret: this.secret,
      })
    );
  }

  /** Sign an entry as the member (derived key) and add it to the claims log. */
  appendAs(userId, holon, appendable, lens = FLOW_CLAIMS_LENS) {
    return appendAsMember(
      this.db,
      this.identity,
      userId,
      holon,
      lens,
      appendable,
      {
        at: Math.floor(this.now() / 1000),
      }
    );
  }

  // ---------------------------------------------------------------- commands

  async claim(ctx) {
    const holon = getholonId(ctx);
    const userId = String(getUserId(ctx));
    const args = (ctx.message?.text || '').split(/\s+/).slice(1);
    const amount = Number(String(args[0] || '').replace(',', '.'));
    if (!(amount > 0)) {
      const usage = 'Usage: /fundclaim <amount> [EUR] [what for]';
      if (args[0]) return ctx.reply(usage);
      return askArgs(
        ctx,
        [
          {
            key: 'amount',
            ask: 'ask_fundclaim_amount',
            question:
              'How much do you want to claim? Send the amount — you can add a unit and what it is for, e.g. 50 EUR tools.',
            validate: startsWithAmount,
            error: 'ask_err_fundclaim_amount',
            errorText:
              'Please start with a number above zero, e.g. 50 or 50 EUR tools.',
          },
        ],
        c => this.claim(c),
        { usage }
      );
    }
    let unit = 'EUR';
    let rest = args.slice(1);
    if (rest[0] && UNIT_RE.test(rest[0])) {
      unit = rest[0].toUpperCase();
      rest = rest.slice(1);
    }
    const memo = rest.join(' ').trim();
    // What is left of the member's right here: their share of the pot less
    // what was already claimed, paid or is awaiting attestation. A claim past
    // it is not recorded — the fold would only hold it as `over`.
    try {
      const { folded, ceilings } = await this.context(holon);
      const headroom = claimHeadroom(ceilings, folded, userId, unit);
      if (!fitsHeadroom(headroom, amount)) {
        return ctx.reply(
          `You can claim up to ${headroom} ${unit} here — what is left of your right after what was already claimed or paid.`
        );
      }
    } catch (err) {
      return ctx.reply(`Could not read the fund: ${err?.message || err}`);
    }
    const delegated = !this.identity.memberSigner(userId);
    const appendable = buildClaim({
      party: userId,
      amount,
      unit,
      memo: memo || undefined,
      at: this.now(),
      ...(delegated ? { onBehalfOf: userId } : {}),
    });
    try {
      const event = await this.appendAs(userId, holon, appendable);
      const ctxFold = await this.context(holon);
      const mine = ctxFold.folded.claims.find(c => c.id === event.id);
      const status = mine ? this.describe(mine) : 'recorded';
      return ctx.reply(
        `Claim recorded: ${amount} ${unit}${memo ? ` — ${memo}` : ''}\n` +
          `#${event.id.slice(0, 8)} · ${status}${delegated ? holonText(' (signed by {@the_holon} on your behalf)') : ''}` +
          (ctxFold.actors.source === 'bootstrap'
            ? holonText(
                '\nThis {@holon} is not founded yet: the signer set is provisional.'
              )
            : '')
      );
    } catch (err) {
      return ctx.reply(`Could not record the claim: ${err?.message || err}`);
    }
  }

  /**
   * /fundgive <amount> [UNIT] <@user|id> [memo] — give part of your access
   * to another party. A `transfer` in the claims log, signed as the member
   * (or by the holon key on their behalf), judged under the same access as
   * a claim: past it, nothing is written. The receiver is a reply's author,
   * an @mention the bot has seen, or a party id.
   */
  async give(ctx) {
    const holon = getholonId(ctx);
    const userId = String(getUserId(ctx));
    const args = (ctx.message?.text || '').split(/\s+/).slice(1);
    const amount = Number(String(args[0] || '').replace(',', '.'));
    const usage = 'Usage: /fundgive <amount> [L|EUR|…] <@user|id> [note]';
    if (!(amount > 0)) {
      if (args[0]) return ctx.reply(usage);
      return this.askGive(ctx, {
        amount: true,
        to: !repliedAuthor(ctx),
        usage,
      });
    }
    let unit = 'EUR';
    let rest = args.slice(1);
    if (rest[0] && UNIT_RE.test(rest[0])) {
      unit = rest[0].toUpperCase();
      rest = rest.slice(1);
    }
    // The receiver: the word after the amount when it names someone, else
    // the author of the message replied to. The rest is the note.
    const named = !!rest[0] && isPartyWord(rest[0]);
    const replied = repliedAuthor(ctx);
    const to = named
      ? await this.receiver(ctx, rest[0])
      : replied
        ? String(replied)
        : null;
    if (!to) {
      // Ask who, keeping what was typed: the amount (and unit) before the
      // receiver, the note after.
      return this.askGive(ctx, {
        to: true,
        head: args.slice(0, args.length - rest.length),
        tail: rest.slice(named ? 1 : 0),
        usage:
          'Who receives it? Reply to their message, @mention them, or give their id.',
      });
    }
    if (to === userId) return ctx.reply('A give names someone else.');
    const memo = rest
      .slice(named ? 1 : 0)
      .join(' ')
      .trim();
    try {
      const { folded, ceilings } = await this.context(holon);
      const headroom = claimHeadroom(ceilings, folded, userId, unit);
      if (!fitsHeadroom(headroom, amount)) {
        return ctx.reply(
          `You can give up to ${headroom} ${unit} here — your access after what was already claimed, paid or given.`
        );
      }
    } catch (err) {
      return ctx.reply(`Could not read the fund: ${err?.message || err}`);
    }
    const delegated = !this.identity.memberSigner(userId);
    const appendable = buildTransfer({
      party: userId,
      to,
      amount,
      unit,
      memo: memo || undefined,
      at: this.now(),
      ...(delegated ? { onBehalfOf: userId } : {}),
    });
    try {
      const event = await this.appendAs(userId, holon, appendable);
      const ctxFold = await this.context(holon);
      const mine = ctxFold.folded.transfers.find(t => t.id === event.id);
      const names = await this.names(holon, [to]);
      return ctx.reply(
        `Given: ${amount} ${unit} to ${names.get(to) || to}${memo ? ` — ${memo}` : ''}\n` +
          `#${event.id.slice(0, 8)} · ${mine ? this.describe(mine) : 'recorded'}${delegated ? holonText(' (signed by {@the_holon} on your behalf)') : ''}`
      );
    } catch (err) {
      return ctx.reply(`Could not record the give: ${err?.message || err}`);
    }
  }

  /**
   * Ask for what a give is missing — the amount, the receiver, or both — and
   * run /fundgive again with the answers in place. The receiver is resolved
   * from the ANSWER (its mention, or the roster) and handed on as an id.
   */
  askGive(ctx, { amount = false, to = false, head = [], tail = [], usage }) {
    const userId = String(getUserId(ctx));
    let receiver = null;
    const questions = [];
    if (amount)
      questions.push({
        key: 'amount',
        ask: 'ask_fundgive_amount',
        question:
          'How much do you want to give? Send the amount, with its unit if it is not EUR — e.g. 5 or 5 L.',
        validate: isAmountAndUnit,
        error: 'ask_err_fundgive_amount',
        errorText:
          'Please send a number above zero, with a unit after it if you like — e.g. 5 or 5 L.',
      });
    if (to)
      questions.push({
        key: 'to',
        ask: 'ask_fundgive_to',
        question: 'Who receives it? Send their @username or their id.',
        validate: async (input, _values, answerCtx, t) => {
          const mention = (answerCtx?.message?.entities || []).find(
            e => e.type === 'text_mention' && e.user?.id
          );
          const id = mention
            ? String(mention.user.id)
            : !/\s/.test(input) && isPartyWord(input)
              ? await this.receiver(ctx, input)
              : null;
          if (!id)
            return t(
              'ask_err_fundgive_to',
              'I could not tell who that is. Send their @username or their id.'
            );
          if (id === userId)
            return t('ask_err_fundgive_to_self', 'A give names someone else.');
          receiver = id;
          return true;
        },
      });
    return askMissing(
      ctx,
      questions,
      (values, original) =>
        this.give(
          withArgs(
            original,
            [
              ...(values.amount ? [values.amount] : head),
              ...(receiver ? [receiver] : []),
              ...tail,
            ].join(' ')
          )
        ),
      { usage }
    );
  }

  /** The party a give's word names: a bare id as it is, an @mention through the message's entities or the roster. */
  async receiver(ctx, word) {
    if (!word) return null;
    if (/^-?\d+$/.test(word) || HEX64.test(word) || /^holon_/.test(word))
      return word;
    if (word.startsWith('@')) {
      const handle = word.slice(1).toLowerCase();
      const entity = (ctx.message?.entities || []).find(
        e =>
          e.type === 'text_mention' &&
          e.user?.username?.toLowerCase() === handle
      );
      if (entity?.user?.id) return String(entity.user.id);
      try {
        const users = await this.db.getAll(getholonId(ctx), 'users');
        const hit = (users || []).find(
          u => String(u?.username || '').toLowerCase() === handle
        );
        if (hit?.id != null) return String(hit.id);
      } catch {
        // No roster to look the handle up in.
      }
    }
    return null;
  }

  /**
   * /fundmint <amount> [UNIT] [memo] — bring value into the fund. Signed as
   * the member; it counts only if they are an attester of the mints log
   * (admins by default), and the reply says so.
   */
  async mint(ctx) {
    const holon = getholonId(ctx);
    const userId = String(getUserId(ctx));
    const args = (ctx.message?.text || '').split(/\s+/).slice(1);
    const amount = Number(String(args[0] || '').replace(',', '.'));
    if (!(amount > 0)) {
      const usage = 'Usage: /fundmint <amount> [L|EUR|…] [what it is]';
      if (args[0]) return ctx.reply(usage);
      return askArgs(
        ctx,
        [
          {
            key: 'amount',
            ask: 'ask_fundmint_amount',
            question:
              'How much comes into the fund? Send the amount — you can add its unit and what it is, e.g. 120 L olive oil.',
            validate: startsWithAmount,
            error: 'ask_err_fundmint_amount',
            errorText:
              'Please start with a number above zero, e.g. 120 or 120 L olive oil.',
          },
        ],
        c => this.mint(c),
        { usage }
      );
    }
    let unit = 'EUR';
    let rest = args.slice(1);
    if (rest[0] && UNIT_RE.test(rest[0])) {
      unit = rest[0].toUpperCase();
      rest = rest.slice(1);
    }
    const memo = rest.join(' ').trim();
    try {
      const event = await this.appendAs(
        userId,
        holon,
        buildMint({ amount, unit, memo: memo || undefined, at: this.now() }),
        FLOW_MINTS_LENS
      );
      const { folded, actors } = await this.mintsContext(holon);
      const mine = folded.mints.find(m => m.id === event.id);
      const total = folded.byUnit[unit] ?? 0;
      return ctx.reply(
        `Added to the fund: ${amount} ${unit}${memo ? ` — ${memo}` : ''}\n` +
          `#${event.id.slice(0, 8)} · ${mine ? this.describeMint(mine) : 'recorded'}` +
          (mine?.status === 'issued'
            ? `\nThe fund now holds ${total} ${unit}.`
            : '') +
          (actors.source === 'bootstrap'
            ? holonText(
                '\nThis {@holon} is not founded yet: the signer set is provisional.'
              )
            : '')
      );
    } catch (err) {
      return ctx.reply(`Could not add to the fund: ${err?.message || err}`);
    }
  }

  describeMint(m) {
    const mark = m.status === 'issued' ? '✅' : STATUS_MARK[m.status] || '';
    const why = m.status === 'issued' ? '' : m.reason ? ` (${m.reason})` : '';
    return `${mark} ${m.status}${why}`;
  }

  /** /fundmints — what the fund holds, per unit, and every mint judged. */
  async mints(ctx) {
    const holon = getholonId(ctx);
    try {
      const { folded, actors } = await this.mintsContext(holon);
      if (!folded.mints.length)
        return ctx.reply(
          'Nothing has been brought into this fund yet. An attester adds to it with /fundmint <amount> [UNIT] [what it is].'
        );
      const names = await this.names(
        holon,
        folded.mints.map(m => m.pubkey)
      );
      const held = Object.entries(folded.byUnit)
        .map(([u, v]) => `${v} ${u}`)
        .join(' · ');
      const lines = folded.mints.slice(-25).map(m => {
        const who = names.get(m.pubkey) || '';
        return `#${m.id.slice(0, 8)} ${m.amount} ${m.unit}${m.memo ? ` — ${escapeHtml(m.memo)}` : ''}${who ? ` <i>(${escapeHtml(who)})</i>` : ''}\n   ${this.describeMint(m)}`;
      });
      const head =
        `<b>The fund holds</b> ${held || 'nothing yet'}` +
        (actors.source === 'bootstrap'
          ? ' · <i>provisional signer set</i>'
          : '');
      return ctx.replyWithHTML([head, ...lines].join('\n'));
    } catch (err) {
      return ctx.reply(`Could not read the fund: ${err?.message || err}`);
    }
  }

  describe(c) {
    const mark = STATUS_MARK[c.status] || '';
    const why =
      c.status === 'approved' || c.status === 'settled'
        ? ''
        : c.reason
          ? ` (${c.reason})`
          : '';
    return `${mark} ${c.status}${why}`;
  }

  /** Your balances here: one line per unit, nothing converted (core `loadWallet`). */
  async balance(ctx) {
    const holon = getholonId(ctx);
    const userId = String(getUserId(ctx));
    try {
      const { folded } = await this.context(holon);
      const { lines, truncated } = await loadWallet(this.db, holon, userId, {
        claims: folded,
        scoreOf: id => scoreAllocationMembers(this.db, id),
        now: this.now(),
      });
      if (!lines.length)
        return ctx.reply(
          'Nothing on your balance here yet: no right over the fund, nothing given to you, nothing open with anyone.'
        );
      const rows = lines.map(l => this.describeLine(l));
      const foot = truncated
        ? '<i>Some splits could not be followed; a right may be missing.</i>'
        : '';
      return ctx.replyWithHTML(
        ['<b>Your balances</b>', ...rows, foot].filter(Boolean).join('\n')
      );
    } catch (err) {
      return ctx.reply(`Could not read your balance: ${err?.message || err}`);
    }
  }

  /** One wallet line, the way every surface words it. */
  describeLine(l) {
    const unit = l.unit.toUpperCase();
    const parts = [];
    if (l.account) {
      const a = l.account;
      parts.push(a.over > 0 ? `over by ${a.over}` : `${a.available} available`);
      if (a.right != null) parts.push(`right ${a.right}`);
      if (a.lifetimeSpent > 0) parts.push(`paid ${a.lifetimeSpent}`);
      if (a.claimed > 0) parts.push(`claimed ${a.claimed}`);
      if (a.received > 0) parts.push(`received ${a.received}`);
      if (a.given > 0) parts.push(`given ${a.given}`);
      if (l.held) parts.push('held in the Pot — collect there');
      else if (l.claimable != null && l.claimable !== a.available)
        parts.push(`claim up to ${l.claimable}`);
    }
    if (l.credit) {
      const c = l.credit;
      parts.push(
        c.net > 0
          ? `owed to you ${c.net}`
          : c.net < 0
            ? `you owe ${-c.net}`
            : 'square with everyone'
      );
    }
    return `<b>${unit}</b> · ${parts.join(' · ')}`;
  }

  async list(ctx) {
    const holon = getholonId(ctx);
    // The Flows Mini App (fund claims live on the kiosk's Flows board), when
    // this bot has it registered (MiniApps.ts). These replies are English.
    const openApp = miniAppButton(ctx, 'flows', holon, 'en');
    const appKeyboard = openApp ? Markup.inlineKeyboard([[openApp]]) : null;
    try {
      const { folded, actors, policy } = await this.context(holon);
      if (!folded.claims.length && !folded.transfers.length) {
        const empty =
          'No claims on this fund yet. Raise one with /fundclaim <amount>, or pass access on with /fundgive.';
        return appKeyboard ? ctx.reply(empty, appKeyboard) : ctx.reply(empty);
      }
      const names = await this.names(holon, [
        ...folded.claims.map(c => c.party),
        ...folded.transfers.flatMap(t => [t.party, t.to]),
      ]);
      const name = id => escapeHtml(names.get(id) || id);
      const rows = [
        ...folded.claims.map(c => ({
          at: c.createdAt,
          id: c.id,
          text: `<b>${name(c.party)}</b> ${c.amount} ${c.unit}${c.memo ? ` — ${escapeHtml(c.memo)}` : ''}\n   ${this.describe(c)}`,
        })),
        ...folded.transfers.map(t => ({
          at: t.createdAt,
          id: t.id,
          text: `<b>${name(t.party)}</b> → <b>${name(t.to)}</b> ${t.amount} ${t.unit}${t.memo ? ` — ${escapeHtml(t.memo)}` : ''}\n   ${this.describe(t)}`,
        })),
      ].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
      const lines = rows.slice(-25).map(r => `#${r.id.slice(0, 8)} ${r.text}`);
      const head =
        `<b>Fund claims</b> · quorum ${policy.quorum}, ${policy.conflict} wins` +
        (actors.source === 'bootstrap'
          ? ' · <i>provisional signer set</i>'
          : '');
      const html = [head, ...lines].join('\n');
      return appKeyboard
        ? ctx.replyWithHTML(html, appKeyboard)
        : ctx.replyWithHTML(html);
    } catch (err) {
      return ctx.reply(`Could not read the claims: ${err?.message || err}`);
    }
  }

  async find(holon, prefix, t = plain) {
    const { folded } = await this.context(holon);
    const p = String(prefix || '')
      .replace(/^#/, '')
      .toLowerCase();
    if (!p)
      return {
        error: t(
          'ask_err_fund_claim_missing',
          'Which claim? Give its id (see /fundclaims).'
        ),
      };
    const hits = folded.claims.filter(c => c.id.startsWith(p));
    if (!hits.length)
      return {
        error: t('ask_err_fund_claim_unknown', 'No claim starts with {{id}}.', {
          id: p,
        }),
      };
    if (hits.length > 1)
      return {
        error: t(
          'ask_err_fund_claim_ambiguous',
          '{{n}} claims start with {{id}}; give more of the id.',
          { n: hits.length, id: p }
        ),
      };
    return { claim: hits[0] };
  }

  /**
   * A command sent without its claim: ask which one, under the claims still
   * open, then run the command again with the answer as its arguments.
   * `ask` is the locale key of the question and `lead` its English; the open
   * claims fill the `{{claims}}` placeholder that ends it.
   */
  async askClaim(ctx, holon, ask, lead, handler) {
    let lines = [];
    try {
      const { folded } = await this.context(holon);
      if (!folded.claims.length)
        return ctx.reply('There are no claims on this fund yet.');
      const open = folded.claims
        .filter(c => c.status !== 'settled' && c.status !== 'rejected')
        .slice(-8);
      const names = await this.names(
        holon,
        open.map(c => c.party)
      );
      lines = open.map(
        c =>
          `#${c.id.slice(0, 8)} ${names.get(c.party) || c.party} ${c.amount} ${c.unit} · ${c.status}`
      );
    } catch {
      // The question still stands without the list.
    }
    return askArgs(
      ctx,
      [
        {
          key: 'claim',
          ask,
          question: `${lead}{{claims}}`,
          vars: { claims: lines.length ? `\n\n${lines.join('\n')}` : '' },
          validate: async (input, _values, _ctx, t) => {
            const { error } = await this.find(holon, input.split(/\s+/)[0], t);
            return error || true;
          },
        },
      ],
      handler,
      { usage: 'Which claim? Give its id (see /fundclaims).' }
    );
  }

  async verdict(ctx, verdict) {
    const holon = getholonId(ctx);
    const userId = String(getUserId(ctx));
    const args = (ctx.message?.text || '').split(/\s+/).slice(1);
    if (!args[0])
      return this.askClaim(
        ctx,
        holon,
        verdict === 'attest' ? 'ask_fundattest_claim' : 'ask_funddispute_claim',
        verdict === 'attest'
          ? 'Which claim do you attest? Send its id.'
          : 'Which claim do you dispute? Send its id — you can add the reason after it.',
        c => this.verdict(c, verdict)
      );
    const { claim, error } = await this.find(holon, args[0]);
    if (error) return ctx.reply(error);
    const reason = args.slice(1).join(' ').trim() || undefined;
    try {
      await this.appendAs(
        userId,
        holon,
        buildClaimVerdict(claim.id, verdict, reason)
      );
      const after = await this.context(holon);
      const now = after.folded.claims.find(c => c.id === claim.id);
      return ctx.reply(
        `${verdict === 'attest' ? 'Attested' : 'Disputed'} #${claim.id.slice(0, 8)} · now ${now ? this.describe(now) : '?'}`
      );
    } catch (err) {
      return ctx.reply(`Could not record the verdict: ${err?.message || err}`);
    }
  }

  async payout(ctx) {
    const holon = getholonId(ctx);
    const userId = String(getUserId(ctx));
    const args = (ctx.message?.text || '').split(/\s+/).slice(1);
    if (!args[0])
      return this.askClaim(
        ctx,
        holon,
        'ask_fundpaid_claim',
        'Which claim was paid out? Send its id — add the amount after it if it differs from the claim.',
        c => this.payout(c)
      );
    const { claim, error } = await this.find(holon, args[0]);
    if (error) return ctx.reply(error);
    const amount = args[1]
      ? Number(String(args[1]).replace(',', '.'))
      : claim.amount;
    if (!(amount > 0)) return ctx.reply('Usage: /fundpaid <id> [amount]');
    try {
      await this.appendAs(
        userId,
        holon,
        buildPayout({
          claimId: claim.id,
          party: claim.party,
          amount,
          unit: claim.unit,
        })
      );
      const after = await this.context(holon);
      const now = after.folded.claims.find(c => c.id === claim.id);
      return ctx.reply(
        `Payout recorded for #${claim.id.slice(0, 8)} · now ${now ? this.describe(now) : '?'}`
      );
    } catch (err) {
      return ctx.reply(`Could not record the payout: ${err?.message || err}`);
    }
  }

  /** Names for the parties on the fund — members by any key, partners, strangers. */
  names(holon, ids = []) {
    return partyNames(this.db, holon, ids);
  }

  // ---------------------------------------------------------------- policy

  /**
   * /fundpolicy — the rules in force for the claims log; with arguments, an
   * admin's change of one rule, appended to `_policy` signed as them (it
   * counts only if their key is an admin as of now — said in the reply).
   */
  async policy(ctx) {
    const holon = getholonId(ctx);
    const userId = String(getUserId(ctx));
    const args = (ctx.message?.text || '').split(/\s+/).slice(1);
    let fold;
    try {
      fold = await this.context(holon);
    } catch (err) {
      return ctx.reply(`Could not read the rules: ${err?.message || err}`);
    }
    const rule = fold.policy;
    const show = () => {
      const pins = Object.keys(rule.partners);
      return ctx.reply(
        [
          `Rules for the claims log${fold.actors.source === 'bootstrap' ? ' (provisional signer set)' : ''}:`,
          `· who may claim: ${rule.authors.join(', ')}`,
          `· who attests: ${rule.attesters.join(', ')}`,
          `· attestations needed: ${rule.quorum}`,
          `· two on one basis: ${rule.conflict === 'quorum' ? 'a human decides' : 'the first wins'}`,
          `· partners pinned: ${pins.length ? pins.join(', ') : 'none'}`,
          '',
          'Change one: /fundpolicy quorum N · conflict earliest|quorum · pin <holon id> · unpin <holon id>',
        ].join('\n')
      );
    };
    if (!args.length) return show();
    const next = normalizePolicy(rule);
    const [what, value] = args;
    const again = c => this.policy(c);
    if (what === 'quorum') {
      if (value === undefined)
        return askArgs(
          ctx,
          [
            {
              key: 'quorum',
              ask: 'ask_fundpolicy_quorum',
              question:
                'How many attestations should a claim need? Send a whole number, 0 or more.',
              validate: s => /^\d+$/.test(s),
              error: 'ask_err_fundpolicy_quorum',
              errorText: 'Please send a whole number, e.g. 2.',
            },
          ],
          again,
          { prefix: what, usage: 'Usage: /fundpolicy quorum <0-9>' }
        );
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0)
        return ctx.reply('Usage: /fundpolicy quorum <0-9>');
      next.quorum = n;
    } else if (what === 'conflict') {
      if (value === undefined)
        return askMissing(
          ctx,
          [
            {
              key: 'conflict',
              ask: 'ask_fundpolicy_conflict',
              question:
                'When two claims stand on the same basis, which one wins? Send "earliest" (the first wins) or "quorum" (a human decides).',
              validate: s => ['earliest', 'quorum'].includes(s.toLowerCase()),
              error: 'ask_err_fundpolicy_conflict',
              errorText: 'Please answer earliest or quorum.',
            },
          ],
          (values, original) =>
            again(withArgs(original, what, values.conflict.toLowerCase())),
          { usage: 'Usage: /fundpolicy conflict earliest|quorum' }
        );
      if (value !== 'earliest' && value !== 'quorum')
        return ctx.reply('Usage: /fundpolicy conflict earliest|quorum');
      next.conflict = value;
    } else if (what === 'pin') {
      if (!value)
        return askArgs(
          ctx,
          [
            {
              key: 'holon',
              ask: 'ask_fundpolicy_pin',
              question:
                'Which partner holon do you want to pin? Send its holon id.',
              validate: s => !/\s/.test(s),
              error: 'ask_err_fundpolicy_pin',
              errorText: 'Please send just the holon id, without spaces.',
            },
          ],
          again,
          { prefix: what, usage: 'Usage: /fundpolicy pin <partner holon id>' }
        );
      let doc = null;
      try {
        doc = await this.db.get(String(value), 'settings', String(value));
      } catch {
        doc = null;
      }
      const key = String(doc?.holonPubkey || '');
      if (!HEX64.test(key))
        return ctx.reply(
          `${value} has not published ${holonText('{@a_holon}')} key, so there is nothing to pin.`
        );
      next.partners = { ...next.partners, [String(value)]: key.toLowerCase() };
    } else if (what === 'unpin') {
      const pinned = Object.keys(next.partners);
      if (!value && pinned.length)
        return askArgs(
          ctx,
          [
            {
              key: 'holon',
              ask: 'ask_fundpolicy_unpin',
              question:
                'Which partner do you want to unpin? Send its holon id.\n\nPinned: {{pinned}}',
              vars: { pinned: pinned.join(', ') },
              validate: s => pinned.includes(s),
              error: 'ask_err_fundpolicy_unpin',
              errorText: 'That one is not pinned. Pinned: {{pinned}}',
            },
          ],
          again,
          { prefix: what, usage: 'Usage: /fundpolicy unpin <partner holon id>' }
        );
      if (!value || !next.partners[String(value)])
        return ctx.reply(`${value || '?'} is not pinned.`);
      const { [String(value)]: _gone, ...rest } = next.partners;
      next.partners = rest;
    } else {
      return show();
    }
    if (samePolicy(next, rule))
      return ctx.reply('These are the rules already in force.');
    const signer = this.identity.memberSigner(userId);
    const pub = signer ? signer.pubkey : this.db.currentPubkey;
    const role = fold.actors.roleAt(pub, Math.floor(this.now() / 1000));
    try {
      await this.appendAs(
        userId,
        holon,
        policyRecord(FLOW_CLAIMS_LENS, next),
        POLICY_LENS
      );
      return ctx.reply(
        role === 'admin'
          ? `Rule set: ${what} ${value}.`
          : holonText(
              'Recorded, but your key is not an admin of this {@holon}, so the rule does not change.'
            )
      );
    } catch (err) {
      return ctx.reply(`Could not set the rule: ${err?.message || err}`);
    }
  }

  // ---------------------------------------------------------------- checkpoints

  startCheckpoints(everyMs) {
    const run = () => {
      this.checkpointClosedEpoch().catch(e =>
        console.warn('[fundclaims] checkpoint failed:', e?.message)
      );
      this.cutRightsAtNewMoon().catch(e =>
        console.warn('[fundclaims] rights cut failed:', e?.message)
      );
    };
    this.timer = setInterval(run, everyMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    setTimeout(run, 30_000).unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Append a checkpoint for the lunar cycle that just closed, per holon with
   * a claims log, unless one is already there. Signed by the holon key.
   */
  async checkpointClosedEpoch() {
    const db = this.db;
    if (!db.signingEnabled) return { checkpointed: [] };
    const closed = epochOf(Math.floor(this.now() / 1000)) - 1;
    const done = [];
    const lenses = [
      {
        lens: FLOW_CLAIMS_LENS,
        fold: async h => this.context(h),
      },
      {
        lens: FLOW_MINTS_LENS,
        fold: async h => this.mintsContext(h),
      },
      {
        lens: GOVERNANCE_VOTES_LENS,
        fold: async h =>
          foldVotesFromLenses(
            await readLogContext(db, h, GOVERNANCE_VOTES_LENS, {
              secret: this.secret,
            })
          ),
      },
    ];
    for (const holon of await db.listHolons()) {
      const h = String(holon);
      for (const { lens, fold } of lenses) {
        let entries = [];
        try {
          entries = await db.getLog(h, lens);
        } catch {
          continue;
        }
        if (!entries.length) continue;
        const ctx = await fold(h);
        const existing = foldCheckpoints(
          await db.getLog(h, CHECKPOINTS_LENS).catch(() => []),
          ctx.actors
        );
        if (existing.has(`${lens}|${closed}`)) continue;
        const cp = buildCheckpoint({
          lens,
          epoch: closed,
          accepted: ctx.folded.accepted,
        });
        await db.append(h, CHECKPOINTS_LENS, cp.item);
        done.push({
          holon: h,
          lens,
          epoch: closed,
          root: cp.item.root,
          count: cp.item.count,
        });
      }
    }
    if (done.length)
      console.log(
        `[fundclaims] checkpointed epoch ${closed}: ${done.length} lens(es)`
      );
    return { checkpointed: done };
  }

  // ---------------------------------------------------------------- the Pot

  /**
   * The Pot's cumulative receipts per token, read off the chain's public
   * endpoint: the chain's coin and every token the holon's record lists.
   * Null when the chain cannot be read from here.
   */
  async potReceipts(pot, tokens) {
    const rpc = describeChain(pot.chainId)?.rpc;
    if (!rpc) return null;
    const provider = new ethers.JsonRpcProvider(rpc, pot.chainId, {
      staticNetwork: true,
    });
    const contract = new ethers.Contract(pot.address, [...POT_ABI], provider);
    const received = {};
    for (const token of [
      POT_ETH,
      ...tokens.map(t => t.address.toLowerCase()),
    ]) {
      const v = BigInt(String(await contract.received(token)));
      if (v > 0n) received[token] = v;
    }
    return received;
  }

  /**
   * The root the Pot applies today — epoch, root and the log id of its
   * table — or null when none was ever activated.
   */
  async potActive(pot) {
    const rpc = describeChain(pot.chainId)?.rpc;
    if (!rpc) return null;
    const provider = new ethers.JsonRpcProvider(rpc, pot.chainId, {
      staticNetwork: true,
    });
    const contract = new ethers.Contract(pot.address, [...POT_ABI], provider);
    const a = await contract.active();
    const root = String(a.root ?? a[1] ?? '').toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(root) || /^0x0+$/.test(root)) return null;
    return {
      epoch: Number(a.epoch ?? a[0]),
      root,
      tableRef: String(a.tableRef ?? a[2]),
    };
  }

  /**
   * At the new moon, cut and publish the lunation's rights table for every
   * holon with a Pot whose latest published table is older than this
   * lunation. Signed by the holon key (an attester); the signers then sign
   * the root with their wallets and post it (kiosk, web, MCP). A walk that
   * could not complete publishes nothing: the income rolls into the next
   * moon, and the log says why.
   */
  async cutRightsAtNewMoon() {
    const db = this.db;
    if (!db.signingEnabled) return { cut: [] };
    const epoch = lunationAt(this.now()).index;
    const done = [];
    for (const holon of await db.listHolons()) {
      const h = String(holon);
      const pot = await loadPotRecord(db, h).catch(() => null);
      if (!pot) continue;
      const ctx = await loadRights(db, h);
      if (ctx.latest && ctx.latest.epoch >= epoch) continue;
      const received = await this.potReceipts(pot, pot.tokens).catch(
        () => null
      );
      if (!received) continue;
      // The next table builds on the one the chain APPLIES, never on the
      // newest in the log: every row is held monotone over its predecessor,
      // so a vetoed table taken as the floor would keep its inflated rows
      // for good. A chain with no active root yet starts from nothing.
      let previous = null;
      try {
        const active = await this.potActive(pot);
        if (active) {
          const applied = rightsByRef(ctx.folded, active.tableRef);
          if (!applied) {
            console.warn(
              `[fundclaims] ${h}: the Pot's active table ${active.tableRef} is not in the rights log — not cut`
            );
            continue;
          }
          previous = applied.table;
        }
      } catch (err) {
        console.warn(
          `[fundclaims] ${h}: could not read the Pot's active root (${err?.message || err}) — not cut`
        );
        continue;
      }
      const cut = await cutRights(db, h, {
        previous,
        epoch,
        chainId: pot.chainId,
        received,
        scoreOf: id => scoreAllocationMembers(db, id),
      });
      if (!cut.complete || !cut.table) {
        console.warn(
          `[fundclaims] ${h}: table for lunation ${epoch} not cut — ${cut.problems.join('; ')}`
        );
        continue;
      }
      const entry = buildRightsEntry({
        table: cut.table,
        chainId: pot.chainId,
        pot: pot.address,
      });
      const event = await db.append(h, FLOW_RIGHTS_LENS, entry.item, {
        refs: entry.refs,
      });
      done.push({ holon: h, epoch, id: event.id, rows: cut.table.rows.length });
      if (/^-?\d+$/.test(h)) {
        this.bot?.telegram
          ?.sendMessage(
            h,
            `🌑 New moon: the rights table for lunation ${epoch} is published (${cut.table.rows.length} rows). Signers, sign and post it from the kiosk or the dashboard; it applies after the challenge window.`
          )
          .catch(() => {});
      }
    }
    if (done.length)
      console.log(
        `[fundclaims] cut lunation ${epoch} rights: ${done.length} holon(s)`
      );
    return { cut: done };
  }
}
