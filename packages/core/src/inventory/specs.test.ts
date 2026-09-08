// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { createStockItemSpec, isStockItemSpec, readStockItemSpecs, stockItemId, updateStockItemSpec } from './specs.js';

describe('stockItemId', () => {
  it('slugs a name so spellings converge', () => {
    expect(stockItemId('Olive Oil ')).toBe('olive-oil');
    expect(stockItemId('Farina di grano')).toBe('farina-di-grano');
    expect(stockItemId('Café')).toBe('cafe');
    expect(stockItemId('***')).toBe('item');
  });
});

describe('createStockItemSpec', () => {
  it('fills defaults and keeps only finite non-negative targets', () => {
    const spec = createStockItemSpec({ name: ' Flour ', target: 20, min: -1, createdBy: 7, now: 0 });
    expect(spec).toEqual({
      type: 'stock-item',
      id: 'flour',
      name: 'Flour',
      category: 'general',
      unit: 'one',
      target: 20,
      createdBy: 7,
      created: '1970-01-01T00:00:00.000Z',
    });
    expect(() => createStockItemSpec({ name: '  ' })).toThrow();
  });
});

describe('updateStockItemSpec', () => {
  it('patches fields and drops a target set to null', () => {
    const spec = createStockItemSpec({ name: 'Flour', category: 'food', unit: 'kg', target: 20, now: 0 });
    const next = updateStockItemSpec(spec, { target: null, min: 5, unit: '' }, 1000);
    expect(next.target).toBeUndefined();
    expect(next.min).toBe(5);
    expect(next.unit).toBe('one');
    expect(next.updated).toBe('1970-01-01T00:00:01.000Z');
    expect(spec.target).toBe(20);
  });
});

describe('readStockItemSpecs', () => {
  it('keeps valid, undeleted specs sorted by category then name', () => {
    const rows = readStockItemSpecs([
      createStockItemSpec({ name: 'Screws', category: 'hardware' }),
      { ...createStockItemSpec({ name: 'Gone', category: 'food' }), _deleted: true },
      createStockItemSpec({ name: 'Rice', category: 'food' }),
      { type: 'other', id: 'x' },
      null,
      createStockItemSpec({ name: 'Flour', category: 'food' }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['flour', 'rice', 'screws']);
    expect(isStockItemSpec(rows[0])).toBe(true);
  });
});
