// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Artisan fork in a project's chat — the three rules a node sets for
// itself, and the two words a member can say about their own seat.
//
//   /claimproject <holon>_<code>       this group is the project the code names:
//                                      the project's split and credit codes move
//                                      onto the chat, the holon that seats the
//                                      project (its fund, or the Pot) seats the
//                                      chat in its place (chat admins only)
//   /claimcredit <code>                 the seat the importer held for you is yours
//   /wallet <0x…>                       where the Pot pays you (your own record)
//   /split                              the buckets the contributors share is divided by
//   /split set <bucket> <percent> …     change the percents (admins; refused when locked)
//   /needs on|off [why]                 flag yourself in need (attested like a claim)
//   /needsattest <id> · /needsdispute <id> [why]
//   /exit [yes]                         retire your seat: collect what the table
//                                      owes, take no new income from the next moon
//   /pot <pot holon>                    the Pot above, and your rows in its table
//
// Every rule lives in @holons/core/flows; this file parses, calls and replies.

import { Markup } from 'telegraf';
import { createHash } from 'node:crypto';
import { createIdentityContext } from '@holons/core/holosphere';
import {
  FLOW_CLAIMS_LENS,
  FLOW_EXITS_LENS,
  FLOW_MINTS_LENS,
  FLOW_NEEDS_LENS,
  buildExit,
  buildNeeds,
  buildStandingVerdict,
  foldStandingFromLenses,
  loadAllocationInputs,
  loadPotRecord,
  loadRights,
  parseSeatClaim,
  readAllocationBuckets,
  readAllocationClaimWindow,
  readAllocationCodes,
  readPayoutAddress,
  resourcesOf,
  rightsRow,
  saveAllocationAliases,
  saveAllocationCodes,
  saveAllocationConfig,
  savePayoutAddress,
  scoreAllocationMembers,
} from '@holons/core/flows';
import {
  getFederationSnapshot,
  setFederationPartner,
} from '@holons/core/federation';
import { lensContext } from '@holons/core/protocol';
import {
  appendAsMember,
  partyNames,
  readLogContext,
} from './protocolContext.js';
import { flowsLine } from './flowsLink.js';
import { getUserId, getholonId, isAdmin } from './utilities.js';

const escapeHtml = s =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const TOKEN_RE = /^((?:holon|hub)_[a-z0-9]{12,32})_([a-z0-9]{6,32})$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const STATUS_MARK = {
  accepted: '✅',
  pending: '⏳',
  disputed: '⛔',
  conflict: '⚠️',
  rejected: '✖️',
};

/** sha256 of a claim code, the way the importer stored it. */
export function codeHash(code) {
  return createHash('sha256')
    .update(`holons-claim:${String(code).trim()}`)
    .digest('hex');
}

const text = ctx => String(ctx.message?.text || '');
const argsOf = ctx => text(ctx).split(/\s+/).slice(1);

export default class ArtisanFork {
  constructor(bot, db, options = {}) {
    this.bot = bot;
    this.db = db;
    this.now = options.now ?? (() => Date.now());
    this.secret = (
      options.derivationSecret ??
      process.env.NOSTR_DERIVATION_SECRET ??
      ''
    ).trim();
    this.identity = createIdentityContext({ derivationSecret: this.secret });
    if (bot) {
      bot.command('claimproject', ctx => this.claimProject(ctx));
      bot.command('claimcredit', ctx => this.claimCredit(ctx));
      bot.command('wallet', ctx => this.wallet(ctx));
      bot.command('split', ctx => this.split(ctx));
      bot.command('needs', ctx => this.needs(ctx));
      bot.command('needsattest', ctx => this.needsVerdict(ctx, 'attest'));
      bot.command('needsdispute', ctx => this.needsVerdict(ctx, 'dispute'));
      bot.command('exit', ctx => this.exit(ctx));
      bot.command('pot', ctx => this.pot(ctx));
      // The deep link a pinned post carries: `?startgroup=artisan_<holon>_<code>`
      // lands as `/start artisan_…` in the group.
      bot.hears(/^\/start(?:@\w+)?\s+artisan_(\S+)/, ctx =>
        this.claimProject(ctx, ctx.match[1])
      );
      bot.action(/^artisan:exit:(-?\d+)$/, ctx => this.exitConfirmed(ctx));
    }
  }

  // ---------------------------------------------------------------- reads

