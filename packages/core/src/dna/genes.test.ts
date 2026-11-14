// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { createHoloSphere } from '../holosphere/factory.js';
import { testKey } from '../protocol/testing.js';
import {
  GENES_LENS,
  geneBytes,
  geneSlug,
  normalizeGene,
  purposeAbout,
  putGene,
  readGenes,
  removeGene,
  reorderGenes,
  subscribeGenes,
  validateGene,
  validateGenes,
} from './genes.js';
import { dnaHash } from './version.js';
import { GENE_LIMITS, GeneInvalid, type Allele, type Gene, type GeneIssue } from './types.js';

const gene = (fields: Partial<Gene> = {}): Gene => ({
  id: 'values',
  kind: 'values',
  title: 'Values',
  blurb: 'What we hold on to.',
  order: 0,
  ack: 'agree',
  alleles: [{ id: 'care', title: 'Care', body: 'We look after each other.' }],
  lang: 'en',
  updated: '',
  ...fields,
});

const alleles = (n: number, body = 'x'): Allele[] => Array.from({ length: n }, (_, i) => ({ id: `a${i}`, title: `A${i}`, body }));
const codes = (issues: GeneIssue[]) => issues.map((i) => i.code);

function instance() {
  const hs = createHoloSphere({ appName: 'holons-test', privateKey: bytesToHex(testKey().sk), store: { adapter: 'memory' } });
  const h = hs as unknown as { publishNostrEvents(e: unknown): void; subscribeNostr(): () => void };
  h.publishNostrEvents = () => {};
  h.subscribeNostr = () => () => {};
  return hs;
}

const HOLON = 'dna-test-holon';
const at = (iso: string) => () => new Date(iso);

describe('geneSlug', () => {
  it('makes a lowercase ASCII slug', () => {
    expect(geneSlug('Our Values!')).toBe('our-values');
    expect(geneSlug('  Perché è così  ')).toBe('perche-e-cosi');
    expect(geneSlug('')).toBe('');
    expect(geneSlug('x'.repeat(80))).toHaveLength(64);
  });
});

describe('normalizeGene', () => {
  it('drops what is not a gene', () => {
    expect(normalizeGene(null)).toBeNull();
    expect(normalizeGene('values')).toBeNull();
    expect(normalizeGene([])).toBeNull();
    expect(normalizeGene({ id: 'values', title: 'Values', _deleted: true })).toBeNull();
    expect(normalizeGene({ blurb: 'no name' })).toBeNull();
  });

  it('fills defaults and drops unknown fields', () => {
    const g = normalizeGene({ id: 'x', title: ' Things ', kind: 'weird', _clock: { title: 1 }, _verified: true, extra: 1 })!;
    expect(g).toEqual({ id: 'x', kind: 'custom', title: 'Things', blurb: '', order: 0, ack: 'read', alleles: [], lang: 'en', updated: '' });
    expect(normalizeGene({ id: 't', title: 'Tools', kind: 'tools' })!.ack).toBe('none');
    expect(normalizeGene({ id: 'v', title: 'Values', kind: 'values' })!.ack).toBe('agree');
    expect(normalizeGene({ id: 'p', title: 'Purpose', kind: 'purpose' })!.ack).toBe('read');
    expect(normalizeGene({ id: 'v', title: 'V', kind: 'values', ack: 'none' })!.ack).toBe('none');
  });

  it('takes its id from the title when it has none', () => {
    expect(normalizeGene({ title: 'How We Decide' })!.id).toBe('how-we-decide');
  });

  it('keeps a valid color (lowercased), drops anything else', () => {
    expect(normalizeGene({ id: 'x', title: 'X', color: '#AABBCC' })!.color).toBe('#aabbcc');
    expect(normalizeGene({ id: 'x', title: 'X', color: 'red' })!.color).toBeUndefined();
    expect(normalizeGene({ id: 'x', title: 'X', order: '3' })!.order).toBe(3);
    expect(normalizeGene({ id: 'x', title: 'X', order: 'soon' })!.order).toBe(0);
  });

  it('drops blank alleles, links without a target, unknown icons and empty details', () => {
    const g = normalizeGene({
      id: 'x',
      title: 'X',
      links: [{ label: 'Nowhere' }, { href: 'https://a.org' }, { label: 'B', href: '/b', icon: '🌱' }],
      alleles: [
        { title: '' },
        { title: 'Care', icon: 'heart', detail: { body: '' }, link: { label: 'L' } },
        { title: 'Care' },
        { ref: 'other/care' },
      ],
    })!;
    expect(g.links).toEqual([{ label: 'https://a.org', href: 'https://a.org' }, { label: 'B', href: '/b' }]);
    expect(g.alleles).toEqual([
      { id: 'care', title: 'Care', icon: 'heart' },
      { id: 'care-2', title: 'Care' },
      { id: 'other-care', title: '', ref: 'other/care' },
    ]);
  });

  it('keeps a stated allele id as it is, so a duplicate is reported, not renamed', () => {
    const g = normalizeGene({ id: 'x', title: 'X', alleles: [{ id: 'a', title: 'A' }, { id: 'a', title: 'B' }] })!;
    expect(g.alleles.map((a) => a.id)).toEqual(['a', 'a']);
    expect(codes(validateGene(g))).toContain('duplicate-allele');
  });
});

