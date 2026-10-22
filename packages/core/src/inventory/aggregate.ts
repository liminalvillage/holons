// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Stock up the scalespace.
 *
 * A hex cell's stock per category is the sum of its children's, nothing
 * more. That conservation rule is what lets a regional view exist without
 * copying records, and is the invariant the spec pins: aggregating the
 * children then summing must equal summing the children directly.
 */
import { round } from './fold.js';
import type { StockItemSpec, StockLevel } from './types.js';

/** One category's total across a set of holons (a cell, a federation). */
export interface StockAggregate {
  category: string;
  /** How many holons hold any of it. */
  holders: number;
  onhand: number;
  available: number;
  incoming: number;
  /** Units seen; a category mixing units is reported, not converted. */
  units: string[];
}

/** Sum levels per category. Levels may come from many holons. */
export function aggregateStock(levels: StockLevel[], specs: StockItemSpec[] = []): StockAggregate[] {
  const specMap = new Map(specs.map((s) => [s.id, s]));
  const acc = new Map<string, StockAggregate & { holderIds: Set<string> }>();
  for (const level of levels ?? []) {
    const category = specMap.get(level.itemId)?.category ?? level.itemId;
    let entry = acc.get(category);
    if (!entry) {
      entry = { category, holders: 0, onhand: 0, available: 0, incoming: 0, units: [], holderIds: new Set() };
      acc.set(category, entry);
    }
    entry.onhand += level.onhand;
    entry.available += Math.max(0, level.available);
    entry.incoming += level.incoming;
    if (level.onhand > 0) entry.holderIds.add(level.holonId);
    if (!entry.units.includes(level.unit)) entry.units.push(level.unit);
  }
  return [...acc.values()]
    .map(({ holderIds, ...entry }) => ({
      ...entry,
      holders: holderIds.size,
      onhand: round(entry.onhand),
      available: round(entry.available),
      incoming: round(entry.incoming),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

/**
 * Fold child aggregates into a parent's. Summing aggregates is the same as
 * aggregating the union of their levels; `holders` adds because a holon
 * sits in exactly one child cell.
 */
export function sumAggregates(children: StockAggregate[][]): StockAggregate[] {
  const acc = new Map<string, StockAggregate>();
  for (const child of children ?? []) {
    for (const a of child ?? []) {
      const entry = acc.get(a.category) ?? {
        category: a.category,
        holders: 0,
        onhand: 0,
        available: 0,
        incoming: 0,
        units: [],
      };
      entry.holders += a.holders;
      entry.onhand = round(entry.onhand + a.onhand);
      entry.available = round(entry.available + a.available);
      entry.incoming = round(entry.incoming + a.incoming);
      for (const u of a.units) if (!entry.units.includes(u)) entry.units.push(u);
      acc.set(a.category, entry);
    }
  }
  return [...acc.values()].sort((a, b) => a.category.localeCompare(b.category));
}
