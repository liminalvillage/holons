/**
 * Pure CRUD for shopping checklists. UI-agnostic: takes data in, returns data out.
 * Storage I/O is the caller's responsibility (telegram uses `db.put`, web uses `holosphere.put`).
 */

import {
  SHOPPING_KEY,
  type ShoppingChecklist,
  type ShoppingItem,
} from './types.js';

/** Default container shape, used when no document exists yet for a holon. */
export function createEmptyChecklist(now: number = Date.now()): ShoppingChecklist {
  return {
    id: SHOPPING_KEY,
    type: 'shopping',
    title: 'Shopping List',
    items: [],
    created: new Date(now).toISOString(),
  };
}

/** Coerce a raw document (possibly partial / from gun) into a sane checklist, or null if deleted/absent. */
export function normalizeChecklist(data: unknown): ShoppingChecklist | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d._deleted) return null;
  // Canonical `created` (ISO); promote legacy `createdAt` (ms epoch) for records written before the unify.
  const created = typeof d.created === 'string'
    ? d.created
    : (typeof d.createdAt === 'number' ? new Date(d.createdAt).toISOString() : new Date().toISOString());
  return {
    id: SHOPPING_KEY,
    type: 'shopping',
    title: typeof d.title === 'string' ? d.title : 'Shopping List',
    items: Array.isArray(d.items)
      ? (d.items as ShoppingItem[]).filter((i) => i && i.id != null && !i._deleted)
      : [],
    created,
    _hologram: d._hologram as ShoppingChecklist['_hologram'],
    _federation: d._federation as ShoppingChecklist['_federation'],
  };
}

/** Build one item with sensible defaults. id-collision-free even within the same millisecond. */
export function createShoppingItem(
  text: string,
  opts: {
    id?: string | number;
    createdBy?: number | string;
    checked?: boolean;
    category?: string;
  } = {}
): ShoppingItem {
  const category = typeof opts.category === 'string' ? opts.category.trim() : '';
  return {
    id: opts.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: String(text).trim(),
    checked: opts.checked ?? false,
    ...(opts.createdBy !== undefined ? { createdBy: opts.createdBy } : {}),
    ...(category ? { category } : {}),
  };
}

/** Append multiple items, dropping blanks. Returns a new checklist (does not mutate input). */
export function addItems(
  checklist: ShoppingChecklist | null,
  texts: string[],
  opts: { createdBy?: number | string; category?: string } = {}
): ShoppingChecklist {
  const base = checklist ?? createEmptyChecklist();
  const fresh = texts
    .map((t) => String(t).trim())
    .filter((t) => t.length > 0)
    .map((t) => createShoppingItem(t, opts));
  return { ...base, items: [...base.items, ...fresh] };
}

/** Single-item convenience wrapper around {@link addItems}. */
export function addItem(
  checklist: ShoppingChecklist | null,
  text: string,
  opts: { createdBy?: number | string; category?: string } = {}
): ShoppingChecklist {
  return addItems(checklist, [text], opts);
}

/** Toggle one item's `checked` flag. Returns a new checklist. */
export function toggleItem(
  checklist: ShoppingChecklist | null,
  itemId: string | number
): ShoppingChecklist | null {
  if (!checklist) return null;
  const target = String(itemId);
  return {
    ...checklist,
    items: checklist.items.map((i) =>
      String(i.id) === target ? { ...i, checked: !i.checked } : i
    ),
  };
}

/** Remove one item by id. Returns a new checklist. */
export function removeItem(
  checklist: ShoppingChecklist | null,
  itemId: string | number
): ShoppingChecklist | null {
  if (!checklist) return null;
  const target = String(itemId);
  return {
    ...checklist,
    items: checklist.items.filter((i) => String(i.id) !== target),
  };
}

/** Drop every checked item. Used by telegram "Done" / web "Remove checked" buttons. */
export function removeChecked(checklist: ShoppingChecklist | null): ShoppingChecklist | null {
  if (!checklist) return null;
  return { ...checklist, items: checklist.items.filter((i) => !i.checked) };
}

/** Uncheck every item without removing them. Used by web "Refresh" button. */
export function clearChecked(checklist: ShoppingChecklist | null): ShoppingChecklist | null {
  if (!checklist) return null;
  return {
    ...checklist,
    items: checklist.items.map((i) => (i.checked ? { ...i, checked: false } : i)),
  };
}

/**
 * Stamp the need id a shopping item was published as (see @holons/core/needs).
 * Returns a new checklist; null when the item isn't present.
 */
export function stampNeedId(
  checklist: ShoppingChecklist | null,
  itemId: string | number,
  needId: string
): ShoppingChecklist | null {
  if (!checklist) return null;
  const target = String(itemId);
  if (!checklist.items.some((i) => String(i.id) === target)) return null;
  return {
    ...checklist,
    items: checklist.items.map((i) =>
      String(i.id) === target ? { ...i, needId } : i
    ),
  };
}

/** The need id an item was published as, if any. */
export function needIdOf(item: ShoppingItem | null | undefined): string | null {
  const needId = item?.needId;
  return typeof needId === 'string' && needId ? needId : null;
}

/** Convenience: is the document the shopping container? */
export function isShoppingDoc(doc: unknown, key?: string): boolean {
  if (!doc) return false;
  if (key === SHOPPING_KEY) return true;
  const d = doc as Record<string, unknown>;
  return d.id === SHOPPING_KEY || d.type === 'shopping';
}
