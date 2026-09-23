// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Votes over the signed votes log (`governance_votes`, kind 1808 — see
// @holons/core/governance votes and @holons/core/protocol).
//
//   /vote <proposal> yes|no|abstain [why]   cast a ballot on a proposal
//                                           (a `type:'proposal'` quest, by
//                                           id prefix or title words), signed
//                                           with the member's own derived key
//   /votes [proposal]                       the tally of every open proposal,
//                                           or one proposal's ballots
//
// One counted vote per party per proposal — the newest; every reader folds
// the same log the same way, and the count (weights, delegations) is core's
// `tallyBallots`. The bot adds nothing a kiosk would not derive.

import { getholonId, getUserId } from './utilities.js';
import { createIdentityContext } from '@holons/core/holosphere';
import {
  DELEGATIONS_LENS,
  GOVERNANCE_VOTES_LENS,
  VOTE_CHOICES,
  buildVote,
  foldDelegations,
  foldVotesFromLenses,
  tallyBallots,
} from '@holons/core/governance';
import {
  appendAsMember,
  memberNames,
  readLogContext,
} from './protocolContext.js';

const CHOICE_MARK = { yes: '👍', no: '👎', abstain: '🤷' };
const STATUS_MARK = {
  counted: '',
  superseded: '(replaced)',
  pending: '⏳ awaiting attestation',
  disputed: '⚠️ disputed',
  rejected: '✖️ not counted',
};

