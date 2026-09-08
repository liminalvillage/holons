// SPDX-License-Identifier: AGPL-3.0-or-later
//
// @holons/core/calendar — external calendar import (the read side of iCal).
//
// A holon can subscribe to calendars it doesn't own (a Google/Apple/Nextcloud
// feed, a venue's opening hours). Parsing what comes back is domain logic —
// what counts as an event, how a recurrence expands, which window is worth
// expanding — so it lives here, and every surface (web dashboard, kiosk)
// renders the same events from the same text.
//
// Fetching is NOT core's job: core does no outbound HTTP. Each UI fetches the
// feed the way its runtime allows (browsers need a same-origin proxy, since
// almost no iCal host sends CORS headers) and hands the text to
// {@link parseICalText}.

import ICAL from 'ical.js';

// `console` is universally present (browser, Node, workers); declared here so
// this module doesn't pull `dom`/`node` lib types into the base tsconfig.
declare const console: { error?: (...args: unknown[]) => void };

/** One occurrence read out of an external feed. */
export interface ExternalCalendarEvent {
    /** Feed UID; for a recurring series, `uid::<occurrence ISO start>`. */
    id: string;
    title: string;
    description?: string;
    location?: string;
    start: Date;
    end: Date;
    /** True when the feed gave a DATE (no time) — an all-day entry. */
    allDay: boolean;
    /** The raw RRULE, when the entry recurs. */
    recurrence?: string;
    /** The feed this came from, for attribution and colouring. */
    calendarUrl: string;
    calendarName?: string;
    calendarId?: string;
    calendarColor?: string;
}

/** A parsed feed: its name, the occurrences in the window, and when we read it. */
export interface ParsedCalendar {
    name: string;
    events: ExternalCalendarEvent[];
    lastSync: Date;
}

/** The span a recurring series is expanded over. */
export interface ParseWindow {
    start: Date;
    end: Date;
}

/**
 * A calendar a holon subscribes to, as stored in the `imported_calendars`
 * record of the `settings` lens. Shared by every surface, so a feed added on
 * the dashboard shows up on the kiosk and vice versa.
 */
export interface ImportedCalendar {
    id: string;
    url: string;
    name: string;
    enabled: boolean;
    /** Optional display colour; surfaces fall back to their own palette. */
    color?: string;
}

/** The key the imported-calendar list is stored under in the settings lens. */
export const IMPORTED_CALENDARS_KEY = 'imported_calendars';

/** How many pre-window occurrences of a series we'll burn through. */
const MAX_SKIP = 300;
/** How many in-window occurrences one series may emit. */
const MAX_EMIT = 1000;

/**
 * Convert an ICAL.Time to a JS Date.
 *
 * All-day entries carry a DATE (no time); `toJSDate()` would read that as UTC
 * midnight, which lands on the previous day for anyone west of UTC. Build
 * those from explicit Y/M/D parts so the event sits on the right local day.
 */
function icalTimeToDate(t: {
    isDate?: boolean;
    year?: number;
    month?: number;
    day?: number;
    toJSDate: () => Date;
}): Date {
    if (t?.isDate) return new Date(t.year ?? 1970, (t.month ?? 1) - 1, t.day ?? 1);
    return t.toJSDate();
}

/**
 * Parse iCal text into occurrences.
 *
 * Recurring series are expanded across `window` (default: the current calendar
 * year), because a feed states a rule, not the dates a board has to draw.
 * A single unparseable VEVENT is skipped rather than failing the whole feed —
 * external calendars are full of oddities and one bad entry shouldn't blank a
 * board.
 *
 * @param icalText     Raw feed text (RFC 5545).
 * @param calendarUrl  Source URL, carried onto every event for attribution.
 * @param calendarName Overrides the feed's own `X-WR-CALNAME`.
 * @param window       Expansion window for recurring series.
 */