  /** Both standing logs folded with the keys this bot knows. */
  async standing(holon) {
    const exits = await readLogContext(this.db, holon, FLOW_EXITS_LENS, {
      secret: this.secret,
    });
    const needs = await readLogContext(this.db, holon, FLOW_NEEDS_LENS, {
      secret: this.secret,
    });
    return foldStandingFromLenses({
      ...exits,
      exits: exits.entries,
      needs: needs.entries,
      exitImports: exits.imports,
      needsImports: needs.imports,
    });
  }

  /** The split as every board reads it, standing applied. */
  inputs(holon) {
    return loadAllocationInputs(this.db, holon, {
      scoreOf: id => scoreAllocationMembers(this.db, id),
      standingOf: id => this.standing(id).then(c => c.standing),
      resourcesOf: resourcesOf(this.db),
    });
  }

  appendAs(userId, holon, appendable, lens) {
    return appendAsMember(
      this.db,
      this.identity,
      userId,
      holon,
      lens,
      appendable,
      { at: Math.floor(this.now() / 1000) }
    );
  }

  names(holon, ids) {
    return partyNames(this.db, holon, ids);
  }

  settings(holon) {
    return this.db
      .get(String(holon), 'settings', String(holon))
      .catch(() => null);
  }

  // ---------------------------------------------------------------- claiming

  /**
   * /claimproject <holon>_<code> — this chat is the project the code names.
   * The code is kept either on the project's own holon (a seat claim: the
   * project is seated straight in a Pot, which the claim names) or on the
   * fund that seats it. The project's split and credit codes move onto the
   * chat; the holon that seats the project aliases it to the chat, and the
   * chat is federated with it and with every fund the project was linked to.
   */
  async claimProject(ctx, tokenArg) {
    const chat = getholonId(ctx);
    const token = String(tokenArg ?? argsOf(ctx)[0] ?? '').trim();
    const m = TOKEN_RE.exec(token);
    if (!m)
      return ctx.reply(
        'Usage: /claimproject <holon>_<code> — the link in the pinned post carries it.'
      );
    if (!/^-\d+$/.test(chat))
      return ctx.reply(
        'Claim a project from its group, not in a private chat.'
      );
    if (!(await isAdmin(ctx)))
      return ctx.reply(
        'Only an admin of this group can claim a project for it.'
      );
    const [, holder, code] = m;
    const hash = codeHash(code);
    const holderDoc = await this.settings(holder);
    if (!holderDoc)
      return ctx.reply(
        `${holder} cannot be read from here yet — try again in a moment.`
      );
    const target = readAllocationCodes(holderDoc)[hash];
    if (!target)
      return ctx.reply('That code is not open: unknown, or already claimed.');
    // A seat claim sits on the project itself and names where its seat is;
    // otherwise the code sits on the fund and names the project.
    const seatedIn = parseSeatClaim(target);
    const project = seatedIn ? holder : target;
    const fund = seatedIn ?? holder;
    const fundDoc = seatedIn ? await this.settings(fund) : holderDoc;
    if (!fundDoc)
      return ctx.reply(
        `${fund} cannot be read from here yet — try again in a moment.`
      );
    // The claim window is kept where the seat is; past it the seat is retired.
    const until = readAllocationClaimWindow(fundDoc)?.until;
    if (until && this.now() >= until)
      return ctx.reply(
        `The claim window closed on ${new Date(until).toISOString().slice(0, 10)}: this seat was shared among those who claimed theirs.`
      );
    const projectDoc = seatedIn ? holderDoc : await this.settings(project);
    if (!projectDoc)
      return ctx.reply(
        `The project ${project} cannot be read from here yet — try again in a moment.`
      );
    const buckets = readAllocationBuckets(projectDoc);
    const codes = readAllocationCodes(projectDoc);
    delete codes[hash]; // the seat claim itself is spent, not carried over
    const name = ctx.chat?.title || projectDoc.name || chat;
    let linked = 0;
    try {
      await saveAllocationConfig(
        this.db,
        chat,
        { interiorPercent: 100, interiorMode: 'custom', nzones: 0 },
        undefined,
        undefined,
        undefined,
        { buckets, codes, force: true }
      );
      await saveAllocationAliases(this.db, fund, { [project]: chat });
      await saveAllocationCodes(this.db, holder, { [hash]: null });
      // The chat stands where the project stood: with the holon that seats
      // it, and with every fund the project was federated to.
      const partners = await getFederationSnapshot(this.db, project)
        .then(s => s.federated)
        .catch(() => []);
      for (const partner of new Set([fund, ...partners])) {
        if (partner === chat || partner === project) continue;
        const done = await setFederationPartner(this.db, partner, chat, {
          partnerName: name,
          inbound: [],
          outbound: [],
        }).catch(() => false);
        if (done && partner !== fund) linked++;
        // A fund that placed the project on a zone pays the chat in its place.
        if (partner !== fund)
          await saveAllocationAliases(this.db, partner, {
            [project]: chat,
          }).catch(() => {});
      }
    } catch (err) {
      return ctx.reply(`Could not claim the project: ${err?.message || err}`);
    }
    const seats = Object.keys(
      buckets.find(b => b.mode === 'custom')?.shares ?? {}
    ).length;
    const open = Object.keys(codes).length;
    return ctx.replyWithHTML(
      [
        `<b>${escapeHtml(name)}</b> is now <b>${escapeHtml(projectDoc.name || project)}</b> in ${seatedIn ? '' : 'fund '}${escapeHtml(fundDoc.name || fund)}.`,
        ...(linked
          ? [
              `Linked to ${linked} fund${linked === 1 ? '' : 's'} it was tied to.`,
            ]
          : []),
        `${seats} seat${seats === 1 ? '' : 's'} carried over, ${open} waiting to be claimed.`,
        '',
        await this.rulesText(chat),
        '',
        'Members: /claimcredit &lt;your code&gt; takes your seat; /wallet &lt;0x…&gt; says where the Pot pays you.',
      ].join('\n') + flowsLine('Its flows', 'h', chat)
    );
  }

