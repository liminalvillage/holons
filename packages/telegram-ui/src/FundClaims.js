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
//   /fundclaims                         the holon's claims, judged: approved,
//                                       pending, disputed, over, settled …
//   /fundattest <id> · /funddispute <id> [reason]   an attester's word
//   /fundpaid <id> [amount]             an attester records the payout
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
import {
  FLOW_CLAIMS_LENS,
  buildClaim,
  buildClaimVerdict,
  buildPayout,
  foldClaimsFromLenses,
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
  memberNames,
  readLogContext,
} from './protocolContext.js';

const HEX64 = /^[0-9a-f]{64}$/i;

const UNIT_RE = /^[A-Za-z]{3}$/;
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
      bot.command('fundclaims', ctx => this.list(ctx));
      bot.command('fundattest', ctx => this.verdict(ctx, 'attest'));
      bot.command('funddispute', ctx => this.verdict(ctx, 'dispute'));
      bot.command('fundpaid', ctx => this.payout(ctx));
      bot.command('fundpolicy', ctx => this.policy(ctx));
    }
    if (options.checkpoints !== false)
      this.startCheckpoints(options.checkpointEveryMs ?? 60 * 60_000);
  }

  // ---------------------------------------------------------------- fold

  /** Everything the fold reads, plus the derived keys only the bot knows. */
  async context(holon) {
    return foldClaimsFromLenses(
      await readLogContext(this.db, holon, FLOW_CLAIMS_LENS, {
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
      if (!folded.claims.length)
        return ctx.reply(
          'No claims on this fund yet. Raise one with /fundclaim <amount>.'
        );
      const names = await this.names(holon);
      const lines = folded.claims.slice(-25).map(c => {
        const who = names.get(c.party) || c.party;
        return `#${c.id.slice(0, 8)} <b>${escapeHtml(who)}</b> ${c.amount} ${c.unit}${c.memo ? ` — ${escapeHtml(c.memo)}` : ''}\n   ${this.describe(c)}`;
      });
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

  names(holon) {
    return memberNames(this.db, holon);
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
    const run = () =>
      this.checkpointClosedEpoch().catch(e =>
        console.warn('[fundclaims] checkpoint failed:', e?.message)
      );
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
}
