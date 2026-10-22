// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Scarcity: what open needs ask for, set against what is on the shelf.
 *
 * Kantorovich's dual price of a stock constraint is what one more unit would
 * unlock. With unit demand that price is 1 while any demand is blocked and
 * 0 otherwise, so the useful numbers are the ones behind it: the shortage
 * in units, and the share of demand a place cannot cover. Both are per
 * category, because needs are clustered by category at hex cells and that
 * is the granularity a surplus and a deficit can meet at.
 */
import type { StockDemand, StockItemSpec, StockLevel, StockPosition } from './types.js';
import { round } from './fold.js';

/** The little a need must carry to count as demand. */
export interface DemandSourceLike {
  status?: string;
  category?: string;
  holonId?: string | number;
  /** Stock reference a need may carry; forward-compatible, optional. */
  stock?: { itemId?: string; quantity?: number } | null;
  /** What the need asks for in its own unit (`@holons/core/needs`); wins over `stock`. */
  demand?: { quantity?: number; unit?: string } | null;
  [key: string]: unknown;
}

/**
 * Needs still waiting on stock: requested, offered, or claimed but not yet
 * handed over (the needs domain's statuses; `open` tolerated for older
 * records). Fulfilled and cancelled needs ask for nothing.
 */
export const STOCK_DEMAND_STATUSES: ReadonlySet<string> = new Set([
  'requested',
  'offered',
  'claimed',
  'open',
]);

/**
 * Read one need as demand at `holonId`. Null when it is closed, has no
 * category, or asks for nothing.
 */
export function demandOf(need: DemandSourceLike, holonId: string): StockDemand | null {
  if (!need || !STOCK_DEMAND_STATUSES.has(String(need.status ?? ''))) return null;
  const category = typeof need.category === 'string' ? need.category.trim() : '';
  if (!category) return null;
  const quantity = demandQuantity(need);
  const itemId = need.stock?.itemId;
  return { holonId, category, ...(itemId ? { itemId } : {}), quantity };
}

/** Units a need asks for: its own `demand`, else its stock reference, else one. */
export function demandQuantity(need: DemandSourceLike): number {
  for (const raw of [need.demand?.quantity, need.stock?.quantity]) {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  }
  return 1;
}

/** The unit a need counts in: its own `demand.unit`, else its stock reference's. */
export function demandUnit(need: DemandSourceLike): string | undefined {
  const own = need.demand?.unit;
  if (typeof own === 'string' && own.trim()) return own.trim();
  const stock = (need.stock as { unit?: unknown } | null | undefined)?.unit;
  return typeof stock === 'string' && stock.trim() ? stock.trim() : undefined;
}

export function demandsOf(needs: DemandSourceLike[], holonId: string): StockDemand[] {
  const out: StockDemand[] = [];
  for (const need of needs ?? []) {
    const d = demandOf(need, holonId);
    if (d) out.push(d);
  }
  return out;
}

/**
 * Set aside stock for demand that names an item. Returns new levels;
 * `reserved` never exceeds what is on hand, so `available` stays ≥ 0.
 */
export function reserve(levels: StockLevel[], demands: StockDemand[]): StockLevel[] {
  const byItem = new Map<string, number>();
  for (const d of demands ?? []) {
    if (!d.itemId) continue;
    byItem.set(d.itemId, (byItem.get(d.itemId) ?? 0) + d.quantity);
  }
  return (levels ?? []).map((level) => {
    const asked = byItem.get(level.itemId) ?? 0;
    const reserved = round(Math.min(Math.max(0, level.onhand), asked));
    return { ...level, reserved, available: round(level.onhand - reserved) };
  });
}

/** Category of each item, from its spec; items without a spec are their own category. */
function categoryOf(itemId: string, specs: Map<string, StockItemSpec>): string {
  return specs.get(itemId)?.category ?? itemId;
}

/** One category's standing at one place. */
export interface ScarcityEntry {
  holonId: string;
  category: string;
  /** Open demand, in units. */
  demand: number;
  /**
   * Stock on the shelf, in units. On-hand rather than net of reservations:
   * a reservation is made FOR the demand counted here, so netting it out
   * would count the same need twice.
   */
  available: number;
  /** Demand that cannot be met: `max(0, demand − available)`. */
  shortage: number;
  /** Share of demand that cannot be met, 0..1. 0 when there is no demand. */
  blocked: number;
}

/**
 * Demand against availability per category at one holon. Only categories
 * that have either demand or stock appear, shortage first.
 */
export function scarcity(
  levels: StockLevel[],
  demands: StockDemand[],
  specs: StockItemSpec[] = [],
): ScarcityEntry[] {
  const specMap = new Map(specs.map((s) => [s.id, s]));
  const holonId = levels[0]?.holonId ?? demands[0]?.holonId ?? '';
  const available = new Map<string, number>();
  for (const level of levels ?? []) {
    const cat = categoryOf(level.itemId, specMap);
    available.set(cat, (available.get(cat) ?? 0) + Math.max(0, level.onhand));
  }
  const demand = new Map<string, number>();
  for (const d of demands ?? []) {
    demand.set(d.category, (demand.get(d.category) ?? 0) + d.quantity);
  }
  const categories = new Set([...available.keys(), ...demand.keys()]);
  const out: ScarcityEntry[] = [];
  for (const category of categories) {
    const ask = round(demand.get(category) ?? 0);
    const have = round(available.get(category) ?? 0);
    const shortage = round(Math.max(0, ask - have));
    out.push({
      holonId,
      category,
      demand: ask,
      available: have,
      shortage,
      blocked: ask > 0 ? round(shortage / ask) : 0,
    });
  }
  return out.sort((a, b) => b.shortage - a.shortage || a.category.localeCompare(b.category));
}

/**
 * What an item keeps back: its `min`, the level the holon holds for itself
 * ("Keep" on the shelf), never negative. `target` is only the level it
 * restocks up to — a reorder hint, not a hold — so an item between the two
 * is both on the shopping list and spare. The one definition behind the
 * shelf's surplus badge and the auto offers (`@holons/core/offers`);
 * settled 2026-09-10 after max(min, target) hid every item under its target.
 */
export function keepBack(spec: StockItemSpec | undefined): number {
  return Math.max(0, spec?.min ?? 0);
}

/**
 * A holon's surplus and deficit per category, the inputs the transport plan
 * moves between. Surplus is what is left above local demand AND above the
 * keep-back floor from the item specs (`keepBack`); deficit is local demand
 * the holon cannot cover.
 */
export function positions(
  levels: StockLevel[],
  demands: StockDemand[],
  specs: StockItemSpec[] = [],
): StockPosition[] {
  const specMap = new Map(specs.map((s) => [s.id, s]));
  const floor = new Map<string, number>();
  for (const level of levels ?? []) {
    const cat = categoryOf(level.itemId, specMap);
    floor.set(cat, (floor.get(cat) ?? 0) + keepBack(specMap.get(level.itemId)));
  }
  return scarcity(levels, demands, specs)
    .map((e) => ({
      holonId: e.holonId,
      category: e.category,
      surplus: round(Math.max(0, e.available - e.demand - (floor.get(e.category) ?? 0))),
      deficit: e.shortage,
    }))
    .filter((p) => p.surplus > 0 || p.deficit > 0)
    .sort((a, b) => a.category.localeCompare(b.category) || a.holonId.localeCompare(b.holonId));
}
