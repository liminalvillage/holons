// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Editing a holon's DNA, as an admin's screen does it: pure operations on a
// DRAFT, the live issues a draft has, and the write that turns a draft into
// the `genes` lens. Three rules the screens must not re-invent:
//
//   • A draft keeps what is still being typed. A blank allele, a link with no
//     address yet, a gene with no title survive every edit; `settleDrafts`
//     decides what a save would store.
//   • An id is given ONCE, at the first save, from the title as it is then,
//     and never derived again — a gene id is its record id, an allele id sits
//     inside refs and hashes, so retitling "Care" must not move them. Until
//     then a row is told apart by its `key`, which is never stored.
//   • Position is the array order. `order` is written as the position, and a
//     pure reorder goes through `reorderGenes` (hash-neutral), never a put.
//
// Nothing here decides who may write: the lens is admin-guarded in
// holosphere, and the screens ask `may(…, 'dna')` before offering an editor.

import type { HoloSphere } from 'holosphere';
import { geneBytes, geneSlug, normalizeGeneDraft, putGene, removeGene, reorderGenes, sortGenes, validateGenes } from './genes.js';
import { STARTER_GENES } from './templates.js';
import {
  GENE_KINDS,
  GENE_KIND_DEFAULTS,
  GeneInvalid,
  SINGLE_KINDS,
  type AckMode,
  type Allele,
  type AlleleDetail,
  type AlleleIcon,
  type Gene,
  type GeneIssue,
  type GeneKind,
  type GeneLink,
} from './types.js';

// ── Draft shapes ───────────────────────────────────────────────────────────

/** An allele as an editor holds it: `key` tells the row apart before it has an `id` ('' until its first save). */
export interface DraftAllele {
  key: string;
  id: string;
  title: string;
  kicker?: string;
  body?: string;
  icon?: AlleleIcon | null;
  link?: Partial<GeneLink>;
  detail?: Partial<AlleleDetail>;
  ref?: string;
}

/** A gene as an editor holds it. Its position in the draft list is its `order`; `updated` is stamped by the write. */
export interface DraftGene {
  key: string;
  id: string;
  kind: GeneKind;
  title: string;
  blurb: string;
  color?: string;
  ack: AckMode;
  links?: Array<Partial<GeneLink>>;
  lang: string;
  alleles: DraftAllele[];
  /**
   * An untouched starter row (`withStarter`): shown, and its id reserved, but
   * never written until the admin changes it. Any edit of the gene clears it;
   * a stored gene of the same id replaces it (`mergeRemote`).
   */
  starter?: true;
}

export type GeneFields = Partial<Pick<DraftGene, 'title' | 'blurb' | 'color' | 'ack' | 'kind' | 'lang' | 'links'>>;
export type AlleleFields = Partial<Omit<DraftAllele, 'key' | 'id'>>;

