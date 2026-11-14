// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// A holon's DNA: an ordered set of GENES (its parts — purpose, values,
// agreements, …), each holding ALLELES (the items of that part). One record
// per gene in the holon's `genes` lens, record id = gene id (a slug), so the
// field clocks of holosphere fold each gene on its own.
//
// Some genes ask a person who wants to join to acknowledge them (`ack`):
// `read` (they saw it) or `agree` (they accept it). What they acknowledge is
// one version of the DNA, named by its hash (`./version.ts`).
//
// The person-profile lens `'dna'` (`<home>/dna/<home>`) is a different thing
// that keeps its old storage name; nothing here touches it.

import type { AlleleIcon } from './icons.js';

export const GENE_KINDS = Object.freeze(['purpose', 'values', 'agreements', 'practices', 'roles', 'tools', 'terms', 'custom'] as const);
export type GeneKind = (typeof GENE_KINDS)[number];

export const ACK_MODES = Object.freeze(['none', 'read', 'agree'] as const);
export type AckMode = (typeof ACK_MODES)[number];

export type { AlleleIcon } from './icons.js';

/** A link shown with a gene or an allele. */
export interface GeneLink {
  label: string;
  href: string;
  icon?: AlleleIcon;
}

/** The long form of an allele (a framework explained, with its steps and reading). */
export interface AlleleDetail {
  body: string;
  steps?: string[];
  links?: GeneLink[];
  image?: { src: string; alt: string };
}

export interface Allele {
  /** Slug, unique within its gene. */
  id: string;
  title: string;
  kicker?: string;
  body?: string;
  icon?: AlleleIcon;
  link?: GeneLink;
  detail?: AlleleDetail;
  /**
   * `"<geneId>/<alleleId>"`: this allele shows that one here. The target
   * must exist and must not itself be a ref (one level). The owner gene
   * lists where it is expressed by following refs back.
   */
  ref?: string;
}

export interface Gene {
  /** Slug; also the record id in the `genes` lens. */
  id: string;
  kind: GeneKind;
  title: string;
  blurb: string;
  /** `#rrggbb`. Decoration: not part of the hash. */
  color?: string;
  /** Position on the front page. Not part of the hash: reordering asks nobody to acknowledge again. */
  order: number;
  ack: AckMode;
  links?: GeneLink[];
  alleles: Allele[];
  /** The language the text is written in; v1 has one language per gene. */
  lang: string;
  /** ISO 8601 of the last edit ('' for a template never saved). */
  updated: string;
}

/** What an editor hands `putGene`: any part may be missing; an id is made when there is none. */
export type GeneDraft = Partial<Omit<Gene, 'alleles' | 'links'>> & {
  alleles?: Array<Partial<Allele>>;
  links?: Array<Partial<GeneLink>>;
};

export type GeneIssueCode =
  | 'bad-id'
  | 'duplicate-id'
  | 'missing-title'
  | 'duplicate-kind'
  | 'too-many'
  | 'too-long'
  | 'too-large'
  | 'duplicate-allele'
  | 'bad-link'
  | 'ref-malformed'
  | 'ref-missing'
  | 'ref-nested'
  | 'referenced';

/** One thing wrong with a gene: the editor shows these live, `putGene` refuses on any. */
export interface GeneIssue {
  code: GeneIssueCode;
  gene: string;
  allele?: string;
  /** The field at fault, e.g. `blurb`, `body`, `detail.body`, `links[0].href`; for `too-many`, what there are too many of (`genes`, `alleles`, `links`, `detail.steps`). */
  field?: string;
  /** The limit crossed (characters, bytes or a count). */
  limit?: number;
  /** What was found against `limit`. */
  actual?: number;
  message: string;
}

/** Thrown by writes that would store an invalid gene; carries every issue found. */
export class GeneInvalid extends Error {
  readonly issues: GeneIssue[];
  constructor(issues: GeneIssue[]) {
    super(issues.map((i) => i.message).join('; ') || 'invalid gene');
    this.name = 'GeneInvalid';
    this.issues = issues;
  }
}

/** The acknowledgement each kind asks for when a gene names none. */
export const GENE_KIND_DEFAULTS: Readonly<Record<GeneKind, { ack: AckMode }>> = Object.freeze({
  purpose: { ack: 'read' },
  values: { ack: 'agree' },
  agreements: { ack: 'agree' },
  practices: { ack: 'agree' },
  roles: { ack: 'none' },
  tools: { ack: 'none' },
  terms: { ack: 'agree' },
  custom: { ack: 'read' },
});

/** Kinds a holon has at most one gene of. */
export const SINGLE_KINDS: readonly GeneKind[] = Object.freeze(['purpose', 'terms']);

export const GENE_LIMITS = Object.freeze({
  genes: 12,
  allelesPerGene: 32,
  /** Gene, allele and link titles/labels, and kickers. */
  title: 200,
  blurb: 600,
  body: 2000,
  termsBody: 8000,
  detailBody: 4000,
  /** One step of a detail. */
  step: 600,
  steps: 24,
  links: 12,
  href: 2048,
  /** Serialized UTF-8 bytes of one gene record: room under the relay's 64 KB for the envelope, `_clock` and tags. */
  bytes: 48 * 1024,
});
