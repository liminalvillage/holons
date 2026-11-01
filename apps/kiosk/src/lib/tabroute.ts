// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Tab ↔ URL mapping. The board's URL grammar is `/[holon]/[tab]` with both
// segments optional (see routes/[[holon]]/[[tab]]): the holon segment is a
// registered label or raw id (holons.ts owns that half), the tab segment is
// one of the TABS ids — `/tasks`, `/liminal/calendar`. These helpers parse
// and rebuild the pathname; the layout uses them to open the deep-linked tab
// on boot and to reflect tab switches in the address bar without navigating.

import { TABS, type TabId } from "./stores";

const TAB_IDS = new Set<string>(TABS.map((t) => t.id));

/**
 * The path segment that opens a holon's onboarding (`/<holon>/onboarding`,
 * the bot's Mini App). Not a tab: the onboarding replaces the board while
 * the key is not seated (see `onboardingGate`).
 */
const ONBOARDING = "onboarding";

/** A pathname's segments, decoded, without empty entries. */
function segmentsOf(pathname: string): string[] {
  return pathname
    .split("/")
    .filter(Boolean)
    .map((s) => decodeURIComponent(s));
}

/**
 * The tab a URL path selects, or null when it doesn't name one. The tab is
 * the LAST segment (`/tasks`, `/liminal/tasks`) — a tab id can never collide
 * with a holon segment, which is a registered label or a numeric id.
 */
export function tabForPath(pathname: string): TabId | null {
  const segs = segmentsOf(pathname);
  const last = (segs[segs.length - 1] ?? "").toLowerCase();
  return TAB_IDS.has(last) ? (last as TabId) : null;
}

/** Was this URL opened for the holon's onboarding? */
export function opensOnboarding(pathname: string): boolean {
  const segs = segmentsOf(pathname);
  return (segs[segs.length - 1] ?? "").toLowerCase() === ONBOARDING;
}

/**
 * The pathname that shows `tab`, keeping whatever else the path carries (the
 * holon segment) and replacing any tab segment already there.
 */
export function pathForTab(pathname: string, tab: TabId): string {
  const segs = segmentsOf(pathname);
  const last = (segs[segs.length - 1] ?? "").toLowerCase();
  if (TAB_IDS.has(last) || last === ONBOARDING) segs.pop();
  segs.push(tab);
  return "/" + segs.map(encodeURIComponent).join("/");
}
