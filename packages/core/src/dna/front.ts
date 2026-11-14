// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// A holon's front page — the ONE view model every surface renders (kiosk,
// web, Telegram, MCP, and the website through the public JSON endpoint).
// Surfaces only lay it out and pick the words; what it says is decided here:
//
//   hero      name, about (purpose gene, else the settings description), a
//             280-character teaser, picture, colour band, member count
//   genes     in front-page order; refs resolved into the card they show,
//             each origin card listing where it is expressed; terms read as
//             long-form text, a gene without alleles as its blurb alone
//   walk      the steps of the walk (`./walk.ts`), with parts and minutes
//   how       how joining works: read and agree, send, the holon's own
//             onboarding steps after the request, linked
//   footer    the DNA's short hash and when it was last updated
//   viewer    which call to action the person looking at it gets
//
// `buildHolonFront` is pure (already-read inputs in, view out). The wire
// shape is `schemas/holon-front.schema.json`; a spec keeps the two equal.

import type { HoloSphere } from 'holosphere';
import { writeAcceptance } from '../holosphere/authority.js';
import { may } from '../holosphere/capabilities.js';
import { joinRequestRecords } from '../holons/requests.js';
import { cleanName, isPlaceholderName, shortId } from '../identity/ids.js';
import { normalizeOnboarding } from '../onboarding/config.js';
import { holonMembers } from '../protocol/founding.js';
import { readHolonColor } from '../settings/color.js';
import { readHolonSettings } from '../settings/persistence.js';
import { isTelegramGroupId } from '../tasks/telegram.js';
import { normalizeGene, purposeAbout, readGenes, sortGenes } from './genes.js';
import type { Allele, Gene } from './types.js';
import { dnaHash, geneHash, shortHash } from './version.js';
import { walkSteps, type WalkStep } from './walk.js';

/** The wire version of the front: bumped on any change a reader must know about. */
export const HOLON_FRONT_SCHEMA = 1;

/** Characters of `about` the hero shows before "Read more". */
export const FRONT_TEASER_CHARS = 280;

/** Reading speed behind the walk's "about {m} min". */
export const WORDS_PER_MINUTE = 200;

/** A gene, named for a reader. */
export interface FrontRef {
  gene: string;
  title: string;
}

/** An allele as the front shows it. */
export interface AlleleView extends Allele {
  /**
   * A ref only: the gene the card lives in. The card's content (title,
   * kicker, body, icon, link, detail) is already the referenced allele's;
   * `ref` still names it.
   */
  from?: FrontRef;
  /** An origin card only: the other genes that show it by ref, in front-page order. */
  expressedIn: FrontRef[];
}

/** How a gene is laid out: cards, one long text (terms), or its blurb alone (no alleles). */
export type GeneLayout = 'cards' | 'longform' | 'blurb';

export interface GeneView extends Omit<Gene, 'alleles'> {
  alleles: AlleleView[];
  /** geneHash of the gene as stored: what the walk acknowledges. */
  hash: string;
  layout: GeneLayout;
  /** Words a reader reads in this gene (title, blurb, cards with their details). */
  words: number;
  /** Every other gene that shows one of this gene's alleles, in front-page order. */
  expressedIn: FrontRef[];
}

/** One line of "How joining works". */
export type HowStep =
  | { kind: 'read'; parts: number; minutes: number }
  | { kind: 'send' }
  | { kind: 'step'; id: string; title: string }
  | { kind: 'linked' };

/**
 * The call to action the person looking gets: `apply` (ask to join),
 * `continue` (their request is in: go on with the onboarding), `review`
 * (their request is in but the DNA changed since: walk it again), `linked`
 * (they are in), `none` (nobody speaks for the holon yet, so nobody could
 * answer an ask).
 */
export type FrontCta = 'apply' | 'continue' | 'review' | 'linked' | 'none';