  /** /claimcredit <code> — the placeholder the code names becomes the caller. */
  async claimCredit(ctx) {
    const chat = getholonId(ctx);
    const userId = String(getUserId(ctx));
    const code = String(argsOf(ctx)[0] ?? '').trim();
    if (!code)
      return ctx.reply(
        'Usage: /claimcredit <code> — the code you were given for this project.'
      );
    const doc = await this.settings(chat);
    const placeholder = readAllocationCodes(doc)[codeHash(code)];
    if (!placeholder)
      return ctx.reply(
        'That code is not open here: unknown, already claimed, or for another project.'
      );
    try {
      await saveAllocationAliases(this.db, chat, { [placeholder]: userId });
      await saveAllocationCodes(this.db, chat, { [codeHash(code)]: null });
    } catch (err) {
      return ctx.reply(`Could not claim the seat: ${err?.message || err}`);
    }
    const legacy = readAllocationBuckets(doc).find(b => b.mode === 'custom');
    const owed = legacy?.shares?.[placeholder];
    const total = Object.values(legacy?.shares ?? {}).reduce(
      (s, v) => s + v,
      0
    );
    const share =
      owed && total
        ? ` (${Math.round((owed / total) * 1000) / 10}% of the legacy credit)`
        : '';
    const wallet = readPayoutAddress(await this.settings(userId));
    return ctx.reply(
      `Your seat is yours: ${owed != null ? `${owed} owed` : placeholder}${share}.\n` +
        (wallet
          ? `The Pot pays you at ${wallet}.`
          : 'Tell the Pot where to pay you: /wallet <0x…>') +
        '\nHold, and your share grows as the pot fills; /exit collects what you are owed and retires it.' +
        flowsLine('Your flows', 'p', userId)
    );
  }

  /** /wallet <0x…> — the caller's payout address, on their own record. */
  async wallet(ctx) {
    const userId = String(getUserId(ctx));
    const address = String(argsOf(ctx)[0] ?? '').trim();
    if (!address) {
      const current = readPayoutAddress(await this.settings(userId));
      return ctx.reply(
        (current
          ? `The Pot pays you at ${current}. Change it: /wallet <0x…>`
          : 'No wallet yet. Set one: /wallet <0x…>') +
          flowsLine('Your flows', 'p', userId)
      );
    }
    if (!ADDRESS_RE.test(address))
      return ctx.reply('That is not a 0x address.');
    try {
      await savePayoutAddress(this.db, userId, address);
      return ctx.reply(
        `Wallet set: ${address.toLowerCase()}. It applies from the next new moon.` +
          flowsLine('Your flows', 'p', userId)
      );
    } catch (err) {
      return ctx.reply(`Could not set the wallet: ${err?.message || err}`);
    }
  }

  // ---------------------------------------------------------------- the split

