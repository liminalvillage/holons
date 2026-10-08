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

import { getholonId, getUserId } from './utilities.js';
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
  loadBundleRecord,
  loadClaimCeilings,
  loadPotRecord,
  loadRights,
  lunationAt,
  readBundleTokens,
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

const HEX64 = /^[0-9a-f]{64}$/i;
/** A word that names a party: an @mention, a Telegram id, a hex key, a keyed holon. */
const isPartyWord = w =>
  w.startsWith('@') || /^-?\d+$/.test(w) || HEX64.test(w) || /^holon_/.test(w);

// A unit is a currency code or a measure: EUR, L, KG, KWH — one to five letters.
const UNIT_RE = /^[A-Za-z]{1,5}$/;
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
      return ctx.reply('Usage: /fundclaim <amount> [EUR] [what for]');
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
          `#${event.id.slice(0, 8)} · ${status}${delegated ? ' (signed by the holon on your behalf)' : ''}` +
          (ctxFold.actors.source === 'bootstrap'
            ? '\nThis holon is not founded yet: the signer set is provisional.'
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
    if (!(amount > 0)) {
      return ctx.reply('Usage: /fundgive <amount> [L|EUR|…] <@user|id> [note]');
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
    const replied = ctx.message?.reply_to_message?.from?.id;
    const to = named
      ? await this.receiver(ctx, rest[0])
      : replied
        ? String(replied)
        : null;
    if (!to) {
      return ctx.reply(
        'Who receives it? Reply to their message, @mention them, or give their id.'
      );
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
          `#${event.id.slice(0, 8)} · ${mine ? this.describe(mine) : 'recorded'}${delegated ? ' (signed by the holon on your behalf)' : ''}`
      );
    } catch (err) {
      return ctx.reply(`Could not record the give: ${err?.message || err}`);
    }
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
      return ctx.reply('Usage: /fundmint <amount> [L|EUR|…] [what it is]');
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
            ? '\nThis holon is not founded yet: the signer set is provisional.'
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

  async list(ctx) {
    const holon = getholonId(ctx);
    try {
      const { folded, actors, policy } = await this.context(holon);
      if (!folded.claims.length && !folded.transfers.length)
        return ctx.reply(
          'No claims on this fund yet. Raise one with /fundclaim <amount>, or pass access on with /fundgive.'
        );
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
      return ctx.replyWithHTML([head, ...lines].join('\n'));
    } catch (err) {
      return ctx.reply(`Could not read the claims: ${err?.message || err}`);
    }
  }

  async find(holon, prefix) {
    const { folded } = await this.context(holon);
    const p = String(prefix || '')
      .replace(/^#/, '')
      .toLowerCase();
    if (!p) return { error: 'Which claim? Give its id (see /fundclaims).' };
    const hits = folded.claims.filter(c => c.id.startsWith(p));
    if (!hits.length) return { error: `No claim starts with ${p}.` };
    if (hits.length > 1)
      return {
        error: `${hits.length} claims start with ${p}; give more of the id.`,
      };
    return { claim: hits[0] };
  }

  async verdict(ctx, verdict) {
    const holon = getholonId(ctx);
    const userId = String(getUserId(ctx));
    const args = (ctx.message?.text || '').split(/\s+/).slice(1);
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
    if (what === 'quorum') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0)
        return ctx.reply('Usage: /fundpolicy quorum <0-9>');
      next.quorum = n;
    } else if (what === 'conflict') {
      if (value !== 'earliest' && value !== 'quorum')
        return ctx.reply('Usage: /fundpolicy conflict earliest|quorum');
      next.conflict = value;
    } else if (what === 'pin') {
      if (!value) return ctx.reply('Usage: /fundpolicy pin <partner holon id>');
      let doc = null;
      try {
        doc = await this.db.get(String(value), 'settings', String(value));
      } catch {
        doc = null;
      }
      const key = String(doc?.holonPubkey || '');
      if (!HEX64.test(key))
        return ctx.reply(
          `${value} has not published a holon key, so there is nothing to pin.`
        );
      next.partners = { ...next.partners, [String(value)]: key.toLowerCase() };
    } else if (what === 'unpin') {
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
          : `Recorded, but your key is not an admin of this holon, so the rule does not change.`
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
      const tokens = readBundleTokens(
        await loadBundleRecord(db, h).catch(() => null)
      );
      const received = await this.potReceipts(pot, tokens).catch(() => null);
      if (!received) continue;
      const cut = await cutRights(db, h, {
        previous: ctx.latest?.table ?? null,
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
