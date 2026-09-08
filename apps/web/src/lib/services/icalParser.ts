// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fetching side of external calendar import. What an iCal feed MEANS —
// occurrences, recurrence expansion, which URLs are subscribable — belongs to
// `@holons/core/calendar`; this wrapper only knows how a browser gets the text
// (same-origin proxy: almost no iCal host sends CORS headers) and re-exports
// the core API so existing call sites keep their import path.

import { parseICalText, normalizeICalUrl } from "@holons/core/calendar";
import type { ParsedCalendar, ParseWindow } from "@holons/core/calendar";

export {
  parseICalText,
  filterEventsByDateRange,
  isValidICalUrl,
  normalizeICalUrl,
  toWebcalUrl,
} from "@holons/core/calendar";
export type {
  ExternalCalendarEvent,
  ParsedCalendar,
  ParseWindow,
  ImportedCalendar,
} from "@holons/core/calendar";

/**
 * Fetch an iCal feed and parse it.
 *
 * @param url          The iCal/webcal feed URL.
 * @param calendarName Optional display name, overriding the feed's own.
 * @param range        Expansion window for recurring series.
 */
export async function fetchAndParseICalFeed(
  url: string,
  calendarName?: string,
  range?: ParseWindow,
): Promise<ParsedCalendar> {
  const normalizedUrl = normalizeICalUrl(url);

  // In the browser the request goes through our own endpoint; on the server
  // (SSR / the feed endpoint) there is no CORS to work around.
  const inBrowser = typeof globalThis.window !== "undefined";
  const fetchUrl = inBrowser
    ? `/api/ical-proxy?url=${encodeURIComponent(normalizedUrl)}`
    : normalizedUrl;

  const response = await fetch(fetchUrl, {
    headers: { Accept: "text/calendar, text/plain, */*" },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch calendar: ${response.status} ${response.statusText}`,
    );
  }
  return parseICalText(await response.text(), url, calendarName, range);
}
