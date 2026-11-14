// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { createHoloSphere } from '../holosphere/factory.js';
import { testKey } from '../protocol/testing.js';
import {
  addAllele,
  addGene,
  adoptIds,
  availableKinds,
  checkDrafts,
  draftGenes,
  mergeRemote,
  moveAllele,
  moveGene,
  planWrites,
  removeAllele,
  removeDraftGene,
  saveDrafts,
  settleDrafts,
  updateAllele,
  updateGene,
  withStarter,
  type DraftGene,
} from './edit.js';
import { readGenes } from './genes.js';
import { STARTER_GENES } from './templates.js';
import { GENE_LIMITS, type Gene } from './types.js';

const HOLON = 'dna-edit-holon';

function instance() {
  const hs = createHoloSphere({ appName: 'holons-test', privateKey: bytesToHex(testKey().sk), store: { adapter: 'memory' } });
  const h = hs as unknown as { publishNostrEvents(e: unknown): void; subscribeNostr(): () => void };
  h.publishNostrEvents = () => {};
  h.subscribeNostr = () => () => {};
  return hs;
}

const stored = (fields: Partial<Gene> = {}): Gene => ({
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

/** A draft with one titled gene and its one allele, from nothing. */
function built(): DraftGene[] {
  let d: DraftGene[] = [];
  const g = addGene(d, 'values', { title: 'Our values' });
  d = updateGene(g.drafts, g.gene.key, { blurb: 'What we hold.' });
  const a = addAllele(d, g.gene.key);
  return updateAllele(a.drafts, g.gene.key, a.allele!.key, { title: 'Care' });
}

describe('draft operations', () => {
  it('turns stored genes into rows with keys, ids kept, order and stamp left to the save', () => {
    const d = draftGenes([stored()]);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ id: 'values', title: 'Values', alleles: [{ id: 'care', title: 'Care' }] });
    expect(d[0].key).toBeTruthy();
    expect(d[0].alleles[0].key).toBeTruthy();
    expect('order' in d[0]).toBe(false);
    expect('updated' in d[0]).toBe(false);
  });

  it('adds a blank gene asking what its kind asks, and offers a single kind once', () => {
    const { drafts, gene } = addGene([], 'terms');
    expect(gene).toMatchObject({ id: '', kind: 'terms', title: '', ack: 'agree', alleles: [] });
    expect(availableKinds(drafts)).not.toContain('terms');
    expect(availableKinds(drafts)).toContain('custom');
    expect(availableKinds([])).toContain('terms');
  });

  it('a new kind brings its default acknowledgement unless one is named', () => {
    const { drafts, gene } = addGene([], 'custom');
    expect(updateGene(drafts, gene.key, { kind: 'tools' })[0].ack).toBe('none');
    expect(updateGene(drafts, gene.key, { kind: 'tools', ack: 'read' })[0].ack).toBe('read');
    expect(updateGene(drafts, gene.key, { title: 'x' })[0].ack).toBe('read');
  });

  it('moves genes and alleles, stopping at the ends, and removes them', () => {
    let d = [...built(), ...addGene([], 'tools', { title: 'Tools' }).drafts];
    const [first, second] = d;
    expect(moveGene(d, first.key, -1)).toBe(d);
    d = moveGene(d, first.key, 1);
    expect(d.map((g) => g.key)).toEqual([second.key, first.key]);
    d = removeDraftGene(d, second.key);
    expect(d.map((g) => g.key)).toEqual([first.key]);

    const a2 = addAllele(d, first.key, { title: 'Trust' });
    expect(a2.drafts[0].alleles.map((a) => a.title)).toEqual(['Care', 'Trust']);
    const up = moveAllele(a2.drafts, first.key, a2.allele!.key, -1);
    expect(up[0].alleles.map((a) => a.title)).toEqual(['Trust', 'Care']);
    expect(removeAllele(up, first.key, a2.allele!.key)[0].alleles.map((a) => a.title)).toEqual(['Care']);
    expect(addAllele(d, 'nope').allele).toBeNull();
  });

  it('starts from the starter genes, once: no second purpose, no id twice', () => {
    const all = withStarter([], 'en');
    expect(all.map((g) => g.id)).toEqual(STARTER_GENES('en').map((g) => g.id));
    expect(withStarter(all, 'en')).toHaveLength(all.length);
    const mine = addGene([], 'purpose', { title: 'Why' }).drafts;
    const rest = withStarter(mine, 'en');
    expect(rest.filter((g) => g.kind === 'purpose')).toHaveLength(1);
    expect(withStarter([], 'it')[0].title).toBe('Scopo');
  });
});

