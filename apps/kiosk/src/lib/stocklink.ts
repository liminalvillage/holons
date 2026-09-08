// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Deep links to one stock item. The grammar rides on the tab route
// (`/[holon]/stock`, see tabroute.ts) and names the item in the query:
//
//     /<holon>/stock?item=<itemId>
//
// Opening such a link boots the Stock tab with that item's card already up,
// so a phone can be pointed at one shelf slot — a QR on the flour bin — and
// record a movement with one tap. The item id is the spec's id (stockItemId
// of its name), stable across renames.

export const STOCK_ITEM_PARAM = "item";

/** The URL that opens `itemId`'s card on the Stock tab of `holonSegment`. */
export function stockItemUrl(
  origin: string,
  holonSegment: string,
  itemId: string,
): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/${encodeURIComponent(holonSegment)}/stock?${STOCK_ITEM_PARAM}=${encodeURIComponent(itemId)}`;
}

/** The item id a location's query names, or null when it names none. */
export function stockItemFromSearch(search: string): string | null {
  const v = new URLSearchParams(search).get(STOCK_ITEM_PARAM);
  const id = v?.trim() ?? "";
  return id ? id : null;
}

/** The same query string with the item pointer removed (empty string when nothing is left). */
export function withoutStockItem(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(STOCK_ITEM_PARAM);
  const q = params.toString();
  return q ? `?${q}` : "";
}

/**
 * Coalesce a burst of ±1 taps into one movement. Each tap moves `delta`;
 * the flush fires once the taps go quiet, so five quick taps on "+" record
 * one `+5` rather than five events. A negative total is clamped by the
 * caller against what is on the shelf.
 */
export function mergeTap(
  pending: number,
  delta: number,
  onhand: number,
): number {
  const next = pending + delta;
  // Never promise to take more off the shelf than is on it.
  return Math.max(next, -Math.max(onhand, 0)) || 0; // no -0
}
