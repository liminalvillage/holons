// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { demandOf, demandQuantity, demandUnit, demandsOf, keepBack, positions, reserve, scarcity } from './scarcity.js';
import type { StockItemSpec, StockLevel } from './types.js';

const H = 'holon-a';

const level = (itemId: string, onhand: number, extra: Partial<StockLevel> = {}): StockLevel => ({
  itemId,
  holonId: H,
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
  { id: 'flour', name: 'Flour', category: 'food', unit: 'kg', target: 20, min: 5 },
  { id: 'rice', name: 'Rice', category: 'food', unit: 'kg' },
  { id: 'screws', name: 'Screws', category: 'hardware', unit: 'one' },
];

describe('demandOf', () => {
  it('reads an open need as one unit of its category', () => {
    expect(demandOf({ status: 'open', category: 'food' }, H)).toEqual({ holonId: H, category: 'food', quantity: 1 });
  });

  it('keeps a stock reference and its quantity when the need carries one', () => {
    expect(demandOf({ status: 'claimed', category: 'food', stock: { itemId: 'flour', quantity: 3 } }, H)).toEqual({
      holonId: H,
      category: 'food',
      itemId: 'flour',
      quantity: 3,
    });
  });

  it("reads a direct need's own demand before its stock reference", () => {
    const direct = { status: 'requested', category: 'skills', demand: { quantity: 5, unit: 'hour' } };
    expect(demandOf(direct, H)).toEqual({ holonId: H, category: 'skills', quantity: 5 });
    expect(demandUnit(direct)).toBe('hour');
    const both = { status: 'requested', category: 'food', demand: { quantity: 2 }, stock: { itemId: 'flour', quantity: 3, unit: 'kg' } };
    expect(demandQuantity(both)).toBe(2);
    expect(demandUnit(both)).toBe('kg');
    expect(demandOf(both, H)?.itemId).toBe('flour');
    expect(demandQuantity({ status: 'requested', demand: { quantity: 0 } })).toBe(1);
    expect(demandUnit({ status: 'requested' })).toBeUndefined();
  });

  it('reads the needs domain statuses: requested and offered count, fulfilled does not', () => {
    expect(demandOf({ status: 'requested', category: 'food' }, H)?.quantity).toBe(1);
    expect(demandOf({ status: 'offered', category: 'food' }, H)?.quantity).toBe(1);
    expect(demandOf({ status: 'cancelled', category: 'food' }, H)).toBeNull();
  });

  it('ignores closed needs and needs with no category', () => {
    expect(demandOf({ status: 'fulfilled', category: 'food' }, H)).toBeNull();
    expect(demandOf({ status: 'open', category: '  ' }, H)).toBeNull();
    expect(demandsOf([{ status: 'open' }, { status: 'open', category: 'food' }], H)).toHaveLength(1);
  });
});

describe('reserve', () => {
  it('sets aside stock for demand that names an item, never more than is on hand', () => {
    const [flour, rice] = reserve(
      [level('flour', 10), level('rice', 2)],
      [
        { holonId: H, category: 'food', itemId: 'flour', quantity: 4 },
        { holonId: H, category: 'food', itemId: 'rice', quantity: 5 },
        { holonId: H, category: 'food', quantity: 1 },
      ],
    );
    expect([flour.reserved, flour.available]).toEqual([4, 6]);
    expect([rice.reserved, rice.available]).toEqual([2, 0]);
  });
});

describe('scarcity', () => {
  it('sets demand against availability per category, shortage first', () => {
    const out = scarcity(
      [level('flour', 10), level('rice', 2), level('screws', 100, { unit: 'one' })],
      [
        { holonId: H, category: 'food', quantity: 15 },
        { holonId: H, category: 'tools', quantity: 2 },
      ],
      specs,
    );
    expect(out).toEqual([
      { holonId: H, category: 'food', demand: 15, available: 12, shortage: 3, blocked: 0.2 },
      { holonId: H, category: 'tools', demand: 2, available: 0, shortage: 2, blocked: 1 },
      { holonId: H, category: 'hardware', demand: 0, available: 100, shortage: 0, blocked: 0 },
    ]);
  });

  it('treats an item without a spec as its own category', () => {
    expect(scarcity([level('mystery', 1)], [])).toEqual([
      { holonId: H, category: 'mystery', demand: 0, available: 1, shortage: 0, blocked: 0 },
    ]);
  });
});

describe('scarcity with reservations', () => {
  it('does not count a reserved need twice', () => {
    const [flour] = reserve([level('flour', 6)], [{ holonId: H, category: 'food', itemId: 'flour', quantity: 5 }]);
    expect([flour.reserved, flour.available]).toEqual([5, 1]);
    const [entry] = scarcity([flour], [{ holonId: H, category: 'food', itemId: 'flour', quantity: 5 }], specs);
    expect(entry).toMatchObject({ demand: 5, available: 6, shortage: 0, blocked: 0 });
  });
});

describe('keepBack', () => {
  it('is min alone — the restock target is not a hold — never negative, zero without a spec', () => {
    expect(keepBack(specs[0])).toBe(5);
    expect(keepBack({ id: 'x', name: 'x', category: 'c', unit: 'kg', target: 20 })).toBe(0);
    expect(keepBack({ id: 'x', name: 'x', category: 'c', unit: 'kg', min: -2 })).toBe(0);
    expect(keepBack(undefined)).toBe(0);
  });
});

describe('positions', () => {
  it('surplus is what is above local demand and the keep-back floor', () => {
    // food: 10 flour + 2 rice = 12 available, floor 5 (flour min), demand 3 → surplus 4
    const out = positions([level('flour', 10), level('rice', 2)], [{ holonId: H, category: 'food', quantity: 3 }], specs);
    expect(out).toEqual([{ holonId: H, category: 'food', surplus: 4, deficit: 0 }]);
  });

  it('an item between its keep and its restock target is spare (and on the reorder list)', () => {
    // 3 flour, keep 2 (target 20 ignored) → 1 spare
    const out = positions([level('flour', 3)], [], [{ ...specs[0], min: 2 }]);
    expect(out).toEqual([{ holonId: H, category: 'food', surplus: 1, deficit: 0 }]);
  });

  it('deficit is the shortage, and a balanced category does not appear', () => {
    const out = positions(
      [level('screws', 10, { unit: 'one' })],
      [
        { holonId: H, category: 'hardware', quantity: 10 },
        { holonId: H, category: 'food', quantity: 6 },
      ],
      specs,
    );
    expect(out).toEqual([{ holonId: H, category: 'food', surplus: 0, deficit: 6 }]);
  });
});