describe('validateGene', () => {
  it('passes a plain gene', () => {
    expect(validateGene(gene())).toEqual([]);
  });

  it('needs a title and a slug id', () => {
    expect(codes(validateGene(gene({ title: '' })))).toEqual(['missing-title']);
    expect(codes(validateGene(gene({ id: 'Not A Slug' })))).toEqual(['bad-id']);
    expect(codes(validateGene(gene({ alleles: [{ id: 'a', title: '' }] })))).toEqual(['missing-title']);
  });

  it('counts genes and alleles', () => {
    const others = Array.from({ length: GENE_LIMITS.genes }, (_, i) => gene({ id: `g${i}`, kind: 'custom' }));
    expect(validateGene(gene({ id: 'g0', kind: 'custom' }), others)).toEqual([]);
    const over = validateGene(gene(), others);
    expect(over).toEqual([expect.objectContaining({ code: 'too-many', field: 'genes', limit: 12, actual: 13 })]);
    expect(validateGene(gene({ alleles: alleles(32) }))).toEqual([]);
    expect(validateGene(gene({ alleles: alleles(33) }))).toEqual([expect.objectContaining({ code: 'too-many', field: 'alleles', limit: 32, actual: 33 })]);
  });

  it('holds the character limits', () => {
    expect(validateGene(gene({ blurb: 'b'.repeat(600) }))).toEqual([]);
    expect(validateGene(gene({ blurb: 'b'.repeat(601) }))).toEqual([expect.objectContaining({ code: 'too-long', field: 'blurb', limit: 600, actual: 601 })]);
    expect(validateGene(gene({ alleles: alleles(1, 'x'.repeat(2000)) }))).toEqual([]);
    expect(validateGene(gene({ alleles: alleles(1, 'x'.repeat(2001)) }))).toEqual([
      expect.objectContaining({ code: 'too-long', allele: 'a0', field: 'body', limit: 2000 }),
    ]);
    const detail = (n: number) => gene({ alleles: [{ id: 'a', title: 'A', detail: { body: 'd'.repeat(n) } }] });
    expect(validateGene(detail(4000))).toEqual([]);
    expect(codes(validateGene(detail(4001)))).toEqual(['too-long']);
    // Characters, not UTF-16 units: an accented or astral text counts what a reader sees.
    expect(validateGene(gene({ blurb: '𝔞'.repeat(600) }))).toEqual([]);
  });

  it('lets a terms allele run to 8000 characters', () => {
    const terms = (n: number) => gene({ id: 'terms', kind: 'terms', alleles: alleles(1, 't'.repeat(n)) });
    expect(validateGene(terms(8000))).toEqual([]);
    expect(validateGene(terms(8001))).toEqual([expect.objectContaining({ code: 'too-long', field: 'body', limit: 8000 })]);
  });

  it('caps the serialized record at 48 KB, and says how big it is', () => {
    // Seven terms alleles of 8000 characters each: every one is within its
    // own limit, the whole is not.
    const g = gene({ id: 'terms', kind: 'terms', alleles: alleles(7, 't'.repeat(8000)) });
    const issues = validateGene(g);
    expect(issues).toEqual([expect.objectContaining({ code: 'too-large', limit: 48 * 1024, actual: geneBytes(g) })]);
    expect(geneBytes(g)).toBeGreaterThan(48 * 1024);
    // Bytes, not characters: a text of 3-byte characters gets there sooner.
    const wide = gene({ id: 'terms', kind: 'terms', alleles: alleles(3, '€'.repeat(6000)) });
    expect(codes(validateGene(wide))).toEqual(['too-large']);
    const fits = gene({ id: 'terms', kind: 'terms', alleles: alleles(5, 't'.repeat(8000)) });
    expect(validateGene(fits)).toEqual([]);
  });

  it('allows one purpose gene and one terms gene', () => {
    const others = [gene({ id: 'purpose', kind: 'purpose' }), gene({ id: 'terms', kind: 'terms' })];
    expect(validateGene(gene({ id: 'purpose', kind: 'purpose', title: 'Purpose, edited' }), others)).toEqual([]);
    expect(codes(validateGene(gene({ id: 'why', kind: 'purpose' }), others))).toEqual(['duplicate-kind']);
    expect(codes(validateGene(gene({ id: 'rules', kind: 'terms' }), others))).toEqual(['duplicate-kind']);
    expect(validateGene(gene({ id: 'more-values', kind: 'values' }), [gene()])).toEqual([]);
  });

  it('refuses links that are not http(s), mailto, tg or site links', () => {
    expect(validateGene(gene({ links: [{ label: 'ok', href: 'https://a.org' }, { label: 'site', href: '/apply' }, { label: 'mail', href: 'mailto:a@b.org' }] }))).toEqual([]);
    expect(codes(validateGene(gene({ links: [{ label: 'x', href: 'javascript:alert(1)' }] })))).toEqual(['bad-link']);
    expect(codes(validateGene(gene({ alleles: [{ id: 'a', title: 'A', link: { label: 'x', href: '//evil.org' } }] })))).toEqual(['bad-link']);
    expect(codes(validateGene(gene({ alleles: [{ id: 'a', title: 'A', detail: { body: 'b', image: { src: 'data:image/png;base64,AA', alt: '' } } }] })))).toEqual(['bad-link']);
  });

  describe('refs', () => {
    const tools = gene({ id: 'tools', kind: 'tools', ack: 'none', alleles: [{ id: 'triz', title: 'TRIZ', detail: { body: 'Long form.' } }, { id: 'echo', title: '', ref: 'values/care' }] });

    it('resolve one level, in another gene or the same one', () => {
      expect(validateGene(gene({ alleles: [{ id: 'care', title: 'Care' }, { id: 'triz', title: '', ref: 'tools/triz' }] }), [tools])).toEqual([]);
      expect(validateGene(gene({ alleles: [{ id: 'care', title: 'Care' }, { id: 'again', title: '', ref: 'values/care' }] }))).toEqual([]);
    });

    it('must name an existing allele', () => {
      const care = { id: 'care', title: 'Care' };
      expect(codes(validateGene(gene({ alleles: [care, { id: 'x', title: '', ref: 'tools/nope' }] }), [tools]))).toEqual(['ref-missing']);
      expect(codes(validateGene(gene({ alleles: [care, { id: 'x', title: '', ref: 'ghost/triz' }] }), [tools]))).toEqual(['ref-missing']);
    });

    it('must not point at another ref', () => {
      expect(codes(validateGene(gene({ id: 'agreements', kind: 'agreements', alleles: [{ id: 'x', title: '', ref: 'tools/echo' }] }), [tools, gene()]))).toEqual(['ref-nested']);
    });

    it('must be "<gene>/<allele>"', () => {
      expect(codes(validateGene(gene({ alleles: [{ id: 'care', title: 'Care' }, { id: 'x', title: '', ref: 'triz' }] }), [tools]))).toEqual(['ref-malformed']);
    });

    it('keep an allele another gene shows from being dropped', () => {
      expect(validateGene(gene(), [tools])).toEqual([]);
      expect(validateGene(gene({ alleles: [] }), [tools])).toEqual([expect.objectContaining({ code: 'referenced', allele: 'care' })]);
    });

    it('keep an allele another gene shows from becoming a ref itself', () => {
      const agreements = gene({ id: 'agreements', kind: 'agreements', alleles: [{ id: 'consent', title: 'Consent' }] });
      const nested = gene({ alleles: [{ id: 'care', title: '', ref: 'agreements/consent' }] });
      expect(validateGene(nested, [tools, agreements])).toEqual([expect.objectContaining({ code: 'referenced', allele: 'care', field: 'ref' })]);
    });
  });
});

