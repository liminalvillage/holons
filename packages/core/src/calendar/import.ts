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
import { normalizeHolonColor, pickColor } from '../settings/color.js';

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
    /**
     * The colour chosen for this feed (`#rrggbb`), if any. Absent, a surface
     * colours the feed by hashing its id into the surface's own palette — see
     * {@link importedCalendarColor}.
     */
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

/**
 * The URL a feed is actually fetched from.
 *
 * - `webcal://` is a subscribe hint, not a transport — fetch it over https.
 * - A Google Calendar *share* or *embed* link (`…/calendar/u/0?cid=…`,
 *   `…/calendar/embed?src=…`) is a web page, not a feed: fetched as-is it
 *   returns HTML and the board stays empty. It is rewritten to the calendar's
 *   public iCal address (see {@link googleICalUrl}).
 *
 * Anything else comes back trimmed and otherwise untouched.
 */
export function normalizeICalUrl(url: string): string {
    const https = url.trim().replace(/^webcal:\/\//i, 'https://');
    return googleICalUrl(https) ?? https;
}

/**
 * Every feed a pasted link subscribes to: one per calendar for a Google
 * share/embed link that names several ({@link googleICalUrls}), else the one
 * {@link normalizeICalUrl} address. What an "add calendar" form stores.
 */
export function normalizeICalUrls(url: string): string[] {
    const google = googleICalUrls(url.trim().replace(/^webcal:\/\//i, 'https://'));
    return google.length ? google : [normalizeICalUrl(url)];
}

/** Hosts that serve Google Calendar's web UI. */
const GOOGLE_CALENDAR_HOSTS = new Set(['calendar.google.com', 'www.google.com', 'google.com']);

/**
 * A Google Calendar id carried in a share link's `cid`: either the id itself
 * (`team@group.calendar.google.com`) or — what Google's "Get shareable link"
 * produces — that id base64-encoded, often without padding.
 */
function decodeGoogleCalendarId(raw: string): string | null {
    const value = raw.trim();
    if (!value) return null;
    if (value.includes('@')) return value;
    try {
        const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
        const decoded = atob(padded);
        // A real id is printable ASCII with an `@` (user@gmail.com,
        // …@group.calendar.google.com, …#holiday@group.v.calendar.google.com).
        if (decoded.includes('@') && /^[\x21-\x7e]+$/.test(decoded)) return decoded;
    } catch {
        /* not base64 */
    }
    return null;
}

/**
 * The public iCal address behind a Google Calendar share/embed link, or
 * `null` when `url` is not such a link (including when it already IS a feed
 * address — `…/calendar/ical/…/basic.ics`).
 *
 * Handles `?cid=<id or base64 id>` (share links, `/calendar/u/0`, `/r`,
 * `/render`) and `?src=<id>` (embed links). A `cid` that is itself a feed URL
 * (Google's "add by URL" links) resolves to that feed. The result only reads
 * if the calendar is public; a private one needs the "Secret address in iCal
 * format" from the calendar's Google settings, which is already a feed URL.
 */
export function googleICalUrl(url: string): string | null {
    return googleICalUrls(url)[0] ?? null;
}

/**
 * Every public iCal address behind a Google Calendar share/embed link — an
 * embed link shows several calendars at once (`?src=a&src=b…`), and each is
 * its own feed. Empty when `url` is not such a link. Order follows the link,
 * duplicates are dropped. See {@link googleICalUrl} for the single-feed case.
 */
export function googleICalUrls(url: string): string[] {
    let parsed: URL;
    try {
        parsed = new URL(url.trim().replace(/^webcal:\/\//i, 'https://'));
    } catch {
        return [];
    }
    if (!GOOGLE_CALENDAR_HOSTS.has(parsed.hostname.toLowerCase())) return [];
    const path = parsed.pathname;
    if (!/^\/calendar(\/|$)/i.test(path) || /\/ical\//i.test(path)) return [];

    const out: string[] = [];
    const raws = [...parsed.searchParams.getAll('cid'), ...parsed.searchParams.getAll('src')];
    for (const raw of raws) {
        let feed: string | null = null;
        if (/^(https?|webcal):\/\//i.test(raw.trim())) {
            const inner = raw.trim().replace(/^webcal:\/\//i, 'https://');
            feed = googleICalUrl(inner) ?? inner;
        } else {
            const id = decodeGoogleCalendarId(raw);
            if (id) feed = `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`;
        }
        if (feed && !out.includes(feed)) out.push(feed);
    }
    return out;
}

/**
 * Whether fetched text is an iCal feed at all. A share page, a login wall or
 * an error page comes back as HTML with a 200, so "the fetch worked" is not
 * "we got a calendar".
 */
export function looksLikeICal(text: string): boolean {
    return /^\s*BEGIN:VCALENDAR/i.test(text.replace(/^﻿/, ''));
}

/** Two feed URLs name the same feed once normalised. */
function sameFeed(a: string, b: string): boolean {
    return normalizeICalUrl(a) === normalizeICalUrl(b);
}

/** One change to a holon's imported-calendar list, addressed by feed id. */
export type ImportedCalendarEdit =
    | { type: 'add'; entry: ImportedCalendar }
    | { type: 'remove'; id: string }
    | { type: 'toggle'; id: string }
    /** `color` `#rrggbb`, or `''`/`null` to go back to the automatic colour. */
    | { type: 'recolor'; id: string; color: string | null };

/**
 * `calendars` with `edit` (or each of `edits`, in order) applied.
 *
 * Every surface saves the list the same way: re-read the persisted list, apply
 * the ONE change the person made to that fresh copy, write it back. Never a
 * union with what a surface held in memory — that would resurrect a feed
 * removed on another device. An edit naming an id that is no longer there is
 * a no-op; an add of a feed already followed is too (see
 * {@link appendImportedCalendar}).
 */
export function applyCalendarEdit(
    calendars: readonly ImportedCalendar[],
    edit: ImportedCalendarEdit | readonly ImportedCalendarEdit[]
): ImportedCalendar[] {
    const edits = Array.isArray(edit) ? edit : [edit as ImportedCalendarEdit];
    let out = [...calendars];
    for (const e of edits) {
        switch (e.type) {
            case 'add':
                out = appendImportedCalendar(out, e.entry);
                break;
            case 'remove':
                out = out.filter((c) => c.id !== e.id);
                break;
            case 'toggle':
                out = out.map((c) => (c.id === e.id ? { ...c, enabled: !c.enabled } : c));
                break;
            case 'recolor': {
                const clean = normalizeHolonColor(e.color ?? '');
                out = out.map((c) => {
                    if (c.id !== e.id) return c;
                    const { color: _drop, ...rest } = c;
                    return clean ? { ...rest, color: clean } : rest;
                });
                break;
            }
        }
    }
    return out;
}

/**
 * `calendars` with `entry` added — unless the same feed is already followed,
 * in which case the list comes back unchanged (no duplicate subscriptions).
 */
export function appendImportedCalendar(
    calendars: readonly ImportedCalendar[],
    entry: ImportedCalendar
): ImportedCalendar[] {
    if (calendars.some((c) => c.id === entry.id || sameFeed(c.url, entry.url))) return [...calendars];
    return [...calendars, entry];
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
            // Only a plain hex colour survives the read: the record is shared
            // by several surfaces and must never carry an arbitrary CSS string.
            ...(normalizeHolonColor(c.color) ? { color: normalizeHolonColor(c.color) } : {}),
        }))
        .filter((c) => !!c.url);
}

/**
 * The colour a followed calendar is drawn with: the colour chosen for it when
 * one is set, else the palette entry its id hashes to — the same rule a
 * holon's identity colour follows, so a feed keeps one colour across sessions
 * with no configuration and every surface agrees on which feed is which.
 * `palette` is the surface's own (the kiosk's post-it notes, the dashboard's
 * hues).
 */
export function importedCalendarColor(
    calendar: Pick<ImportedCalendar, 'id' | 'color'>,
    palette: readonly string[]
): string {
    return pickColor(calendar.id, palette, calendar.color);
}
