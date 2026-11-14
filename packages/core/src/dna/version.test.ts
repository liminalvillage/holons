// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import { canonicalJson, dnaHash, geneHash, shortHash } from './version.js';
import type { Gene } from './types.js';

const base = (): Gene => ({
  id: 'values',
  kind: 'values',
  title: 'Values',
  blurb: 'What we hold on to.',
  color: '#b45309',
  order: 1,
  ack: 'agree',
  links: [{ label: 'Read more', href: 'https://example.org/values', icon: 'book' }],
  alleles: [
    { id: 'care', title: 'Care', body: 'We look after each other.', icon: 'heart' },
    {
      id: 'commons',
      title: 'Commons',
      kicker: 'Shared',
      body: 'What we make is ours.',
      link: { label: 'Commons', href: '/commons', icon: 'seedling' },
      detail: { body: 'Long form.', steps: ['one', 'two'], links: [{ label: 'Paper', href: 'https://example.org/p' }], image: { src: '/img.png', alt: 'A field' } },
    },
  ],
  lang: 'en',
  updated: '2026-11-01T00:00:00.000Z',
});

const purpose = (): Gene => ({ id: 'purpose', kind: 'purpose', title: 'Purpose', blurb: 'Why.', order: 0, ack: 'read', alleles: [], lang: 'en', updated: '' });
const tools = (): Gene => ({ id: 'tools', kind: 'tools', title: 'Tools', blurb: 'How.', order: 2, ack: 'none', alleles: [{ id: 'triz', title: 'TRIZ' }], lang: 'en', updated: '' });

/** A gene's hash in a DNA of that gene alone. */
const own = (g: Gene) => geneHash(g, [g]);

/** The same object with its keys (at every depth) in reverse order. */
function reversed<T>(v: T): T {
  if (Array.isArray(v)) return v.map(reversed) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reversed(x)])) as T;
  return v;
}

describe('canonicalJson', () => {
  it('sorts keys at every depth and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[{"y":2,"z":1}]},"b":1}');
  });
});

describe('geneHash', () => {
  it('is 64 hex and stable under key order', () => {
    const h = own(base());
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(own(reversed(base()))).toBe(h);
  });

  it('ignores color, icons, order, the detail image and updated', () => {
    const h = own(base());
    const g = base();
    g.color = '#000000';
    g.order = 9;
    g.updated = '2030-01-01T00:00:00.000Z';
    g.links![0].icon = 'link';
    g.alleles[0].icon = 'star';
    g.alleles[1].link!.icon = 'leaf';
    g.alleles[1].detail!.image = { src: '/other.png', alt: 'Other' };
    g.alleles[1].detail!.links![0].icon = 'scroll';
    expect(own(g)).toBe(h);
    delete g.color;
    delete g.alleles[1].detail!.image;
    expect(own(g)).toBe(h);
  });

  it('changes with any text a reader is shown', () => {
    const h = own(base());
    const edits: Array<(g: Gene) => void> = [
      (g) => (g.title = 'Our values'),
      (g) => (g.blurb = 'Something else.'),
      (g) => (g.ack = 'read'),
      (g) => (g.kind = 'custom'),
      (g) => (g.links![0].href = 'https://example.org/other'),
      (g) => (g.links![0].label = 'More'),
      (g) => g.links!.push({ label: 'Extra', href: '/x' }),
      (g) => (g.alleles[0].title = 'Caring'),
      (g) => (g.alleles[0].body = 'We look after each other, always.'),
      (g) => (g.alleles[1].kicker = 'Ours'),
      (g) => (g.alleles[1].link!.href = '/elsewhere'),
      (g) => (g.alleles[1].detail!.body = 'Longer form.'),
      (g) => g.alleles[1].detail!.steps!.push('three'),
      (g) => (g.alleles[1].detail!.links![0].href = 'https://example.org/q'),
      (g) => (g.alleles[0].ref = 'purpose/why'),
      (g) => g.alleles.reverse(),
      (g) => g.alleles.pop(),
    ];
    for (const edit of edits) {
      const g = base();
      edit(g);
      expect(own(g)).not.toBe(h);
    }
  });

  it('treats absent and empty optional parts alike', () => {
    expect(own({ ...base(), links: [] })).toBe(own({ ...base(), links: undefined }));
    const steps = base();
    steps.alleles[1].detail!.steps = [];
    const noSteps = base();
    delete noSteps.alleles[1].detail!.steps;
    expect(own(steps)).toBe(own(noSteps));
  });

  it('treats a detail holding only an image as no detail', () => {
    const plain = (): Gene => ({ ...purpose(), alleles: [{ id: 'x', title: 'X' }] });
    const h = own(plain());
    const pictured = plain();
    pictured.alleles[0].detail = { body: '', image: { src: '/a.png', alt: '' } };
    expect(own(pictured)).toBe(h);
    const bare = plain();
    bare.alleles[0].detail = { body: '' };
    expect(own(bare)).toBe(h);
  });

  it('treats an empty detail body and a missing one alike', () => {
    const withBody = base();
    withBody.alleles[1].detail!.body = '';
    const noBody = base();
    delete (noBody.alleles[1].detail as { body?: string }).body;
    expect(own(withBody)).toBe(own(noBody));
  });
});

