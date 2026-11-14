// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import { GENE_KINDS } from '@holons/core/dna';
import { CATALOGS, formatDate, kindLabel, peopleLabel, pickLang, t, type CopyKey } from './copy';

describe('dna copy', () => {
  it('keeps the catalogues in step: same keys, same placeholders', () => {
    const keys = Object.keys(CATALOGS.en) as CopyKey[];
    expect(Object.keys(CATALOGS.it).sort()).toEqual([...keys].sort());
    const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of keys) expect(holes(CATALOGS.it[k]), k).toEqual(holes(CATALOGS.en[k]));
  });

  it('never says seat, roster, founded or accepted', () => {
    for (const lang of ['en', 'it'] as const) {
      for (const [k, v] of Object.entries(CATALOGS[lang])) expect(v, k).not.toMatch(/\b(seat|seated|roster|founded)\b/i);
    }
  });

  it('fills placeholders and leaves unknown ones visible', () => {
    expect(t('en', 'dna.footer', { short: 'e961512c', date: '1 May 2026' })).toBe('DNA e961512c · updated 1 May 2026');
    expect(t('en', 'dna.empty', {})).toBe("{holon} hasn't written its DNA yet");
    expect(t('it', 'walk.consent', { holon: 'Liminal', short: 'ab12cd34' })).toBe('Accetto il DNA di Liminal (ab12cd34)');
  });

  it('labels every gene kind, and a kind it does not know as a gene', () => {
    for (const kind of GENE_KINDS) expect(kindLabel('en', kind)).toBeTruthy();
    expect(kindLabel('en', 'terms')).toBe('Terms');
    expect(kindLabel('it', 'terms')).toBe('Condizioni');
    expect(kindLabel('en', 'whatever')).toBe('Gene');
  });

  it('picks a language from the browser, English by default', () => {
    expect(pickLang(['it-IT', 'en'])).toBe('it');
    expect(pickLang(['fr', 'en-GB'])).toBe('en');
    expect(pickLang(['fr'])).toBe('en');
    expect(pickLang(undefined)).toBe('en');
  });

  it('says one person in the singular and dates the footer', () => {
    expect(peopleLabel('en', 1)).toBe('1 person');
    expect(peopleLabel('en', 12)).toBe('12 people');
    expect(peopleLabel('it', 12)).toBe('12 persone');
    expect(formatDate('en', '2026-05-01T10:00:00.000Z')).toContain('2026');
    expect(formatDate('en', 'nope')).toBe('');
    expect(formatDate('en', null)).toBe('');
  });
});
