// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { mergeReorderRows, reorderItemId, reorderList, syncReorderToShopping, toShoppingItems } from './reorder.js';
import type { StockItemSpec, StockLevel } from './types.js';

const level = (itemId: string, onhand: number, extra: Partial<StockLevel> = {}): StockLevel => ({
  itemId,
  holonId: 'h',
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
  { id: 'flour', name: 'Flour', category: 'food', unit: 'kg', target: 20 },
  { id: 'oil', name: 'Olive oil', category: 'food', unit: 'l', target: 5 },
  { id: 'rice', name: 'Rice', category: 'food', unit: 'kg' },
  { id: 'screws', name: 'Screws', category: 'hardware', unit: 'one', target: 100 },
];

describe('reorderList', () => {
  it('buys the positive part of target − onhand − incoming + reserved', () => {
    const lines = reorderList(
      [level('flour', 12, { incoming: 3, reserved: 2 }), level('oil', 6), level('screws', 40, { unit: 'one' })],
      specs,
    );
    expect(lines.map((l) => [l.itemId, l.quantity])).toEqual([
      ['flour', 7],
      ['screws', 60],
    ]);
    expect(lines[0].basis).toEqual({ target: 20, onhand: 12, incoming: 3, reserved: 2 });
  });

  it('counts an item with no level as empty and never reorders one with no target', () => {
    const lines = reorderList([], specs);
    expect(lines.map((l) => l.itemId)).toEqual(['flour', 'oil', 'screws']);
  });
});

describe('toShoppingItems', () => {
  it('writes checklist rows with a stable id and a stock reference', () => {
    const [row] = toShoppingItems(
      [{ itemId: 'oil', name: 'Olive oil', category: 'food', unit: 'l', quantity: 2.5, basis: { target: 5, onhand: 2.5, incoming: 0, reserved: 0 } }],
      { createdBy: 7 },
    );
    expect(row).toEqual({
      id: reorderItemId('oil'),
      text: '2.5 l Olive oil',
      checked: false,
      createdBy: 7,
      category: 'food',
      stock: { itemId: 'oil', quantity: 2.5, unit: 'l' },
    });
  });

  it('formats a plain count with a multiplier', () => {
    const [row] = toShoppingItems([
      { itemId: 'screws', name: 'Screws', category: 'hardware', unit: 'one', quantity: 60, basis: { target: 100, onhand: 40, incoming: 0, reserved: 0 } },
    ]);
    expect(row.text).toBe('60× Screws');
    expect(row).not.toHaveProperty('createdBy');
  });
});

describe('mergeReorderRows', () => {
  const line = (itemId: string, name: string, quantity: number) => ({
    itemId,
    name,
    category: 'food',
    unit: 'kg',
    quantity,
    basis: { target: 10, onhand: 10 - quantity, incoming: 0, reserved: 0 },
  });

  it('replaces an unticked row for the same item, keeps ticked ones, appends the rest', () => {
    const { rows, changed } = mergeReorderRows(
      [
        { text: 'candles', checked: false },
        { text: '3 kg Flour', checked: false, stockItemId: 'flour' },
        { text: '2 kg Rice', checked: true, stockItemId: 'rice' },
      ],
      [line('flour', 'Flour', 5), line('rice', 'Rice', 2), line('oil', 'Olive oil', 1)],
    );
    expect(rows).toEqual([
      { text: 'candles', checked: false },
      { text: '5 kg Flour', checked: false, stockItemId: 'flour' },
      { text: '2 kg Rice', checked: true, stockItemId: 'rice' },
      { text: '2 kg Rice', checked: false, stockItemId: 'rice' },
      { text: '1 kg Olive oil', checked: false, stockItemId: 'oil' },
    ]);
    expect(changed).toBe(3);
  });

  it('reports no change when the rows already match', () => {
    const { changed } = mergeReorderRows([{ text: '5 kg Flour', checked: false, stockItemId: 'flour' }], [line('flour', 'Flour', 5)]);
    expect(changed).toBe(0);
  });
});

describe('syncReorderToShopping', () => {
  it('creates the shopping list when missing and skips a no-op write', async () => {
    const puts: unknown[] = [];
    const db = new Map<string, unknown>();
    const store = {
      get: async (_h: string | number, _b: string, key: string | number) => db.get(String(key)) ?? null,
      getAll: async () => [...db.values()],
      put: async (_h: string | number, _b: string, value: { id: string }) => {
        db.set(value.id, value);
        puts.push(value);
      },
      delete: async () => {},
    };
    const lines = [
      { itemId: 'flour', name: 'Flour', category: 'food', unit: 'kg', quantity: 5, basis: { target: 5, onhand: 0, incoming: 0, reserved: 0 } },
    ];
    expect(await syncReorderToShopping(store as never, 'h', lines, { creator: 7 })).toBe(1);
    expect((puts[0] as { id: string; type: string; items: unknown[] })).toMatchObject({
      id: 'shopping',
      type: 'shopping',
      items: [{ text: '5 kg Flour', checked: false, stockItemId: 'flour' }],
    });
    expect(await syncReorderToShopping(store as never, 'h', lines)).toBe(0);
    expect(puts).toHaveLength(1);
  });
});
