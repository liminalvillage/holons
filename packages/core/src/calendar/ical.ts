// @holons/core/calendar — iCal generation
// UI-agnostic iCalendar feed generator. Used by web (SvelteKit endpoint)
// and bot (export commands). Browser-only download helpers stay in the
// web wrapper that re-exports this module.

import ICAL from 'ical.js';

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
    participants?: Array<{
        id: string;
        username?: string;
        firstName?: string;
        lastName?: string;
    }>;
    status?: string;
    category?: string;
}

/** Options for iCal feed generation. */
export interface ICalFeedOptions {
    /** Calendar product identifier. Defaults to Harvest. */
    prodId?: string;
    /** Domain used to scope event UIDs. Defaults to `harvest.app`. */
    uidDomain?: string;
}

const DEFAULT_PRODID = '-//Harvest Holon Calendar//EN';
const DEFAULT_UID_DOMAIN = 'harvest.app';

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

    for (const event of events) {
        if (!event?.when) continue;
        try {
            cal.addSubcomponent(buildVEvent(event, holonId, uidDomain));
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
    ievent.summary = event.title || 'Untitled Event';
    if (event.description) ievent.description = event.description;
    if (event.location) ievent.location = event.location;

    const startDate = new Date(event.when);
    ievent.startDate = ICAL.Time.fromJSDate(startDate, true);
    const endDate = event.ends
        ? new Date(event.ends)
        : new Date(startDate.getTime() + 60 * 60 * 1000);
    ievent.endDate = ICAL.Time.fromJSDate(endDate, true);

    if (event.status) {
        vevent.updatePropertyWithValue('status', mapStatusToICalStatus(event.status));
    }
    if (event.category) {
        vevent.updatePropertyWithValue('categories', event.category);
    }

    if (event.participants?.length) {
        for (const participant of event.participants) {
            const attendeeName =
                participant.firstName || participant.username || participant.id;
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
