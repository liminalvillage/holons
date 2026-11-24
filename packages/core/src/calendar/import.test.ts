import { describe, it, expect } from 'vitest';
import {
    occurrenceSpan,
    parseICalText,
    filterEventsByDateRange,
    isValidICalUrl,
    normalizeICalUrl,
    toWebcalUrl,
    readImportedCalendars,
    importedCalendarColor,
    googleICalUrl,
    looksLikeICal,
    googleICalUrls,
    normalizeICalUrls,
    applyCalendarEdit,
    appendImportedCalendar,
} from './index.js';

/** Minimal well-formed feed builder — VEVENT bodies are passed in. */
const feed = (body: string, name = 'Team') =>
    ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', `X-WR-CALNAME:${name}`, body, 'END:VCALENDAR'].join(
        '\r\n'
    );

const timed = (uid: string, start: string, end: string, extra = '') =>
    ['BEGIN:VEVENT', `UID:${uid}`, 'SUMMARY:Standup', `DTSTART:${start}`, `DTEND:${end}`, extra, 'END:VEVENT']
        .filter(Boolean)
        .join('\r\n');

const WINDOW = { start: new Date(2026, 0, 1), end: new Date(2026, 11, 31, 23, 59, 59) };

describe('parseICalText', () => {
    it('reads a single timed event and the calendar name', () => {
        const parsed = parseICalText(
            feed(timed('e1', '20260507T090000Z', '20260507T093000Z')),
            'https://example.com/c.ics',
            undefined,
            WINDOW
        );
        expect(parsed.name).toBe('Team');
        expect(parsed.events).toHaveLength(1);
        const [e] = parsed.events;
        expect(e.id).toBe('e1');
        expect(e.title).toBe('Standup');
        expect(e.allDay).toBe(false);
        expect(e.calendarUrl).toBe('https://example.com/c.ics');
        expect(e.start.toISOString()).toBe('2026-05-07T09:00:00.000Z');
    });

    it('an explicit name overrides the feed X-WR-CALNAME', () => {
        const parsed = parseICalText(
            feed(timed('e1', '20260507T090000Z', '20260507T093000Z')),
            'https://example.com/c.ics',
            'Our name',
            WINDOW
        );
        expect(parsed.name).toBe('Our name');
    });

    it('keeps an all-day entry on its local day (no UTC-midnight drift)', () => {
        const body = ['BEGIN:VEVENT', 'UID:allday', 'SUMMARY:Holiday', 'DTSTART;VALUE=DATE:20260101', 'DTEND;VALUE=DATE:20260102', 'END:VEVENT'].join('\r\n');
        const [e] = parseICalText(feed(body), 'u', undefined, WINDOW).events;
        expect(e.allDay).toBe(true);
        expect(e.start.getFullYear()).toBe(2026);
        expect(e.start.getMonth()).toBe(0);
        expect(e.start.getDate()).toBe(1);
    });

    it('expands a recurring series across the window only', () => {
        const body = timed('weekly', '20260105T090000Z', '20260105T093000Z', 'RRULE:FREQ=WEEKLY;COUNT=200');
        const parsed = parseICalText(feed(body), 'u', undefined, {
            start: new Date(2026, 0, 1),
            end: new Date(2026, 1, 1),
        });
        // Jan 5/12/19/26 — the rest of the series is outside the window.
        expect(parsed.events).toHaveLength(4);
        expect(parsed.events.every((e) => e.recurrence?.includes('WEEKLY'))).toBe(true);
        // Each occurrence gets its own id, so view keys stay unique.
        expect(new Set(parsed.events.map((e) => e.id)).size).toBe(4);
    });

    it('drops events wholly outside the window', () => {
        const parsed = parseICalText(
            feed(timed('old', '20200507T090000Z', '20200507T093000Z')),
            'u',
            undefined,
            WINDOW
        );
        expect(parsed.events).toEqual([]);
    });

    it('skips an unparseable entry instead of failing the feed', () => {
        const good = timed('good', '20260507T090000Z', '20260507T093000Z');
        const broken = ['BEGIN:VEVENT', 'UID:broken', 'SUMMARY:No dates at all', 'END:VEVENT'].join('\r\n');
        const parsed = parseICalText(feed(`${broken}\r\n${good}`), 'u', undefined, WINDOW);
        expect(parsed.events.map((e) => e.id)).toEqual(['good']);
    });
});

