// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { parseOfferText } from '../src/Offers.js';

describe('parseOfferText', () => {
  it('a bare title is one unit given', () => {
    expect(parseOfferText('bike')).toEqual({
      title: 'bike',
      quantity: 1,
      unit: 'one',
      mode: 'give',
      itemType: 'good',
    });
  });

  it('reads a quantity and unit the way /stock does', () => {
    expect(parseOfferText('5kg flour')).toMatchObject({
      title: 'flour',
      quantity: 5,
      unit: 'kg',
    });
    expect(parseOfferText('12 eggs')).toMatchObject({
      title: 'eggs',
      quantity: 12,
      unit: 'one',
    });
    expect(parseOfferText('2,5 l olive oil')).toMatchObject({
      title: 'olive oil',
      quantity: 2.5,
      unit: 'l',
    });
  });

  it('a leading verb sets the mode, in three languages', () => {
    expect(parseOfferText('lend ladder').mode).toBe('lend');
    expect(parseOfferText('presto scala').mode).toBe('lend');
    expect(parseOfferText('sell 12 eggs').mode).toBe('sell');
    expect(parseOfferText('vendo 12 huevos')).toMatchObject({
      mode: 'sell',
      quantity: 12,
      title: 'huevos',
    });
    expect(parseOfferText('give 3 chairs').title).toBe('chairs');
  });

  it('#category and a trailing price', () => {
    expect(parseOfferText('2 hours plumbing #skills')).toMatchObject({
      title: 'plumbing',
      quantity: 2,
      unit: 'hour',
      category: 'skills',
      itemType: 'service',
    });
    expect(parseOfferText('sell 12 eggs for 4 EUR')).toMatchObject({
      mode: 'sell',
      price: 4,
      currency: 'EUR',
      title: 'eggs',
    });
    expect(parseOfferText('12 eggs for 0.5 €')).toMatchObject({
      mode: 'sell',
      price: 0.5,
      currency: 'EUR',
    });
    expect(parseOfferText('flour #food for 2')).toMatchObject({
      category: 'food',
      price: 2,
      currency: 'EUR',
      title: 'flour',
    });
  });

  it('nothing left for a title is null', () => {
    expect(parseOfferText('')).toBeNull();
    expect(parseOfferText('   ')).toBeNull();
    expect(parseOfferText('lend')).toBeNull();
    expect(parseOfferText('#food')).toBeNull();
  });
});
