// @holons/core/calendar — iCal generation
// UI-agnostic iCalendar feed generator. Used by web (SvelteKit endpoint)
// and bot (export commands). Browser-only download helpers stay in the
// web wrapper that re-exports this module.

import ICAL from 'ical.js';
import { parseInstant } from '../datetime/index.js';
import { isTimedValue } from '../tasks/schedule.js';
import { rsvpDisplayName } from './rsvp.js';

// `console` is universally present (browser, Node, workers); declare it
// here so we don't pull in `dom`/`node` lib types from the base tsconfig.
declare const console: { error?: (...args: unknown[]) => void };

/** A holon event (quest with `when`) shaped for iCal export. */
export interface HolonEvent {
    id: string;
    title: string;
    description?: string;
    location?: string;
    /** ISO date string for event start. */
    when: string;
    /** ISO date string for event end. Defaults to start + 1h when omitted. */
    ends?: string;
    /** Legacy spelling of `ends`, still present on older quests. */
    until?: string;
    participants?: Array<{
        /** Telegram-sourced participants carry a numeric id. */
        id: string | number;
        username?: string;
        firstName?: string;
        lastName?: string;
        /** Telegram spelling, as the bot and kiosk store it. */
        first_name?: string;
    }>;
    status?: string;
    category?: string;
}

/** Options for iCal feed generation. */
export interface ICalFeedOptions {
    /** Calendar product identifier. Defaults to Holons. */
    prodId?: string;
    /** Domain used to scope event UIDs. Defaults to `holons.io`. */
    uidDomain?: string;
}

const DEFAULT_PRODID = '-//Holons Holon Calendar//EN';
const DEFAULT_UID_DOMAIN = 'holons.io';
/** How often a subscriber is asked to re-read the feed (RFC 7986 + the
 *  Apple/Outlook `X-PUBLISHED-TTL` spelling of the same hint). */
const REFRESH_INTERVAL = 'PT1H';

/**
 * Generate an iCal feed string from holon events.
 *
 * @param events     Events to include (entries lacking `when` are skipped).
 * @param holonName  Display name for the calendar.
 * @param holonId    Holon identifier, embedded in event UIDs.
 * @param options    Optional product id / UID domain overrides.
 */
export function generateICalFeed(
    events: HolonEvent[],
    holonName: string,
    holonId: string,
    options: ICalFeedOptions = {}
): string {
    const prodId = options.prodId ?? DEFAULT_PRODID;
    const uidDomain = options.uidDomain ?? DEFAULT_UID_DOMAIN;

    const cal = new ICAL.Component(['vcalendar', [], []]);
    cal.updatePropertyWithValue('prodid', prodId);
    cal.updatePropertyWithValue('version', '2.0');
    cal.updatePropertyWithValue('calscale', 'GREGORIAN');
    cal.updatePropertyWithValue('method', 'PUBLISH');
    cal.updatePropertyWithValue('x-wr-calname', `${holonName} Calendar`);
    cal.updatePropertyWithValue('x-wr-caldesc', `Events from ${holonName} holon`);
    cal.updatePropertyWithValue('x-wr-timezone', 'UTC');
    // ical.js stamps `VALUE=DURATION` on its own for a Duration value.
    cal.updatePropertyWithValue('refresh-interval', ICAL.Duration.fromString(REFRESH_INTERVAL));
    cal.updatePropertyWithValue('x-published-ttl', REFRESH_INTERVAL);

    for (const event of events) {
        // A quest is a calendar entry only once it carries a date that parses.
        // Anything else — the empty-string / null "unscheduled" sentinels, an
        // `{}` left by an old migration, free text — is skipped rather than
        // serialized as `DTSTART:NaN-…`, which would make the WHOLE feed
        // unparsable and freeze every subscriber on its last good copy.
        if (!parseInstant(event?.when)) continue;
        try {
            const vevent = buildVEvent(event, holonId, uidDomain);
            // ical.js only rejects a bad value when it serializes, so prove the
            // entry serializes before it joins the feed — one stray record must
            // cost that entry, never the whole calendar.
            vevent.toString();
            cal.addSubcomponent(vevent);
        } catch (err) {
            // Skip malformed events but keep the feed valid.
            console.error?.('Error generating iCal event:', err);
        }
    }

    return cal.toString();
}