describe('filterEventsByDateRange', () => {
    const ev = (start: string, end: string) =>
        ({ id: start, title: 't', start: new Date(start), end: new Date(end), allDay: false, calendarUrl: 'u' }) as const;

    it('keeps events that overlap the range, including at its edges', () => {
        const events = [
            ev('2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z'),
            ev('2026-04-01T10:00:00Z', '2026-04-01T11:00:00Z'),
            ev('2026-04-30T23:00:00Z', '2026-05-01T01:00:00Z'),
        ];
        const kept = filterEventsByDateRange(
            events as never,
            new Date('2026-05-01T00:00:00Z'),
            new Date('2026-05-31T23:59:59Z')
        );
        expect(kept.map((e) => e.id)).toEqual(['2026-05-01T10:00:00Z', '2026-04-30T23:00:00Z']);
    });
});

describe('feed URLs', () => {
    it('accepts http, https and webcal, rejects anything else', () => {
        expect(isValidICalUrl('https://example.com/c.ics')).toBe(true);
        expect(isValidICalUrl('http://example.com/c.ics')).toBe(true);
        expect(isValidICalUrl('webcal://example.com/c.ics')).toBe(true);
        expect(isValidICalUrl('ftp://example.com/c.ics')).toBe(false);
        expect(isValidICalUrl('javascript:alert(1)')).toBe(false);
        expect(isValidICalUrl('not a url')).toBe(false);
    });

    it('fetches webcal over https and subscribes over webcal', () => {
        expect(normalizeICalUrl(' webcal://example.com/c.ics ')).toBe('https://example.com/c.ics');
        expect(normalizeICalUrl('https://example.com/c.ics')).toBe('https://example.com/c.ics');
        expect(toWebcalUrl('https://example.com/c.ics')).toBe('webcal://example.com/c.ics');
        expect(toWebcalUrl('http://example.com/c.ics')).toBe('webcal://example.com/c.ics');
    });
});

describe('Google Calendar links', () => {
    const ical = (id: string) =>
        `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`;

    it('turns a share link with a base64 cid into the public iCal address', () => {
        // btoa('team@group.calendar.google.com'), padding stripped as Google does.
        const cid = btoa('team@group.calendar.google.com').replace(/=+$/, '');
        const share = `https://calendar.google.com/calendar/u/0?cid=${cid}`;
        expect(googleICalUrl(share)).toBe(ical('team@group.calendar.google.com'));
        expect(normalizeICalUrl(share)).toBe(ical('team@group.calendar.google.com'));
        expect(normalizeICalUrl(`https://calendar.google.com/calendar/r?cid=${cid}`)).toBe(
            ical('team@group.calendar.google.com')
        );
    });

    it('accepts a raw id in cid and an embed src', () => {
        expect(normalizeICalUrl('https://calendar.google.com/calendar/u/0?cid=someone%40gmail.com')).toBe(
            ical('someone@gmail.com')
        );
        expect(
            normalizeICalUrl(
                'https://calendar.google.com/calendar/embed?src=en.italian%23holiday%40group.v.calendar.google.com&ctz=Europe%2FRome'
            )
        ).toBe(
            'https://calendar.google.com/calendar/ical/en.italian%23holiday%40group.v.calendar.google.com/public/basic.ics'
        );
    });

    it('follows a cid that is itself a feed URL', () => {
        expect(
            normalizeICalUrl('https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fexample.com%2Fc.ics')
        ).toBe('https://example.com/c.ics');
    });

    it('leaves real feed addresses and other hosts alone', () => {
        const secret =
            'https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc123/basic.ics';
        expect(googleICalUrl(secret)).toBeNull();
        expect(normalizeICalUrl(secret)).toBe(secret);
        expect(normalizeICalUrl('webcal://calendar.google.com/calendar/ical/x%40gmail.com/public/basic.ics')).toBe(
            'https://calendar.google.com/calendar/ical/x%40gmail.com/public/basic.ics'
        );
        expect(googleICalUrl('https://example.com/calendar?cid=abc%40x.com')).toBeNull();
        expect(googleICalUrl('https://calendar.google.com/calendar/u/0')).toBeNull();
        // A cid that is neither an id nor base64 of one is left for the user to fix.
        expect(googleICalUrl('https://calendar.google.com/calendar/u/0?cid=!!!')).toBeNull();
        expect(googleICalUrl('not a url')).toBeNull();
    });
});

