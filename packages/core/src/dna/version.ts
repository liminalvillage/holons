// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Naming a version of the DNA. A person who asks to join acknowledges ONE
// version by its hash, signed into their request; an admin who then edits
// what readers are shown makes that acknowledgement outdated.
//
// So the hash covers exactly what a reader is shown and nothing else:
//   geneHash — id, kind, ack, title, blurb, link labels and targets, and per
//              allele (in order) id, title, kicker, body, link, detail
//              (body, steps, links) and ref.
//              NOT color, icons, order, the detail image or `updated`.
//   dnaHash  — the genes that ask for an acknowledgement, sorted by id, so
//              reordering the front page invalidates nobody's consent.

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import type { Allele, Gene, GeneLink } from './types.js';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** JSON with keys sorted at every depth; `undefined` members dropped. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): Json {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : sortKeys(v)));
  if (value && typeof value === 'object') {
    const out: { [k: string]: Json } = {};
    for (const k of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortKeys(v);
    }
    return out;
  }
  return value as Json;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

const linkView = (l: GeneLink | undefined) => (l ? { label: l.label, href: l.href } : undefined);

const linksView = (ls: GeneLink[] | undefined) => (ls ?? []).map((l) => ({ label: l.label, href: l.href }));

function alleleView(a: Allele) {
  const d = a.detail;
  return {
    id: a.id,
    title: str(a.title),
    kicker: str(a.kicker),
    body: str(a.body),
    link: linkView(a.link),
    detail: d ? { body: d.body, steps: d.steps?.length ? d.steps : undefined, links: d.links?.length ? linksView(d.links) : undefined } : undefined,
    ref: str(a.ref),
  };
}

/** What a reader of `gene` is shown, as the hash sees it. */
export function hashedView(gene: Gene) {
  return {
    id: gene.id,
    kind: gene.kind,
    ack: gene.ack,
    title: gene.title,
    blurb: gene.blurb ?? '',
    links: linksView(gene.links),
    alleles: (gene.alleles ?? []).map(alleleView),
  };
}

const sha256Hex = (text: string): string => bytesToHex(sha256(utf8ToBytes(text)));

/** sha256 (hex) of what a reader of the gene is shown. */
export function geneHash(gene: Gene): string {
  return sha256Hex(canonicalJson(hashedView(gene)));
}

/**
 * sha256 (hex) over `id:geneHash` of every gene that asks for an
 * acknowledgement, sorted by id — or null when no gene asks for one.
 */
export function dnaHash(genes: readonly Gene[]): string | null {
  const lines = genes
    .filter((g) => g.ack !== 'none')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((g) => `${g.id}:${geneHash(g)}`);
  return lines.length ? sha256Hex(lines.join('\n')) : null;
}

/** The first 8 hex characters: how a hash is shown to people. */
export function shortHash(hash: string | null | undefined): string | null {
  return typeof hash === 'string' && hash.length >= 8 ? hash.slice(0, 8) : null;
}