/** Alias kept for spec compatibility (`generateICal` / `toICalendar`). */
export const generateICal = generateICalFeed;
export const toICalendar = generateICalFeed;

function buildVEvent(
    event: HolonEvent,
    holonId: string,
    uidDomain: string
): InstanceType<typeof ICAL.Component> {
    const vevent = new ICAL.Component('vevent');
    const ievent = new ICAL.Event(vevent);

    ievent.uid = `${event.id}@${holonId}.${uidDomain}`;
    ievent.summary = text(event.title) || 'Untitled Event';
    const description = text(event.description);
    if (description) ievent.description = description;
    const location = text(event.location);
    if (location) ievent.location = location;

    const startDate = parseInstant(event.when) as Date;
    const rawEnd = parseInstant(event.ends ?? event.until);
    if (isTimedValue(event.when)) {
        ievent.startDate = ICAL.Time.fromJSDate(startDate, true);
        const endDate =
            rawEnd && rawEnd.getTime() > startDate.getTime()
                ? rawEnd
                : new Date(startDate.getTime() + 60 * 60 * 1000);
        ievent.endDate = ICAL.Time.fromJSDate(endDate, true);
    } else {
        // A bare `YYYY-MM-DD` is an all-day entry: DATE-valued, with iCal's
        // exclusive end (the day AFTER the last one it covers). Rendering it as
        // a midnight-UTC instant would land it on the wrong day west of UTC
        // and show it as a one-hour block everywhere else.
        const lastDay = rawEnd && rawEnd.getTime() >= startDate.getTime() ? rawEnd : startDate;
        ievent.startDate = allDayTime(startDate);
        ievent.endDate = allDayTime(
            new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1)
        );
    }

    const status = text(event.status);
    if (status) {
        vevent.updatePropertyWithValue('status', mapStatusToICalStatus(status));
    }
    const category = text(event.category);
    if (category) {
        vevent.updatePropertyWithValue('categories', category);
    }

    if (Array.isArray(event.participants)) {
        for (const participant of event.participants) {
            if (participant?.id == null) continue;
            const attendeeName = text(participant.firstName) || rsvpDisplayName(participant);
            const attendee = vevent.addPropertyWithValue(
                'attendee',
                `mailto:${participant.id}@${uidDomain}`
            );
            attendee.setParameter('cn', attendeeName);
            attendee.setParameter('role', 'REQ-PARTICIPANT');
            attendee.setParameter('partstat', 'ACCEPTED');
        }
    }

    const now = ICAL.Time.now();
    vevent.updatePropertyWithValue('dtstamp', now);
    vevent.updatePropertyWithValue('created', now);
    vevent.updatePropertyWithValue('last-modified', now);

    return vevent;
}

/** Stored records are untyped: ical.js throws on anything but a string, so a
 *  number is spelled out and any other shape counts as absent. */
function text(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return undefined;
}

/** A DATE-valued ICAL.Time for the local calendar day `d` falls on. */
function allDayTime(d: Date): InstanceType<typeof ICAL.Time> {
    return new ICAL.Time(
        { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), isDate: true },
        ICAL.Timezone.localTimezone
    );
}

const STATUS_MAP: Record<string, string> = {
    cancelled: 'CANCELLED',
    tentative: 'TENTATIVE',
    completed: 'CONFIRMED',
    ongoing: 'CONFIRMED',
    scheduled: 'CONFIRMED',
};

/** Map an internal event status to an iCal STATUS value. */
export function mapStatusToICalStatus(status: string): string {
    return STATUS_MAP[(status || '').toLowerCase()] ?? 'CONFIRMED';
}