describe('settling and ids', () => {
  it('gives ids at the first save, from the title then; a single kind takes its kind', () => {
    const d = [...built(), ...addGene([], 'purpose', { title: 'Why we exist' }).drafts];
    const s = settleDrafts(d);
    expect(s.map((x) => x.gene.id)).toEqual(['our-values', 'purpose']);
    expect(s[0].gene.alleles[0].id).toBe('care');
    expect(s.map((x) => x.gene.order)).toEqual([0, 1]);
  });

  it('leaves blank alleles and links out, and tells which draft row each stored allele is', () => {
    let d = built();
    d = updateGene(d, d[0].key, { links: [{ label: 'Nowhere' }, { label: 'Home', href: '/home' }] });
    const blank = addAllele(d, d[0].key);
    const trust = addAllele(blank.drafts, d[0].key, { title: 'Trust' });
    const s = settleDrafts(trust.drafts)[0];
    expect(s.gene.alleles.map((a) => a.id)).toEqual(['care', 'trust']);
    expect(s.alleleKeys).toEqual([d[0].alleles[0].key, trust.allele!.key]);
    expect(s.gene.links).toEqual([{ label: 'Home', href: '/home' }]);
  });

  it('adopts ids once and never derives them again from a new title', () => {
    let d = built();
    d = adoptIds(d, settleDrafts(d));
    expect(d[0].id).toBe('our-values');
    expect(d[0].alleles[0].id).toBe('care');
    d = updateGene(d, d[0].key, { title: 'Something else entirely' });
    d = updateAllele(d, d[0].key, d[0].alleles[0].key, { title: 'Looking after one another' });
    const s = settleDrafts(d)[0];
    expect(s.gene.id).toBe('our-values');
    expect(s.gene.alleles[0].id).toBe('care');
  });

  it('makes two genes with one title two ids', () => {
    let d = addGene([], 'custom', { title: 'Circles' }).drafts;
    d = addGene(d, 'custom', { title: 'Circles' }).drafts;
    expect(settleDrafts(d).map((x) => x.gene.id)).toEqual(['circles', 'circles-2']);
  });
});

describe('live issues', () => {
  it('reports what a write would refuse, on the row it belongs to', () => {
    let d = built();
    d = updateGene(d, d[0].key, { title: '' });
    const check = checkDrafts(d);
    expect(check.issues).toEqual([expect.objectContaining({ code: 'missing-title', geneKey: d[0].key })]);
  });

  it('points an allele issue at its draft row', () => {
    const d0 = built();
    const withRef = addAllele(d0, d0[0].key, { ref: 'nowhere/none' });
    const check = checkDrafts(withRef.drafts);
    expect(check.issues).toEqual([expect.objectContaining({ code: 'ref-missing', geneKey: d0[0].key, alleleKey: withRef.allele!.key })]);
  });

  it('flags a disallowed link live instead of dropping it', () => {
    let d = built();
    d = updateGene(d, d[0].key, { links: [{ label: 'Evil', href: 'javascript:alert(1)' }] });
    const check = checkDrafts(d);
    expect(check.issues).toEqual([expect.objectContaining({ code: 'bad-link', geneKey: d[0].key })]);
  });

  it('measures each gene as stored and flags one over 48 KB', () => {
    let d = built();
    const small = checkDrafts(d).bytes.get(d[0].key)!;
    expect(small).toBeGreaterThan(50);
    expect(checkDrafts(d).issues).toEqual([]);
    // Four terms-sized alleles of 8000 characters is ~32 KB; add more until the cap is crossed.
    d = updateGene(d, d[0].key, { kind: 'terms' });
    for (let i = 0; i < 7; i++) {
      const a = addAllele(d, d[0].key, { title: `Part ${i}`, body: 'é'.repeat(4000) });
      d = a.drafts;
    }
    const check = checkDrafts(d);
    expect(check.bytes.get(d[0].key)!).toBeGreaterThan(GENE_LIMITS.bytes);
    expect(check.issues.map((i) => i.code)).toContain('too-large');
  });
});