export function parseICalText(
    icalText: string,
    calendarUrl: string,
    calendarName?: string,
    window?: ParseWindow
): ParsedCalendar {
    const jcalData = ICAL.parse(icalText);
    const comp = new ICAL.Component(jcalData);

    const calNameProp = comp.getFirstPropertyValue('x-wr-calname');
    const calName =
        calendarName || (typeof calNameProp === 'string' ? calNameProp : null) || 'Imported Calendar';

    const events: ExternalCalendarEvent[] = [];
    const vevents = comp.getAllSubcomponents('vevent');

    const now = new Date();
    const windowStart = window?.start ?? new Date(now.getFullYear(), 0, 1);
    const windowEnd = window?.end ?? new Date(now.getFullYear(), 11, 31, 23, 59, 59);

    for (const vevent of vevents) {
        try {
            const event = new ICAL.Event(vevent);
            const uid = event.uid;
            const summary = event.summary || 'Untitled Event';
            const description = event.description || '';
            const location = event.location || '';
            const allDay = event.startDate.isDate === true;
            const rrule = vevent.getFirstPropertyValue('rrule');
            const recurrence = rrule ? rrule.toString() : undefined;

            const pushOccurrence = (startJs: Date, endJs: Date, occurrenceId: string) => {
                // Anything wholly outside the window isn't drawn, so isn't emitted.
                if (endJs < windowStart || startJs > windowEnd) return;
                events.push({
                    id: occurrenceId,
                    title: summary,
                    description,
                    location,
                    start: startJs,
                    end: endJs,
                    allDay,
                    recurrence,
                    calendarUrl,
                    calendarName: calName,
                });
            };

            if (event.isRecurring()) {
                const iterator = event.iterator();
                const durationMs =
                    icalTimeToDate(event.endDate).getTime() - icalTimeToDate(event.startDate).getTime();
                let skipped = 0;
                let emitted = 0;
                let next = iterator.next();
                while (next) {
                    const startJs = icalTimeToDate(next);
                    if (startJs > windowEnd) break; // past the window — done
                    const endJs = new Date(startJs.getTime() + durationMs);
                    if (endJs >= windowStart) {
                        pushOccurrence(startJs, endJs, `${uid}::${startJs.toISOString()}`);
                        if (++emitted >= MAX_EMIT) break;
                    } else if (++skipped >= MAX_SKIP) {
                        break;
                    }
                    next = iterator.next();
                }
            } else {
                pushOccurrence(icalTimeToDate(event.startDate), icalTimeToDate(event.endDate), uid);
            }
        } catch (error) {
            console.error?.('Skipping unparseable VEVENT:', error);
        }
    }

    return { name: calName, events, lastSync: new Date() };
}

/**
 * How a board should draw one occurrence: the INCLUSIVE last moment it covers
 * and how many calendar days that is.
 *
 * iCal states an all-day DTEND as the day AFTER the last one (an exclusive
 * boundary), while a board draws the last day it actually covers — so a
 * one-day holiday arrives as `20260101 → 20260102` and must render on Jan 1
 * alone. Timed events keep their real end instant.
 */
export function occurrenceSpan(event: {
    start: Date;
    end: Date;
    allDay: boolean;
}): { end: Date; days: number; multiDay: boolean } {
    const start = new Date(event.start);
    let end = new Date(event.end);
    if (event.allDay) {
        // Step back off the exclusive boundary, but never behind the start
        // (feeds do emit DTEND === DTSTART for a single all-day entry).
        const inclusive = new Date(end.getTime() - 1);
        end = inclusive < start ? new Date(start) : inclusive;
    }
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const days = Math.max(1, Math.round((endDay.getTime() - startDay.getTime()) / 86_400_000) + 1);
    return { end, days, multiDay: days > 1 };
}

/** Events overlapping `[startDate, endDate]` — touching an edge counts. */
export function filterEventsByDateRange(
    events: ExternalCalendarEvent[],
    startDate: Date,
    endDate: Date
): ExternalCalendarEvent[] {
    return events.filter((event) => {
        const eventStart = new Date(event.start);
        const eventEnd = new Date(event.end);
        return eventStart <= endDate && eventEnd >= startDate;
    });
}

/** Whether a string is a subscribable feed URL (`http`, `https` or `webcal`). */
export function isValidICalUrl(url: string): boolean {
    try {
        const protocol = new URL(url).protocol.toLowerCase();
        return protocol === 'http:' || protocol === 'https:' || protocol === 'webcal:';
    } catch {
        return false;
    }
}

/** `webcal://` is a subscribe hint, not a transport — fetch it over https. */
export function normalizeICalUrl(url: string): string {
    return url.trim().replace(/^webcal:\/\//i, 'https://');
}

/** The `webcal://` form of a feed URL — what a calendar app subscribes to. */
export function toWebcalUrl(url: string): string {
    return url.trim().replace(/^https?:\/\//i, 'webcal://');
}

/**
 * The imported-calendar list held in a `settings` lens record, defensively
 * read: the record is written by several surfaces and older ones stored
 * partial entries.
 */
export function readImportedCalendars(record: unknown): ImportedCalendar[] {
    const calendars = (record as { calendars?: unknown } | null | undefined)?.calendars;
    if (!Array.isArray(calendars)) return [];
    return calendars
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map((c, i) => ({
            id: typeof c.id === 'string' && c.id ? c.id : `cal_${i}`,
            url: typeof c.url === 'string' ? c.url : '',
            name: typeof c.name === 'string' && c.name ? c.name : 'Imported Calendar',
            // Absent `enabled` means an older write — treat it as on.
            enabled: c.enabled !== false,
            ...(typeof c.color === 'string' ? { color: c.color } : {}),
        }))
        .filter((c) => !!c.url);
}
