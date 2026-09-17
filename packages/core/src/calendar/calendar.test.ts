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
        expect(ical).toContain('UID:evt1@holon-123.holons.io');
    });

    it('skips events without `when`', () => {
        const ical = generateICalFeed(
            [{ id: 'no-date', title: 'Floating', when: '' }],
            'H',
            'h1'
        );
        expect(ical).not.toContain('BEGIN:VEVENT');
    });

    it('skips entries whose `when` does not parse instead of emitting an invalid DTSTART', () => {
        const ical = generateICalFeed(
            [
                // `{}` is what an old migration left on unscheduled bot quests;
                // `null` is the web board's "unscheduled" write.
                { id: 'obj', title: 'Object', when: {} as unknown as string },
                { id: 'nul', title: 'Null', when: null as unknown as string },
                { id: 'txt', title: 'Text', when: 'next thursday' },
                { id: 'ok', title: 'Real', when: '2026-09-10T16:30:00.000Z' },
            ],
            'H',
            'h1'
        );
        expect(ical).not.toMatch(/NaN/);
        expect(ical.match(/BEGIN:VEVENT/g)).toHaveLength(1);
        expect(ical).toContain('UID:ok@h1.holons.io');
        expect(ical).toContain('DTSTART:20260910T163000Z');
    });

    it('emits a bare-date `when` as an all-day DATE with an exclusive end', () => {
        const ical = generateICalFeed(
            [
                { id: 'day', title: 'Market', when: '2026-09-20' },
                { id: 'span', title: 'Retreat', when: '2026-09-21', ends: '2026-09-23' },
            ],
            'H',
            'h1'
        );
        expect(ical).toContain('DTSTART;VALUE=DATE:20260920');
        expect(ical).toContain('DTEND;VALUE=DATE:20260921');
        expect(ical).toContain('DTSTART;VALUE=DATE:20260921');
        expect(ical).toContain('DTEND;VALUE=DATE:20260924');
    });

    it('defaults a timed entry with no (or an inverted) end to one hour', () => {
        const ical = generateICalFeed(
            [
                { id: 'a', title: 'A', when: '2026-09-10T16:30:00.000Z' },
                { id: 'b', title: 'B', when: '2026-09-10T16:30:00.000Z', ends: '2026-09-10T10:00:00.000Z' },
            ],
            'H',
            'h1'
        );
        expect(ical.match(/DTEND:20260910T173000Z/g)).toHaveLength(2);
    });

    it('names a Telegram-shaped participant (numeric id, `first_name`) instead of throwing', () => {
        const ical = generateICalFeed(
            [
                {
                    id: 23,
                    title: 'Dinner',
                    when: '2026-09-10T16:30:00.000Z',
                    participants: [{ id: 235114395, first_name: 'Roberto' }, { id: 42 }],
                } as any,
            ],
            'H',
            'h1'
        ).replace(/\r?\n /g, '');
        expect(ical).toContain('UID:23@h1.holons.io');
        expect(ical).toContain('CN=Roberto');
        expect(ical).toContain('CN=42');
        expect(ical).toContain('mailto:235114395@holons.io');
    });

    it('keeps the feed valid when an entry carries non-text fields', () => {
        const ical = generateICalFeed(
            [
                { id: 'bad', title: { text: 'oops' }, when: '2026-09-10T16:30:00.000Z', category: 7 } as any,
                { id: 'good', title: 'Good', when: '2026-09-11T16:30:00.000Z' },
            ],
            'H',
            'h1'
        );
        expect(ical).toContain('SUMMARY:Untitled Event');
        expect(ical).toContain('CATEGORIES:7');
        expect(ical).toContain('SUMMARY:Good');
        expect(ical).toContain('END:VCALENDAR');
    });

    it('asks subscribers to re-read the feed hourly', () => {
        const ical = generateICalFeed([], 'H', 'h1');
        expect(ical).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT1H');
        expect(ical).toContain('X-PUBLISHED-TTL:PT1H');
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
