// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Stock up the scalespace: a holon publishes ONE record of its per-category
 * totals to its home hex cell, and the publish climbs the parent cells, so
 * any cell's stock is the sum of the records that landed on it. Nothing is
 * copied item by item and nobody owns a cell: the record is keyed by the
 * holon id, so a re-publish replaces the previous one at every level.
 *
 * Reading a cell (`readCellStock`) sums whatever records are there. Because
 * a holon has one home cell and its record climbs once per ancestor, the
 * sum at a parent equals the sum over its children (the conservation rule
 * `sumAggregates` pins).
 */
import type { HoloSphere } from 'holosphere';
import { publishToFederation, type PublishOutcome } from '../federation/publish.js';
import { readSettingsHex } from '../federation/settings-hex.js';
import { HOME_HEX_DEFAULT_HOPS, normalizeHops } from '../federation/home-hex.js';
import { aggregateStock, sumAggregates, type StockAggregate } from './aggregate.js';
import type { StockItemSpec, StockLevel } from './types.js';

/** Where a holon's totals land on its cell. Separate from `stock` (the specs). */
export const STOCK_AGGREGATE_LENS = 'stock_aggregates';

export interface StockAggregateRecord {
  type: 'stock-aggregate';
  /** The publishing holon: one record per holon per cell. */
  id: string;
  holonId: string;
  name?: string;
  /** The home cell it was published to. */
  cell: string;
  categories: StockAggregate[];
  /** ISO timestamp of the publish. */
  updated: string;
}

export function isStockAggregateRecord(rec: unknown): rec is StockAggregateRecord {
  if (!rec || typeof rec !== 'object') return false;
  const r = rec as Record<string, unknown>;
  return (
    r.type === 'stock-aggregate' &&
    typeof r.id === 'string' &&
    typeof r.holonId === 'string' &&
    Array.isArray(r.categories) &&
    !r._deleted
  );
}

export function buildStockAggregateRecord(input: {
  holonId: string;
  cell: string;
  levels: StockLevel[];
  specs?: StockItemSpec[];
  name?: string;
  now?: number;
}): StockAggregateRecord {
  return {
    type: 'stock-aggregate',
    id: input.holonId,
    holonId: input.holonId,
    ...(input.name ? { name: input.name } : {}),
    cell: input.cell,
    categories: aggregateStock(input.levels, input.specs ?? []),
    updated: new Date(input.now ?? Date.now()).toISOString(),
  };
}

export type PublishStockAggregateResult =
  | { ok: true; cell: string; record: StockAggregateRecord; outcome: PublishOutcome }
  | { ok: false; reason: 'no_hex' | 'no_levels' };

/**
 * Publish the holon's totals to its `settings.hex` cell and up the parent
 * chain. Best-effort by design: a holon with no hex is not on the map, and
 * a holon with nothing on the shelf has nothing to say.
 */
export async function publishStockAggregate(
  holosphere: HoloSphere,
  input: {
    holonId: string;
    levels: StockLevel[];
    specs?: StockItemSpec[];
    name?: string;
    /** Parent levels to climb; defaults to the home-hex reach. */
    hops?: number;
    now?: number;
    onWriteDenied?: (info: { target: string; lens: string; message: string }) => void;
  },
): Promise<PublishStockAggregateResult> {
  if (!input.levels?.length) return { ok: false, reason: 'no_levels' };
  const cell = await readSettingsHex(holosphere, input.holonId);
  if (!cell) return { ok: false, reason: 'no_hex' };
  const record = buildStockAggregateRecord({ ...input, cell });
  const hops = input.hops == null ? HOME_HEX_DEFAULT_HOPS : normalizeHops(input.hops);
  const outcome = await publishToFederation(
    { holosphere, holonId: input.holonId, lens: STOCK_AGGREGATE_LENS, item: record },
    { kind: 'hex', cell },
    { upcast: hops > 0, upcastLevels: hops, useHolograms: false, onWriteDenied: input.onWriteDenied },
  );
  return { ok: true, cell, record, outcome };
}

export interface CellStock {
  cell: string;
  /** Holons whose record reached this cell. */
  holons: string[];
  categories: StockAggregate[];
}

/** Sum the aggregate records found on a cell; pure, for any lens read. */
export function sumCellStock(cell: string, records: unknown[]): CellStock {
  const recs = (records ?? []).filter(isStockAggregateRecord);
  // One record per holon: a re-publish that raced its own parent copy must
  // not count twice, so the newest per holon wins.
  const byHolon = new Map<string, StockAggregateRecord>();
  for (const r of recs) {
    const prev = byHolon.get(r.holonId);
    if (!prev || String(r.updated) > String(prev.updated)) byHolon.set(r.holonId, r);
  }
  const kept = [...byHolon.values()];
  return {
    cell,
    holons: kept.map((r) => r.holonId).sort(),
    categories: sumAggregates(kept.map((r) => r.categories)),
  };
}

/** What a cell holds, summed over every holon whose record reached it. */
export async function readCellStock(holosphere: HoloSphere, cell: string): Promise<CellStock> {
  let records: unknown[] = [];
  try {
    records = ((await (holosphere as any).getAll(cell, STOCK_AGGREGATE_LENS)) ?? []) as unknown[];
  } catch {
    records = [];
  }
  return sumCellStock(cell, records);
}
