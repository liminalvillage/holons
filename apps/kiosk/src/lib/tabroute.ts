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

/**
 * The path segment that opens the Tasks "Choose" deck full screen
 * (`/<holon>/choose`) — the direct link a phone, a home-screen icon or a
 * Mini App button can open straight into. Not a tab: it shows the Tasks tab
 * with the deck over it, and closing the deck returns the path to `/tasks`.
 */
export const CHOOSE = "choose";

/**
 * Other words a link may use for a tab: `/lists` opens Checklists, `/quests`
 * opens Tasks, `/need` (or `/needs`) opens Needs & Offers. Read on the way
 * in only — the address bar always shows the tab's own id.
 */
export const TAB_ALIASES: Readonly<Record<string, TabId>> = {
  lists: "checklists",
  quests: "tasks",
  need: "offers",
  needs: "offers",
};

/** Segments a view replaces when another view is reflected in the path. */
const VIEW_SEGMENTS = new Set<string>([
  ...TAB_IDS,
  ...Object.keys(TAB_ALIASES),
  ONBOARDING,
  CHOOSE,
]);

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
  if (last === CHOOSE) return "tasks";
  if (Object.hasOwn(TAB_ALIASES, last)) return TAB_ALIASES[last];
  return TAB_IDS.has(last) ? (last as TabId) : null;
}

/** Was this URL opened straight into the Tasks "Choose" deck? */
export function opensChoose(pathname: string): boolean {
  const segs = segmentsOf(pathname);
  return (segs[segs.length - 1] ?? "").toLowerCase() === CHOOSE;
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
  return withView(pathname, tab);
}

/** The pathname that opens the "Choose" deck, keeping the holon segment. */
export function pathForChoose(pathname: string): string {
  return withView(pathname, CHOOSE);
}

function withView(pathname: string, view: string): string {
  const segs = segmentsOf(pathname);
  const last = (segs[segs.length - 1] ?? "").toLowerCase();
  if (VIEW_SEGMENTS.has(last)) segs.pop();
  segs.push(view);
  return "/" + segs.map(encodeURIComponent).join("/");
}