  /** The three rules of this node, in a few lines. */
  async rulesText(holon) {
    const [mints, claims, inputs] = await Promise.all([
      readLogContext(this.db, holon, FLOW_MINTS_LENS, {
        secret: this.secret,
      }).then(b => lensContext(b).policyFor(FLOW_MINTS_LENS)),
      readLogContext(this.db, holon, FLOW_CLAIMS_LENS, {
        secret: this.secret,
      }).then(b => lensContext(b).policyFor(FLOW_CLAIMS_LENS)),
      this.inputs(holon),
    ]);
    const rule = p =>
      `${p.authors.join('/')} act, ${p.attesters.join('/')} attest, ${p.quorum} needed`;
    return [
      `<b>In</b> — ${rule(mints)} (/fundmint, /fundpolicy)`,
      `<b>Split</b> — ${this.splitLine(inputs)}`,
      `<b>Out</b> — ${rule(claims)} (/fundclaim, /fundattest, /fundpaid)`,
    ].join('\n');
  }

  splitLine(inputs) {
    if (!inputs.buckets.length)
      return `contributors ${inputs.config.interiorPercent}% by ${inputs.config.interiorMode}`;
    const total = inputs.buckets.reduce((s, b) => s + b.percent, 0) || 1;
    return (
      inputs.buckets
        .map(
          b => `${b.label || b.id} ${Math.round((b.percent / total) * 100)}%`
        )
        .join(' · ') + (inputs.genesis ? ' · 🔒 fixed at genesis' : '')
    );
  }

  /** /split — the buckets and who is in each; /split set <bucket> <percent> … */
  async split(ctx) {
    const holon = getholonId(ctx);
    const userId = String(getUserId(ctx));
    const args = argsOf(ctx);
    let inputs;
    try {
      inputs = await this.inputs(holon);
    } catch (err) {
      return ctx.reply(`Could not read the split: ${err?.message || err}`);
    }
    if (args[0] !== 'set') {
      if (!inputs.configured)
        return ctx.reply(
          'No split here yet. An admin sets one from the kiosk, the dashboard, or MCP allocation_save.'
        );
      const ids = inputs.members.map(m => m.id);
      const names = await this.names(holon, ids);
      const name = id => escapeHtml(names.get(id) || id);
      const lines = [`<b>Split</b> — ${this.splitLine(inputs)}`];
      for (const b of inputs.buckets) {
        const rows = Object.entries(inputs.byBucket[b.id] ?? {}).sort(
          (x, y) => y[1] - x[1]
        );
        lines.push(
          `<b>${escapeHtml(b.label || b.id)}</b> (${b.mode})${rows.length ? '' : ' — nobody in it yet'}` +
            (rows.length
              ? ': ' +
                rows
                  .map(
                    ([id, pct]) => `${name(id)} ${Math.round(pct * 10) / 10}%`
                  )
                  .join(', ')
              : '')
        );
      }
      if (!inputs.buckets.length)
        lines.push(
          inputs.members
            .map(m => `${name(m.id)} ${Math.round(m.percentage * 10) / 10}%`)
            .join(', ') || 'nobody seated'
        );
      const exited = Object.keys(inputs.standing?.exited ?? {});
      if (exited.length) lines.push(`Exited: ${exited.map(name).join(', ')}`);
      lines.push(
        '',
        'Admins change the percents: /split set legacy 40 needs 30 impact 30'
      );
      return ctx.replyWithHTML(
        lines.join('\n') + flowsLine('As a diagram', 'h', holon)
      );
    }
    if (!(await isAdmin(ctx)))
      return ctx.reply('Only an admin of this group can change the split.');
    const pairs = args.slice(1);
    if (!pairs.length || pairs.length % 2)
      return ctx.reply(
        'Usage: /split set <bucket> <percent> [<bucket> <percent> …]'
      );
    const next = inputs.buckets.map(b => ({ ...b }));
    for (let i = 0; i < pairs.length; i += 2) {
      const id = pairs[i].toLowerCase();
      const percent = Number(pairs[i + 1]);
      if (!(percent >= 0))
        return ctx.reply(`${pairs[i + 1]} is not a percent.`);
      const found = next.find(b => b.id === id);
      if (found) found.percent = percent;
      else {
        const mode =
          id === 'legacy'
            ? 'custom'
            : id === 'needs'
              ? 'needs'
              : id === 'impact'
                ? 'equation'
                : id === 'equal'
                  ? 'equal'
                  : null;
        if (!mode)
          return ctx.reply(
            `Unknown bucket "${id}": legacy, needs, impact or equal.`
          );
        next.push({
          id,
          percent,
          mode,
          ...(mode === 'custom' ? { shares: {} } : {}),
        });
      }
    }
    try {
      await saveAllocationConfig(
        this.db,
        holon,
        {},
        undefined,
        undefined,
        undefined,
        { buckets: next }
      );
    } catch (err) {
      return ctx.reply(
        /locked/.test(String(err?.message))
          ? 'This split is fixed at genesis; the percents cannot move.'
          : `Could not set the split: ${err?.message || err}`
      );
    }
    void userId;
    return ctx.reply(
      `Split set: ${next.map(b => `${b.id} ${b.percent}`).join(' · ')}.`
    );
  }

