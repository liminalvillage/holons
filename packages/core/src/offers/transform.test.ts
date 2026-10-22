// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { classifyMarketItem, createMarketItem } from '../tasks/marketplace.js';
import {
  createOffer,
  isLiveReservation,
  modeOf,
  normalizeOffer,
  offerFromStockSurplus,
  remainingSupply,
  stockOfferId,
} from './transform.js';
import { isOfferRecord } from './types.js';

const initiator = { id: 7, username: 'ada' };

describe('createOffer', () => {
  it('is still a market quest, with status, supply, mode and reservations attached', () => {
    const o = createOffer({
      holonId: 'h',
      initiator,
      title: '  Flour ',
      category: 'food',
      supply: { itemId: 'flour', quantity: 8, unit: 'kg' },
      mode: 'give',
      now: 1_700_000_000_000,
      id: 'o1',
    });
    expect(classifyMarketItem(o)).toBe('offer');
    expect(o.exchange_type).toBe('offer');
    expect(o.transaction_type).toEqual(['receive-donate']);
    expect(o).toMatchObject({ id: 'o1', title: 'Flour', status: 'open', mode: 'give', reservations: [] });
    expect(o.supply).toEqual({ itemId: 'flour', quantity: 8, unit: 'kg' });
    expect(isOfferRecord(o)).toBe(true);
  });

  it('carries a price only when selling', () => {
    const sale = createOffer({ holonId: 'h', initiator, title: 'Eggs', supply: { quantity: 12, unit: 'one' }, mode: 'sell', price: 4, currency: 'EUR' });
    expect(sale.transaction_type).toEqual(['buy-sell']);
    expect(sale).toMatchObject({ price: 4, currency: 'EUR' });
    const bad = createOffer({ holonId: 'h', initiator, title: 'x', supply: { quantity: 1, unit: 'one' }, price: -1 });
    expect('price' in bad).toBe(false);
  });

  it('offerFromStockSurplus keeps one stable id per shelf item', () => {
    const spec = { id: 'flour', name: 'Flour', category: 'food', unit: 'kg', min: 2 };
    const o = offerFromStockSurplus(spec, 6, { holonId: 'h', initiator });
    expect(o.id).toBe(stockOfferId('flour'));
    expect(o.source).toEqual({ kind: 'stock', itemId: 'flour' });
    expect(o.supply).toEqual({ itemId: 'flour', quantity: 6, unit: 'kg' });
    expect(o.category).toBe('food');
  });
});

describe('normalizeOffer', () => {
  it('reads a legacy market offer as an open one-unit offer (no migration)', () => {
    const legacy = createMarketItem({ holonId: 'h', initiator, kind: 'offer', title: 'Bike', transactionTypes: ['borrow-lend'] });
    legacy.id = 'legacy-1';
    const o = normalizeOffer(legacy)!;
    expect(o.status).toBe('open');
    expect(o.supply).toEqual({ quantity: 1, unit: 'one' });
    expect(o.mode).toBe('lend');
    expect(o.reservations).toEqual([]);
    expect(isOfferRecord(o)).toBe(true);
  });

  it('maps completed to fulfilled and a past expiry to expired', () => {
    expect(normalizeOffer({ id: 'a', type: 'offer', status: 'completed' })!.status).toBe('fulfilled');
    expect(normalizeOffer({ id: 'b', type: 'offer', expires_at: 10 }, 20)!.status).toBe('expired');
    expect(normalizeOffer({ id: 'c', type: 'offer', status: 'withdrawn', expires_at: 10 }, 20)!.status).toBe('withdrawn');
    expect(normalizeOffer({ id: 'd', type: 'offer', expires_at: 30 }, 20)!.status).toBe('open');
  });

  it('reads the flywheel mint as a minted source and keeps the envelopes', () => {
    const o = normalizeOffer({
      id: 'offer-from-need-1',
      type: 'offer',
      mintedFrom: { needId: 'need-1', holonId: 'b', at: 5 },
      _federation: { origin: 'b' },
    })!;
    expect(o.source).toEqual({ kind: 'minted', needId: 'need-1', holonId: 'b', at: 5 });
    expect((o as { _federation?: unknown })._federation).toEqual({ origin: 'b' });
  });

  it('is null for non-offers and deleted records', () => {
    expect(normalizeOffer({ id: 'n', type: 'need' })).toBeNull();
    expect(normalizeOffer({ id: 'o', type: 'offer', _deleted: true })).toBeNull();
    expect(normalizeOffer(null)).toBeNull();
  });

  it('modeOf reads legacy transaction types', () => {
    expect(modeOf(['buy-sell'])).toBe('sell');
    expect(modeOf(['borrow-lend'])).toBe('lend');
    expect(modeOf(undefined)).toBe('give');
  });
});

describe('remainingSupply', () => {
  it('nets live and settled reservations, not released ones', () => {
    const o = createOffer({ holonId: 'h', initiator, title: 'x', supply: { quantity: 10, unit: 'kg' }, id: 'o' });
    o.reservations = [
      { id: 'r1', needId: 'n1', needHolonId: 'b', responseId: 'p1', quantity: 3, createdAt: 'x' },
      { id: 'r2', needId: 'n2', needHolonId: 'b', responseId: 'p2', quantity: 2, createdAt: 'x', settledAt: 'y' },
      { id: 'r3', needId: 'n3', needHolonId: 'b', responseId: 'p3', quantity: 4, createdAt: 'x', releasedAt: 'y' },
    ];
    expect(remainingSupply(o)).toBe(5);
    expect(o.reservations.filter(isLiveReservation).map((r) => r.id)).toEqual(['r1']);
  });
});