let counter = 0;
/** A row key no other row of this page has. Never stored. */
export function newDraftKey(): string {
  counter += 1;
  return `k${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const allele = (a: Allele): DraftAllele => ({ ...structuredClone(a), key: newDraftKey() });

/** The draft of stored genes (in the order given), every row with a fresh key. */
export function draftGenes(genes: readonly Gene[]): DraftGene[] {
  return genes.map((g) => {
    const { order: _order, updated: _updated, alleles, ...rest } = structuredClone(g);
    return { ...rest, key: newDraftKey(), alleles: alleles.map(allele) };
  });
}

// ── Operations ─────────────────────────────────────────────────────────────

function moved<T>(list: T[], index: number, by: number): T[] {
  const to = Math.max(0, Math.min(list.length - 1, index + by));
  if (index < 0 || to === index) return list;
  const out = [...list];
  const [item] = out.splice(index, 1);
  out.splice(to, 0, item);
  return out;
}

/** Apply an edit to one gene: a starter row that is edited is the admin's own from then on. */
const mapGene = (drafts: DraftGene[], key: string, f: (g: DraftGene) => DraftGene): DraftGene[] =>
  drafts.map((g) => {
    if (g.key !== key) return g;
    const { starter: _starter, ...next } = f(g);
    return next;
  });

/** The kinds a new gene may take: every kind, except a single kind (purpose, terms) the draft already has. */
export function availableKinds(drafts: readonly DraftGene[]): GeneKind[] {
  return GENE_KINDS.filter((k) => !SINGLE_KINDS.includes(k) || !drafts.some((g) => g.kind === k));
}

/** A blank gene of a kind at the end, asking what the kind asks by default. */
export function addGene(drafts: DraftGene[], kind: GeneKind, fields: { title?: string; lang?: string } = {}): { drafts: DraftGene[]; gene: DraftGene } {
  const gene: DraftGene = {
    key: newDraftKey(),
    id: '',
    kind,
    title: fields.title ?? '',
    blurb: '',
    ack: GENE_KIND_DEFAULTS[kind].ack,
    lang: fields.lang ?? drafts[0]?.lang ?? 'en',
    alleles: [],
  };
  return { drafts: [...drafts, gene], gene };
}

/**
 * Add the starter genes (`STARTER_GENES(lang)`) the draft does not have yet:
 * one whose id is already used, or whose single kind is already there, is
 * skipped. Starter genes are given their ids, so they are saved under the
 * names every holon's DNA shares, and are marked `starter`: untouched, they
 * are not written, but their ids stay reserved against the admin's own genes.
 */
export function withStarter(drafts: DraftGene[], lang = 'en'): DraftGene[] {
  const have = draftGenes(
    STARTER_GENES(lang).filter((s) => !drafts.some((d) => d.id === s.id || (SINGLE_KINDS.includes(s.kind) && d.kind === s.kind))),
  );
  return [...drafts, ...have.map((g): DraftGene => ({ ...g, starter: true }))];
}

/** Change a gene. A new kind brings that kind's default acknowledgement, unless the change names one. */
export function updateGene(drafts: DraftGene[], key: string, fields: GeneFields): DraftGene[] {
  return mapGene(drafts, key, (g) => {
    const next: DraftGene = { ...g, ...fields };
    if (fields.kind && fields.kind !== g.kind && fields.ack === undefined) next.ack = GENE_KIND_DEFAULTS[fields.kind].ack;
    return next;
  });
}

/** Move a gene up (-1) or down (+1); at either end nothing moves. */
export function moveGene(drafts: DraftGene[], key: string, by: -1 | 1): DraftGene[] {
  const from = drafts.findIndex((g) => g.key === key);
  const out = moved(drafts, from, by);
  return out === drafts ? out : mapGene(out, key, (g) => g);
}

export function removeDraftGene(drafts: DraftGene[], key: string): DraftGene[] {
  return drafts.filter((g) => g.key !== key);
}

/** A blank allele at the end of a gene. */
export function addAllele(drafts: DraftGene[], geneKey: string, fields: AlleleFields = {}): { drafts: DraftGene[]; allele: DraftAllele | null } {
  if (!drafts.some((g) => g.key === geneKey)) return { drafts, allele: null };
  const made: DraftAllele = { key: newDraftKey(), id: '', title: '', ...fields };
  return { drafts: mapGene(drafts, geneKey, (g) => ({ ...g, alleles: [...g.alleles, made] })), allele: made };
}

export function updateAllele(drafts: DraftGene[], geneKey: string, alleleKey: string, fields: AlleleFields): DraftGene[] {
  return mapGene(drafts, geneKey, (g) => ({ ...g, alleles: g.alleles.map((a) => (a.key === alleleKey ? { ...a, ...fields } : a)) }));
}

export function moveAllele(drafts: DraftGene[], geneKey: string, alleleKey: string, by: -1 | 1): DraftGene[] {
  return mapGene(drafts, geneKey, (g) => ({ ...g, alleles: moved(g.alleles, g.alleles.findIndex((a) => a.key === alleleKey), by) }));
}

export function removeAllele(drafts: DraftGene[], geneKey: string, alleleKey: string): DraftGene[] {
  return mapGene(drafts, geneKey, (g) => ({ ...g, alleles: g.alleles.filter((a) => a.key !== alleleKey) }));
}

// ── Settling: what a save would store ──────────────────────────────────────

/** A draft gene as it would be stored, with the key of the draft allele behind each stored allele. */
export interface SettledGene {
  key: string;
  gene: Gene;
  /** `alleleKeys[i]` is the draft row of `gene.alleles[i]` (blank rows are not stored, so they are not here). */
  alleleKeys: string[];
  /** The draft row is an untouched starter: reserved and shown, not written. */
  starter?: true;
}

function unique(id: string, taken: Set<string>): string {
  let out = id;
  for (let n = 2; taken.has(out); n++) out = `${id}-${n}`;
  return out;
}

const stamp = new Date(0).toISOString();

/**
 * Every gene of the draft as a save would store it: ids given to the rows
 * that have none yet (a single kind takes its kind as its id, any other the
 * slug of its title), `order` the position, blank alleles and links left
 * out. Pure — nothing is adopted until `adoptIds`.
 */
export function settleDrafts(drafts: readonly DraftGene[]): SettledGene[] {
  const taken = new Set(drafts.map((g) => g.id).filter(Boolean));
  const out: SettledGene[] = [];
  drafts.forEach((d, order) => {
    const id = d.id || unique(SINGLE_KINDS.includes(d.kind) ? d.kind : geneSlug(d.title) || d.kind, taken);
    taken.add(id);
    const { key: _key, alleles, starter, ...rest } = d;
    // A blank allele is not stored; ask core which rows it keeps, one by one.
    const kept = alleles.filter((a) => (normalizeGeneDraft({ id: 'x', title: 'x', alleles: [a] })?.alleles.length ?? 0) > 0);
    const gene = normalizeGeneDraft({ ...rest, id, order, updated: stamp, alleles: kept.map(({ key: _k, ...a }) => a) });
    if (gene) out.push({ key: d.key, gene, alleleKeys: kept.map((a) => a.key), ...(starter ? { starter } : {}) });
  });
  return out;
}

/** A gene's or allele's id that ended up not matching what was stored is never changed: only blank ids are filled. */
export function adoptIds(drafts: DraftGene[], saved: readonly SettledGene[]): DraftGene[] {
  const byKey = new Map(saved.map((s) => [s.key, s]));
  return drafts.map((d) => {
    const s = byKey.get(d.key);
    if (!s) return d;
    const ids = new Map(s.alleleKeys.map((k, i) => [k, s.gene.alleles[i].id]));
    return {
      ...d,
      id: d.id || s.gene.id,
      alleles: d.alleles.map((a) => (a.id || !ids.has(a.key) ? a : { ...a, id: ids.get(a.key)! })),
    };
  });
}

/** One thing wrong with the draft, with the rows to show it on. */
export interface DraftIssue extends GeneIssue {
  geneKey: string;
  alleleKey?: string;
}

export interface DraftCheck {
  settled: SettledGene[];
  issues: DraftIssue[];
  /** Stored size of each gene, by row key, as it would be written. */
  bytes: Map<string, number>;
}

/** Everything wrong with the draft, live: the very issues a write would refuse on, and each gene's stored size. */
export function checkDrafts(drafts: readonly DraftGene[]): DraftCheck {
  const settled = settleDrafts(drafts);
  const byId = new Map(settled.map((s) => [s.gene.id, s]));
  const issues: DraftIssue[] = [];
  for (const i of validateGenes(settled.map((s) => s.gene))) {
    const s = byId.get(i.gene);
    if (!s) continue;
    const at = i.allele ? s.gene.alleles.findIndex((a) => a.id === i.allele) : -1;
    issues.push({ ...i, geneKey: s.key, ...(at >= 0 ? { alleleKey: s.alleleKeys[at] } : {}) });
  }
  return { settled, issues, bytes: new Map(settled.map((s) => [s.key, geneBytes(s.gene)])) };
}

// ── Saving ─────────────────────────────────────────────────────────────────

/** What makes a gene different to a reader or an editor: everything but where it stands, when it was stamped and the lens's own `_` bookkeeping (`_clock`). */
const content = (g: Gene): string =>
  JSON.stringify({ ...Object.fromEntries(Object.entries(g).filter(([k]) => !k.startsWith('_'))), order: 0, updated: '' });

export interface WritePlan {
  /** Genes to put: new or changed, with no issue standing in the way. Untouched starter rows are never put. */
  put: SettledGene[];
  /** Genes with changes held back by an issue. */
  held: DraftIssue[];
  /** All the genes' ids in draft order, when stored positions must be rewritten; else null. */
  reorder: string[] | null;
}

/**
 * What saving the draft would write, against `baseline` (the genes as this
 * editor last saw them stored). A gene that did not change is not written;
 * a gene with an issue is held back (the others still go); a pure move is a
 * `reorder`, never a put; an untouched starter row is not the holon's yet.
 */
export function planWrites(baseline: readonly Gene[], check: DraftCheck): WritePlan {
  const base = new Map(baseline.map((g) => [g.id, g]));
  const blocked = new Set(check.issues.map((i) => i.geneKey));
  const put: SettledGene[] = [];
  for (const s of check.settled) {
    if (blocked.has(s.key) || s.starter) continue;
    const was = base.get(s.gene.id);
    if (!was || content(was) !== content(s.gene)) put.push(s);
  }
  const ids = check.settled.map((s) => s.gene.id);
  const known = sortGenes([...baseline]).map((g) => g.id);
  const sequence = ids.filter((id) => base.has(id));
  const moved = sequence.join('\n') !== known.filter((id) => sequence.includes(id)).join('\n');
  const grown = put.some((s) => !base.has(s.gene.id));
  const stored = new Set([...base.keys(), ...put.map((s) => s.gene.id)]);
  return { put, held: check.issues, reorder: moved || grown ? ids.filter((id) => stored.has(id)) : null };
}

export interface SaveResult {
  /** Genes written (as stored). */
  saved: SettledGene[];
  /** Stored genes after the save, for the next `baseline`. */
  baseline: Gene[];
  /** Issues that held a gene back, here or at the write. */
  held: DraftIssue[];
}

/**
 * Write the draft: puts, then removals the user asked for, then the
 * positions. A put the lens refuses on a ref that is not stored yet (a gene
 * pointing at one written in the same save) is tried again once the others
 * are in. Network errors are not caught: the caller's autosave shows them
 * and retries.
 */
export async function saveDrafts(
  hs: HoloSphere,
  holon: string,
  input: { drafts: readonly DraftGene[]; baseline: readonly Gene[]; removed?: readonly string[] },
): Promise<SaveResult> {
  const check = checkDrafts(input.drafts);
  const plan = planWrites(input.baseline, check);
  const stored = new Map(input.baseline.map((g) => [g.id, g]));
  const saved: SettledGene[] = [];
  const held: DraftIssue[] = [...plan.held];

  let waiting = [...plan.put];
  for (let pass = 0; waiting.length && pass <= plan.put.length; pass++) {
    const retry: SettledGene[] = [];
    const refused: DraftIssue[] = [];
    for (const s of waiting) {
      try {
        // A cleared colour or link list must clear the stored one: a put names only what it carries.
        const gene = await putGene(hs, holon, { ...s.gene, links: s.gene.links ?? [], color: s.gene.color ?? '' });
        stored.set(gene.id, gene);
        saved.push(s);
      } catch (err) {
        if (!(err instanceof GeneInvalid)) throw err;
        retry.push(s);
        refused.push(...err.issues.map((i) => ({ ...i, geneKey: s.key })));
      }
    }
    if (retry.length === waiting.length) {
      held.push(...refused);
      break;
    }
    waiting = retry;
  }

  for (const id of input.removed ?? []) {
    try {
      await removeGene(hs, holon, id);
      stored.delete(id);
    } catch (err) {
      if (!(err instanceof GeneInvalid)) throw err;
      held.push(...err.issues.map((i) => ({ ...i, geneKey: '' })));
    }
  }

  if (plan.reorder) {
    const ids = plan.reorder.filter((id) => stored.has(id));
    for (const g of await reorderGenes(hs, holon, ids)) stored.set(g.id, g);
  }
  return { saved, baseline: sortGenes([...stored.values()]), held };
}

// ── Following the lens while editing ───────────────────────────────────────

/**
 * Fold what the lens now holds (`remote`) into a draft being edited. A gene
 * this draft has not changed since `baseline` follows the lens (another
 * admin's edit, or the first read arriving after the editor opened), and so
 * does an untouched starter row (a stored gene beats a placeholder); a
 * changed one is kept as it is; a gene new to the lens is added; a row never
 * saved stays, and so does a starter row the lens does not know. `removed`
 * ids are not brought back.
 */
export function mergeRemote(
  drafts: readonly DraftGene[],
  baseline: readonly Gene[],
  remote: readonly Gene[],
  removed: readonly string[] = [],
): DraftGene[] {
  const base = new Map(baseline.map((g) => [g.id, g]));
  const settled = new Map(settleDrafts(drafts).map((s) => [s.key, s.gene]));
  const changed = (d: DraftGene): boolean => {
    const was = base.get(d.id);
    const now = settled.get(d.key);
    return d.starter ? false : !d.id ? true : !was ? true : !now || content(was) !== content(now);
  };
  const mine = new Map(drafts.map((d) => [d.id, d]));
  const out: DraftGene[] = [];
  for (const r of remote) {
    if (removed.includes(r.id)) continue;
    const d = mine.get(r.id);
    if (d && changed(d)) out.push(d);
    else out.push(d ? { ...draftGenes([r])[0], key: d.key } : draftGenes([r])[0]);
  }
  const seen = new Set(out.map((d) => d.id));
  // Rows the lens does not know: never saved, or changed here though gone from there.
  for (const d of drafts) if (!d.id || (!seen.has(d.id) && (d.starter || changed(d)))) out.push(d);
  return out;
}
