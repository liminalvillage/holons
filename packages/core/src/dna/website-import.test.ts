// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The parser behind scripts/import-website-dna.mjs, on a small fixture in the
// shape of the website's /dna page (and, when the website checkout is next to
// this repo, on the real page too).

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALLELE_ICONS, dnaHash, geneBytes, isAlleleIcon, validateGene, validateGenes, GENE_LIMITS } from './index.js';

// A path held in a variable keeps the untyped script out of the typecheck.
const LIB = join(__dirname, '../../../../scripts/lib/website-dna.mjs');
const lib: any = await import(pathToFileURL(LIB).href);

const HTML = `
<section class="hero"><div class="eyebrow">Founded 2018</div><p>Follow the strand.</p></section>
<section class="gene" id="agreements" data-gene="Agreements" style="--g:#3F8A8C">
  <div class="alleles"><header class="tag">
    <div class="num"><b>Gene 01</b> How we relate <small class="range"></small></div>
    <h2>Agreements</h2><p>The shared grammar.</p></header>
    <article class="allele"><span class="ico"><i class="fa-solid fa-comments"></i></span><div><div class="kicker">Marshall Rosenberg</div><h3>Non-Violent Communication</h3>
      <ol class="steps"><li><i class="fa-solid fa-eye"></i><b>Observation</b><span>what happened</span></li><li><i class="fa-solid fa-heart"></i><b>Feeling</b><span>what you feel</span></li></ol></div></article>
    <article class="allele"><span class="ico"><i class="fa-solid fa-om"></i></span><div><h3>Member <span class="stat">2h <small>/ day</small></span></h3><p>plus a ticket &amp; insurance</p></div></article>
  </div>
</section>
<section class="gene" id="tools" data-gene="Tools" style="--g:#5f7590">
  <div class="alleles"><header class="tag"><div class="num"><b>Gene 02</b> What we use <small class="range"></small></div><h2>Tools</h2><p>Open tools.</p></header>
    <a class="allele" href="/lunations"><span class="ico"><i class="fa-solid fa-moon"></i></span><div><div class="kicker">Coordination</div><h3>Lunations</h3><p>Our year in moons</p><div class="go">Calendar →</div></div></a>
    <article class="allele"><span class="ico"><i class="fa-solid fa-yin-yang"></i></span><div><h3>Inside</h3><ul class="chips">
      <li><button type="button" data-fw="nvc"><i class="fa-solid fa-comments"></i>Non-Violent Communication</button></li>
      <li><i class="fa-solid fa-people-group"></i>Circles &amp; feedback</li></ul></div></article>
  </div>
</section>`;

const CONTENT = {
  GENES: {
    agreements: { blurb: 'How we speak.', frameworks: ['nvc', 'ikigai'], links: [{ label: 'Frameworks', href: '/frameworks', icon: 'fa-map' }] },
    tools: { blurb: 'Open tools.', frameworks: ['nvc'], links: [] },
  },
  FRAMEWORKS: {
    nvc: { title: 'Non-Violent Communication', origin: 'Rosenberg', tagline: 'Say it plainly.', body: 'Observation, feeling, need, request.', steps: ['Observation', 'Feeling', 'Need', 'Request'], links: [{ label: 'CNVC', href: 'https://www.cnvc.org/' }] },
    ikigai: { title: 'Ikigai', origin: 'Japan', tagline: 'A reason for being.', body: 'Four questions.', image: { src: '/images/ikigai.svg', alt: 'diagram' }, page: '/frameworks#ikigai', links: [] },
  },
};

const isIcon = (k: string) => (ALLELE_ICONS as readonly string[]).includes(k);

describe('parseDnaHtml', () => {
  const parsed = lib.parseDnaHtml(HTML);

  it('reads genes in page order with their colour and header', () => {
    expect(parsed.genes.map((g: any) => g.id)).toEqual(['agreements', 'tools']);
    expect(parsed.genes[0]).toMatchObject({ color: '#3f8a8c', title: 'Agreements', tagline: 'How we relate', lede: 'The shared grammar.' });
    expect(parsed.hero.eyebrow).toBe('Founded 2018');
  });

  it('reads cards: icon, kicker, title, stat, steps, links, chips', () => {
    const [nvc, member] = parsed.genes[0].alleles;
    expect(nvc).toMatchObject({ icon: 'fa-comments', kicker: 'Marshall Rosenberg', title: 'Non-Violent Communication' });
    expect(nvc.steps).toEqual([
      { name: 'Observation', desc: 'what happened' },
      { name: 'Feeling', desc: 'what you feel' },
    ]);
    expect(member).toMatchObject({ title: 'Member', stat: '2h / day' });
    expect(member.p.text).toBe('plus a ticket & insurance');
    const [lunations, inside] = parsed.genes[1].alleles;
    expect(lunations).toMatchObject({ href: '/lunations', go: 'Calendar' });
    expect(inside.chips.items).toEqual([
      expect.objectContaining({ text: 'Non-Violent Communication', fw: 'nvc' }),
      expect.objectContaining({ text: 'Circles & feedback', fw: null }),
    ]);
  });
});

