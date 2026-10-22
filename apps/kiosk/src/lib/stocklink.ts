// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Deep links to one card. The grammar rides on the tab route
// (`/[holon]/<tab>`, see tabroute.ts) and names the record in the query:
//
//     /<holon>/stock?item=<itemId>      a shelf item
//     /<holon>/offers?offer=<offerId>   an offer
//
// Opening such a link boots the Stock tab with that item's card already up,
// so a phone can be pointed at one shelf slot — a QR on the flour bin — and
// record a movement with one tap. The item id is the spec's id (stockItemId
// of its name), stable across renames.

export const STOCK_ITEM_PARAM = "item";
export const OFFER_PARAM = "offer";

/** The URL that opens `id`'s card on `tab` of `holonSegment`, under `param`. */
export function cardUrl(
  origin: string,
  holonSegment: string,
  tab: string,
  param: string,
  id: string,
): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/${encodeURIComponent(holonSegment)}/${tab}?${param}=${encodeURIComponent(id)}`;
}

/** The id a location's query names under `param`, or null when it names none. */
export function cardFromSearch(search: string, param: string): string | null {
  const v = new URLSearchParams(search).get(param);
  const id = v?.trim() ?? "";
  return id ? id : null;
}

/** The same query string with `param` removed (empty string when nothing is left). */
export function withoutCard(search: string, param: string): string {
  const params = new URLSearchParams(search);
  params.delete(param);
  const q = params.toString();
  return q ? `?${q}` : "";
}

/** The URL that opens `itemId`'s card on the Stock tab of `holonSegment`. */
export function stockItemUrl(
  origin: string,
  holonSegment: string,
  itemId: string,
): string {
  return cardUrl(origin, holonSegment, "stock", STOCK_ITEM_PARAM, itemId);
}

/** The item id a location's query names, or null when it names none. */
export function stockItemFromSearch(search: string): string | null {
  return cardFromSearch(search, STOCK_ITEM_PARAM);
}

/** The same query string with the item pointer removed (empty string when nothing is left). */
export function withoutStockItem(search: string): string {
  return withoutCard(search, STOCK_ITEM_PARAM);
}

/** `/<holon>/offers?offer=<id>` — the same grammar for an offer's card. */
export function offerUrl(
  origin: string,
  holonSegment: string,
  offerId: string,
): string {
  return cardUrl(origin, holonSegment, "offers", OFFER_PARAM, offerId);
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