export interface HolonFront {
  schema: typeof HOLON_FRONT_SCHEMA;
  holon: string;
  /** The holon's name, or its short id when it has none. */
  name: string;
  /** http(s) picture from the settings. */
  picture?: string;
  /** `#rrggbb` for the colour band: the purpose gene's colour, else the holon's chosen one; absent → the surface's own colour for the holon. */
  color?: string;
  /** The purpose gene's blurb, else the settings description, else ''. */
  about: string;
  /** `about` cut to {@link FRONT_TEASER_CHARS} at a word, with `…`; equal to `about` when it fits. */
  teaser: string;
  /** The holon has written no DNA yet. */
  empty: boolean;
  genes: GeneView[];
  dna: { hash: string | null; short: string | null; updated: string | null };
  counts: {
    genes: number;
    alleles: number;
    /** Steps of the walk. */
    parts: number;
    /** Words in the walk's genes. */
    words: number;
    /** words / {@link WORDS_PER_MINUTE}, rounded up; at least 1 when there is anything to read. */
    minutes: number;
  };
  walk: WalkStep[];
  /** The holon's onboarding steps that follow the request (none while its onboarding is off). */
  after: { id: string; title: string }[];
  how: HowStep[];
  /** People linked to the holon. */
  members: number;
  /** Telegram-born holon: the Telegram bot can take the request. */
  telegram: boolean;
  viewer: { cta: FrontCta; edit: boolean };
}

/** What the surface knows about the person looking (nothing for an anonymous visitor). */
export interface HolonFrontViewer {
  /** Their key is linked to the holon. */
  linked?: boolean;
  /** They may edit the DNA (`may(standing, 'dna')`). */
  admin?: boolean;
  /** Their request: in and waiting, or in but blocked on a DNA that changed since. */
  request?: 'pending' | 'blocked' | null;
}

export interface HolonFrontInput {
  holon: string;
  /** The holon's settings document, as read. */
  settings?: Record<string, unknown> | null;
  /** The holon's genes, as read (normalized again here). */
  genes: readonly unknown[];
  /** The onboarding config, or the raw `settings.onboarding`; default: the onboarding stored in `settings`. */
  onboarding?: unknown;
  /** People linked to the holon. */
  members?: number;
  /** Something signed speaks for the holon, so an ask can be answered. Default true. */
  anchored?: boolean;
  viewer?: HolonFrontViewer | null;
}

// ── Building ───────────────────────────────────────────────────────────────

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const WORD = /[\p{L}\p{N}]/u;

/** Words in a text: whitespace-separated tokens holding a letter or a digit. */
export function countWords(...texts: Array<string | undefined | null>): number {
  let n = 0;
  for (const t of texts) if (t) for (const w of t.split(/\s+/)) if (WORD.test(w)) n++;
  return n;
}

/** Minutes to read `words`, rounded up; 0 for nothing. */
export function readingMinutes(words: number): number {
  return words > 0 ? Math.max(1, Math.ceil(words / WORDS_PER_MINUTE)) : 0;
}