describe('buildGenes', () => {
  const build = () => lib.buildGenes({ parsed: lib.parseDnaHtml(HTML), content: CONTENT, isIcon, updated: '2026-01-01T00:00:00.000Z' });

  it('makes valid genes with kind, ack, colour and order', () => {
    const { genes } = build();
    expect(validateGenes(genes)).toEqual([]);
    expect(genes.map((g: any) => [g.id, g.kind, g.ack, g.order])).toEqual([
      ['agreements', 'agreements', 'agree', 1],
      ['tools', 'tools', 'none', 2],
    ]);
    expect(genes[0].color).toBe('#3f8a8c');
    expect(genes[0].blurb).toBe('How we speak.');
    for (const g of genes) expect(geneBytes(g)).toBeLessThan(GENE_LIMITS.bytes);
  });

  it('maps icons to semantic keys and reports what has none', () => {
    const { genes, unmapped } = build();
    expect(genes[0].alleles[0].icon).toBe('chat');
    expect(genes[1].alleles[0].icon).toBe('moon');
    expect(genes[0].links[0]).toEqual({ label: 'Frameworks', href: 'https://liminalvillage.com/frameworks', icon: 'map' });
    expect(unmapped).toEqual([expect.objectContaining({ fa: 'fa-om', gene: 'agreements' })]);
    expect(genes[0].alleles[1].icon).toBeUndefined();
    for (const a of genes.flatMap((g: any) => g.alleles)) if (a.icon) expect(isAlleleIcon(a.icon)).toBe(true);
  });

  it('keeps stats in the body, steps in detail, and absolutizes site links', () => {
    const { genes } = build();
    expect(genes[0].alleles[1].body).toBe('2h / day · plus a ticket & insurance');
    expect(genes[1].alleles[0].link).toEqual({ label: 'Calendar', href: 'https://liminalvillage.com/lunations' });
  });

  it('merges a framework into the card of the same name; adds the others; refs elsewhere, one level', () => {
    const { genes } = build();
    const [agreements, tools] = genes;
    const nvc = agreements.alleles.find((a: any) => a.id === 'nvc');
    expect(nvc.detail.body).toBe('Observation, feeling, need, request.');
    expect(nvc.detail.steps).toEqual(['Observation: what happened', 'Feeling: what you feel']); // the page's richer steps win
    const ikigai = agreements.alleles.find((a: any) => a.id === 'ikigai');
    expect(ikigai.detail.image).toEqual({ src: 'https://liminalvillage.com/images/ikigai.svg', alt: 'diagram' });
    expect(ikigai.detail.links[0]).toEqual({ label: 'On our Frameworks page', href: 'https://liminalvillage.com/frameworks#ikigai' });
    expect(tools.alleles.filter((a: any) => a.ref)).toEqual([{ id: 'agreements-nvc', title: 'Non-Violent Communication', ref: 'agreements/nvc' }]);
    // the framework chip that became a ref is not repeated as text
    expect(tools.alleles.find((a: any) => a.id === 'inside').body).toBe('- Circles & feedback');
    expect(validateGene(tools, genes)).toEqual([]);
  });

  it('is deterministic: the same page gives the same dnaHash', () => {
    expect(dnaHash(build().genes)).toBe(dnaHash(build().genes));
    expect(dnaHash(build().genes)).toMatch(/^[0-9a-f]{64}$/);
  });
});

const REAL = join(process.env.WEBSITE || join(homedir(), 'Projects/website'));
describe.skipIf(!existsSync(join(REAL, 'dna.html')))('the real website page', () => {
  it('gives 7 valid genes under the byte cap, with no framework ref left dangling', async () => {
    const content: any = await import(pathToFileURL(join(REAL, 'src/dna/content.js')).href);
    const parsed = lib.parseDnaHtml(readFileSync(join(REAL, 'dna.html'), 'utf8'));
    const { genes } = lib.buildGenes({ parsed, content, isIcon });
    expect(genes).toHaveLength(7);
    expect(validateGenes(genes)).toEqual([]);
    for (const g of genes) expect(geneBytes(g)).toBeLessThanOrEqual(GENE_LIMITS.bytes);
    expect(dnaHash(genes)).toMatch(/^[0-9a-f]{64}$/);
  });
});
