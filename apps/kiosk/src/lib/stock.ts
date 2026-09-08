// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Stock board's view models, kept out of the Svelte file so vitest (node
// environment, no DOM) can pin them. Every number here comes from
// `@holons/core/inventory`; this module only arranges it for a screen:
// which specs are ours and which a partner's, how full a shelf row is, the
// story of one item as a list of lines, and the federation board that sets
// our shelf beside the partners'.

import {
  demandsOf,
  federationCost,
  foldStock,
  positions,
  readStockItemSpecs,
  rebalancePlan,
  reorderList,
  reserve,
  scarcity,
  stockEffectOn,
  stockItemIdOf,
  isStockEvent,
  type PartnerGraph,
  type ReorderLine,
  type ScarcityEntry,
  type StockEventLike,
  type StockItemSpecRecord,
  type StockLevel,
  type StockPosition,
  type StockTransfer,
} from "@holons/core/inventory";
import { filterBySearch } from "./data";

/** Own specs beside each partner's, keyed by the partner holon id. */
export interface SpecSets {
  own: StockItemSpecRecord[];
  partners: Record<string, StockItemSpecRecord[]>;
}

/**
 * Split a federated `stock` lens read into ours and the partners'. A record
 * folded in by federation carries `_federation.origin`; the specs are keyed
 * by item id and two holons may well both keep "flour", which is why the
 * shell subscribes this lens without cross-space dedupe.
 */
export function splitSpecs(raw: unknown[]): SpecSets {
  const own: unknown[] = [];
  const byPartner = new Map<string, unknown[]>();
  for (const rec of raw ?? []) {
    const origin = (rec as { _federation?: { origin?: unknown } } | null)
      ?._federation?.origin;
    if (typeof origin === "string" && origin) {
      if (!byPartner.has(origin)) byPartner.set(origin, []);
      byPartner.get(origin)!.push(rec);
    } else {
      own.push(rec);
    }
  }
  const partners: Record<string, StockItemSpecRecord[]> = {};
  for (const [id, recs] of byPartner) partners[id] = readStockItemSpecs(recs);
  return { own: readStockItemSpecs(own), partners };
}

/** How a shelf row reads at a glance. */
export type ShelfStatus = "empty" | "low" | "ok";

export interface ShelfRow {
  spec: StockItemSpecRecord;
  /** Null until the first stock event lands for it. */
  level: StockLevel | null;
  onhand: number;
  status: ShelfStatus;
  /** 0..1 against the target, or against the biggest level in the category when there is none. */
  fill: number;
  /** The row is waiting on a transfer in. */
  incoming: number;
  /** Confirmed and pending disagree: a transfer is in flight. */
  inFlight: boolean;
}

/**
 * One row per spec, in category then name order. A spec with no events yet
 * is an empty row rather than a missing one: the shelf is what the holon
 * keeps, not what it happens to have counted.
 */
export function shelfRows(
  input: StockItemSpecRecord[],
  levels: StockLevel[],
): ShelfRow[] {
  const specs = [...input].sort(
    (a, b) =>
      a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );
  const byItem = new Map(levels.map((l) => [l.itemId, l]));
  const maxByCategory = new Map<string, number>();
  for (const spec of specs) {
    const onhand = byItem.get(spec.id)?.onhand ?? 0;
    maxByCategory.set(
      spec.category,
      Math.max(maxByCategory.get(spec.category) ?? 0, onhand),
    );
  }
  return specs.map((spec) => {
    const level = byItem.get(spec.id) ?? null;
    const onhand = level?.onhand ?? 0;
    const target = spec.target ?? 0;
    const min = spec.min ?? 0;
    let status: ShelfStatus = "ok";
    if (onhand <= 0) status = "empty";
    else if ((min > 0 && onhand < min) || (target > 0 && onhand < target / 4))
      status = "low";
    const ceiling = target > 0 ? target : maxByCategory.get(spec.category) || 0;
    const fill = ceiling > 0 ? Math.max(0, Math.min(1, onhand / ceiling)) : 0;
    return {
      spec,
      level,
      onhand,
      status,
      fill,
      incoming: level?.incoming ?? 0,
      inFlight: !!level && level.confirmed !== level.pending,
    };
  });
}

/** Rows grouped by category, categories in first-seen (spec) order. */
export function groupShelf(
  rows: ShelfRow[],
): { category: string; rows: ShelfRow[] }[] {
  const groups = new Map<string, ShelfRow[]>();
  for (const row of rows) {
    if (!groups.has(row.spec.category)) groups.set(row.spec.category, []);
    groups.get(row.spec.category)!.push(row);
  }
  return [...groups].map(([category, rows]) => ({ category, rows }));
}

/** One line of an item's story, newest first. */
export interface HistoryLine {
  id: string;
  at: number;
  kind: string;
  /** Signed change to this holon's level. */
  delta: number;
  unit: string;
  note: string;
  /** Who recorded it: the member, or the other holon on a transfer. */
  who: string;
  pending: boolean;
}

const agentName = (agent: unknown): string => {
  const a = agent as { name?: unknown; id?: unknown } | null | undefined;
  if (!a) return "";
  return typeof a.name === "string" && a.name
    ? a.name
    : a.id != null
      ? String(a.id)
      : "";
};

