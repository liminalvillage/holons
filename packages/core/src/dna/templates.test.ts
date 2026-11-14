// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import genesSchema from '../../schemas/genes.json' with { type: 'json' };
import { createHoloSphere } from '../holosphere/factory.js';
import { testKey } from '../protocol/testing.js';
import { GENES_LENS, normalizeGene, purposeAbout, putGene, readGenes, validateGenes } from './genes.js';
import { ALLELE_ICONS, isAlleleIcon } from './icons.js';
import { STARTER_GENES, STARTER_LANGS } from './templates.js';
import { GENE_KINDS, GENE_KIND_DEFAULTS } from './types.js';
import { dnaHash } from './version.js';

const PICTOGRAPH = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}]/u;

describe('STARTER_GENES', () => {
  for (const lang of STARTER_LANGS) {
    describe(lang, () => {
      const genes = STARTER_GENES(lang);

      it('has the seven standard kinds, in order, each with its default ack', () => {
        expect(genes.map((g) => g.kind)).toEqual(GENE_KINDS.filter((k) => k !== 'custom'));
        expect(genes.map((g) => g.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
        for (const g of genes) {
          expect(g.ack).toBe(GENE_KIND_DEFAULTS[g.kind].ack);
          expect(g.lang).toBe(lang);
          expect(g.title).not.toBe('');
          expect(g.blurb).not.toBe('');
        }
      });

      it('is valid as a whole DNA', () => {
        expect(validateGenes(genes)).toEqual([]);
      });

      it('is already normal', () => {
        for (const g of genes) expect(normalizeGene(g)).toEqual(g);
      });

      it('carries no emoji, only semantic icon keys', () => {
        expect(JSON.stringify(genes)).not.toMatch(PICTOGRAPH);
        for (const a of genes.flatMap((g) => g.alleles)) if (a.icon !== undefined) expect(isAlleleIcon(a.icon)).toBe(true);
      });

      it('has a purpose to stand as the about, and a hash to acknowledge', () => {
        expect(purposeAbout(genes)).not.toBe('');
        expect(dnaHash(genes)).toMatch(/^[0-9a-f]{64}$/);
      });
    });
  }

  it('uses the same ids and icons in every language', () => {
    const shape = (lang: string) => STARTER_GENES(lang).map((g) => [g.id, g.alleles.map((a) => [a.id, a.icon])]);
    expect(shape('it')).toEqual(shape('en'));
    expect(STARTER_GENES('it')[1].title).not.toBe(STARTER_GENES('en')[1].title);
  });

  it('falls back to English, and hands out a fresh copy every call', () => {
    expect(STARTER_GENES('xx')).toEqual(STARTER_GENES('en'));
    expect(STARTER_GENES()).toEqual(STARTER_GENES('en'));
    const a = STARTER_GENES();
    a[1].alleles.pop();
    expect(STARTER_GENES()[1].alleles.length).toBe(a[1].alleles.length + 1);
  });
});

describe('ALLELE_ICONS', () => {
  it('are kebab-case keys, never glyphs, each once', () => {
    for (const k of ALLELE_ICONS) expect(k).toMatch(/^[a-z][a-z-]*$/);
    expect(new Set(ALLELE_ICONS).size).toBe(ALLELE_ICONS.length);
    expect(isAlleleIcon('🌱')).toBe(false);
    expect(isAlleleIcon('heart')).toBe(true);
  });
});

describe('schemas/genes.json', () => {
  it('is a lens schema holosphere accepts, and the starter genes pass it under strict writes', async () => {
    const hs = createHoloSphere({ appName: 'holons-test', privateKey: bytesToHex(testKey().sk), store: { adapter: 'memory' }, strict: true });
    const h = hs as unknown as { publishNostrEvents(e: unknown): void; subscribeNostr(): () => void };
    h.publishNostrEvents = () => {};
    h.subscribeNostr = () => () => {};
    await hs.setSchema(GENES_LENS, genesSchema);
    for (const g of STARTER_GENES('it')) await putGene(hs, 'schema-holon', g);
    expect((await readGenes(hs, 'schema-holon')).length).toBe(7);
    await expect(hs.put('schema-holon', GENES_LENS, { id: 'bad', kind: 'nonsense', title: 'X', order: 0, ack: 'agree', alleles: [] })).rejects.toThrow();
  });
});
