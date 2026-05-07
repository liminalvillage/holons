import { describe, it, expect } from 'vitest';
import {
    generateICalFeed,
    generateICal,
    toICalendar,
    mapStatusToICalStatus,
    toggleRSVP,
    isAttending,
    buildRSVPList,
    countAttendees,
    rsvpDisplayName,
} from './index.js';

describe('iCal generation', () => {
    it('emits a VCALENDAR with a VEVENT for a basic event', () => {
        const ical = generateICalFeed(
            [
                {
                    id: 'evt1',
                    title: 'Standup',
                    when: '2026-05-07T09:00:00Z',
                    ends: '2026-05-07T09:30:00Z',
                },
            ],
            'My Holon',
            'holon-123'
        );
        expect(ical).toContain('BEGIN:VCALENDAR');
        expect(ical).toContain('END:VCALENDAR');
        expect(ical).toContain('BEGIN:VEVENT');
        expect(ical).toContain('SUMMARY:Standup');
        expect(ical).toContain('UID:evt1@holon-123.harvest.app');
    });

    it('skips events without `when`', () => {
        const ical = generateICalFeed(
            [{ id: 'no-date', title: 'Floating', when: '' }],
            'H',
            'h1'
        );
        expect(ical).not.toContain('BEGIN:VEVENT');
    });

    it('exposes generateICal and toICalendar aliases', () => {
        expect(generateICal).toBe(generateICalFeed);
        expect(toICalendar).toBe(generateICalFeed);
    });

    it('maps statuses to iCal STATUS values', () => {
        expect(mapStatusToICalStatus('cancelled')).toBe('CANCELLED');
        expect(mapStatusToICalStatus('TENTATIVE')).toBe('TENTATIVE');
        expect(mapStatusToICalStatus('completed')).toBe('CONFIRMED');
        expect(mapStatusToICalStatus('whatever')).toBe('CONFIRMED');
    });
});

describe('RSVP', () => {
    it('toggles attendance per event/message key', () => {
        const user = { id: 'u1', first_name: 'Ada' };
        toggleRSVP(user, 'msg-42');
        expect(isAttending(user, 'msg-42')).toBe(true);
        toggleRSVP(user, 'msg-42');
        expect(isAttending(user, 'msg-42')).toBe(false);
    });

    it('builds a participant list with display names', () => {
        const users = [
            { id: 'u1', first_name: 'Ada', participated: { 'm1': true } },
            { id: 'u2', username: 'bob', participated: {} },
        ];
        const list = buildRSVPList(users, 'm1');
        expect(list).toEqual([
            { userId: 'u1', name: 'Ada', attending: true },
            { userId: 'u2', name: 'bob', attending: false },
        ]);
        expect(countAttendees(users, 'm1')).toBe(1);
    });

    it('falls back through display name fields', () => {
        expect(rsvpDisplayName({ id: 'x', first_name: 'A', second_name: 'B' })).toBe('A B');
        expect(rsvpDisplayName({ id: 'x', username: 'bob' })).toBe('bob');
        expect(rsvpDisplayName({ id: '42' })).toBe('42');
    });
});
