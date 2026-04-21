// iCal Feed Parser Service
// Fetches and parses external iCal/webcal feeds for calendar integration

import ICAL from 'ical.js';

export interface ExternalCalendarEvent {
    id: string;
    title: string;
    description?: string;
    location?: string;
    start: Date;
    end: Date;
    allDay: boolean;
    recurrence?: string;
    calendarUrl: string;
    calendarName?: string;
    calendarId?: string;
    calendarColor?: string;
}

export interface ParsedCalendar {
    name: string;
    events: ExternalCalendarEvent[];
    lastSync: Date;
}

/**
 * Fetches and parses an iCal feed from a URL
 * @param url - The iCal/webcal feed URL
 * @param calendarName - Optional name for the calendar
 * @returns Parsed calendar with events
 */
export interface ParseWindow {
    start: Date;
    end: Date;
}

export async function fetchAndParseICalFeed(
    url: string,
    calendarName?: string,
    window?: ParseWindow
): Promise<ParsedCalendar> {
    try {
        // Convert webcal:// to https://
        const normalizedUrl = url.replace(/^webcal:\/\//i, 'https://');

        // Most iCal hosts (Google Calendar, iCloud) don't send CORS headers, so
        // browser fetches fail. Route through our SvelteKit proxy when in-browser.
        // On the server (SSR/build), fetch directly.
        const inBrowser = typeof window !== 'undefined';
        const fetchUrl = inBrowser
            ? `/api/ical-proxy?url=${encodeURIComponent(normalizedUrl)}`
            : normalizedUrl;

        const response = await fetch(fetchUrl, {
            headers: { Accept: 'text/calendar, text/plain, */*' }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch calendar: ${response.status} ${response.statusText}`);
        }

        const icalText = await response.text();
        return parseICalText(icalText, url, calendarName, window);
    } catch (error) {
        console.error('Error fetching iCal feed:', error);
        throw error;
    }
}

/**
 * Parses iCal text data into structured calendar events
 * @param icalText - Raw iCal text data
 * @param calendarUrl - The source URL for reference
 * @param calendarName - Optional calendar name
 * @returns Parsed calendar with events
 */
export function parseICalText(
    icalText: string,
    calendarUrl: string,
    calendarName?: string,
    window?: ParseWindow
): ParsedCalendar {
    try {
        const jcalData = ICAL.parse(icalText);
        const comp = new ICAL.Component(jcalData);

        // Get calendar name from X-WR-CALNAME or use provided name
        const calNameProp = comp.getFirstPropertyValue('x-wr-calname');
        const calName = calendarName ||
            (typeof calNameProp === 'string' ? calNameProp : null) ||
            'Imported Calendar';

        const events: ExternalCalendarEvent[] = [];
        const vevents = comp.getAllSubcomponents('vevent');

        // Expansion window: caller-provided, or default to the current calendar year.
        const now = new Date();
        const windowStart = window?.start ?? new Date(now.getFullYear(), 0, 1);
        const windowEnd = window?.end ?? new Date(now.getFullYear(), 11, 31, 23, 59, 59);

        // Convert ICAL.Time → JS Date. For all-day entries the iCal value is a DATE (no time);
        // toJSDate() would implicitly use UTC midnight, which shifts into the previous day for
        // users in negative UTC offsets (notably around New Year's). Build the Date from
        // explicit Y/M/D parts so the calendar lands on the correct local day.
        const icalTimeToDate = (t: any): Date => {
            if (t?.isDate) {
                return new Date(t.year, (t.month ?? 1) - 1, t.day ?? 1);
            }
            return t.toJSDate();
        };

        vevents.forEach((vevent) => {
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
                    // Skip instances entirely outside the window.
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
                    // Iterate from DTSTART and filter by window ourselves. Two caps:
                    //   - MAX_SKIP: how many pre-window occurrences we'll burn through.
                    //     Covers ~5y of weekly or ~80y of monthly events starting in the past.
                    //   - MAX_EMIT: how many in-window occurrences we'll emit.
                    const MAX_SKIP = 300;
                    const MAX_EMIT = 1000;
                    const iterator = event.iterator();
                    const durationMs = icalTimeToDate(event.endDate).getTime() - icalTimeToDate(event.startDate).getTime();
                    let skipped = 0;
                    let emitted = 0;
                    let next = iterator.next();
                    while (next) {
                        const startJs = icalTimeToDate(next);
                        // Past the window: stop iterating entirely.
                        if (startJs > windowEnd) break;
                        const endJs = new Date(startJs.getTime() + durationMs);
                        if (endJs >= windowStart) {
                            pushOccurrence(startJs, endJs, `${uid}::${startJs.toISOString()}`);
                            if (++emitted >= MAX_EMIT) break;
                        } else {
                            if (++skipped >= MAX_SKIP) break;
                        }
                        next = iterator.next();
                    }
                } else {
                    pushOccurrence(icalTimeToDate(event.startDate), icalTimeToDate(event.endDate), uid);
                }
            } catch (error) {
                console.error('Error parsing event:', error);
            }
        });

        return {
            name: calName,
            events,
            lastSync: new Date()
        };
    } catch (error) {
        console.error('Error parsing iCal text:', error);
        throw error;
    }
}

/**
 * Filters events within a date range
 * @param events - Array of calendar events
 * @param startDate - Range start date
 * @param endDate - Range end date
 * @returns Filtered events
 */
export function filterEventsByDateRange(
    events: ExternalCalendarEvent[],
    startDate: Date,
    endDate: Date
): ExternalCalendarEvent[] {
    return events.filter(event => {
        const eventStart = new Date(event.start);
        const eventEnd = new Date(event.end);

        // Include event if it overlaps with the date range
        return eventStart <= endDate && eventEnd >= startDate;
    });
}

/**
 * Validates an iCal URL
 * @param url - URL to validate
 * @returns true if valid
 */
export function isValidICalUrl(url: string): boolean {
    try {
        const urlObj = new URL(url);
        const protocol = urlObj.protocol.toLowerCase();
        return protocol === 'http:' || protocol === 'https:' || protocol === 'webcal:';
    } catch {
        return false;
    }
}
