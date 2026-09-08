// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Subscribed external calendars: the feeds a holon watches but doesn't own.
//
// A room's opening hours, a festival's programme, a partner's Google Calendar —
// things the group needs on the board without anyone re-typing them as quests.
// The list of feeds lives in the `settings` lens under `imported_calendars`,
// the SAME record the web dashboard writes, so a calendar added on either
// surface shows up on both.
//
// Core owns what a feed means (`@holons/core/calendar`: parsing, recurrence
// expansion, which URLs are subscribable, how a span reads on a board). This
// module owns only the kiosk's side of it: reading/writing the settings
// record, fetching through the same-origin proxy (calendar hosts send no CORS
// headers), and shaping occurrences into the board's `CalendarEvent`.

import { writable, get } from "svelte/store";
import {
  IMPORTED_CALENDARS_KEY,
  isValidICalUrl,
  normalizeICalUrl,
  parseICalText,
  readImportedCalendars,
  type ImportedCalendar,
} from "@holons/core/calendar";
import { getHolosphere, getWriter } from "./holosphere";
import { toExternalEvents, type CalendarEvent } from "./data";

export { isValidICalUrl, type ImportedCalendar };

/** The feeds this holon subscribes to, as last read from the settings lens. */
export const importedCalendars = writable<ImportedCalendar[]>([]);

/** Occurrences from the enabled feeds, ready to merge into the board. */
export const externalEvents = writable<CalendarEvent[]>([]);

/** True while feeds are being (re)fetched — the settings sheet says so. */
export const calendarsSyncing = writable(false);

/** Which holon the two stores above currently describe. */
let boundHolon: string | null = null;

/**
 * Re-fetch no more often than this. A calendar app polls a feed every few
 * hours; a kiosk that re-reads on every render would just hammer the hosts.
 */
const REFRESH_MS = 15 * 60 * 1000;
let lastRefreshAt = 0;

/** The window recurring series are expanded over: the year around today. */
function expansionWindow(): { start: Date; end: Date } {
  const year = new Date().getFullYear();
  return {
    start: new Date(year - 1, 11, 1),
    end: new Date(year + 1, 1, 1, 23, 59, 59),
  };
}

/** Read the holon's subscribed feeds. Returns [] for an unreadable record. */
export async function loadImportedCalendars(
  holon: string,
): Promise<ImportedCalendar[]> {
  try {
    const hs = await getHolosphere();
    const record = await hs.get(holon, "settings", IMPORTED_CALENDARS_KEY);
    return readImportedCalendars(record);
  } catch (err) {
    console.error("[kiosk] failed to read the subscribed calendars", err);
    return [];
  }
}

/**
 * Write the feed list back. Keyed by `imported_calendars` so it sits beside —
 * never on top of — the holon's own settings record (see core's
 * `loadSettings`, which scores keyed records and skips this one).
 */
export async function saveImportedCalendars(
  holon: string,
  calendars: ImportedCalendar[],
): Promise<boolean> {
  try {
    const writer = await getWriter(holon);
    return await writer.put("settings", {
      id: IMPORTED_CALENDARS_KEY,
      calendars,
      updated: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[kiosk] failed to save the subscribed calendars", err);
    return false;
  }
}

/** Fetch and parse one feed. A failing feed yields [] — the board still draws. */
async function readFeed(calendar: ImportedCalendar): Promise<CalendarEvent[]> {
  const url = normalizeICalUrl(calendar.url);
  if (!isValidICalUrl(url)) return [];
  try {
    // Calendar hosts (Google, iCloud, Nextcloud) send no CORS headers, so the
    // request goes through our own endpoint rather than straight out.
    const res = await fetch(`/api/ical-proxy?url=${encodeURIComponent(url)}`, {
      headers: { Accept: "text/calendar, text/plain, */*" },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const parsed = parseICalText(
      await res.text(),
      calendar.url,
      calendar.name,
      expansionWindow(),
    );
    return toExternalEvents(parsed.events, calendar);
  } catch (err) {
    console.warn(`[kiosk] calendar feed "${calendar.name}" failed`, err);
    return [];
  }
}

/**
 * Bring `importedCalendars` and `externalEvents` up to date for `holon`.
 *
 * Cheap to call: a repeat within {@link REFRESH_MS} on the same holon does
 * nothing unless `force` is set (the settings sheet forces one after an edit).
 * Switching holon always refetches, and clears first so one holon's feeds
 * never linger on another's board.
 */
export async function refreshExternalCalendars(
  holon: string | null,
  force = false,
): Promise<void> {
  if (!holon) {
    boundHolon = null;
    importedCalendars.set([]);
    externalEvents.set([]);
    return;
  }
  const switched = holon !== boundHolon;
  if (!switched && !force && Date.now() - lastRefreshAt < REFRESH_MS) return;
  if (switched) {
    boundHolon = holon;
    importedCalendars.set([]);
    externalEvents.set([]);
  }

  lastRefreshAt = Date.now();
  calendarsSyncing.set(true);
  try {
    const calendars = await loadImportedCalendars(holon);
    if (boundHolon !== holon) return;
    importedCalendars.set(calendars);

    const enabled = calendars.filter((c) => c.enabled);
    if (!enabled.length) {
      externalEvents.set([]);
      return;
    }
    const feeds = await Promise.all(enabled.map(readFeed));
    // A holon switch mid-fetch must not land the old holon's events.
    if (boundHolon !== holon) return;
    externalEvents.set(feeds.flat());
  } finally {
    if (boundHolon === holon) calendarsSyncing.set(false);
  }
}

/** Add a feed, persist it, and pull it in. `false` when the URL is unusable. */
export async function addImportedCalendar(
  holon: string,
  url: string,
  name: string,
): Promise<boolean> {
  const trimmed = url.trim();
  if (!isValidICalUrl(trimmed)) return false;
  const calendars = [
    ...get(importedCalendars),
    {
      id: `cal_${Date.now()}`,
      url: trimmed,
      name: name.trim() || "Imported Calendar",
      enabled: true,
    },
  ];
  importedCalendars.set(calendars);
  const ok = await saveImportedCalendars(holon, calendars);
  await refreshExternalCalendars(holon, true);
  return ok;
}

/** Drop a feed and everything it put on the board. */
export async function removeImportedCalendar(
  holon: string,
  id: string,
): Promise<boolean> {
  const calendars = get(importedCalendars).filter((c) => c.id !== id);
  importedCalendars.set(calendars);
  const ok = await saveImportedCalendars(holon, calendars);
  await refreshExternalCalendars(holon, true);
  return ok;
}

/** Show or hide a feed without forgetting the subscription. */
export async function toggleImportedCalendar(
  holon: string,
  id: string,
): Promise<boolean> {
  const calendars = get(importedCalendars).map((c) =>
    c.id === id ? { ...c, enabled: !c.enabled } : c,
  );
  importedCalendars.set(calendars);
  const ok = await saveImportedCalendars(holon, calendars);
  await refreshExternalCalendars(holon, true);
  return ok;
}

/**
 * The subscribe URL for this holon's own live calendar — what someone pastes
 * into Google/Apple Calendar. `federated` widens it to the partners the holon
 * federates `quests` with.
 */
export function holonFeedUrl(
  holon: string,
  federated: boolean,
  origin?: string,
): string {
  const base =
    origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  const query = `holon=${encodeURIComponent(holon)}${federated ? "&federated=1" : ""}`;
  return `${base}/api/calendar/feed.ics?${query}`;
}
