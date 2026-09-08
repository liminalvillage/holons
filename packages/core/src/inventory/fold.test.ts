// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { foldStock, isStockEvent, stockEffectOn, type StockEventLike } from './fold.js';

const H = 'holon-a';
const P = 'holon-b';

const ev = (overrides: StockEventLike): StockEventLike => ({
  eventType: 'stock:produced',
  provider: { id: H },
  receiver: { id: H },
  resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' },
  resourceInventoriedAs: 'flour',
  inScopeOf: H,
  timestamp: 1_000,
  ...overrides,
});

describe('isStockEvent', () => {
  it('accepts stock:* kinds and events classified stock', () => {
    expect(isStockEvent(ev({}))).toBe(true);
    expect(isStockEvent({ eventType: 'expense:paid', resourceClassifiedAs: ['stock'] })).toBe(true);
  });

  it('ignores library custody and everything else', () => {
    expect(isStockEvent({ eventType: 'item:borrowed', resource: { type: 'item', resourceId: 'drill' } })).toBe(false);
    expect(isStockEvent(null)).toBe(false);
  });
});

describe('stockEffectOn', () => {
  it('adds for produce and raise, removes for consume and lower', () => {
    expect(stockEffectOn(ev({ eventType: 'stock:produced', resourceQuantity: { hasNumericalValue: 5, hasUnit: 'kg' } }), H)).toBe(5);
    expect(stockEffectOn(ev({ eventType: 'stock:raised', resourceQuantity: { hasNumericalValue: 2, hasUnit: 'kg' } }), H)).toBe(2);
    expect(stockEffectOn(ev({ eventType: 'stock:consumed', resourceQuantity: { hasNumericalValue: 3, hasUnit: 'kg' } }), H)).toBe(-3);
    expect(stockEffectOn(ev({ eventType: 'stock:lowered', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' } }), H)).toBe(-1);
  });

  it('reads a transfer from whichever side the holon is on', () => {
    const transfer = ev({
      eventType: 'stock:transferred',
      provider: { id: H },
      receiver: { id: P },
      resourceQuantity: { hasNumericalValue: 4, hasUnit: 'kg' },
    });
    expect(stockEffectOn(transfer, H)).toBe(-4);
    expect(stockEffectOn(transfer, P)).toBe(4);
    expect(stockEffectOn(transfer, 'holon-c')).toBe(0);
  });

  it('keeps another holon\'s production out of this holon\'s stock', () => {
    expect(stockEffectOn(ev({ inScopeOf: P }), H)).toBe(0);
  });

  it('falls back on the explicit ValueFlows action when there is no kind', () => {
    expect(stockEffectOn(ev({ eventType: undefined, action: 'consume', resourceClassifiedAs: ['stock'] }), H)).toBe(-1);
  });
});

describe('foldStock', () => {
  it('sums effects per item, in any order', () => {
    const events = [
      ev({ resourceQuantity: { hasNumericalValue: 10, hasUnit: 'kg' }, timestamp: 1 }),
      ev({ eventType: 'stock:consumed', resourceQuantity: { hasNumericalValue: 2.5, hasUnit: 'kg' }, timestamp: 3 }),
      ev({ resourceInventoriedAs: 'oil', resourceQuantity: { hasNumericalValue: 3, hasUnit: 'l' }, timestamp: 2 }),
    ];
    const forward = foldStock(events, H);
    const backward = foldStock([...events].reverse(), H);
    expect(forward).toEqual(backward);
    expect(forward.map((l) => [l.itemId, l.onhand, l.unit, l.updatedAt])).toEqual([
      ['flour', 7.5, 'kg', 3],
      ['oil', 3, 'l', 2],
    ]);
  });

  it('keeps confirmed and pending apart and counts pending inbound as incoming', () => {
    const levels = foldStock(
      [
        ev({ resourceQuantity: { hasNumericalValue: 10, hasUnit: 'kg' } }),
        ev({
          eventType: 'stock:transferred',
          provider: { id: P },
          receiver: { id: H },
          resourceQuantity: { hasNumericalValue: 4, hasUnit: 'kg' },
          status: 'pending',
        }),
        ev({
          eventType: 'stock:transferred',
          provider: { id: H },
          receiver: { id: P },
          resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' },
          status: 'pending',
        }),
      ],
      H,
    );
    expect(levels).toHaveLength(1);
    const flour = levels[0];
    expect(flour.confirmed).toBe(10);
    expect(flour.onhand).toBe(10);
    expect(flour.pending).toBe(13);
    expect(flour.incoming).toBe(4);
    expect(flour.available).toBe(10);
  });

  it('skips non-stock events and events with no item', () => {
    const levels = foldStock(
      [
        ev({ eventType: 'item:borrowed', resourceInventoriedAs: 'drill' }),
        ev({ resourceInventoriedAs: undefined, context: null, resource: null }),
      ],
      H,
    );
    expect(levels).toEqual([]);
  });

  it('kills float dust', () => {
    const levels = foldStock(
      [
        ev({ resourceQuantity: { hasNumericalValue: 0.1, hasUnit: 'kg' } }),
        ev({ resourceQuantity: { hasNumericalValue: 0.2, hasUnit: 'kg' } }),
      ],
      H,
    );
    expect(levels[0].onhand).toBe(0.3);
  });
});