describe('validateGenes', () => {
  it('reports too many genes once, not once per gene', () => {
    const all = Array.from({ length: GENE_LIMITS.genes + 1 }, (_, i) => gene({ id: `g${i}`, kind: 'custom' }));
    expect(validateGenes(all)).toEqual([expect.objectContaining({ code: 'too-many', field: 'genes', actual: 13 })]);
  });

  it('reports a second purpose once, and ids used twice', () => {
    const issues = validateGenes([gene({ id: 'a', kind: 'purpose' }), gene({ id: 'b', kind: 'purpose' }), gene({ id: 'b', kind: 'custom' })]);
    expect(issues.filter((i) => i.code === 'duplicate-kind').map((i) => i.gene)).toEqual(['b']);
    expect(issues.filter((i) => i.code === 'duplicate-id').map((i) => i.gene)).toEqual(['b']);
  });
});

describe('purposeAbout', () => {
  it('is the purpose gene blurb, or empty', () => {
    expect(purposeAbout([])).toBe('');
    expect(purposeAbout([gene()])).toBe('');
    expect(purposeAbout([gene(), gene({ id: 'purpose', kind: 'purpose', blurb: '  We grow food together.  ' })])).toBe('We grow food together.');
  });
});

describe('the genes lens', () => {
  it('stores a gene under its id, ids and order made when missing', async () => {
    const hs = instance();
    const p = await putGene(hs, HOLON, { kind: 'purpose', title: 'Purpose', blurb: 'Why we are here.' }, { now: at('2026-11-01T10:00:00Z') });
    expect(p).toMatchObject({ id: 'purpose', order: 0, ack: 'read', updated: '2026-11-01T10:00:00.000Z' });
    const v = await putGene(hs, HOLON, { kind: 'values', title: 'Our Values', alleles: [{ title: 'Care' }] });
    expect(v).toMatchObject({ id: 'our-values', order: 1, ack: 'agree', alleles: [{ id: 'care', title: 'Care' }] });
    const again = await putGene(hs, HOLON, { kind: 'custom', title: 'Our Values' });
    expect(again.id).toBe('our-values-2');
    expect((await hs.get(HOLON, GENES_LENS, 'purpose'))?.blurb).toBe('Why we are here.');
    expect((await readGenes(hs, HOLON)).map((g) => g.id)).toEqual(['purpose', 'our-values', 'our-values-2']);
  });

  it('keeps a gene at its place when it is edited', async () => {
    const hs = instance();
    await putGene(hs, HOLON, { kind: 'purpose', title: 'Purpose' });
    await putGene(hs, HOLON, { kind: 'values', id: 'values', title: 'Values' });
    const edited = await putGene(hs, HOLON, { kind: 'purpose', id: 'purpose', title: 'Purpose', blurb: 'Edited.' });
    expect(edited.order).toBe(0);
    expect(purposeAbout(await readGenes(hs, HOLON))).toBe('Edited.');
  });

  it('changes only what a draft for a stored gene names', async () => {
    const hs = instance();
    await putGene(hs, HOLON, { kind: 'values', id: 'values', title: 'Values', ack: 'read', alleles: [{ title: 'Care' }] });
    const edited = await putGene(hs, HOLON, { id: 'values', blurb: 'New.', kind: undefined });
    expect(edited).toMatchObject({ kind: 'values', ack: 'read', title: 'Values', blurb: 'New.', alleles: [{ id: 'care', title: 'Care' }] });
  });

  it('stores text in one Unicode form, so composed and decomposed typing agree', async () => {
    const hs = instance();
    const composed = await putGene(hs, HOLON, { kind: 'custom', id: 'a', title: 'Caf\u00e9' });
    const decomposed = await putGene(hs, HOLON, { kind: 'custom', id: 'a', title: 'Cafe\u0301' });
    expect(decomposed.title).toBe(composed.title);
    expect(dnaHash([decomposed])).toBe(dnaHash([composed]));
  });

  it('refuses an invalid gene with every issue, and stores nothing', async () => {
    const hs = instance();
    await putGene(hs, HOLON, { kind: 'purpose', title: 'Purpose' });
    const err = await putGene(hs, HOLON, { kind: 'purpose', id: 'why', title: 'Why', blurb: 'b'.repeat(601) }).catch((e) => e);
    expect(err).toBeInstanceOf(GeneInvalid);
    expect(codes((err as GeneInvalid).issues).sort()).toEqual(['duplicate-kind', 'too-long']);
    expect((await readGenes(hs, HOLON)).map((g) => g.id)).toEqual(['purpose']);
    await expect(putGene(hs, HOLON, { title: '' })).rejects.toBeInstanceOf(GeneInvalid);
  });

  it('reorders without changing the DNA hash, writing only what moved', async () => {
    const hs = instance();
    await putGene(hs, HOLON, { kind: 'purpose', title: 'Purpose', blurb: 'Why.' });
    await putGene(hs, HOLON, { kind: 'values', id: 'values', title: 'Values', alleles: [{ title: 'Care' }] });
    await putGene(hs, HOLON, { kind: 'tools', id: 'tools', title: 'Tools' });
    const before = await readGenes(hs, HOLON);
    const moved = await reorderGenes(hs, HOLON, ['tools', 'purpose']);
    expect(moved.map((g) => g.id)).toEqual(['tools', 'purpose', 'values']);
    const after = await readGenes(hs, HOLON);
    expect(after.map((g) => [g.id, g.order])).toEqual([
      ['tools', 0],
      ['purpose', 1],
      ['values', 2],
    ]);
    expect(after.find((g) => g.id === 'values')!.updated).toBe(before.find((g) => g.id === 'values')!.updated);
    expect(dnaHash(after)).toBe(dnaHash(before));
  });

  it('removes a gene, but not while another gene shows one of its alleles', async () => {
    const hs = instance();
    await putGene(hs, HOLON, { kind: 'tools', id: 'tools', title: 'Tools', alleles: [{ id: 'triz', title: 'TRIZ' }] });
    await putGene(hs, HOLON, { kind: 'practices', id: 'practices', title: 'Practices', alleles: [{ id: 'triz', ref: 'tools/triz' }] });
    await expect(removeGene(hs, HOLON, 'tools')).rejects.toBeInstanceOf(GeneInvalid);
    await removeGene(hs, HOLON, 'practices');
    await removeGene(hs, HOLON, 'tools');
    expect(await readGenes(hs, HOLON)).toEqual([]);
  });

  it('refuses to drop an allele another gene shows', async () => {
    const hs = instance();
    await putGene(hs, HOLON, { kind: 'tools', id: 'tools', title: 'Tools', alleles: [{ id: 'triz', title: 'TRIZ' }] });
    await putGene(hs, HOLON, { kind: 'practices', id: 'practices', title: 'Practices', alleles: [{ id: 'triz', ref: 'tools/triz' }] });
    const err = await putGene(hs, HOLON, { kind: 'tools', id: 'tools', title: 'Tools', alleles: [] }).catch((e) => e);
    expect(codes((err as GeneInvalid).issues)).toEqual(['referenced']);
  });

  it('refuses to turn an allele another gene shows into a ref', async () => {
    const hs = instance();
    await putGene(hs, HOLON, { kind: 'tools', id: 'tools', title: 'Tools', alleles: [{ id: 'triz', title: 'TRIZ' }] });
    await putGene(hs, HOLON, { kind: 'practices', id: 'practices', title: 'Practices', alleles: [{ id: 'triz', ref: 'tools/triz' }] });
    await putGene(hs, HOLON, { kind: 'values', id: 'values', title: 'Values', alleles: [{ id: 'care', title: 'Care' }] });
    const err = await putGene(hs, HOLON, { kind: 'tools', id: 'tools', title: 'Tools', alleles: [{ id: 'triz', ref: 'values/care' }] }).catch((e) => e);
    expect(err).toBeInstanceOf(GeneInvalid);
    expect(codes((err as GeneInvalid).issues)).toEqual(['referenced']);
    expect(validateGenes(await readGenes(hs, HOLON))).toEqual([]);
  });

  it('is watched as one sorted list, until stopped', async () => {
    const hs = instance();
    await putGene(hs, HOLON, { kind: 'values', id: 'values', title: 'Values', order: 1 });
    const seen: string[][] = [];
    const stop = subscribeGenes(hs, HOLON, (genes) => seen.push(genes.map((g) => g.id)));
    const settle = () => new Promise((r) => setTimeout(r, 30));
    await settle();
    expect(seen.at(-1)).toEqual(['values']);
    await putGene(hs, HOLON, { kind: 'purpose', title: 'Purpose', order: 0 });
    await settle();
    expect(seen.at(-1)).toEqual(['purpose', 'values']);
    await removeGene(hs, HOLON, 'values');
    await settle();
    expect(seen.at(-1)).toEqual(['purpose']);
    stop();
    const count = seen.length;
    await putGene(hs, HOLON, { kind: 'tools', title: 'Tools' });
    await settle();
    expect(seen.length).toBe(count);
  });

  it('says so at once when there are no genes', async () => {
    const hs = instance();
    const seen: number[] = [];
    const stop = subscribeGenes(hs, 'empty-holon', (genes) => seen.push(genes.length));
    await new Promise((r) => setTimeout(r, 30));
    stop();
    expect(seen).toContain(0);
  });
});
