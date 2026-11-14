// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The `genes` lens: one record per gene, record id = gene id. Everything a
// surface does with a holon's DNA goes through here — normalize what is
// stored, say what is wrong with a gene (the editor shows the same issues
// live that a write refuses on), read, watch, write, remove, reorder.
//
// Who may write is not decided here: the lens is admin-guarded in
// holosphere, so a gene written by a key that was not an admin when it
// signed simply never counts on an enforced read.

import type { HoloSphere } from 'holosphere';
import { isAlleleIcon } from './icons.js';
import {
  ACK_MODES,
  GENE_KINDS,
  GENE_KIND_DEFAULTS,
  GENE_LIMITS,
  GeneInvalid,
  SINGLE_KINDS,
  type AckMode,
  type Allele,
  type AlleleDetail,
  type Gene,
  type GeneDraft,
  type GeneIssue,
  type GeneKind,
  type GeneLink,
} from './types.js';

export const GENES_LENS = 'genes';

// ── Normalizing ────────────────────────────────────────────────────────────

/** A gene or allele id: lowercase letters, digits, `-` and `_`. */
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const REF = /^([a-z0-9][a-z0-9_-]{0,63})\/([a-z0-9][a-z0-9_-]{0,63})$/;
const COLOR = /^#[0-9a-f]{6}$/i;
/** What a link may point at: the web, mail, Telegram, or a path on the same site. Never `javascript:`. */
const HREF = /^(https?:\/\/[^\s]+|mailto:[^\s]+|tg:\/\/[^\s]+|\/(?!\/)[^\s]*|#[^\s]*)$/i;
const IMAGE_SRC = /^(https?:\/\/[^\s]+|\/(?!\/)[^\s]*)$/i;

/** Title → slug: lowercase ASCII, `-` between words, at most 64 characters. */
export function geneSlug(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 64)
    .replace(/[-_]+$/, '');
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function normalizeLink(raw: unknown): GeneLink | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const href = text(r.href);
  if (!href) return undefined;
  const label = text(r.label) || href;
  return { label, href, ...(isAlleleIcon(r.icon) ? { icon: r.icon } : {}) };
}

function normalizeLinks(raw: unknown): GeneLink[] {
  return Array.isArray(raw) ? raw.map(normalizeLink).filter((l): l is GeneLink => !!l) : [];
}

function normalizeDetail(raw: unknown): AlleleDetail | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const body = text(r.body);
  const steps = Array.isArray(r.steps) ? r.steps.map(text).filter(Boolean) : [];
  const links = normalizeLinks(r.links);
  const img = (r.image && typeof r.image === 'object' ? r.image : {}) as Record<string, unknown>;
  const src = text(img.src);
  if (!body && !steps.length && !links.length && !src) return undefined;
  return {
    body,
    ...(steps.length ? { steps } : {}),
    ...(links.length ? { links } : {}),
    ...(src ? { image: { src, alt: text(img.alt) } } : {}),
  };
}

function unique(id: string, taken: Set<string>): string {
  let out = id;
  for (let n = 2; taken.has(out); n++) out = `${id}-${n}`;
  return out;
}

function normalizeAlleles(raw: unknown): Allele[] {
  if (!Array.isArray(raw)) return [];
  const taken = new Set<string>();
  const out: Allele[] = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue;
    const r = a as Record<string, unknown>;
    const title = text(r.title);
    const ref = text(r.ref);
    // A blank allele (still being typed in an editor) is not stored.
    if (!title && !ref) continue;
    // An id stated is kept as it is (a duplicate is an issue the editor
    // shows); one made from the title is made unique.
    const stated = geneSlug(r.id);
    const id = stated || unique(geneSlug(title) || geneSlug(ref) || `allele-${out.length + 1}`, taken);
    taken.add(id);
    const kicker = text(r.kicker);
    const body = text(r.body);
    const link = normalizeLink(r.link);
    const detail = normalizeDetail(r.detail);
    out.push({
      id,
      title,
      ...(kicker ? { kicker } : {}),
      ...(body ? { body } : {}),
      ...(isAlleleIcon(r.icon) ? { icon: r.icon } : {}),
      ...(link ? { link } : {}),
      ...(detail ? { detail } : {}),
      ...(ref ? { ref } : {}),
    });
  }
  return out;
}

/**
 * Whatever is stored → a gene, or null when it is not one (not an object,
 * deleted, or nothing to name it by). Unknown fields (`_clock`, `_verified`,
 * …) are dropped, an unknown kind is `custom`, a missing `ack` is the kind's
 * default, blank alleles and links without a target drop out. Limits are
 * NOT enforced here: `validateGene` reports them.
 */