describe('googleICalUrls', () => {
    const ical = (id: string) =>
        `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`;

    it('returns one feed per calendar an embed link shows', () => {
        const embed =
            'https://calendar.google.com/calendar/embed?src=team%40group.calendar.google.com' +
            '&src=en.italian%23holiday%40group.v.calendar.google.com&src=team%40group.calendar.google.com&ctz=Europe%2FRome';
        const both = [ical('team@group.calendar.google.com'), ical('en.italian#holiday@group.v.calendar.google.com')];
        expect(googleICalUrls(embed)).toEqual(both);
        expect(normalizeICalUrls(embed)).toEqual(both);
        // The single-feed form keeps answering with the first.
        expect(googleICalUrl(embed)).toBe(both[0]);
    });

    it('skips unreadable ids and leaves non-Google links to normalizeICalUrl', () => {
        expect(googleICalUrls('https://calendar.google.com/calendar/embed?src=!!!&src=me%40gmail.com')).toEqual([
            ical('me@gmail.com'),
        ]);
        expect(googleICalUrls('https://example.com/c.ics')).toEqual([]);
        expect(normalizeICalUrls('webcal://example.com/c.ics')).toEqual(['https://example.com/c.ics']);
    });
});

describe('looksLikeICal', () => {
    it('tells a feed from an HTML page', () => {
        expect(looksLikeICal(feed(''))).toBe(true);
        expect(looksLikeICal('﻿  BEGIN:VCALENDAR\r\nEND:VCALENDAR')).toBe(true);
        expect(looksLikeICal('<!doctype html><html>…</html>')).toBe(false);
        expect(looksLikeICal('')).toBe(false);
    });
});

describe('imported-calendar list edits', () => {
    const a = { id: 'a', url: 'https://x.com/a.ics', name: 'A', enabled: true };
    const b = { id: 'b', url: 'https://x.com/b.ics', name: 'B', enabled: false };

    it('applies one edit to the fresh list — a feed removed elsewhere stays removed', () => {
        // Device 1 held [a, b]; device 2 removed b. Device 1 now toggles a:
        // the edit lands on the FRESH persisted list, b does not come back.
        const fresh = [a];
        expect(applyCalendarEdit(fresh, { type: 'toggle', id: 'a' })).toEqual([{ ...a, enabled: false }]);
        // Toggling the feed removed elsewhere is a no-op, not a resurrection.
        expect(applyCalendarEdit(fresh, { type: 'toggle', id: 'b' })).toEqual([a]);
        expect(applyCalendarEdit(fresh, { type: 'recolor', id: 'b', color: '#112233' })).toEqual([a]);
    });

    it('adds, removes, toggles and recolours by id', () => {
        expect(applyCalendarEdit([a], { type: 'add', entry: b })).toEqual([a, b]);
        // The same feed under another id is not doubled.
        expect(applyCalendarEdit([a], { type: 'add', entry: { ...b, url: 'webcal://x.com/a.ics' } })).toEqual([a]);
        expect(applyCalendarEdit([a, b], { type: 'remove', id: 'a' })).toEqual([b]);
        expect(applyCalendarEdit([b], { type: 'toggle', id: 'b' })).toEqual([{ ...b, enabled: true }]);
        const red = applyCalendarEdit([a], { type: 'recolor', id: 'a', color: '#FF0000' });
        expect(red[0].color).toBe('#ff0000');
        expect(applyCalendarEdit(red, { type: 'recolor', id: 'a', color: '' })).toEqual([a]);
        expect(applyCalendarEdit([a], { type: 'recolor', id: 'a', color: 'red; x' })).toEqual([a]);
        // Several edits apply in order; the input is never mutated.
        const input = [a];
        expect(
            applyCalendarEdit(input, [
                { type: 'add', entry: b },
                { type: 'remove', id: 'a' },
            ])
        ).toEqual([b]);
        expect(input).toEqual([a]);
    });

    it('append adds a new feed and refuses a duplicate', () => {
        expect(appendImportedCalendar([a], b)).toEqual([a, b]);
        expect(appendImportedCalendar([a], { ...b, url: 'webcal://x.com/a.ics' })).toEqual([a]);
    });
});

