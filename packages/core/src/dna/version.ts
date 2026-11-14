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
//              (body, steps, links). A ref allele is hashed as its ref plus
//              the card it SHOWS, resolved among the holon's genes: what a
//              reader sees there is the target's text, so editing that text
//              outdates the acknowledgement of every gene showing it — even
//              when the target lives in a gene nobody acknowledges.
//              NOT color, icons, order, the detail image or `updated`.
//   dnaHash  — the genes that ask for an acknowledgement, sorted by id, so
//              reordering the front page invalidates nobody's consent.

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { shownByRef } from './genes.js';
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

/**
 * The detail as a reader is shown it: body, steps and links. A detail that
 * holds only an image (or nothing) is no detail to the hash, so attaching a
 * picture never outdates anyone's acknowledgement.
 */
function detailView(d: Allele['detail']) {
  if (!d) return undefined;
  const body = str(d.body);
  const steps = d.steps?.length ? d.steps : undefined;
  const links = d.links?.length ? linksView(d.links) : undefined;
  return body || steps || links ? { body: body ?? '', steps, links } : undefined;
}

/** The text of a card: what a reader reads on it, wherever it is shown. */
function cardView(a: Allele) {
  return {
    title: str(a.title),
    kicker: str(a.kicker),
    body: str(a.body),
    link: linkView(a.link),
    detail: detailView(a.detail),
  };
}

/**
 * An allele as the hash sees it. A plain one is its id and card. A ref is
 * its id, the ref and the card it shows (`null` when it shows none, as the
 * front then shows nothing): its own stored text is never shown, so it is
 * not hashed either.
 */
function alleleView(a: Allele, genes: readonly Gene[]) {
  const ref = str(a.ref);
  if (!ref) return { id: a.id, ...cardView(a) };
  const shown = shownByRef(ref, genes);
  return { id: a.id, ref, shows: shown ? cardView(shown) : null };
}

/**
 * What a reader of `gene` is shown, as the hash sees it. `genes` is the
 * holon's DNA the gene's refs resolve in (an older copy of `gene` in it is
 * ignored: refs to its own alleles resolve in `gene` itself).
 */
export function hashedView(gene: Gene, genes: readonly Gene[]) {
  const within = [gene, ...genes.filter((g) => g.id !== gene.id)];
  return {
    id: gene.id,
    kind: gene.kind,
    ack: gene.ack,
    title: gene.title,
    blurb: gene.blurb ?? '',
    links: linksView(gene.links),
    alleles: (gene.alleles ?? []).map((a) => alleleView(a, within)),
  };
}

const sha256Hex = (text: string): string => bytesToHex(sha256(utf8ToBytes(text)));

/**
 * sha256 (hex) of what a reader of `gene` is shown, its refs resolved among
 * `genes` (the holon's DNA). There is no form without the DNA: a gene's
 * hash is only ever the one its reader acknowledges.
 */
export function geneHash(gene: Gene, genes: readonly Gene[]): string {
  return sha256Hex(canonicalJson(hashedView(gene, genes)));
}

/**
 * sha256 (hex) over `id:geneHash` of every gene that asks for an
 * acknowledgement, sorted by id — or null when no gene asks for one.
 */
export function dnaHash(genes: readonly Gene[]): string | null {
  const lines = genes
    .filter((g) => g.ack !== 'none')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((g) => `${g.id}:${geneHash(g, genes)}`);
  return lines.length ? sha256Hex(lines.join('\n')) : null;
}

/** The first 8 hex characters: how a hash is shown to people. */
export function shortHash(hash: string | null | undefined): string | null {
  return typeof hash === 'string' && hash.length >= 8 ? hash.slice(0, 8) : null;
}
