// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Deep links to ONE card, for every kind of card the board shows. The grammar
// rides on the tab route (`/[holon]/<tab>`, tabroute.ts) and names the record
// in the query — the shape stocklink.ts introduced for shelf items and offers:
//
//     /<holon>/tasks?task=<id>        a backlog task     (DetailModal)
//     /<holon>/calendar?event=<id>    a calendar event   (DetailModal)
//     /<holon>/library?thing=<id>     a library thing    (DetailModal)
//     /<holon>/stock?item=<id>        a shelf item       (StockView's sheet)
//     /<holon>/offers?offer=<id>      an offer           (OffersView's sheet)
//
// The layout reads the card on boot: it picks the card's tab when the path
// names none, holds the ask until the record streams in, and opens it. The
// three DetailModal kinds are also mirrored back into the address bar while
// they are open, so what is showing is always shareable. Stock and Offers
// keep consuming their own param (they did before this module existed).

import type { TabId, Selection } from "./stores";
import {
  cardFromSearch,
  cardUrl,
  OFFER_PARAM,
  STOCK_ITEM_PARAM,
} from "./stocklink";

export type CardKind = "task" | "event" | "thing" | "item" | "offer";

export interface CardLink {
  param: string;
  tab: TabId;
  kind: CardKind;
}

/** A card named by a URL: which param carried it, the id, and where it lives. */
export interface LinkedCard extends CardLink {
  id: string;
}

export const TASK_PARAM = "task";
export const EVENT_PARAM = "event";
export const THING_PARAM = "thing";

/** Every card param the board understands, in precedence order. */
export const CARD_LINKS: readonly CardLink[] = [
  { param: TASK_PARAM, tab: "tasks", kind: "task" },
  { param: EVENT_PARAM, tab: "calendar", kind: "event" },
  { param: THING_PARAM, tab: "library", kind: "thing" },
  { param: STOCK_ITEM_PARAM, tab: "stock", kind: "item" },
  { param: OFFER_PARAM, tab: "offers", kind: "offer" },
];

/** The params whose cards open in the shared DetailModal (`selection`). */
export const SELECTION_PARAMS: readonly string[] = [
  TASK_PARAM,
  EVENT_PARAM,
  THING_PARAM,
];

/** The card a location's query names, or null when it names none. */
export function linkedCardFromSearch(search: string): LinkedCard | null {
  for (const link of CARD_LINKS) {
    const id = cardFromSearch(search, link.param);
    if (id) return { ...link, id };
  }
  return null;
}

/** The same query string with every DetailModal card param removed. */
export function withoutSelectionCard(search: string): string {
  const params = new URLSearchParams(search);
  for (const p of SELECTION_PARAMS) params.delete(p);
  const q = params.toString();
  return q ? `?${q}` : "";
}

/**
 * The query string naming `id` under `param`, with any other DetailModal card
 * param dropped (one card shows at a time) and the rest of the query kept.
 */
export function searchWithCard(
  search: string,
  param: string,
  id: string,
): string {
  const params = new URLSearchParams(search);
  for (const p of SELECTION_PARAMS) if (p !== param) params.delete(p);
  params.set(param, id);
  return `?${params.toString()}`;
}

/**
 * The param and id that name a DetailModal selection — the same id
 * `openQuest`/`openThing` look up — or null for nothing / a local draft
 * that has no record to link to yet.
 */
export function selectionCard(
  sel: Selection,
): { param: string; id: string } | null {
  if (!sel) return null;
  if (sel.kind === "thing") {
    const id = String(sel.item.id ?? "").trim();
    return id ? { param: THING_PARAM, id } : null;
  }
  if (sel.isNew) return null;
  const id = String(sel.quest.id ?? sel.quest.title ?? "").trim();
  if (!id) return null;
  return { param: sel.kind === "event" ? EVENT_PARAM : TASK_PARAM, id };
}

/** The tab a DetailModal selection's link opens on. */
function tabForParam(param: string): TabId {
  return CARD_LINKS.find((l) => l.param === param)?.tab ?? "tasks";
}

/** The shareable URL for a DetailModal selection, or null when it has none. */
export function selectionCardUrl(
  origin: string,
  holonSegment: string,
  sel: Selection,
): string | null {
  const card = selectionCard(sel);
  if (!card) return null;
  return cardUrl(
    origin,
    holonSegment,
    tabForParam(card.param),
    card.param,
    card.id,
  );
}
