// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import type { HoloSphere } from 'holosphere';
import { aggregateStock } from './aggregate.js';
import {
  STOCK_AGGREGATE_LENS,
  buildStockAggregateRecord,
  publishStockAggregate,
  readCellStock,
  sumCellStock,
} from './publish.js';
import type { StockItemSpec, StockLevel } from './types.js';

const level = (holonId: string, itemId: string, onhand: number): StockLevel => ({
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
});
const specs: StockItemSpec[] = [
  { id: 'flour', name: 'Flour', category: 'food', unit: 'kg' },
  { id: 'rice', name: 'Rice', category: 'food', unit: 'kg' },
];

function mockHolosphere(opts: { hex?: string | null; cells?: Record<string, unknown[]> } = {}) {
  const put = vi.fn(async () => {});
  const propagate = vi.fn(async () => ({ success: 0 }));
  const holosphere = {
    put,
    propagate,
    getNodeRef: vi.fn(() => ({ get: () => ({ get: () => ({ put: () => {} }) }) })),
    appname: 'test-app',
    getFederation: vi.fn(async () => ({ federated: [] })),
    get: vi.fn(async (_h: string, lens: string) => (lens === 'settings' ? { hex: opts.hex ?? null } : null)),
    getAll: vi.fn(async (cell: string) => opts.cells?.[cell] ?? []),
    isValidH3: (id: string) => /^8[0-9a-f]{14}$/.test(id),
  } as unknown as HoloSphere;
  return { holosphere, put, propagate };
}

const CELL = '891f1d48b53ffff';

describe('buildStockAggregateRecord', () => {
  it('is keyed by the holon and carries its per-category totals', () => {
    const rec = buildStockAggregateRecord({
      holonId: 'a',
      cell: CELL,
      levels: [level('a', 'flour', 3), level('a', 'rice', 2)],
      specs,
      now: 0,
    });
    expect(rec).toEqual({
      type: 'stock-aggregate',
      id: 'a',
      holonId: 'a',
      cell: CELL,
      categories: [{ category: 'food', holders: 1, onhand: 5, available: 5, incoming: 0, units: ['kg'] }],
      updated: '1970-01-01T00:00:00.000Z',
    });
  });
});

describe('publishStockAggregate', () => {
  it('needs a home hex and something on the shelf', async () => {
    const none = mockHolosphere({ hex: null });
    expect(await publishStockAggregate(none.holosphere, { holonId: 'a', levels: [level('a', 'flour', 1)] })).toEqual({
      ok: false,
      reason: 'no_hex',
    });
    const some = mockHolosphere({ hex: CELL });
    expect(await publishStockAggregate(some.holosphere, { holonId: 'a', levels: [] })).toEqual({
      ok: false,
      reason: 'no_levels',
    });
    expect(some.put).not.toHaveBeenCalled();
  });

  it('writes the record to the cell and climbs the parents', async () => {
    const m = mockHolosphere({ hex: CELL });
    const res = await publishStockAggregate(m.holosphere, {
      holonId: 'a',
      levels: [level('a', 'flour', 3)],
      specs,
      now: 0,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.cell).toBe(CELL);
    expect(m.put).toHaveBeenCalledWith(
      CELL,
      STOCK_AGGREGATE_LENS,
      expect.objectContaining({ id: 'a', type: 'stock-aggregate' }),
      expect.objectContaining({
        autoPropagate: true,
        propagationOptions: expect.objectContaining({ propagateToParents: true, maxParentLevels: 5 }),
      }),
    );
  });

  it('honours an explicit reach of zero by writing the cell only', async () => {
    const m = mockHolosphere({ hex: CELL });
    await publishStockAggregate(m.holosphere, { holonId: 'a', levels: [level('a', 'flour', 3)], hops: 0 });
    const call = m.put.mock.calls[0] as unknown[];
    expect(call[0]).toBe(CELL);
    expect((call[3] as { autoPropagate?: boolean } | undefined)?.autoPropagate).not.toBe(true);
  });
});

describe('sumCellStock / readCellStock', () => {
  it('sums one record per holon, newest wins, and conserves the children', async () => {
    const a = buildStockAggregateRecord({ holonId: 'a', cell: CELL, levels: [level('a', 'flour', 3)], specs, now: 1000 });
    const aOld = buildStockAggregateRecord({ holonId: 'a', cell: CELL, levels: [level('a', 'flour', 99)], specs, now: 0 });
    const b = buildStockAggregateRecord({ holonId: 'b', cell: CELL, levels: [level('b', 'rice', 2)], specs, now: 500 });
    const cell = sumCellStock(CELL, [aOld, a, b, { type: 'junk' }, null]);
    expect(cell.holons).toEqual(['a', 'b']);
    expect(cell.categories).toEqual(aggregateStock([level('a', 'flour', 3), level('b', 'rice', 2)], specs));

    const m = mockHolosphere({ cells: { [CELL]: [a, b] } });
    expect(await readCellStock(m.holosphere, CELL)).toEqual(cell);
    expect(await readCellStock(m.holosphere, 'elsewhere')).toEqual({ cell: 'elsewhere', holons: [], categories: [] });
  });
});