  // ---------------------------------------------------------------- standing

  describe(e) {
    const mark = STATUS_MARK[e.status] || '';
    const why = e.status === 'accepted' ? '' : e.reason ? ` (${e.reason})` : '';
    return `${mark} ${e.status}${why}`;
  }

  /** /needs on|off [why] — flag yourself in need, signed as you. */
  async needs(ctx) {
    const holon = getholonId(ctx);
    const userId = String(getUserId(ctx));
    const [word, ...rest] = argsOf(ctx);
    if (word !== 'on' && word !== 'off') {
      try {
        const { standing, needs } = await this.standing(holon);
        const flagged = Object.keys(standing.inNeed);
        const names = await this.names(holon, flagged);
        const mine = needs.entries.filter(e => e.party === userId).slice(-1)[0];
        return ctx.reply(
          (flagged.length
            ? `In need: ${flagged.map(id => names.get(id) || id).join(', ')}.`
            : 'Nobody is flagged in need.') +
            (mine
              ? `\nYour last word: ${mine.on ? 'on' : 'off'} · ${this.describe(mine)}`
              : '') +
            '\n/needs on [why] · /needs off'
        );
      } catch (err) {
        return ctx.reply(`Could not read the flags: ${err?.message || err}`);
      }
    }
    const delegated = !this.identity.memberSigner(userId);
    const appendable = buildNeeds({
      party: userId,
      on: word === 'on',
      memo: rest.join(' ').trim() || undefined,
      at: this.now(),
      ...(delegated ? { onBehalfOf: userId } : {}),
    });
    try {
      const event = await this.appendAs(
        userId,
        holon,
        appendable,
        FLOW_NEEDS_LENS
      );
      const { needs } = await this.standing(holon);
      const mine = needs.entries.find(e => e.id === event.id);
      return ctx.reply(
        `Flag recorded: ${word}. #${event.id.slice(0, 8)} · ${mine ? this.describe(mine) : 'recorded'}` +
          (mine?.status === 'pending'
            ? '\nAn attester confirms it with /needsattest ' +
              event.id.slice(0, 8)
            : '')
      );
    } catch (err) {
      return ctx.reply(`Could not record the flag: ${err?.message || err}`);
    }
  }

  /** /needsattest <id> · /needsdispute <id> [why] — an attester's word on a flag. */
  async needsVerdict(ctx, verdict) {
    const holon = getholonId(ctx);
    const userId = String(getUserId(ctx));
    const [prefix, ...rest] = argsOf(ctx);
    if (!prefix)
      return ctx.reply(
        `Usage: /needs${verdict} <id>${verdict === 'dispute' ? ' [why]' : ''}`
      );
    let target;
    try {
      const { needs } = await this.standing(holon);
      const hits = needs.entries.filter(e => e.id.startsWith(prefix));
      if (hits.length !== 1)
        return ctx.reply(
          hits.length
            ? 'More than one flag starts like that; give more of the id.'
            : 'No such flag.'
        );
      target = hits[0];
    } catch (err) {
      return ctx.reply(`Could not read the flags: ${err?.message || err}`);
    }
    try {
      const event = await this.appendAs(
        userId,
        holon,
        buildStandingVerdict(
          target.id,
          verdict,
          rest.join(' ').trim() || undefined
        ),
        FLOW_NEEDS_LENS
      );
      const { needs } = await this.standing(holon);
      const after = needs.entries.find(e => e.id === target.id);
      return ctx.reply(
        `${verdict === 'attest' ? 'Attested' : 'Disputed'} #${target.id.slice(0, 8)} (#${event.id.slice(0, 8)}) · ${after ? this.describe(after) : ''}`
      );
    } catch (err) {
      return ctx.reply(`Could not record the verdict: ${err?.message || err}`);
    }
  }

