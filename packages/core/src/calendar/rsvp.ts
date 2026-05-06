// @holons/core/calendar — RSVP / participation tracking
// Pure data helpers shared by web and bot. UI-agnostic — no Telegraf,
// no DOM. Bots own the keyboard rendering, the web app owns its UI.

/** Display fields used to build a participant label. */
export interface RSVPUser {
    id: string | number;
    username?: string;
    first_name?: string;
    second_name?: string;
    /**
     * Map of `messageId -> attending?` for legacy bot storage. The bot
     * stores per-message RSVP state on the user record.
     */
    participated?: Record<string, boolean | undefined> | null;
}

/** A single rendered participant entry. */
export interface RSVPEntry {
    userId: string | number;
    name: string;
    attending: boolean;
}

/** Display name for a user, falling back through the available fields. */
export function rsvpDisplayName(user: RSVPUser): string {
    const first = user.first_name || user.username || String(user.id);
    return user.second_name ? `${first} ${user.second_name}` : first;
}

/** Whether the user is currently marked attending for the given event/message. */
export function isAttending(
    user: RSVPUser,
    eventKey: string | number
): boolean {
    if (!user || typeof user.participated !== 'object' || !user.participated) {
        return false;
    }
    return Boolean(user.participated[String(eventKey)]);
}

/**
 * Toggle the user's RSVP state for the given event/message key.
 * Mutates and returns the user (ensuring `participated` is an object).
 */
export function toggleRSVP<T extends RSVPUser>(
    user: T,
    eventKey: string | number
): T {
    if (typeof user.participated !== 'object' || !user.participated) {
        user.participated = {};
    }
    const key = String(eventKey);
    user.participated[key] = !user.participated[key];
    return user;
}

/**
 * Build a participant list (for rendering an RSVP keyboard or web list).
 * The check-mark glyph is left to the UI layer; only the boolean state
 * and display name are produced here.
 */
export function buildRSVPList(
    users: RSVPUser[],
    eventKey: string | number
): RSVPEntry[] {
    return (users ?? []).map((user) => ({
        userId: user.id,
        name: rsvpDisplayName(user),
        attending: isAttending(user, eventKey),
    }));
}

/** Count attendees for the given event/message key. */
export function countAttendees(
    users: RSVPUser[],
    eventKey: string | number
): number {
    return (users ?? []).filter((u) => isAttending(u, eventKey)).length;
}