describe('planning and saving', () => {
  it('writes only what changed, holds back a gene with an issue, and sends a pure move as a reorder', () => {
    const base = [stored(), stored({ id: 'tools', kind: 'tools', title: 'Tools', ack: 'none', order: 1, alleles: [] })];
    let d = draftGenes(base);
    expect(planWrites(base, checkDrafts(d))).toMatchObject({ put: [], reorder: null });

    d = moveGene(d, d[1].key, -1);
    const moved = planWrites(base, checkDrafts(d));
    expect(moved.put).toEqual([]);
    expect(moved.reorder).toEqual(['tools', 'values']);

    d = updateGene(d, d[1].key, { blurb: 'Edited' });
    d = updateGene(d, d[0].key, { title: '' });
    const plan = planWrites(base, checkDrafts(d));
    expect(plan.put.map((s) => s.gene.id)).toEqual(['values']);
    expect(plan.held.map((i) => i.code)).toEqual(['missing-title']);
  });

  it('round-trips through the lens: new gene, edit, reorder, remove', async () => {
    const hs = instance();
    let baseline: Gene[] = [];
    let d = built();
    let r = await saveDrafts(hs, HOLON, { drafts: d, baseline });
    expect(r.saved.map((s) => s.gene.id)).toEqual(['our-values']);
    expect(r.held).toEqual([]);
    d = adoptIds(d, r.saved);
    baseline = r.baseline;
    expect((await readGenes(hs, HOLON)).map((g) => [g.id, g.order])).toEqual([['our-values', 0]]);

    // A second gene before the first, and an edit to the first.
    const tools = addGene(d, 'tools', { title: 'Tools' });
    d = moveGene(tools.drafts, tools.gene.key, -1);
    d = updateGene(d, d[1].key, { blurb: 'Changed.' });
    r = await saveDrafts(hs, HOLON, { drafts: d, baseline });
    d = adoptIds(d, r.saved);
    baseline = r.baseline;
    const now = await readGenes(hs, HOLON);
    expect(now.map((g) => [g.id, g.order])).toEqual([
      ['tools', 0],
      ['our-values', 1],
    ]);
    expect(now[1].blurb).toBe('Changed.');
    expect(now[1].updated).not.toBe('');

    // Nothing changed: nothing written (the stamp stays).
    const stamp = now[1].updated;
    r = await saveDrafts(hs, HOLON, { drafts: d, baseline });
    expect(r.saved).toEqual([]);
    expect((await readGenes(hs, HOLON))[1].updated).toBe(stamp);

    // Remove one.
    r = await saveDrafts(hs, HOLON, { drafts: removeDraftGene(d, d[0].key), baseline, removed: ['tools'] });
    expect((await readGenes(hs, HOLON)).map((g) => g.id)).toEqual(['our-values']);
    expect(r.baseline.map((g) => g.id)).toEqual(['our-values']);
  });

  it('clears a gene colour and links that were stored', async () => {
    const hs = instance();
    let d = draftGenes([stored({ color: '#0f766e', links: [{ label: 'A', href: '/a' }] })]);
    let r = await saveDrafts(hs, HOLON, { drafts: d, baseline: [] });
    d = updateGene(d, d[0].key, { color: '', links: [] });
    r = await saveDrafts(hs, HOLON, { drafts: d, baseline: r.baseline });
    const g = (await readGenes(hs, HOLON))[0];
    expect(g.color).toBeUndefined();
    expect(g.links).toBeUndefined();
  });

  it('refuses a gene over the byte cap and still saves the others', async () => {
    const hs = instance();
    let d = built();
    const big = addGene(d, 'terms', { title: 'Terms' });
    d = big.drafts;
    for (let i = 0; i < 7; i++) d = addAllele(d, big.gene.key, { title: `Part ${i}`, body: 'é'.repeat(4000) }).drafts;
    const r = await saveDrafts(hs, HOLON, { drafts: d, baseline: [] });
    expect(r.saved.map((s) => s.gene.id)).toEqual(['our-values']);
    expect(r.held.map((i) => i.code)).toContain('too-large');
    expect((await readGenes(hs, HOLON)).map((g) => g.id)).toEqual(['our-values']);
  });

  it('saves a gene that refs a gene written in the same save', async () => {
    const hs = instance();
    let d = draftGenes([stored({ id: 'values' }), stored({ id: 'practices', kind: 'practices', title: 'Practices', order: 1, alleles: [] })]);
    // practices (second) is stored after values; make the FIRST one the ref holder so it must wait.
    d = moveGene(d, d[1].key, -1);
    d = addAllele(d, d[0].key, { ref: 'values/care' }).drafts;
    const r = await saveDrafts(hs, HOLON, { drafts: d, baseline: [] });
    expect(r.held).toEqual([]);
    expect(r.saved.map((s) => s.gene.id).sort()).toEqual(['practices', 'values']);
  });

  it('refuses to remove a gene another still shows, and says so', async () => {
    const hs = instance();
    let d = draftGenes([stored(), stored({ id: 'practices', kind: 'practices', title: 'Practices', order: 1, alleles: [{ id: 'c', title: '', ref: 'values/care' }] })]);
    let r = await saveDrafts(hs, HOLON, { drafts: d, baseline: [] });
    d = removeDraftGene(d, d[0].key);
    r = await saveDrafts(hs, HOLON, { drafts: d, baseline: r.baseline, removed: ['values'] });
    expect(r.held.map((i) => i.code)).toContain('referenced');
    expect((await readGenes(hs, HOLON)).map((g) => g.id).sort()).toEqual(['practices', 'values']);
  });
});