const escapeHtml = s =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default class GovernanceVotes {
  /**
   * @param {import('telegraf').Telegraf|null} bot
   * @param {object} db HoloSphere (the holon key)
   * @param {object} [options]
   * @param {string} [options.derivationSecret]
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
    if (bot) {
      bot.command('vote', ctx => this.vote(ctx));
      bot.command('votes', ctx => this.list(ctx));
    }
  }

  // ---------------------------------------------------------------- fold

  /** The folded ballots plus what the tally needs: the roster and delegations. */
  async context(holon) {
    const h = String(holon);
    const input = await readLogContext(this.db, h, GOVERNANCE_VOTES_LENS, {
      secret: this.secret,
    });
    const ctx = foldVotesFromLenses(input);
    let delegations = {};
    try {
      delegations = foldDelegations(
        (await this.db.getAll(h, DELEGATIONS_LENS)) || []
      );
    } catch {
      delegations = {};
    }
    const memberIds = input.users
      .map(u => (u?.id === undefined || u?.id === null ? '' : String(u.id)))
      .filter(Boolean);
    return { ...ctx, delegations, memberIds };
  }

  tally(fold, proposal) {
    return tallyBallots(fold.folded.ballots[proposal] || {}, fold.memberIds, {
      delegations: fold.delegations,
    });
  }

  /** The holon's proposals: `type:'proposal'` quests, undeleted. */
  async proposals(holon) {
    let quests = [];
    try {
      quests = (await this.db.getAll(String(holon), 'quests')) || [];
    } catch {
      quests = [];
    }
    return quests.filter(q => q && q.type === 'proposal' && !q._deleted);
  }

  /** One proposal by id prefix or title words. */
  async find(holon, words) {
    const needle = String(words.join(' ') || '')
      .trim()
      .toLowerCase();
    if (!needle)
      return {
        error:
          'Which proposal? Give its id or a few words of its title (see /votes).',
      };
    const all = await this.proposals(holon);
    const byId = all.filter(q =>
      String(q.id).toLowerCase().startsWith(needle.replace(/^#/, ''))
    );
    if (byId.length === 1) return { proposal: byId[0] };
    const byTitle = all.filter(q =>
      String(q.title || '')
        .toLowerCase()
        .includes(needle)
    );
    if (byTitle.length === 1) return { proposal: byTitle[0] };
    const hits = byId.length ? byId : byTitle;
    if (!hits.length)
      return { error: `No proposal matches “${words.join(' ')}”.` };
    return {
      error:
        `${hits.length} proposals match; be more specific:\n` +
        hits
          .slice(0, 6)
          .map(q => `· ${String(q.id).slice(0, 8)} ${q.title || ''}`)
          .join('\n'),
    };
  }

  // ---------------------------------------------------------------- commands

  async vote(ctx) {
    const holon = getholonId(ctx);
    const userId = String(getUserId(ctx));
    const args = (ctx.message?.text || '').split(/\s+/).slice(1);
    const at = args.findIndex(a => VOTE_CHOICES.includes(a.toLowerCase()));
    if (at < 1)
      return ctx.reply('Usage: /vote <proposal> yes|no|abstain [why]');
    const choice = args[at].toLowerCase();
    const memo = args
      .slice(at + 1)
      .join(' ')
      .trim();
    const { proposal, error } = await this.find(holon, args.slice(0, at));
    if (error) return ctx.reply(error);
    const delegated = !this.identity.memberSigner(userId);
    const appendable = buildVote({
      proposal: String(proposal.id),
      choice,
      party: userId,
      memo: memo || undefined,
      ...(delegated ? { onBehalfOf: userId } : {}),
    });
    try {
      const event = await appendAsMember(
        this.db,
        this.identity,
        userId,
        holon,
        GOVERNANCE_VOTES_LENS,
        appendable,
        { at: Math.floor(this.now() / 1000) }
      );
      const fold = await this.context(holon);
      const mine = fold.folded.votes.find(v => v.id === event.id);
      const t = this.tally(fold, String(proposal.id));
      return ctx.reply(
        `${CHOICE_MARK[choice]} Voted ${choice} on “${proposal.title || proposal.id}”` +
          (mine && mine.status !== 'counted'
            ? ` · ${STATUS_MARK[mine.status] || mine.status}`
            : '') +
          (delegated ? ' (signed by the holon on your behalf)' : '') +
          `\n${this.describeTally(t)}` +
          (fold.actors.source === 'bootstrap'
            ? '\nThis holon is not founded yet: the signer set is provisional.'
            : '')
      );
    } catch (err) {
      return ctx.reply(`Could not record the vote: ${err?.message || err}`);
    }
  }

  describeTally(t) {
    return `Yes ${t.yes} · No ${t.no} · Abstain ${t.abstain} · of ${t.total} — ${t.passed ? 'passing' : 'not passing'}`;
  }

  async list(ctx) {
    const holon = getholonId(ctx);
    const args = (ctx.message?.text || '').split(/\s+/).slice(1);
    try {
      const fold = await this.context(holon);
      const provisional =
        fold.actors.source === 'bootstrap'
          ? ' · <i>provisional signer set</i>'
          : '';
      if (args.length) {
        const { proposal, error } = await this.find(holon, args);
        if (error) return ctx.reply(error);
        const id = String(proposal.id);
        const names = await memberNames(this.db, holon);
        const votes = fold.folded.votes.filter(
          v => v.proposal === id && v.status !== 'superseded'
        );
        const lines = votes.slice(-25).map(v => {
          const who = names.get(v.party) || v.party;
          const mark = STATUS_MARK[v.status] ? ` ${STATUS_MARK[v.status]}` : '';
          return `${CHOICE_MARK[v.choice]} <b>${escapeHtml(who)}</b>${v.memo ? ` — ${escapeHtml(v.memo)}` : ''}${mark}${v.origin ? ` <i>via ${escapeHtml(v.origin)}</i>` : ''}`;
        });
        return ctx.replyWithHTML(
          [
            `<b>${escapeHtml(proposal.title || id)}</b>${provisional}`,
            this.describeTally(this.tally(fold, id)),
            ...(lines.length ? lines : ['No ballots yet.']),
          ].join('\n')
        );
      }
      const open = (await this.proposals(holon)).filter(
        q => q.status !== 'executed' && q.status !== 'completed'
      );
      if (!open.length)
        return ctx.reply(
          'No open proposals. Create one as a proposal-type quest, then /vote on it.'
        );
      const lines = open.slice(0, 20).map(q => {
        const t = this.tally(fold, String(q.id));
        return `#${String(q.id).slice(0, 8)} <b>${escapeHtml(q.title || q.id)}</b>\n   ${this.describeTally(t)}`;
      });
      return ctx.replyWithHTML(
        [
          `<b>Proposals</b> · quorum ${fold.policy.quorum}${provisional}`,
          ...lines,
        ].join('\n')
      );
    } catch (err) {
      return ctx.reply(`Could not read the votes: ${err?.message || err}`);
    }
  }
}
