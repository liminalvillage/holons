// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Tab ↔ URL mapping. The board's URL grammar is `/[holon]/[tab]` with both
// segments optional (see routes/[[holon]]/[[tab]]): the holon segment is a
// registered label or raw id (holons.ts owns that half), the tab segment is
// one of the TABS ids — `/tasks`, `/liminal/calendar` — or one of the PAGE
// segments that are not tabs: `/dna` (the holon's front page), `/apply`
// (the walk before asking to join) and `/onboarding`. These helpers parse
// and rebuild the pathname; the layout uses them to open the deep-linked tab
// or page on boot and to reflect tab switches in the address bar without
// navigating.

import { JOIN_PAGES, joinPageOf, type JoinPage } from "@holons/core/onboarding";
import { TABS, type TabId } from "./stores";

const TAB_IDS = new Set<string>(TABS.map((t) => t.id));

/**
 * The segments that open a page instead of the board. Never tabs, and never
 * a holon label (holons.ts reserves them): `/dna` alone is this holon's front
 * page, not a holon called "dna". The words are core's (`JOIN_PAGES`).
 */
export const PAGE_SEGMENTS: readonly JoinPage[] = JOIN_PAGES;
export type PageSegment = JoinPage;

/** A pathname's segments, decoded, without empty entries. */
function segmentsOf(pathname: string): string[] {
  return pathname
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
}

const lastOf = (segs: string[]): string =>
  (segs[segs.length - 1] ?? "").toLowerCase();

/**
 * The tab a URL path selects, or null when it doesn't name one. The tab is
 * the LAST segment (`/tasks`, `/liminal/tasks`) — a tab id can never collide
 * with a holon segment, which is a registered label or a numeric id.
 */
export function tabForPath(pathname: string): TabId | null {
  const last = lastOf(segmentsOf(pathname));
  return TAB_IDS.has(last) ? (last as TabId) : null;
}

/** The page a URL path opens (`/liminal/dna` → `dna`), or null for the board. */
export function pageForPath(pathname: string): PageSegment | null {
  return joinPageOf(lastOf(segmentsOf(pathname)));
}

/** The path without its tab or page segment: what names the holon. */
function holonSegments(pathname: string): string[] {
  const segs = segmentsOf(pathname);
  const last = lastOf(segs);
  if (TAB_IDS.has(last) || joinPageOf(last)) segs.pop();
  return segs;
}

const build = (segs: string[]): string =>
  "/" + segs.map(encodeURIComponent).join("/");

/**
 * The pathname that shows `tab`, keeping whatever else the path carries (the
 * holon segment) and replacing any tab or page segment already there.
 */
export function pathForTab(pathname: string, tab: TabId): string {
  return build([...holonSegments(pathname), tab]);
}

/**
 * The pathname that opens `page` for the holon this path names (null: its
 * board), keeping the holon segment as written — a label stays a label.
 */
export function pathForPage(
  pathname: string,
  page: PageSegment | null,
): string {
  const segs = holonSegments(pathname);
  return build(page ? [...segs, page] : segs);
}

/** Query parameters that belong to one page and never follow a link off it. */
const PAGE_PARAMS = ["dna", "edit"];

/**
 * The link to `page` from the URL on screen: its path (see `pathForPage`)
 * with the query kept — a dev namespace or a `?holon=` override travels —
 * minus the parameters one page reads (`?dna=`, `?edit`).
 */
export function hrefForPage(
  url: { pathname: string; search: string },
  page: PageSegment | null,
  params: Record<string, string> = {},
): string {
  const q = new URLSearchParams(url.search);
  for (const p of PAGE_PARAMS) q.delete(p);
  for (const [k, v] of Object.entries(params)) q.set(k, v);
  const s = q.toString().replace(/=(?=&|$)/g, "");
  return pathForPage(url.pathname, page) + (s ? `?${s}` : "");
}