describe('following the lens', () => {
  it('takes in what arrives late, keeps a changed gene, and does not bring back a removed one', () => {
    const base = [stored(), stored({ id: 'tools', kind: 'tools', title: 'Tools', ack: 'none', order: 1, alleles: [] })];
    let d = draftGenes(base);
    d = updateGene(d, d[0].key, { blurb: 'My edit' });
    const remote = [
      stored({ blurb: 'Their edit' }),
      stored({ id: 'tools', kind: 'tools', title: 'Tools renamed', ack: 'none', order: 1, alleles: [] }),
      stored({ id: 'practices', kind: 'practices', title: 'Practices', order: 2, alleles: [] }),
    ];
    const merged = mergeRemote(d, base, remote);
    expect(merged.map((g) => [g.id, g.title, g.blurb])).toEqual([
      ['values', 'Values', 'My edit'],
      ['tools', 'Tools renamed', 'What we hold on to.'],
      ['practices', 'Practices', 'What we hold on to.'],
    ]);
    expect(merged[0].key).toBe(d[0].key);
    expect(mergeRemote(d, base, remote, ['practices']).map((g) => g.id)).toEqual(['values', 'tools']);
  });

  it('the first read arriving into an empty editor fills it; a row never saved stays', () => {
    const fresh = addGene([], 'custom', { title: 'Circles' }).drafts;
    const merged = mergeRemote(fresh, [], [stored()]);
    expect(merged.map((g) => g.title)).toEqual(['Values', 'Circles']);
  });

});

