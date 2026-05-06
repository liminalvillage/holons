// iCal Feed Generator Service
// Generates iCal feeds from holon events for export/subscription

import ICAL from 'ical.js';

export interface HolonEvent {
    id: string;
    title: string;
    description?: string;
    location?: string;
    when: string; // ISO date string
    ends?: string; // ISO date string
    participants?: Array<{ id: string; username?: string; firstName?: string; lastName?: string }>;
    status?: string;
    category?: string;
}

/**
 * Generates an iCal feed from holon events
 * @param events - Array of holon events
 * @param holonName - Name of the holon (for calendar name)
 * @param holonId - ID of the holon
 * @returns iCal formatted string
 */
export function generateICalFeed(
    events: HolonEvent[],
    holonName: string,
    holonId: string
): string {
    // Create the calendar component
    const cal = new ICAL.Component(['vcalendar', [], []]);

    // Set calendar properties
    cal.updatePropertyWithValue('prodid', '-//Harvest Holon Calendar//EN');
    cal.updatePropertyWithValue('version', '2.0');
    cal.updatePropertyWithValue('calscale', 'GREGORIAN');
    cal.updatePropertyWithValue('method', 'PUBLISH');
    cal.updatePropertyWithValue('x-wr-calname', `${holonName} Calendar`);
    cal.updatePropertyWithValue('x-wr-caldesc', `Events from ${holonName} holon`);
    cal.updatePropertyWithValue('x-wr-timezone', 'UTC');

    // Add each event
    events.forEach(event => {
        try {
            if (!event.when) return; // Skip events without dates

            const vevent = new ICAL.Component('vevent');
            const ievent = new ICAL.Event(vevent);

            // Set UID - use event ID with holon ID for uniqueness
            ievent.uid = `${event.id}@${holonId}.harvest.app`;

            // Set summary (title)
            ievent.summary = event.title || 'Untitled Event';

            // Set description
            if (event.description) {
                ievent.description = event.description;
            }

            // Set location
            if (event.location) {
                ievent.location = event.location;
            }

            // Set start time
            const startDate = new Date(event.when);
            ievent.startDate = ICAL.Time.fromJSDate(startDate, true);

            // Set end time
            const endDate = event.ends ? new Date(event.ends) : new Date(startDate.getTime() + 60 * 60 * 1000); // Default 1 hour
            ievent.endDate = ICAL.Time.fromJSDate(endDate, true);

            // Add status
            if (event.status) {
                vevent.updatePropertyWithValue('status', mapStatusToICalStatus(event.status));
            }

            // Add categories
            if (event.category) {
                vevent.updatePropertyWithValue('categories', event.category);
            }

            // Add participants as attendees
            if (event.participants && event.participants.length > 0) {
                event.participants.forEach(participant => {
                    const attendeeName = participant.firstName || participant.username || participant.id;
                    const attendee = vevent.addPropertyWithValue(
                        'attendee',
                        `mailto:${participant.id}@harvest.app`
                    );
                    attendee.setParameter('cn', attendeeName);
                    attendee.setParameter('role', 'REQ-PARTICIPANT');
                    attendee.setParameter('partstat', 'ACCEPTED');
                });
            }

            // Set created and last modified timestamps
            const now = ICAL.Time.now();
            vevent.updatePropertyWithValue('dtstamp', now);
            vevent.updatePropertyWithValue('created', now);
            vevent.updatePropertyWithValue('last-modified', now);

            // Add the event to the calendar
            cal.addSubcomponent(vevent);
        } catch (error) {
            console.error('Error generating iCal event:', error);
            // Skip malformed events
        }
    });

    return cal.toString();
}

/**
 * Maps holon event status to iCal status
 */
function mapStatusToICalStatus(status: string): string {
    const statusMap: Record<string, string> = {
        'completed': 'CONFIRMED',
        'ongoing': 'CONFIRMED',
        'scheduled': 'CONFIRMED',
        'cancelled': 'CANCELLED',
        'tentative': 'TENTATIVE'
    };

    return statusMap[status.toLowerCase()] || 'CONFIRMED';
}

/**
 * Generates a download URL for the iCal feed
 * @param icalContent - iCal content string
 * @returns Blob URL for download
 */
export function createICalDownloadUrl(icalContent: string): string {
    const blob = new Blob([icalContent], { type: 'text/calendar;charset=utf-8' });
    return URL.createObjectURL(blob);
}

/**
 * Downloads an iCal file
 * @param icalContent - iCal content string
 * @param fileName - Name for the downloaded file
 */
export function downloadICalFile(icalContent: string, fileName: string = 'calendar.ics'): void {
    const url = createICalDownloadUrl(icalContent);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