/** `text` cut to `max` characters at a word boundary, with `…`; unchanged when it fits. */
export function teaserOf(text: string, max = FRONT_TEASER_CHARS): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  const cut = chars.slice(0, max - 1).join('');
  const space = cut.search(/\s\S*$/);
  const head = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${head.replace(/[\s.,;:!?-]+$/u, '')}…`;
}

const splitRef = (ref: string): [string, string] | null => {
  const i = ref.indexOf('/');
  return i > 0 && i < ref.length - 1 ? [ref.slice(0, i), ref.slice(i + 1)] : null;
};

const alleleWords = (a: Allele): number => countWords(a.title, a.kicker, a.body, a.detail?.body, ...(a.detail?.steps ?? []));

/** The genes as stored → their views, refs resolved both ways. */
function geneViews(genes: Gene[]): GeneView[] {
  const byId = new Map(genes.map((g) => [g.id, g]));
  const ref = (gene: Gene): FrontRef => ({ gene: gene.id, title: gene.title });

  // Origin card → the genes that show it, in front-page order.
  const shownIn = new Map<string, FrontRef[]>();
  for (const g of genes) {
    for (const a of g.alleles) {
      const at = a.ref ? splitRef(a.ref) : null;
      if (!at || at[0] === g.id) continue;
      const key = `${at[0]}/${at[1]}`;
      const list = shownIn.get(key) ?? [];
      if (!list.some((r) => r.gene === g.id)) list.push(ref(g));
      shownIn.set(key, list);
    }
  }

  return genes.map((g) => {
    const alleles: AlleleView[] = [];
    for (const a of g.alleles) {
      if (!a.ref) {
        alleles.push({ ...a, expressedIn: shownIn.get(`${g.id}/${a.id}`) ?? [] });
        continue;
      }
      // A ref shows the card it names; one that names nothing (or another
      // ref) shows nothing.
      const at = splitRef(a.ref);
      const owner = at ? byId.get(at[0]) : undefined;
      const target = owner?.alleles.find((x) => x.id === at![1]);
      if (!owner || !target || target.ref) continue;
      const { id: _id, ref: _ref, ...card } = target;
      alleles.push({ ...card, id: a.id, ref: a.ref, from: ref(owner), expressedIn: [] });
    }
    const expressedIn: FrontRef[] = [];
    for (const a of alleles) for (const r of a.expressedIn) if (!expressedIn.some((x) => x.gene === r.gene)) expressedIn.push(r);
    expressedIn.sort((x, y) => genes.findIndex((o) => o.id === x.gene) - genes.findIndex((o) => o.id === y.gene));
    const { alleles: _stored, ...rest } = g;
    return {
      ...rest,
      alleles,
      hash: geneHash(g),
      layout: !alleles.length ? 'blurb' : g.kind === 'terms' ? 'longform' : 'cards',
      words: countWords(g.title, g.blurb) + alleles.reduce((n, a) => n + alleleWords(a), 0),
      expressedIn,
    } satisfies GeneView;
  });
}

function latest(genes: readonly Gene[]): string | null {
  let best: string | null = null;
  let bestAt = -Infinity;
  for (const g of genes) {
    const at = Date.parse(g.updated);
    if (Number.isFinite(at) && at > bestAt) {
      bestAt = at;
      best = g.updated;
    }
  }
  return best;
}

function ctaOf(viewer: HolonFrontViewer | null | undefined, anchored: boolean): FrontCta {
  if (viewer?.linked) return 'linked';
  if (viewer?.request === 'blocked') return 'review';
  if (viewer?.request === 'pending') return 'continue';
  return anchored ? 'apply' : 'none';
}

/** The front page of a holon, from what was read. Pure. */
export function buildHolonFront(input: HolonFrontInput): HolonFront {
  const holon = String(input.holon ?? '').trim();
  const settings = (input.settings && typeof input.settings === 'object' && !Array.isArray(input.settings) ? input.settings : {}) as Record<string, unknown>;

  const unique = new Map<string, Gene>();
  for (const raw of input.genes ?? []) {
    const g = normalizeGene(raw);
    if (g && !unique.has(g.id)) unique.set(g.id, g);
  }
  const genes = sortGenes([...unique.values()]);
  const views = geneViews(genes);
  const walk = walkSteps(genes);
  const hash = dnaHash(genes);

  const named = cleanName(settings.name ?? settings.title);
  const name = named && !isPlaceholderName(named, holon) ? named : shortId(holon) || holon;
  const about = purposeAbout(genes) || str(settings.description);
  const picture = str(settings.picture);
  const color = genes.find((g) => g.kind === 'purpose')?.color || readHolonColor(settings) || '';

  const onboarding = normalizeOnboarding(input.onboarding !== undefined ? input.onboarding : settings.onboarding);
  const after = onboarding.enabled ? onboarding.steps.map((s) => ({ id: s.id, title: s.title })) : [];

  const walked = new Set(walk.map((s) => s.gene));
  const words = views.filter((g) => walked.has(g.id)).reduce((n, g) => n + g.words, 0);
  const minutes = readingMinutes(words);
  const how: HowStep[] = [
    ...(walk.length ? [{ kind: 'read' as const, parts: walk.length, minutes }] : []),
    { kind: 'send' },
    ...after.map((s) => ({ kind: 'step' as const, id: s.id, title: s.title })),
    { kind: 'linked' },
  ];

  const members = Number.isFinite(input.members) && (input.members as number) > 0 ? Math.floor(input.members as number) : 0;

  return {
    schema: HOLON_FRONT_SCHEMA,
    holon,
    name,
    ...(/^https?:\/\/\S+$/i.test(picture) ? { picture } : {}),
    ...(color ? { color } : {}),
    about,
    teaser: teaserOf(about),
    empty: genes.length === 0,
    genes: views,
    dna: { hash, short: shortHash(hash), updated: latest(genes) },
    counts: { genes: views.length, alleles: views.reduce((n, g) => n + g.alleles.length, 0), parts: walk.length, words, minutes },
    walk,
    after,
    how,
    members,
    telegram: isTelegramGroupId(holon),
    viewer: { cta: ctaOf(input.viewer, input.anchored !== false), edit: !!input.viewer?.admin },
  };
}

// ── Reading ────────────────────────────────────────────────────────────────

/** The holon's inputs did not arrive within the catch-up bound. */
export class HolonFrontUnreachable extends Error {
  readonly holon: string;
  constructor(holon: string, ms: number) {
    super(`Couldn't reach ${holon} within ${ms} ms`);
    this.name = 'HolonFrontUnreachable';
    this.holon = holon;
  }
}

