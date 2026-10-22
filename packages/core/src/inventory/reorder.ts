// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Reorder: the shopping list as a derived object.
 *
 *   buy(item) = max(0, target − onhand − incoming + reserved)
 *
 * This is Kantorovich's resource problem with one constraint per item and
 * no prices, where the optimum is just the positive part. Price breaks and
 * group buys are what would turn it back into a real programme; those live
 * in the needs domain's group-buy clustering, not here.
 */
import type { ChecklistItem, ChecklistStore } from '../checklists/types.js';
import { CHECKLIST_TYPES } from '../checklists/types.js';
import { getChecklist, putChecklist, createChecklistObject } from '../checklists/operations.js';
import type { ShoppingItem } from '../shopping/types.js';
import { round } from './fold.js';
import type { StockItemSpec, StockLevel } from './types.js';

export interface ReorderLine {
  itemId: string;
  name: string;
  category: string;
  unit: string;
  /** Units to buy. Always > 0. */
  quantity: number;
  /** What the line was computed from, for the UI to explain it. */
  basis: { target: number; onhand: number; incoming: number; reserved: number };
}

/**
 * What to buy so every item with a target reaches it. Items with no target
 * are never reordered; items with no level count as empty.
 */
export function reorderList(levels: StockLevel[], specs: StockItemSpec[]): ReorderLine[] {
  const byItem = new Map((levels ?? []).map((l) => [l.itemId, l]));
  const out: ReorderLine[] = [];
  for (const spec of specs ?? []) {
    const target = spec.target;
    if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0) continue;
    const level = byItem.get(spec.id);
    const onhand = level?.onhand ?? 0;
    const incoming = level?.incoming ?? 0;
    const reserved = level?.reserved ?? 0;
    const quantity = round(Math.max(0, target - onhand - incoming + reserved));
    if (quantity <= 0) continue;
    out.push({
      itemId: spec.id,
      name: spec.name,
      category: spec.category,
      unit: spec.unit,
      quantity,
      basis: { target, onhand, incoming, reserved },
    });
  }
  return out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

/** Stable id so re-deriving the list upserts rather than stacking rows. */
export function reorderItemId(itemId: string): string {
  return `stock:${itemId}`;
}

/**
 * Reorder lines as rows of the shopping checklist. Each row carries a
 * `stock` reference so the need it becomes can name the item, and its id is
 * stable per stock item so re-deriving the list replaces rather than adds.
 */
export function toShoppingItems(
  lines: ReorderLine[],
  opts: { createdBy?: number | string } = {},
): ShoppingItem[] {
  return (lines ?? []).map((line) => ({
    id: reorderItemId(line.itemId),
    text: `${formatQuantity(line.quantity, line.unit)} ${line.name}`.trim(),
    checked: false,
    ...(opts.createdBy != null ? { createdBy: opts.createdBy } : {}),
    category: line.category,
    stock: { itemId: line.itemId, quantity: line.quantity, unit: line.unit },
  }));
}

function formatQuantity(quantity: number, unit: string): string {
  const n = Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2).replace(/\.?0+$/, '');
  return unit === 'one' || unit === '' ? `${n}×` : `${n} ${unit}`;
}

// ── The shared shopping checklist ───────────────────────────────────────────
// Every UI keeps the holon's shopping list as the `shopping` checklist under
// `checklists`: rows of `{ text, checked }`. The reorder writes there, marking
// its rows with the stock item id so a re-derivation replaces rather than
// stacks, and never touching rows people typed by hand.


export const SHOPPING_CHECKLIST_ID = 'shopping';

/** One reorder line as a checklist row. */
export function toChecklistItem(line: ReorderLine): ChecklistItem {
  return {
    text: `${formatQuantity(line.quantity, line.unit)} ${line.name}`.trim(),
    checked: false,
    stockItemId: line.itemId,
  };
}

/**
 * Merge reorder lines into the rows of a checklist. An unticked row for the
 * same item is replaced in place; a ticked one is left as the record of a
 * purchase and a fresh row is added after it; items with no row are appended.
 * Rows without a stock id are never touched. Returns the new rows and how
 * many changed, so a caller can skip a no-op write.
 */
export function mergeReorderRows(
  rows: ChecklistItem[],
  lines: ReorderLine[],
): { rows: ChecklistItem[]; changed: number } {
  const next = (rows ?? []).map((r) => ({ ...r }));
  let changed = 0;
  for (const line of lines ?? []) {
    const row = toChecklistItem(line);
    const at = next.findIndex((r) => r.stockItemId === line.itemId && !r.checked);
    if (at >= 0) {
      if (next[at].text !== row.text) {
        next[at] = row;
        changed++;
      }
    } else {
      next.push(row);
      changed++;
    }
  }
  return { rows: next, changed };
}

/** Write the reorder into the holon's shopping checklist. Returns rows changed. */
export async function syncReorderToShopping(
  store: ChecklistStore,
  holonId: string | number,
  lines: ReorderLine[],
  opts: { creator?: string | number } = {},
): Promise<number> {
  const existing = await getChecklist(store, holonId, SHOPPING_CHECKLIST_ID);
  const checklist =
    existing ??
    createChecklistObject(SHOPPING_CHECKLIST_ID, CHECKLIST_TYPES.SHOPPING, {
      creator: opts.creator ?? null,
    });
  const { rows, changed } = mergeReorderRows(checklist.items ?? [], lines);
  if (!changed && existing) return 0;
  await putChecklist(store, holonId, { ...checklist, items: rows });
  return changed;
}
