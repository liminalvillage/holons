// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Item specs as stored records under the `stock` lens: one record per item,
 * keyed by item id. Levels are never stored; only what the holon keeps and
 * how much it wants to keep.
 */
import { STOCK_LENS, type StockItemSpec } from './types.js';

export { STOCK_LENS };

export interface StockItemSpecRecord extends StockItemSpec {
  type: 'stock-item';
  createdBy?: string | number;
  created: string;
  updated?: string;
}

const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** A stable id from the item's name; two spellings of one thing share it. */
export function stockItemId(name: string): string {
  return slug(name) || 'item';
}

const optional = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;

export function isStockItemSpec(rec: unknown): rec is StockItemSpecRecord {
  if (!rec || typeof rec !== 'object') return false;
  const r = rec as Record<string, unknown>;
  return r.type === 'stock-item' && typeof r.id === 'string' && typeof r.name === 'string' && !r._deleted;
}

export interface CreateStockItemInput {
  name: string;
  category?: string;
  unit?: string;
  target?: number;
  min?: number;
  createdBy?: string | number;
  now?: number;
}

export function createStockItemSpec(input: CreateStockItemInput): StockItemSpecRecord {
  const name = (input.name ?? '').trim();
  if (!name) throw new Error('a stock item needs a name');
  const target = optional(input.target);
  const min = optional(input.min);
  return {
    type: 'stock-item',
    id: stockItemId(name),
    name,
    category: (input.category ?? '').trim() || 'general',
    unit: (input.unit ?? '').trim() || 'one',
    ...(target !== undefined ? { target } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(input.createdBy != null ? { createdBy: input.createdBy } : {}),
    created: new Date(input.now ?? Date.now()).toISOString(),
  };
}

/** Apply edits, dropping a target or floor when set to null. */
export function updateStockItemSpec(
  spec: StockItemSpecRecord,
  patch: Partial<Pick<StockItemSpec, 'name' | 'category' | 'unit'>> & { target?: number | null; min?: number | null },
  now: number = Date.now(),
): StockItemSpecRecord {
  const next: StockItemSpecRecord = { ...spec, updated: new Date(now).toISOString() };
  if (typeof patch.name === 'string' && patch.name.trim()) next.name = patch.name.trim();
  if (typeof patch.category === 'string') next.category = patch.category.trim() || 'general';
  if (typeof patch.unit === 'string') next.unit = patch.unit.trim() || 'one';
  if (patch.target === null) delete next.target;
  else if (optional(patch.target) !== undefined) next.target = patch.target as number;
  if (patch.min === null) delete next.min;
  else if (optional(patch.min) !== undefined) next.min = patch.min as number;
  return next;
}

/** Every valid spec in a lens read, sorted by category then name. */
export function readStockItemSpecs(records: unknown[]): StockItemSpecRecord[] {
  return (records ?? [])
    .filter(isStockItemSpec)
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}