export interface ReadHolonFrontOptions {
  /** How long the relay catch-up may take before giving up (default 4 s). */
  catchUpMs?: number;
  /** The key of the person looking, to pick their call to action. None: an anonymous visitor. */
  viewer?: string | null;
}

/** The default bound on {@link readHolonFront}'s relay catch-up. */
export const FRONT_CATCH_UP_MS = 4000;

/**
 * Read a holon's front page: genes, settings (with the onboarding), member
 * count and — when a viewer is named — where that key stands. Every read is
 * an authorized one: the instance must enforce reads (the factory's
 * default), or a gene a member forged would show as the holon's word. A
 * holon nobody speaks for shows no genes at all (see the gather below).
 * Throws {@link HolonFrontUnreachable} when the catch-up takes longer than
 * `catchUpMs`.
 */
export async function readHolonFront(hs: HoloSphere, holon: string, opts: ReadHolonFrontOptions = {}): Promise<HolonFront> {
  if (!(hs as { enforceActive?: boolean }).enforceActive) throw new Error('readHolonFront needs a HoloSphere that enforces reads');
  const h = String(holon ?? '').trim();
  if (!h) throw new Error('readHolonFront needs a holon id');
  const viewer = String(opts.viewer ?? '').toLowerCase();
  const ms = opts.catchUpMs ?? FRONT_CATCH_UP_MS;

  const gather = (async () => {
    const [genes, settings, members, standing, records] = await Promise.all([
      readGenes(hs, h),
      readHolonSettings(hs, h),
      holonMembers(hs, h),
      // '' (not undefined): never stand in the instance's own key for an anonymous visitor.
      writeAcceptance(hs, h, viewer),
      viewer ? joinRequestRecords(hs, h) : Promise.resolve(null),
    ]);
    const linked = !!viewer && standing.status === 'accepted';
    const pending = !linked && records?.get(viewer)?.status === 'pending';
    return buildHolonFront({
      holon: h,
      settings,
      // Nobody speaks for a holon whose standing is 'open' (no genesis, no
      // self-signed anchor), so the signer's read hands back raw items and
      // the genes lens' admin guard never runs: a stranger's gene would show
      // as the holon's word. No admin exists there to sign a real one, so
      // none is shown.
      genes: standing.status === 'open' ? [] : genes,
      members: members.size,
      anchored: standing.status !== 'open',
      viewer: viewer ? { linked, admin: may(standing, 'dna'), request: pending ? 'pending' : null } : null,
    });
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HolonFrontUnreachable(h, ms)), ms);
  });
  gather.catch(() => {
    /* reported through the race */
  });
  try {
    return await Promise.race([gather, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
