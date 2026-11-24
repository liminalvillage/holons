// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import {
  HOLON_NOUNS,
  fillHolonNoun,
  holonNounForms,
  holonWords,
  resolveHolonNoun,
} from './index.js';

describe('resolveHolonNoun', () => {
  it('the setting wins over the host', () => {
    expect(resolveHolonNoun({ setting: 'circle', host: 'x.hubs.network' })).toBe('circle');
  });
  it('the host decides when the setting is unset', () => {
    expect(resolveHolonNoun({ host: 'hubs.network' })).toBe('hub');
    expect(resolveHolonNoun({ host: 'liminal.hubs.network:443' })).toBe('hub');
    expect(resolveHolonNoun({ setting: '  ', host: 'kiosk.holons.io' })).toBe('holon');
  });
  it('anything else is a holon', () => {
    expect(resolveHolonNoun({})).toBe('holon');
    expect(resolveHolonNoun({ host: 'nothubs.network' })).toBe('holon');
  });
});

describe('fillHolonNoun', () => {
  it('fills English forms with the right article', () => {
    const w = holonWords('hub', 'en');
    expect(fillHolonNoun('Start {@a_holon}. {@Holons} near {@the_holon}.', w)).toBe(
      'Start a hub. Hubs near the hub.',
    );
    expect(fillHolonNoun('Start {@a_holon}', holonWords('org', 'en'))).toBe('Start an org');
  });

  it('agrees in gender in Italian and Spanish', () => {
    const it_ = 'Crea {@a_holon} nuov{@g:o|a}. Impostazioni {@of_the_holon}.';
    expect(fillHolonNoun(it_, holonWords('hub', 'it'))).toBe(
      "Crea un hub nuovo. Impostazioni dell'hub.",
    );
    expect(fillHolonNoun(it_, holonWords('company', 'it'))).toBe(
      "Crea un'azienda nuova. Impostazioni dell'azienda.",
    );
    expect(fillHolonNoun(it_, holonWords('circle', 'it'))).toBe(
      'Crea un cerchio nuovo. Impostazioni del cerchio.',
    );
    expect(fillHolonNoun('Ajustes {@of_the_holon}', holonWords('membrane', 'es'))).toBe(
      'Ajustes de la membrana',
    );
    expect(fillHolonNoun('Est{@g:e|a} {@holon}', holonWords('holon', 'es'))).toBe('Este holón');
  });

  it('elides French articles before vowels, not before an aspirated h', () => {
    expect(fillHolonNoun('ID {@of_the_holon}', holonWords('hub', 'fr'))).toBe('ID du hub');
    expect(fillHolonNoun('ID {@of_the_holon}', holonWords('team', 'fr'))).toBe("ID de l'équipe");
    expect(fillHolonNoun('{@the_holon}', holonWords('holon', 'fr'))).toBe("l'holon");
  });

  it('leaves message parameters and unknown tokens alone', () => {
    const w = holonWords('hub', 'en');
    expect(fillHolonNoun('{holon} is {@a_holon} {@nope}', w)).toBe('{holon} is a hub {@nope}');
  });

  it('uses a custom word as given, with an optional plural', () => {
    expect(fillHolonNoun('{@Holons} and {@a_holon}', holonWords('commune', 'en'))).toBe(
      'Communes and a commune',
    );
    expect(holonNounForms('Kollektiv/Kollektive', 'de').other).toBe('Kollektive');
  });

  it('covers every known noun in every language', () => {
    for (const noun of HOLON_NOUNS) {
      for (const lang of ['en', 'it', 'es', 'fr', 'de', 'ru']) {
        const f = holonNounForms(noun, lang);
        expect(f.one && f.other && f.a && f.the).toBeTruthy();
      }
    }
  });
});
