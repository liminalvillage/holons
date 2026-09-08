import { describe, it, expect } from 'vitest';
import {
    occurrenceSpan,
    parseICalText,
    filterEventsByDateRange,
    isValidICalUrl,
    normalizeICalUrl,
    toWebcalUrl,
    readImportedCalendars,
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
            { id: 'b', url: 'https://b.example/c.ics', name: 'B', enabled: false, color: '#123' },
        ]);
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
