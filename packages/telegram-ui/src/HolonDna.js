// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// A holon's DNA, in Telegram.
//
//   /dna            in a group: the group's front page — its name, what it
//                   is for, and one button per gene (a tap shows the gene).
//                   In a private chat: /dna <holon id>.
//   /apply <holon>  in a private chat: the walk, straight away.
//
// The walk (`/start onboard_<holon>` or `onboard_<holon>_<hash16>`, the
// button under the front page): one gene per message, each with "I've read
// this" or "I agree to …"; then a review with an explicit agreement, and
// Send. Send asks core to sign the 9021 (`applyToHolon`, through
// JoinRequests.askFromTelegram) with the key the person's Telegram id
// derives, carrying the hash of the DNA they agreed to.
//
// Everything about WHAT the DNA says and where a person stands comes from
// core (`readHolonFront`, `walkProgress`): this file only lays it out as
// messages and keeps the walk's state in the Telegraf session, per holon.
//
// A link that carries a hash (`_<hash16>`) skips the reading, never the
// agreement: the review is always shown and the person still taps "I agree".
// A hash that is not the DNA's current one is ignored: the person walks it.
//
// Callback grammar (a button is capped at 64 bytes):
//   dnag:<holon>:<geneIdx>       show one gene from the front page
//   dnas:<holon>                 start the walk
//   dnaw:<stepIdx>:<r|a|back|c|s>:<hash8>
//        r / a   "I've read this" / "I agree" on a step (the step's gene
//                hash, first 8 hex, proves the button is for the gene as it
//                is now); back  the previous step; c  tick the agreement on
//                the review (stepIdx = the number of steps; hash8 = the
//                DNA's); s  send.

import { Markup } from 'telegraf';
import i18next from 'i18next';
import {
  acknowledgeStep,
  normalizeWalkState,
  readHolonFront,
  walkProgress,
} from '@holons/core/dna';
import { deriveTelegramNostrKey } from '@holons/core/auth';
import { isTelegramGroup } from './JoinRequests.js';

/** Telegram refuses a text over 4096 characters; leave room for the markup. */
const CHUNK = 3500;
const FRONT_TTL_MS = 30_000;
const HOLON = '-?\\d{1,20}';

/**
 * The `/start` payload of the walk's deep link: `onboard_<holon>`, or
 * `onboard_<holon>_<hash16>` carrying the first 16 hex of the DNA hash the
 * person read elsewhere (the website's handoff).
 */
export const ONBOARD_PAYLOAD = /^onboard_(-?\d{1,20})(?:_([0-9a-f]{16}))?$/;
const NO_HASH = '00000000';

const esc = s =>
  String(s ?? '').replace(
    /[&<>]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]
  );