export function normalizeGene(raw: unknown): Gene | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r._deleted) return null;
  const kind: GeneKind = (GENE_KINDS as readonly string[]).includes(r.kind as string) ? (r.kind as GeneKind) : 'custom';
  const title = text(r.title);
  const id = geneSlug(r.id) || geneSlug(title);
  if (!id) return null;
  const ack: AckMode = (ACK_MODES as readonly string[]).includes(r.ack as string) ? (r.ack as AckMode) : GENE_KIND_DEFAULTS[kind].ack;
  const n = typeof r.order === 'number' ? r.order : typeof r.order === 'string' && r.order.trim() ? Number(r.order) : NaN;
  const order = Number.isFinite(n) ? n : 0;
  const color = typeof r.color === 'string' && COLOR.test(r.color.trim()) ? r.color.trim().toLowerCase() : undefined;
  const links = normalizeLinks(r.links);
  return {
    id,
    kind,
    title,
    blurb: text(r.blurb),
    ...(color ? { color } : {}),
    order,
    ack,
    ...(links.length ? { links } : {}),
    alleles: normalizeAlleles(r.alleles),
    lang: text(r.lang).slice(0, 16) || 'en',
    updated: text(r.updated),
  };
}

/** Front-page order: `order`, then id. */
export function sortGenes(genes: Gene[]): Gene[] {
  return genes.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ── Validating ─────────────────────────────────────────────────────────────

/** UTF-8 bytes of the gene as it is stored. */
export function geneBytes(gene: Gene): number {
  return new TextEncoder().encode(JSON.stringify(gene)).length;
}

const resolveRef = (ref: string, genes: readonly Gene[]): Allele | undefined => {
  const m = REF.exec(ref);
  return m ? genes.find((g) => g.id === m[1])?.alleles.find((a) => a.id === m[2]) : undefined;
};

/**
 * Everything wrong with `gene` among the holon's `others` (which may contain
 * an older copy of it, ignored by id). Empty when it can be stored. The
 * editor shows these live; `putGene` refuses on any.
 */
export function validateGene(gene: Gene, others: readonly Gene[] = []): GeneIssue[] {
  const issues: GeneIssue[] = [];
  const g = gene.id;
  const rest = others.filter((o) => o.id !== g);
  const all = [gene, ...rest];
  const add = (i: Omit<GeneIssue, 'gene'>) => issues.push({ gene: g, ...i });
  const long = (field: string, value: string | undefined, limit: number, allele?: string) => {
    const n = [...(value ?? '')].length;
    if (n > limit) add({ code: 'too-long', field, limit, actual: n, ...(allele ? { allele } : {}), message: `${allele ? `${allele}: ` : ''}${field} is ${n} characters (at most ${limit})` });
  };
  const href = (field: string, l: GeneLink | undefined, allele?: string) => {
    if (!l) return;
    long(`${field}.label`, l.label, GENE_LIMITS.title, allele);
    if (l.href.length > GENE_LIMITS.href || !HREF.test(l.href))
      add({ code: 'bad-link', field: `${field}.href`, ...(allele ? { allele } : {}), message: `${allele ? `${allele}: ` : ''}${field} must be an http(s), mailto:, tg:// or site link` });
  };
  const links = (field: string, ls: GeneLink[] | undefined, allele?: string) => {
    if (!ls) return;
    if (ls.length > GENE_LIMITS.links)
      add({ code: 'too-many', field, limit: GENE_LIMITS.links, actual: ls.length, ...(allele ? { allele } : {}), message: `${allele ? `${allele}: ` : ''}${ls.length} links (at most ${GENE_LIMITS.links})` });
    ls.forEach((l, i) => href(`${field}[${i}]`, l, allele));
  };

  if (!SLUG.test(g)) add({ code: 'bad-id', field: 'id', message: `"${g}" is not a gene id (lowercase letters, digits, - and _)` });
  if (!gene.title) add({ code: 'missing-title', field: 'title', message: 'the gene needs a title' });
  if (SINGLE_KINDS.includes(gene.kind) && rest.some((o) => o.kind === gene.kind))
    add({ code: 'duplicate-kind', field: 'kind', message: `a holon has one ${gene.kind} gene` });
  const count = new Set(all.map((o) => o.id)).size;
  if (count > GENE_LIMITS.genes) add({ code: 'too-many', field: 'genes', limit: GENE_LIMITS.genes, actual: count, message: `${count} genes (at most ${GENE_LIMITS.genes})` });

  long('title', gene.title, GENE_LIMITS.title);
  long('blurb', gene.blurb, GENE_LIMITS.blurb);
  links('links', gene.links);

  const alleles = gene.alleles ?? [];
  if (alleles.length > GENE_LIMITS.allelesPerGene)
    add({ code: 'too-many', field: 'alleles', limit: GENE_LIMITS.allelesPerGene, actual: alleles.length, message: `${alleles.length} alleles (at most ${GENE_LIMITS.allelesPerGene})` });
  const bodyLimit = gene.kind === 'terms' ? GENE_LIMITS.termsBody : GENE_LIMITS.body;
  const seen = new Set<string>();
  for (const a of alleles) {
    if (!SLUG.test(a.id)) add({ code: 'bad-id', allele: a.id, field: 'id', message: `"${a.id}" is not an allele id` });
    if (seen.has(a.id)) add({ code: 'duplicate-allele', allele: a.id, field: 'id', message: `two alleles are called "${a.id}"` });
    seen.add(a.id);
    if (!a.title && !a.ref) add({ code: 'missing-title', allele: a.id, field: 'title', message: `${a.id}: the allele needs a title` });
    long('title', a.title, GENE_LIMITS.title, a.id);
    long('kicker', a.kicker, GENE_LIMITS.title, a.id);
    long('body', a.body, bodyLimit, a.id);
    href('link', a.link, a.id);
    if (a.detail) {
      long('detail.body', a.detail.body, GENE_LIMITS.detailBody, a.id);
      const steps = a.detail.steps ?? [];
      if (steps.length > GENE_LIMITS.steps)
        add({ code: 'too-many', allele: a.id, field: 'detail.steps', limit: GENE_LIMITS.steps, actual: steps.length, message: `${a.id}: ${steps.length} steps (at most ${GENE_LIMITS.steps})` });
      steps.forEach((s, i) => long(`detail.steps[${i}]`, s, GENE_LIMITS.step, a.id));
      links('detail.links', a.detail.links, a.id);
      const src = a.detail.image?.src;
      if (src !== undefined && (src.length > GENE_LIMITS.href || !IMAGE_SRC.test(src)))
        add({ code: 'bad-link', allele: a.id, field: 'detail.image.src', message: `${a.id}: the image must be an http(s) or site link` });
    }
    if (a.ref) {
      const m = REF.exec(a.ref);
      if (!m) add({ code: 'ref-malformed', allele: a.id, field: 'ref', message: `${a.id}: a ref is "<gene>/<allele>"` });
      else {
        const target = resolveRef(a.ref, all);
        if (!target) add({ code: 'ref-missing', allele: a.id, field: 'ref', message: `${a.id}: ${a.ref} does not exist` });
        else if (target.ref) add({ code: 'ref-nested', allele: a.id, field: 'ref', message: `${a.id}: ${a.ref} is itself a ref (one level only)` });
      }
    }
  }

  // Another gene showing one of ours that this version no longer has.
  for (const o of rest) {
    for (const a of o.alleles) {
      const m = a.ref ? REF.exec(a.ref) : null;
      if (m && m[1] === g && !alleles.some((x) => x.id === m[2]))
        add({ code: 'referenced', allele: m[2], field: 'alleles', message: `${o.id}/${a.id} shows ${a.ref}, which this gene no longer has` });
    }
  }

  const bytes = geneBytes(gene);
  if (bytes > GENE_LIMITS.bytes) add({ code: 'too-large', limit: GENE_LIMITS.bytes, actual: bytes, message: `the gene is ${bytes} bytes (at most ${GENE_LIMITS.bytes}); split long text across alleles or genes` });
  return issues;
}

/** Every issue across a whole DNA, plus ids used twice. */
export function validateGenes(genes: readonly Gene[]): GeneIssue[] {
  const issues: GeneIssue[] = [];
  const ids = new Set<string>();
  for (const g of genes) {
    if (ids.has(g.id)) issues.push({ code: 'duplicate-id', gene: g.id, field: 'id', message: `two genes are called "${g.id}"` });
    ids.add(g.id);
  }
  const seen = new Set<string>();
  for (const g of genes) {
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    // A single kind is reported once, on its later genes, not on every copy.
    const others = genes.filter((o) => o !== g);
    for (const i of validateGene(g, others)) {
      if (i.code === 'duplicate-kind' && !genes.slice(0, genes.indexOf(g)).some((o) => o.kind === g.kind)) continue;
      issues.push(i);
    }
  }
  return issues;
}

/** The holon's one-line about: its purpose gene's blurb, or ''. The 39000 `about` and the registry purpose come from here. */
export function purposeAbout(genes: readonly Gene[]): string {
  return (genes.find((g) => g.kind === 'purpose')?.blurb ?? '').trim();
}

// ── Reading and writing ────────────────────────────────────────────────────

export interface GeneWriteOptions {
  /** The clock for `updated`; injectable for tests. */
  now?: () => Date;
}

const toGenes = (raw: unknown): Gene[] => {
  const byId = new Map<string, Gene>();
  for (const r of Array.isArray(raw) ? raw : []) {
    const g = normalizeGene(r);
    if (g && !byId.has(g.id)) byId.set(g.id, g);
  }
  return sortGenes([...byId.values()]);
};

/** The holon's genes, in front-page order. */
export async function readGenes(hs: HoloSphere, holon: string): Promise<Gene[]> {
  return toGenes(await hs.getAll(String(holon), GENES_LENS));
}

/**
 * Watch the holon's genes: `cb` gets the whole sorted list on every change
 * (and once at the start, even when there are none). Returns the stop.
 */
export function subscribeGenes(hs: HoloSphere, holon: string, cb: (genes: Gene[]) => void): () => void {
  const byId = new Map<string, Gene>();
  const touched = new Set<string>();
  let active = true;
  const emit = () => {
    if (active) cb(sortGenes([...byId.values()]));
  };
  const sub = hs.subscribe(String(holon), GENES_LENS, (data: unknown, key?: string) => {
    const id = key ?? (data as { id?: string } | null)?.id;
    if (id == null) return;
    touched.add(String(id));
    const g = normalizeGene(data);
    byId.delete(String(id));
    if (g) byId.set(g.id, g);
    emit();
  });
  // The first read only fills in what the live feed has not spoken for yet.
  readGenes(hs, holon)
    .then((genes) => {
      for (const g of genes) if (!touched.has(g.id) && !byId.has(g.id)) byId.set(g.id, g);
      emit();
    })
    .catch(() => emit());
  return () => {
    active = false;
    sub.unsubscribe();
  };
}

/**
 * Store a gene: normalized, given an id when it has none (a single kind
 * takes the kind as its id; others a slug of the title), kept at its place
 * or put last, stamped `updated`. Throws `GeneInvalid` with every issue
 * instead of storing an invalid gene. Returns what was stored.
 */
export async function putGene(hs: HoloSphere, holon: string, draft: GeneDraft, opts: GeneWriteOptions = {}): Promise<Gene> {
  const existing = await readGenes(hs, holon);
  const kind: GeneKind = (GENE_KINDS as readonly string[]).includes(draft.kind as string) ? (draft.kind as GeneKind) : 'custom';
  let id = geneSlug(draft.id);
  if (!id) {
    const base = SINGLE_KINDS.includes(kind) ? kind : geneSlug(draft.title) || kind;
    id = unique(
      base,
      new Set(existing.map((g) => g.id)),
    );
  }
  const before = existing.find((g) => g.id === id);
  const order =
    typeof draft.order === 'number' && Number.isFinite(draft.order)
      ? draft.order
      : (before?.order ?? (existing.length ? Math.max(...existing.map((g) => g.order)) + 1 : 0));
  const gene = normalizeGene({ ...draft, id, kind, order, updated: (opts.now?.() ?? new Date()).toISOString() });
  if (!gene) throw new GeneInvalid([{ code: 'bad-id', gene: id, field: 'id', message: 'the gene needs an id or a title' }]);
  const issues = validateGene(gene, existing);
  if (issues.length) throw new GeneInvalid(issues);
  await hs.put(String(holon), GENES_LENS, gene);
  return gene;
}

/** Remove a gene. Refuses (`GeneInvalid`, code `referenced`) while another gene still shows one of its alleles. */
export async function removeGene(hs: HoloSphere, holon: string, id: string, _opts: GeneWriteOptions = {}): Promise<void> {
  const existing = await readGenes(hs, holon);
  const issues: GeneIssue[] = [];
  for (const o of existing) {
    if (o.id === id) continue;
    for (const a of o.alleles) {
      const m = a.ref ? REF.exec(a.ref) : null;
      if (m && m[1] === id) issues.push({ code: 'referenced', gene: id, allele: m[2], field: 'alleles', message: `${o.id}/${a.id} shows ${a.ref}` });
    }
  }
  if (issues.length) throw new GeneInvalid(issues);
  await hs.delete(String(holon), GENES_LENS, id);
}

/**
 * Put the genes in the order of `ids` (genes not named follow, as they
 * were). Rewrites `order` only — the hash does not cover it, so nobody's
 * acknowledgement goes out of date. Writes only the genes that moved.
 */
export async function reorderGenes(hs: HoloSphere, holon: string, ids: readonly string[], _opts: GeneWriteOptions = {}): Promise<Gene[]> {
  const existing = await readGenes(hs, holon);
  const named = ids.map((id) => existing.find((g) => g.id === id)).filter((g): g is Gene => !!g);
  const next = [...new Set([...named, ...existing])];
  const out: Gene[] = [];
  for (const [i, g] of next.entries()) {
    if (g.order !== i) {
      const moved = { ...g, order: i };
      await hs.put(String(holon), GENES_LENS, moved);
      out.push(moved);
    } else out.push(g);
  }
  return out;
}