  /** /exit [yes] — retire the caller's seat, after a confirmation. */
  async exit(ctx) {
    const holon = getholonId(ctx);
    const userId = String(getUserId(ctx));
    if (argsOf(ctx)[0] === 'yes') return this.recordExit(ctx, holon, userId);
    try {
      const { standing } = await this.standing(holon);
      if (standing.exited[userId])
        return ctx.reply('You have already exited this node.');
    } catch {
      // Read failed; the fold will say.
    }
    return ctx.reply(
      'Exit retires your seat here for good: you collect what the table already owes you, and from the next new moon you take no part in new income. Hold instead, and your share grows as the pot fills.',
      Markup.inlineKeyboard([
        [Markup.button.callback('Yes, exit', `artisan:exit:${userId}`)],
      ])
    );
  }

  async exitConfirmed(ctx) {
    const who = String(ctx.match?.[1] ?? '');
    const userId = String(getUserId(ctx));
    if (who !== userId) return ctx.answerCbQuery?.('That button is not yours.');
    await ctx.answerCbQuery?.().catch?.(() => {});
    return this.recordExit(ctx, getholonId(ctx), userId);
  }

  async recordExit(ctx, holon, userId) {
    const delegated = !this.identity.memberSigner(userId);
    const appendable = buildExit({
      party: userId,
      at: this.now(),
      ...(delegated ? { onBehalfOf: userId } : {}),
    });
    try {
      const event = await this.appendAs(
        userId,
        holon,
        appendable,
        FLOW_EXITS_LENS
      );
      const { exits } = await this.standing(holon);
      const mine = exits.entries.find(e => e.id === event.id);
      return ctx.reply(
        `Exit recorded. #${event.id.slice(0, 8)} · ${mine ? this.describe(mine) : 'recorded'}\n` +
          'Your seat retires at the next new moon; what the table owes you stays collectable.'
      );
    } catch (err) {
      return ctx.reply(`Could not record the exit: ${err?.message || err}`);
    }
  }

  // ---------------------------------------------------------------- the Pot

  /** /pot <pot holon> — the Pot above and the caller's rows in its latest table. */
  async pot(ctx) {
    const userId = String(getUserId(ctx));
    const holon = String(argsOf(ctx)[0] ?? getholonId(ctx)).trim();
    try {
      const pot = await loadPotRecord(this.db, holon);
      if (!pot)
        return ctx.reply(
          `${holon} has no Pot recorded. Usage: /pot <pot holon>`
        );
      const rights = await loadRights(this.db, holon);
      const head = [
        `<b>Pot</b> ${pot.address} (chain ${pot.chainId})`,
        `owner ${pot.owner ? escapeHtml(pot.owner) : 'not recorded'}${pot.treasury ? ` · treasury ${escapeHtml(pot.treasury.address)}` : ''}`,
      ];
      const until = readAllocationClaimWindow(
        await this.settings(holon)
      )?.until;
      if (until)
        head.push(
          `Claims ${this.now() >= until ? 'closed' : 'open until'} ${new Date(until).toISOString().slice(0, 10)}.`
        );
      const links =
        flowsLine('The map', 'h', holon) + flowsLine('Your flows', 'p', userId);
      if (!rights.latest)
        return ctx.replyWithHTML(
          [...head, 'No table committed yet.'].join('\n') + links
        );
      const table = rights.latest.table;
      const tokens = [...new Set(table.rows.map(r => r.token))];
      const symbol = t =>
        pot.tokens.find(x => x.address.toLowerCase() === t)?.symbol ||
        t.slice(0, 10);
      const mine = tokens.map(t => rightsRow(table, userId, t)).filter(Boolean);
      head.push(`Lunation ${table.epoch}: ${table.rows.length} rows.`);
      head.push(
        mine.length
          ? mine
              .map(
                r =>
                  `Your row in ${symbol(r.token)}: ${r.cumulative.toString()} all time, paid at ${r.to}`
              )
              .join('\n')
          : 'No row for you in this table yet.'
      );
      return ctx.replyWithHTML(head.join('\n') + links);
    } catch (err) {
      return ctx.reply(`Could not read the Pot: ${err?.message || err}`);
    }
  }
}