describe('geneHash of a ref', () => {
  // A gene asked to be agreed to shows a card that lives in a gene nobody
  // is asked to acknowledge: the text people agree to is the target's.
  const frameworks = (): Gene => ({
    id: 'frameworks',
    kind: 'tools',
    title: 'Frameworks',
    blurb: 'How we work.',
    order: 3,
    ack: 'none',
    alleles: [{ id: 'nvc', title: 'NVC', kicker: 'Speech', body: 'We speak without blame.', icon: 'heart', detail: { body: 'Observe, feel, need, request.', steps: ['observe'] } }],
    lang: 'en',
    updated: '',
  });
  const agreements = (): Gene => ({
    id: 'agreements',
    kind: 'agreements',
    title: 'Agreements',
    blurb: 'What we keep.',
    order: 1,
    ack: 'agree',
    alleles: [{ id: 'speech', title: 'stale own title', ref: 'frameworks/nvc' }],
    lang: 'en',
    updated: '',
  });
  const dna = (edit?: (f: Gene) => void): Gene[] => {
    const f = frameworks();
    edit?.(f);
    return [agreements(), f];
  };

  it('changes when the text the ref shows is edited in its own gene', () => {
    const h = geneHash(agreements(), dna());
    const edits: Array<(f: Gene) => void> = [
      (f) => (f.alleles[0].title = 'Nonviolent Communication'),
      (f) => (f.alleles[0].kicker = 'Talk'),
      (f) => (f.alleles[0].body = 'We speak, and blame whom we like.'),
      (f) => (f.alleles[0].link = { label: 'More', href: '/nvc' }),
      (f) => (f.alleles[0].detail!.body = 'Something else entirely.'),
      (f) => f.alleles[0].detail!.steps!.push('feel'),
      (f) => (f.alleles[0].ref = 'agreements/speech'),
      (f) => f.alleles.pop(),
    ];
    for (const edit of edits) expect(geneHash(agreements(), dna(edit))).not.toBe(h);
  });

  it('carries the change into dnaHash although the target gene asks for nothing', () => {
    const h = dnaHash(dna());
    expect(dnaHash(dna((f) => (f.alleles[0].body = 'Changed.')))).not.toBe(h);
  });

  it('ignores what the reader does not see: the target gene, decoration, the ref’s own text', () => {
    const h = geneHash(agreements(), dna());
    expect(geneHash(agreements(), dna((f) => (f.title = 'Methods')))).toBe(h);
    expect(geneHash(agreements(), dna((f) => (f.blurb = 'Other.')))).toBe(h);
    expect(geneHash(agreements(), dna((f) => (f.alleles[0].icon = 'star')))).toBe(h);
    expect(geneHash(agreements(), dna((f) => f.alleles.push({ id: 'triz', title: 'TRIZ' })))).toBe(h);
    const retitled = agreements();
    retitled.alleles[0].title = 'another stale title';
    expect(geneHash(retitled, dna())).toBe(h);
  });

  it('hashes a ref that shows nothing apart from one that shows a card', () => {
    const h = geneHash(agreements(), dna());
    expect(geneHash(agreements(), [agreements()])).not.toBe(h);
    expect(geneHash(agreements(), dna((f) => (f.alleles[0].id = 'gone')))).toBe(geneHash(agreements(), [agreements()]));
    const retargeted = agreements();
    retargeted.alleles[0].ref = 'frameworks/other';
    expect(geneHash(retargeted, dna())).not.toBe(geneHash(agreements(), [agreements()]));
  });

  it('resolves refs to its own alleles in the gene hashed, not an older copy in the DNA', () => {
    const self = (body: string): Gene => ({
      ...frameworks(),
      ack: 'read',
      alleles: [{ id: 'nvc', title: 'NVC', body }, { id: 'again', title: '', ref: 'frameworks/nvc' }],
    });
    expect(geneHash(self('new'), [self('old')])).toBe(own(self('new')));
    expect(own(self('new'))).not.toBe(own(self('old')));
  });
});

describe('dnaHash', () => {
  it('is null when no gene asks for an acknowledgement', () => {
    expect(dnaHash([])).toBeNull();
    expect(dnaHash([tools()])).toBeNull();
  });

  it('is unchanged by reordering, in the array or by `order`', () => {
    const h = dnaHash([purpose(), base(), tools()]);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(dnaHash([tools(), base(), purpose()])).toBe(h);
    expect(dnaHash([{ ...purpose(), order: 7 }, { ...base(), order: 0 }, tools()])).toBe(h);
  });

  it('follows the genes that ask for an acknowledgement, and only those', () => {
    const h = dnaHash([purpose(), base(), tools()]);
    expect(dnaHash([purpose(), base(), { ...tools(), title: 'Methods' }])).toBe(h);
    expect(dnaHash([{ ...purpose(), blurb: 'Why else.' }, base(), tools()])).not.toBe(h);
    expect(dnaHash([purpose(), base()])).toBe(h);
    expect(dnaHash([purpose()])).not.toBe(h);
    // Switching a gene's ack on brings it in.
    expect(dnaHash([purpose(), base(), { ...tools(), ack: 'read' }])).not.toBe(h);
  });
});

describe('shortHash', () => {
  it('is the first 8 hex characters, or null', () => {
    const h = dnaHash([purpose()])!;
    expect(shortHash(h)).toBe(h.slice(0, 8));
    expect(shortHash(null)).toBeNull();
    expect(shortHash('abc')).toBeNull();
  });
});
