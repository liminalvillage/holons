// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { aggregateStock, sumAggregates } from './aggregate.js';
import type { StockItemSpec, StockLevel } from './types.js';

const level = (holonId: string, itemId: string, onhand: number, extra: Partial<StockLevel> = {}): StockLevel => ({
  itemId,
  holonId,
  unit: 'kg',
  onhand,
  confirmed: onhand,
  pending: onhand,
  reserved: 0,
  incoming: 0,
  available: onhand,
  updatedAt: 0,
  ...extra,
});

const specs: StockItemSpec[] = [
  { id: 'flour', name: 'Flour', category: 'food', unit: 'kg' },
  { id: 'rice', name: 'Rice', category: 'food', unit: 'kg' },
];

describe('aggregateStock', () => {
  it('sums per category across holons and counts holders', () => {
    const out = aggregateStock(
      [
        level('a', 'flour', 10, { incoming: 2 }),
        level('a', 'rice', 0),
        level('b', 'rice', 4, { reserved: 1, available: 3 }),
        level('b', 'nails', 200, { unit: 'one' }),
      ],
      specs,
    );
    expect(out).toEqual([
      { category: 'food', holders: 2, onhand: 14, available: 13, incoming: 2, units: ['kg'] },
      { category: 'nails', holders: 1, onhand: 200, available: 200, incoming: 0, units: ['one'] },
    ]);
  });
});

describe('sumAggregates', () => {
  it('conserves: summing the children equals aggregating their union', () => {
    const cellA = [level('a', 'flour', 10), level('b', 'rice', 4)];
    const cellB = [level('c', 'flour', 1.5), level('c', 'nails', 7, { unit: 'one' })];
    const cellC: StockLevel[] = [];
    const viaChildren = sumAggregates([aggregateStock(cellA, specs), aggregateStock(cellB, specs), aggregateStock(cellC, specs)]);
    const direct = aggregateStock([...cellA, ...cellB, ...cellC], specs);
    expect(viaChildren).toEqual(direct);
  });
});