describe('untouched starter rows', () => {
  const starterOf = (id: string, rows: DraftGene[]) => rows.find((g) => g.id === id)!;

  it('are marked, shown in the settled draft with their position, and never written', () => {
    const rows = withStarter([], 'en');
    expect(rows.every((g) => g.starter)).toBe(true);
    const check = checkDrafts(rows);
    expect(check.settled.map((s) => s.gene.order)).toEqual(rows.map((_, i) => i));
    expect(planWrites([], check).put).toEqual([]);
    expect(planWrites([], check).reorder).toBeNull();
  });

  it('any edit of a row makes it the admin\'s own, and only that row', () => {
    const rows = withStarter([], 'en');
    const key = starterOf('values', rows).key;
    const edited = updateGene(rows, key, { blurb: 'Ours.' });
    expect(starterOf('values', edited).starter).toBeUndefined();
    expect(starterOf('purpose', edited).starter).toBe(true);
    const plan = planWrites([], checkDrafts(edited));
    expect(plan.put.map((s) => s.gene.id)).toEqual(['values']);
    const withItem = addAllele(rows, key).drafts;
    expect(starterOf('values', withItem).starter).toBeUndefined();
    const down = moveGene(rows, rows[0].key, 1);
    expect(down[1].starter).toBeUndefined();
    expect(down[0].starter).toBe(true);
  });

  it('keep their ids reserved: an own gene titled like a starter id is not overwritten', async () => {
    const hs = instance();
    // Starter rows are there; the admin adds their own gene titled "Values" ...
    let drafts = withStarter([], 'en');
    const own = addGene(drafts, 'custom', { title: 'Values' });
    drafts = updateGene(own.drafts, own.gene.key, { blurb: 'MY OWN values text' });
    const first = await saveDrafts(hs, HOLON, { drafts, baseline: [] });
    expect(first.saved.map((s) => s.gene.id)).toEqual(['values-2']);
    drafts = adoptIds(drafts, first.saved);
    // ... then edits the untouched starter Values row.
    const key = starterOf('values', drafts).key;
    drafts = updateGene(drafts, key, { blurb: 'Edited starter.' });
    const check = checkDrafts(drafts);
    expect(check.issues).toEqual([]);
    const second = await saveDrafts(hs, HOLON, { drafts, baseline: first.baseline });
    expect(second.saved.map((s) => s.gene.id)).toEqual(['values']);
    const all = await readGenes(hs, HOLON);
    const mine = all.find((g) => g.id === 'values-2')!;
    expect(mine.kind).toBe('custom');
    expect(mine.blurb).toBe('MY OWN values text');
    expect(all.find((g) => g.id === 'values')!.blurb).toBe('Edited starter.');
  });

  it('a stored gene arriving late replaces an untouched starter row, but not one being edited', () => {
    const rows = withStarter([], 'en');
    const purpose = rows.find((g) => g.id === 'purpose')!;
    const storedPurpose = stored({ id: 'purpose', kind: 'purpose', title: 'Purpose', blurb: 'Published about text.', alleles: [] });
    const merged = mergeRemote(rows, [], [storedPurpose]);
    const got = merged.find((g) => g.id === 'purpose')!;
    expect(got.blurb).toBe('Published about text.');
    expect(got.starter).toBeUndefined();
    expect(got.key).toBe(purpose.key);
    // The other starter rows the lens does not know stay, still untouched.
    expect(merged.filter((g) => g.starter)).toHaveLength(rows.length - 1);
    const edited = updateGene(rows, purpose.key, { blurb: 'Typing.' });
    expect(mergeRemote(edited, [], [storedPurpose]).find((g) => g.id === 'purpose')!.blurb).toBe('Typing.');
  });
});