describe('readImportedCalendars', () => {
    it('returns [] for anything that is not a calendar record', () => {
        expect(readImportedCalendars(null)).toEqual([]);
        expect(readImportedCalendars({})).toEqual([]);
        expect(readImportedCalendars({ calendars: 'nope' })).toEqual([]);
    });

    it('fills in ids and names, treats a missing `enabled` as on, drops url-less rows', () => {
        expect(
            readImportedCalendars({
                calendars: [
                    { url: 'https://a.example/c.ics' },
                    { id: 'b', url: 'https://b.example/c.ics', name: 'B', enabled: false, color: '#123' },
                    { name: 'no url' },
                    null,
                ],
            })
        ).toEqual([
            { id: 'cal_0', url: 'https://a.example/c.ics', name: 'Imported Calendar', enabled: true },
            { id: 'b', url: 'https://b.example/c.ics', name: 'B', enabled: false, color: '#112233' },
        ]);
    });

    it('keeps only a plain hex colour, normalised', () => {
        const [plain, junk, none] = readImportedCalendars({
            calendars: [
                { id: 'a', url: 'https://a.example/c.ics', color: ' #ABCDEF ' },
                { id: 'b', url: 'https://b.example/c.ics', color: 'red; background: url(x)' },
                { id: 'c', url: 'https://c.example/c.ics' },
            ],
        });
        expect(plain.color).toBe('#abcdef');
        expect(junk.color).toBeUndefined();
        expect(none.color).toBeUndefined();
    });
});

describe('importedCalendarColor', () => {
    const palette = ['sun', 'mint', 'sky'];

    it('is the chosen colour when one is set', () => {
        expect(importedCalendarColor({ id: 'cal_1', color: '#ffe79a' }, palette)).toBe('#ffe79a');
        expect(importedCalendarColor({ id: 'cal_1', color: 'FFE79A' }, palette)).toBe('#ffe79a');
    });

    it('falls back to a stable palette entry hashed from the id', () => {
        const a = importedCalendarColor({ id: 'cal_1' }, palette);
        expect(palette).toContain(a);
        expect(importedCalendarColor({ id: 'cal_1' }, palette)).toBe(a);
        expect(importedCalendarColor({ id: 'cal_1', color: 'not a colour' }, palette)).toBe(a);
    });
});

describe('occurrenceSpan', () => {
    it('draws a one-day all-day entry on its single day (DTEND is exclusive)', () => {
        const span = occurrenceSpan({
            start: new Date(2026, 0, 1),
            end: new Date(2026, 0, 2),
            allDay: true,
        });
        expect(span.days).toBe(1);
        expect(span.multiDay).toBe(false);
        expect(span.end.getDate()).toBe(1);
    });

    it('counts an all-day range inclusively', () => {
        const span = occurrenceSpan({
            start: new Date(2026, 0, 1),
            end: new Date(2026, 0, 4),
            allDay: true,
        });
        expect(span.days).toBe(3);
        expect(span.multiDay).toBe(true);
    });

    it('tolerates a feed that ends an all-day entry where it starts', () => {
        const span = occurrenceSpan({
            start: new Date(2026, 0, 1),
            end: new Date(2026, 0, 1),
            allDay: true,
        });
        expect(span.days).toBe(1);
        expect(span.end.getDate()).toBe(1);
    });

    it('keeps a timed event\'s real end, spanning midnight when it does', () => {
        const span = occurrenceSpan({
            start: new Date(2026, 0, 1, 22, 0),
            end: new Date(2026, 0, 2, 1, 0),
            allDay: false,
        });
        expect(span.end.getHours()).toBe(1);
        expect(span.days).toBe(2);
        expect(span.multiDay).toBe(true);
    });
});