const escAttr = s => esc(s).replace(/"/g, '&quot;');

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

const KIND_LABELS = {
  purpose: ['dnaKindPurpose', 'Purpose'],
  values: ['dnaKindValues', 'Values'],
  agreements: ['dnaKindAgreements', 'Agreements'],
  practices: ['dnaKindPractices', 'Practices'],
  roles: ['dnaKindRoles', 'Roles'],
  tools: ['dnaKindTools', 'Tools'],
  terms: ['dnaKindTerms', 'Terms'],
};

// ── Text layout ────────────────────────────────────────────────────────────

/**
 * `text` cut into pieces whose HTML-escaped length is at most `max`, at a
 * paragraph, line, sentence or word where one is near. Cut BEFORE escaping,
 * so an entity is never split.
 */
export function splitText(text, max = CHUNK) {
  const len = s => esc(s).length;
  const out = [];
  let rest = String(text ?? '').trim();
  while (rest && len(rest) > max) {
    let lo = 1;
    let hi = rest.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (len(rest.slice(0, mid)) <= max) lo = mid;
      else hi = mid - 1;
    }
    const head = rest.slice(0, lo);
    const floor = Math.floor(lo * 0.5);
    let at = -1;
    for (const sep of ['\n\n', '\n', '. ', ' ']) {
      const i = head.lastIndexOf(sep);
      if (i >= floor) {
        at = i + (sep === '. ' ? 1 : 0);
        break;
      }
    }
    if (at < 0) {
      at = lo;
      // Never cut a surrogate pair in two.
      const code = rest.charCodeAt(at - 1);
      if (code >= 0xd800 && code <= 0xdbff) at -= 1;
    }
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Blocks of HTML packed into messages, none over {@link CHUNK}. */
export function pack(blocks, max = CHUNK) {
  const out = [];
  let cur = '';
  for (const block of blocks.filter(Boolean)) {
    if (cur && cur.length + 2 + block.length > max) {
      out.push(cur);
      cur = block;
    } else cur = cur ? `${cur}\n\n${block}` : block;
  }
  if (cur) out.push(cur);
  return out;
}

const anchor = link =>
  /^https?:\/\/\S+$/i.test(link?.href ?? '')
    ? `<a href="${escAttr(link.href)}">${esc(link.label || link.href)}</a>`
    : esc(link?.label ?? '');

/** The blocks of one allele, with everything its gene hash covers. */
function alleleBlocks(a, longform) {
  const head = longform
    ? `<b>${esc(a.title)}</b>`
    : `• <b>${esc(a.title)}</b>${a.kicker ? ` — <i>${esc(a.kicker)}</i>` : ''}`;
  const body = a.body ? splitText(a.body).map(esc) : [];
  const tail = [];
  if (a.link) tail.push(anchor(a.link));
  const d = a.detail;
  const detail = d?.body ? splitText(d.body).map(esc) : [];
  const steps = (d?.steps ?? []).map((s, i) => `${i + 1}. ${esc(s)}`);
  for (const l of d?.links ?? []) tail.push(anchor(l));
  const first = [head, body[0]].filter(Boolean).join('\n');
  return [
    first,
    ...body.slice(1),
    ...detail,
    steps.join('\n'),
    tail.join('\n'),
  ];
}

/**
 * One gene as messages: title, what kind it is and whether it asks for an
 * agreement, the blurb, its links, then every allele with the whole of what
 * a reader is shown (the gene hash covers it all).
 */
export function renderGene(gene, labels) {
  const [, kindDefault] = KIND_LABELS[gene.kind] ?? [null, ''];
  const kind = labels.kind(gene.kind, kindDefault);
  const badge = gene.ack === 'agree' ? ` · ${labels.termsBadge}` : '';
  const blocks = [
    `<b>${esc(gene.title)}</b>\n<i>${esc(kind)}${esc(badge)}</i>`,
    ...(gene.blurb ? splitText(gene.blurb).map(esc) : []),
    ...(gene.links?.length ? [gene.links.map(anchor).join('\n')] : []),
  ];
  const longform = gene.layout === 'longform';
  for (const a of gene.alleles) blocks.push(...alleleBlocks(a, longform));
  if (gene.expressedIn?.length) {
    blocks.push(
      `${esc(labels.expressedIn)}: ${gene.expressedIn.map(r => esc(r.title)).join(', ')}`
    );
  }
  return pack(blocks);
}

// ── The service ────────────────────────────────────────────────────────────

export default class HolonDna {
  /**
   * @param {import('telegraf').Telegraf|null} bot
   * @param {object} db HoloSphere (enforcing reads, as the factory makes it)
   * @param {{getLanguage?: (holon: string) => Promise<string>}|null} settings
   * @param {object} [options]
   * @param {import('./JoinRequests.js').default|null} [options.joinRequests]
   *   sends the request (askFromTelegram) and continues a pending one
   * @param {string} [options.derivationSecret] to name the person looking by key
   * @param {() => number} [options.now] ms, for tests
   * @param {number} [options.catchUpMs] bound on a front read's relay catch-up
   */
  constructor(bot, db, settings = null, options = {}) {
    this.bot = bot;
    this.db = db;
    this.settings = settings;
    this.joinRequests = options.joinRequests ?? null;
    this.secret = (
      options.derivationSecret ??
      process.env.NOSTR_DERIVATION_SECRET ??
      ''
    ).trim();
    this.now = options.now ?? (() => Date.now());
    this.catchUpMs = options.catchUpMs;
    /** `<holon>:<viewer>` → { at, front }: a walk taps often, a relay catch-up is slow. */
    this.fronts = new Map();

    if (bot) {
      bot.command('dna', ctx => this.onDna(ctx));
      bot.command('apply', ctx => this.onApply(ctx));
      bot.action(new RegExp(`^dnag:(${HOLON}):(\\d{1,2})$`), ctx =>
        this.showGene(ctx)
      );
      bot.action(new RegExp(`^dnas:(${HOLON})$`), ctx => this.onStart(ctx));
      bot.action(/^dnaw:(\d{1,2}):(r|a|back|c|s):([0-9a-f]{8})$/, ctx =>
        this.onTap(ctx)
      );
    }
  }

  setJoinRequestsInstance(joinRequests) {
    this.joinRequests = joinRequests;
  }

  // ── Reading ──────────────────────────────────────────────────────────────

  async language(chat) {
    try {
      return (await this.settings?.getLanguage?.(String(chat))) || 'en';
    } catch {
      return 'en';
    }
  }

  /** The key the person's Telegram id derives: how the holon knows them. */
  viewerOf(ctx) {
    if (!this.secret || !ctx.from?.id) return '';
    try {
      return deriveTelegramNostrKey(String(ctx.from.id), this.secret).publicKey;
    } catch {
      return '';
    }
  }

  /** The front page, as this person sees it. Cached briefly unless `fresh`. */
  async front(holon, viewer, fresh = false) {
    const key = `${holon}:${viewer}`;
    const hit = this.fronts.get(key);
    if (!fresh && hit && this.now() - hit.at < FRONT_TTL_MS) return hit.front;
    const front = await readHolonFront(this.db, holon, {
      viewer,
      ...(this.catchUpMs ? { catchUpMs: this.catchUpMs } : {}),
    });
    this.fronts.set(key, { at: this.now(), front });
    return front;
  }

  /** A front, or a message that the holon could not be reached. */
  async frontOrSay(ctx, holon, language, fresh = false) {
    try {
      return await this.front(holon, this.viewerOf(ctx), fresh);
    } catch (e) {
      console.warn(`[dna] ${holon}:`, e?.message);
      await ctx.reply(
        translated(
          language,
          'dnaUnreachable',
          "Couldn't reach {{holon}}. Try again in a moment.",
          { holon }
        )
      );
      return null;
    }
  }

  labels(language, front) {
    return {
      kind: (kind, def) =>
        KIND_LABELS[kind]
          ? translated(language, KIND_LABELS[kind][0], def)
          : kind === 'custom'
            ? ''
            : def,
      termsBadge: translated(
        language,
        'dnaTermsBadge',
        "You'll be asked to agree to this"
      ),
      expressedIn: translated(language, 'dnaExpressedIn', 'Expressed in'),
      holon: front?.name ?? '',
    };
  }

  link(holon, hash16 = null) {
    const bot = this.bot?.botInfo?.username;
    return bot
      ? `https://t.me/${bot}?start=onboard_${holon}${hash16 ? `_${hash16}` : ''}`
      : null;
  }

  // ── /dna ─────────────────────────────────────────────────────────────────

  /** The holon a command names: this group, or an id given in a private chat. */
  holonOf(ctx) {
    if (ctx.chat?.type !== 'private') return String(ctx.chat?.id ?? '');
    const arg = String(ctx.message?.text ?? '')
      .trim()
      .split(/\s+/)[1];
    return new RegExp(`^${HOLON}$`).test(arg ?? '') ? arg : null;
  }

  async onDna(ctx) {
    const language = await this.language(ctx.chat?.id);
    const holon = this.holonOf(ctx);
    if (!holon) {
      await ctx.reply(
        translated(
          language,
          'dnaUsage',
          "Send /dna in a group to see what it stands for, or /dna followed by a holon's id here."
        )
      );
      return;
    }
    await this.showFront(ctx, holon, language);
  }

  /** `/apply <holon>` in a private chat is the walk; in a group it points there. */
  async onApply(ctx) {
    const language = await this.language(ctx.chat?.id);
    const holon = this.holonOf(ctx);
    if (!holon) {
      await ctx.reply(
        translated(
          language,
          'dnaUsage',
          "Send /dna in a group to see what it stands for, or /dna followed by a holon's id here."
        )
      );
      return;
    }
    await this.begin(ctx, holon);
  }

  /** The hero and the gene index: one message, a button per gene. */
  async showFront(ctx, holon, language) {
    const front = await this.frontOrSay(ctx, holon, language, true);
    if (!front) return;
    const lines = [`<b>${esc(front.name)}</b>`];
    if (front.teaser) lines.push(esc(front.teaser));
    lines.push(
      esc(
        translated(language, 'dnaPeople', '{{n}} people', { n: front.members })
      )
    );
    if (front.empty) {
      lines.push(
        `<i>${esc(translated(language, 'dnaEmpty', "{{holon}} hasn't written its DNA yet", { holon: front.name }))}</i>`
      );
    } else {
      lines.push(
        esc(
          translated(
            language,
            'dnaFooter',
            'DNA {{short}} · updated {{date}}',
            {
              short: front.dna.short ?? '',
              date: String(front.dna.updated ?? '').slice(0, 10),
            }
          )
        )
      );
    }
    const rows = front.genes.map((g, i) => [
      Markup.button.callback(
        `${g.ack === 'agree' ? '✍️ ' : ''}${g.title}`.slice(0, 60),
        `dnag:${holon}:${i}`
      ),
    ]);
    const cta = front.viewer.cta;
    const private_ = ctx.chat?.type === 'private';
    const hash16 = front.dna.hash?.slice(0, 16) ?? null;
    if (cta === 'linked') {
      lines.push(translated(language, 'dnaLinked', "You're linked"));
    } else if (cta !== 'none' && front.telegram) {
      const text =
        cta === 'continue'
          ? translated(language, 'dnaPending', 'Request sent: continue')
          : cta === 'review'
            ? translated(language, 'dnaBlocked', 'The DNA changed: review it')
            : translated(language, 'dnaApply', 'Ask to join');
      const url = private_ ? null : this.link(holon, hash16);
      if (private_) rows.push([Markup.button.callback(text, `dnas:${holon}`)]);
      else if (url) rows.push([Markup.button.url(text, url)]);
    }
    if (front.viewer.edit) {
      rows.push([
        Markup.button.url(
          translated(language, 'dnaEdit', 'Edit DNA'),
          `https://hubs.network/${encodeURIComponent(holon)}/dna?edit`
        ),
      ]);
    }
    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(rows.length ? Markup.inlineKeyboard(rows) : {}),
    });
  }

  /** A tap on a gene in the index: the whole gene, read-only. */
  async showGene(ctx) {
    const [, holon, i] = ctx.match;
    const language = await this.language(ctx.chat?.id);
    await ctx.answerCbQuery().catch(() => {});
    const front = await this.frontOrSay(ctx, holon, language);
    if (!front) return;
    const gene = front.genes[Number(i)];
    if (!gene) {
      await ctx.reply(
        translated(
          language,
          'dnaGeneGone',
          'That part is no longer there: send /dna again.'
        )
      );
      return;
    }
    for (const chunk of renderGene(gene, this.labels(language, front))) {
      await ctx.reply(chunk, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
    }
  }

  // ── The walk ─────────────────────────────────────────────────────────────

  /** The walk state of a holon, kept in the session. */
  walkState(ctx, holon) {
    ctx.session ??= {};
    ctx.session.dnaWalk ??= {};
    const kept = ctx.session.dnaWalk[holon];
    const state = {
      ...normalizeWalkState(kept),
      consent: typeof kept?.consent === 'string' ? kept.consent : null,
    };
    return state;
  }

  saveWalk(ctx, holon, state) {
    ctx.session ??= {};
    ctx.session.dnaWalk ??= {};
    ctx.session.dnaWalk[holon] = state;
    ctx.session.dnaWalkHolon = holon;
  }

  async onStart(ctx) {
    await ctx.answerCbQuery().catch(() => {});
    await this.begin(ctx, ctx.match[1]);
  }

  /**
   * Start (or resume) the walk of a holon. `handoff` is the `<hash16>` of a
   * link; `changed` says the DNA moved under a walk in progress.
   */
  async begin(ctx, holon, { handoff = null, changed = false } = {}) {
    const language = await this.language(ctx.chat?.id);
    if (ctx.chat?.type !== 'private') {
      const url = this.link(holon);
      await ctx.reply(
        translated(
          language,
          'walkInPrivate',
          'The walk happens in a private chat with me.'
        ),
        url
          ? Markup.inlineKeyboard([
              Markup.button.url(
                translated(language, 'dnaApply', 'Ask to join'),
                url
              ),
            ])
          : undefined
      );
      return;
    }
    const front = await this.frontOrSay(ctx, holon, language, true);
    if (!front) return;
    if (!isTelegramGroup(holon) || !front.telegram) {
      await ctx.reply(
        translated(
          language,
          'onbCannotAsk',
          "This holon can't be joined from here."
        )
      );
      return;
    }
    const cta = front.viewer.cta;
    if (cta === 'linked') {
      await ctx.reply(
        `✅ ${translated(language, 'dnaLinked', "You're linked")}`
      );
      return;
    }
    if (cta === 'none') {
      await ctx.reply(
        translated(
          language,
          'onbCannotAsk',
          "This holon can't be joined from here."
        )
      );
      return;
    }
    if (cta === 'continue') {
      await this.joinRequests?.continueFromTelegram(ctx, holon);
      return;
    }

    let state = this.walkState(ctx, holon);
    const hash = front.dna.hash;
    let notice = changed
      ? translated(
          language,
          'walkChanged',
          'The DNA of {{holon}} changed. Walk through it again.',
          { holon: front.name }
        )
      : null;
    let handedOff = false;
    if (handoff && hash) {
      if (hash.startsWith(handoff)) {
        // A link that carries this DNA's hash: the reading is skipped, the
        // agreement is not (the review is shown and must be ticked).
        for (const step of front.walk) state = acknowledgeStep(state, step);
        handedOff = true;
      } else {
        notice ??= translated(
          language,
          'walkChanged',
          'The DNA of {{holon}} changed. Walk through it again.',
          { holon: front.name }
        );
      }
    }
    // A consent given to another version never carries over.
    if (state.consent !== hash) state.consent = null;
    this.saveWalk(ctx, holon, state);

    const progress = walkProgress(front.walk, state, hash);
    const intro = front.walk.length
      ? translated(
          language,
          'walkIntro',
          'Before asking to join {{holon}}, walk through its DNA: {{k}} parts, about {{m}} min.',
          {
            holon: front.name,
            k: front.counts.parts,
            m: front.counts.minutes,
          }
        )
      : translated(
          language,
          'walkNoDna',
          '{{holon}} asks for no agreement before you ask to join.',
          { holon: front.name }
        );
    await ctx.reply(
      [
        `<b>${esc(front.name)}</b>`,
        ...(notice ? [`⚠️ ${esc(notice)}`] : []),
        esc(intro),
        ...(handedOff
          ? [
              esc(
                translated(
                  language,
                  'walkHandoff',
                  'Your link brought the DNA ({{short}}) with it. Check what you agree to below.',
                  { short: front.dna.short ?? '' }
                )
              ),
            ]
          : []),
      ].join('\n'),
      { parse_mode: 'HTML' }
    );
    if (progress.complete) {
      await this.showReview(ctx, holon, front, state, language);
      return;
    }
    const at = front.walk.findIndex(s => s.gene === progress.current);
    await this.showStep(ctx, holon, front, state, at, language);
  }

  /** One gene: its content, and the button for what it asks. */
  async showStep(ctx, holon, front, state, index, language) {
    const step = front.walk[index];
    const gene = front.genes.find(g => g.id === step.gene);
    const chunks = renderGene(gene, this.labels(language, front));
    const progress = walkProgress(front.walk, state, front.dna.hash);
    const head = [
      `<i>${esc(
        translated(language, 'walkStep', '{{i}} of {{k}}', {
          i: index + 1,
          k: front.walk.length,
        })
      )}</i>`,
      ...(progress.stale.includes(step.gene)
        ? [
            `⚠️ ${esc(translated(language, 'walkStale', '{{gene}} changed since you read it', { gene: step.title }))}`,
          ]
        : []),
    ].join('\n');
    const h8 = step.hash.slice(0, 8);
    const rows = [
      [
        Markup.button.callback(
          (step.ack === 'agree'
            ? `✅ ${translated(language, 'walkAgree', 'I agree to {{gene}}', { gene: step.title })}`
            : `✅ ${translated(language, 'walkRead', "I've read this")}`
          ).slice(0, 60),
          `dnaw:${index}:${step.ack === 'agree' ? 'a' : 'r'}:${h8}`
        ),
      ],
      ...(index > 0
        ? [
            [
              Markup.button.callback(
                translated(language, 'walkBack', '◀ Back'),
                `dnaw:${index}:back:${h8}`
              ),
            ],
          ]
        : []),
    ];
    chunks[0] = `${head}\n\n${chunks[0]}`;
    for (let i = 0; i < chunks.length; i++) {
      await ctx.reply(chunks[i], {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(i === chunks.length - 1 ? Markup.inlineKeyboard(rows) : {}),
      });
    }
  }

  reviewKeyboard(front, state, language) {
    const n = front.walk.length;
    const hash = front.dna.hash;
    const h8 = hash ? hash.slice(0, 8) : NO_HASH;
    const agreed = !hash || state.consent === hash;
    const rows = [];
    if (hash) {
      rows.push([
        Markup.button.callback(
          `${agreed ? '☑️' : '☐'} ${translated(
            language,
            'walkConsent',
            'I agree to the DNA of {{holon}} ({{short}})',
            { holon: front.name, short: front.dna.short }
          )}`.slice(0, 64),
          `dnaw:${n}:c:${h8}`
        ),
      ]);
    }
    if (agreed) {
      rows.push([
        Markup.button.callback(
          `📨 ${translated(language, 'walkSend', 'Send request')}`,
          `dnaw:${n}:s:${h8}`
        ),
      ]);
    }
    if (n > 0) {
      rows.push([
        Markup.button.callback(
          translated(language, 'walkBack', '◀ Back'),
          `dnaw:${n}:back:${h8}`
        ),
      ]);
    }
    return Markup.inlineKeyboard(rows);
  }

  /** Review: what they walked, and the agreement as a button of its own. */
  async showReview(ctx, holon, front, state, language) {
    const ticks = front.walk.map(s => `✔️ ${esc(s.title)}`);
    const lines = [
      `<b>${esc(translated(language, 'walkReview', 'Ready to send'))}</b>`,
      ...ticks,
    ];
    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      ...this.reviewKeyboard(front, state, language),
    });
  }

  /** A tap on a walk button. */
  async onTap(ctx) {
    const [, idx, act, h8] = ctx.match;
    const index = Number(idx);
    const holon = ctx.session?.dnaWalkHolon;
    const language = await this.language(ctx.chat?.id);
    if (!holon) {
      await ctx
        .answerCbQuery(
          translated(
            language,
            'walkExpired',
            'This walk has ended: send /dna to start again.'
          )
        )
        .catch(() => {});
      return;
    }
    const fresh = act === 's';
    const front = await this.frontOrSay(ctx, holon, language, fresh);
    if (!front) return;
    const steps = front.walk;
    let state = this.walkState(ctx, holon);
    const dropKeyboard = () =>
      ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});

    // Review buttons: index == number of steps, hash8 == the DNA's.
    if (act === 'c' || act === 's' || index === steps.length) {
      const hash = front.dna.hash;
      if (
        index !== steps.length ||
        (hash ? hash.slice(0, 8) : NO_HASH) !== h8
      ) {
        await ctx.answerCbQuery().catch(() => {});
        await dropKeyboard();
        await this.begin(ctx, holon, { changed: true });
        return;
      }
      if (act === 'back') {
        await ctx.answerCbQuery().catch(() => {});
        await dropKeyboard();
        if (steps.length)
          await this.showStep(
            ctx,
            holon,
            front,
            state,
            steps.length - 1,
            language
          );
        return;
      }
      if (act === 'c') {
        state = { ...state, consent: state.consent === hash ? null : hash };
        this.saveWalk(ctx, holon, state);
        await ctx.answerCbQuery().catch(() => {});
        await ctx
          .editMessageReplyMarkup(
            this.reviewKeyboard(front, state, language).reply_markup
          )
          .catch(() => {});
        return;
      }
      // Send: the agreement ticked, every step done as the genes are now.
      const progress = walkProgress(steps, state, hash);
      if (hash && state.consent !== hash) {
        await ctx
          .answerCbQuery(
            translated(language, 'walkTickFirst', 'Tick the agreement first.'),
            { show_alert: true }
          )
          .catch(() => {});
        return;
      }
      if (!progress.complete) {
        await ctx.answerCbQuery().catch(() => {});
        await dropKeyboard();
        await this.begin(ctx, holon, { changed: true });
        return;
      }
      await ctx.answerCbQuery().catch(() => {});
      await dropKeyboard();
      await this.send(ctx, holon, progress.hash);
      return;
    }

    // A step: the button must be for the gene as it is now.
    const step = steps[index];
    if (!step || !step.hash.startsWith(h8)) {
      await ctx.answerCbQuery().catch(() => {});
      await dropKeyboard();
      await this.begin(ctx, holon, { changed: true });
      return;
    }
    if (act === 'back') {
      await ctx.answerCbQuery().catch(() => {});
      await dropKeyboard();
      if (index > 0)
        await this.showStep(ctx, holon, front, state, index - 1, language);
      return;
    }
    if ((act === 'a') !== (step.ack === 'agree')) {
      await ctx.answerCbQuery().catch(() => {});
      await dropKeyboard();
      await this.begin(ctx, holon, { changed: true });
      return;
    }
    state = acknowledgeStep(state, step);
    state.consent = null;
    this.saveWalk(ctx, holon, state);
    await ctx.answerCbQuery('✅').catch(() => {});
    await dropKeyboard();
    const progress = walkProgress(steps, state, front.dna.hash);
    if (progress.complete) {
      await this.showReview(ctx, holon, front, state, language);
      return;
    }
    // Onwards in order; a step skipped or gone stale comes round again.
    const done = new Set(progress.done);
    const next =
      steps.findIndex((s, i) => i > index && !done.has(s.gene)) >= 0
        ? steps.findIndex((s, i) => i > index && !done.has(s.gene))
        : steps.findIndex(s => !done.has(s.gene));
    await this.showStep(ctx, holon, front, state, next, language);
  }

  /** Send: core signs the request with the person's derived key. */
  async send(ctx, holon, hash) {
    const language = await this.language(ctx.chat?.id);
    if (!this.joinRequests) {
      await ctx.reply(
        translated(
          language,
          'onbCannotAsk',
          "This holon can't be joined from here."
        )
      );
      return;
    }
    const outcome = await this.joinRequests.askFromTelegram(ctx, holon, hash, {
      // The DNA moved while they read: walk it again, not a link to read.
      onDna: () => this.begin(ctx, holon, { changed: true }),
    });
    if (outcome !== 'dna' && outcome !== 'refused') {
      const state = this.walkState(ctx, holon);
      this.saveWalk(ctx, holon, { ...state, consent: null });
    }
    this.fronts.clear();
    return outcome;
  }
}