export function historyOf(
  events: StockEventLike[],
  holonId: string,
  itemId: string,
): HistoryLine[] {
  const lines: HistoryLine[] = [];
  for (const e of events ?? []) {
    if (!isStockEvent(e) || stockItemIdOf(e) !== itemId) continue;
    const delta = stockEffectOn(e, holonId);
    const raw = e as StockEventLike & {
      id?: unknown;
      context?: { note?: unknown; recordedBy?: unknown } | null;
    };
    const isTransfer = e.eventType === "stock:transferred";
    // On a transfer the interesting party is the OTHER holon; otherwise the
    // member who recorded it (the non-holon agent).
    const other = isTransfer
      ? delta >= 0
        ? e.provider
        : e.receiver
      : String(e.provider?.id ?? "") === holonId
        ? e.receiver
        : e.provider;
    lines.push({
      id: String(raw.id ?? ""),
      at:
        typeof e.timestamp === "number"
          ? e.timestamp
          : e.hasPointInTime
            ? Date.parse(e.hasPointInTime) || 0
            : 0,
      kind: String(e.eventType ?? e.action ?? ""),
      delta,
      unit: e.resourceQuantity?.hasUnit ?? e.resource?.unit ?? "",
      note: typeof raw.context?.note === "string" ? raw.context.note : "",
      who: agentName(other),
      pending: e.status === "pending",
    });
  }
  return lines.sort((a, b) => b.at - a.at);
}

/** A partner's contribution to the federation board. */
export interface PartnerStock {
  id: string;
  name: string;
  specs: StockItemSpecRecord[];
  events: StockEventLike[];
  /** Whom this partner is federated with, for the cost graph. */
  federated: string[];
}

export interface StockBoard {
  levels: StockLevel[];
  scarcity: ScarcityEntry[];
  reorder: ReorderLine[];
  /** Our position and every partner's, per category. */
  positions: StockPosition[];
  /** The rebalance plan across the federation, nearest partnership first. */
  plan: StockTransfer[];
  /** Every partner's levels, keyed by holon, for the federation shelves. */
  partnerLevels: Record<string, StockLevel[]>;
}

/**
 * Everything the board shows, from raw inputs. Partner demand is not known
 * here (their needs are not federated), so a partner's surplus is what sits
 * above its keep-back floor; ours also nets out our open needs.
 */
export function buildStockBoard(input: {
  holonId: string;
  specs: StockItemSpecRecord[];
  events: StockEventLike[];
  needs: unknown[];
  federated: string[];
  partners: PartnerStock[];
}): StockBoard {
  const demands = demandsOf(
    (input.needs ?? []) as Parameters<typeof demandsOf>[0],
    input.holonId,
  );
  const levels = reserve(foldStock(input.events, input.holonId), demands);
  const own = positions(levels, demands, input.specs);
  const partnerLevels: Record<string, StockLevel[]> = {};
  const all: StockPosition[] = [...own];
  const graph: PartnerGraph = { [input.holonId]: input.federated };
  for (const p of input.partners ?? []) {
    const pl = foldStock(p.events, p.id);
    partnerLevels[p.id] = pl;
    all.push(...positions(pl, [], p.specs));
    graph[p.id] = p.federated;
  }
  return {
    levels,
    scarcity: scarcity(levels, demands, input.specs),
    reorder: reorderList(levels, input.specs),
    positions: all,
    plan: rebalancePlan(all, federationCost(graph)),
    partnerLevels,
  };
}

/** Compact quantity text: 2.5 kg, 60×, 3 l. */
export function fmtQty(quantity: number, unit: string): string {
  const n = Number.isInteger(quantity)
    ? String(quantity)
    : quantity.toFixed(2).replace(/\.?0+$/, "");
  return unit === "one" || unit === "" ? `${n}×` : `${n} ${unit}`;
}

/**
 * The shelf narrowed by the header search bar: every whitespace-separated
 * term must hit the item's name or its category (the shared `filterBySearch`
 * rule, so "food fl" finds Flour under food the way it finds a task). An
 * empty query returns the same array.
 */
export function filterShelf(rows: ShelfRow[], query: string): ShelfRow[] {
  if (!query.trim()) return rows;
  const keep = new Set(
    filterBySearch(
      rows.map((r) => ({
        title: r.spec.name,
        category: r.spec.category,
        id: r.spec.id,
      })),
      query,
    ).map((h) => h.id),
  );
  return rows.filter((r) => keep.has(r.spec.id));
}

/** The reorder list narrowed the same way, by item name and category. */
export function filterReorder(
  lines: ReorderLine[],
  query: string,
): ReorderLine[] {
  if (!query.trim()) return lines;
  const keep = new Set(
    filterBySearch(
      lines.map((l) => ({ title: l.name, category: l.category, id: l.itemId })),
      query,
    ).map((h) => h.id),
  );
  return lines.filter((l) => keep.has(l.itemId));
}

/** Category names the shelf keeps, for the search bar's suggestion chips. */
export function shelfCategories(specs: StockItemSpecRecord[]): string[] {
  return [...new Set(specs.map((s) => s.category).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );
}
