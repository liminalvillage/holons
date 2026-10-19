// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  RESOURCE_OFFERS_KEY,
  hasFullTerms,
  normalizeResourceOffer,
  offerIdOf,
  readResourceOffers,
  withResourceOffer,
  withoutResourceOffer,
} from './resource-offers.js';

const workspace = {
  capital: 'material',
  title: 'Workspace',
  quantity: 2,
  unit: 'desks',
  terms: { when: 'Weekdays 9–17', who: 'Projects in the Pot', how: 'Book a week ahead' },
};

describe('resource offers', () => {
  it('keep their capital, title and terms; get an id from the title', () => {
    expect(normalizeResourceOffer(workspace)).toEqual({ id: 'workspace', ...workspace });
    expect(offerIdOf('Design hours — Café')).toBe('design-hours-cafe');
    expect(hasFullTerms(normalizeResourceOffer(workspace)!)).toBe(true);
    expect(hasFullTerms(normalizeResourceOffer({ capital: 'material', title: 'Tools', terms: { when: 'any' } })!)).toBe(false);
  });

  it('are nothing without one of the eight capitals and a title', () => {
    expect(normalizeResourceOffer({ capital: 'love', title: 'x' })).toBeNull();
    expect(normalizeResourceOffer({ capital: 'material' })).toBeNull();
    expect(normalizeResourceOffer(null)).toBeNull();
  });

  it('are read off the settings document, one per id', () => {
    const settings = { [RESOURCE_OFFERS_KEY]: [workspace, { ...workspace, title: 'Workspace' }, { capital: 'intellectual', title: 'Design hours' }, 'junk'] };
    expect(readResourceOffers(settings).map((o) => o.id)).toEqual(['workspace', 'design-hours']);
    expect(readResourceOffers(null)).toEqual([]);
  });

  it('are added, replaced by id and removed', () => {
    let list = withResourceOffer([], workspace);
    list = withResourceOffer(list, { capital: 'material', title: 'Tool library' });
    list = withResourceOffer(list, { ...workspace, quantity: 3 });
    expect(list.map((o) => [o.id, o.quantity])).toEqual([
      ['workspace', 3],
      ['tool-library', undefined],
    ]);
    expect(withoutResourceOffer(list, 'workspace').map((o) => o.id)).toEqual(['tool-library']);
    expect(() => withResourceOffer(list, { title: 'x' })).toThrow();
  });
});
