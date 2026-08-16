// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import {
  buildScheduleFields,
  coversDay,
  dayIndexIn,
  isTimedValue,
  localDayNumber,
  questSchedule,
  scheduleToFields,
  shiftSchedule,
} from './schedule.js';

// Local wall-clock helper — every assertion here is about what the VIEWER
// sees, so the tests build local dates the same way the UIs do.
const local = (
  y: number,
  mo: number,
  d: number,
  h = 0,
  mi = 0,
): Date => new Date(y, mo - 1, d, h, mi);
/** The stored (UTC) instant for a local wall-clock time. */
const stored = (...a: Parameters<typeof local>): string =>
  local(...a).toISOString();

describe('questSchedule', () => {
  it('reads an undated quest as covering nothing', () => {
    const s = questSchedule({ when: '' });
    expect(s).toMatchObject({ start: null, end: null, days: 0, multiDay: false });
    expect(questSchedule(undefined).days).toBe(0);
  });

  it('reads a bare date as a single all-day day', () => {
    const s = questSchedule({ when: '2026-08-20' });
    expect(s.allDay).toBe(true);
    expect(s.days).toBe(1);
    expect(s.multiDay).toBe(false);
    expect(s.start).toEqual(local(2026, 8, 20));
    expect(s.end).toBeNull();
  });

  it('spans an all-day range INCLUSIVELY — 20th to 22nd is three days', () => {
    const s = questSchedule({ when: '2026-08-20', ends: '2026-08-22' });
    expect(s.allDay).toBe(true);
    expect(s.days).toBe(3);
    expect(s.multiDay).toBe(true);
    expect(s.end).toEqual(local(2026, 8, 22));
  });

  it('spans a timed range across days, and keeps a same-day one at one', () => {
    expect(
      questSchedule({
        when: stored(2026, 8, 20, 18, 0),
        ends: stored(2026, 8, 22, 12, 0),
      }),
    ).toMatchObject({ allDay: false, days: 3, multiDay: true });
    expect(
      questSchedule({
        when: stored(2026, 8, 20, 9, 0),
        ends: stored(2026, 8, 20, 17, 0),
      }).days,
    ).toBe(1);
  });

  it('keeps an event that finishes exactly at midnight on its own day', () => {
    // 21:00 → 00:00 covers one evening, not two calendar days.
    const s = questSchedule({
      when: stored(2026, 8, 20, 21, 0),
      ends: stored(2026, 8, 21, 0, 0),
    });
    expect(s.days).toBe(1);
    expect(s.multiDay).toBe(false);
  });

  it('ignores an end at or before the start rather than spanning backwards', () => {
    expect(
      questSchedule({ when: '2026-08-20', ends: '2026-08-18' }),
    ).toMatchObject({ end: null, days: 1 });
    expect(
      questSchedule({
        when: stored(2026, 8, 20, 9, 0),
        ends: stored(2026, 8, 20, 9, 0),
      }).end,
    ).toBeNull();
  });

  it('falls back to the legacy `until` when `ends` is absent', () => {
    expect(questSchedule({ when: '2026-08-20', until: '2026-08-21' }).days).toBe(
      2,
    );
  });
});

describe('coversDay / dayIndexIn', () => {
  const s = questSchedule({ when: '2026-08-20', ends: '2026-08-22' });

  it('covers every day of the span and nothing outside it', () => {
    expect(coversDay(s, local(2026, 8, 19))).toBe(false);
    expect(coversDay(s, local(2026, 8, 20))).toBe(true);
    expect(coversDay(s, local(2026, 8, 21, 23, 59))).toBe(true);
    expect(coversDay(s, local(2026, 8, 22))).toBe(true);
    expect(coversDay(s, local(2026, 8, 23))).toBe(false);
  });

  it('numbers the days of the span 1…n, 0 outside', () => {
    expect(dayIndexIn(s, local(2026, 8, 20))).toBe(1);
    expect(dayIndexIn(s, local(2026, 8, 22))).toBe(3);
    expect(dayIndexIn(s, local(2026, 8, 23))).toBe(0);
    expect(dayIndexIn(questSchedule({ when: '' }), local(2026, 8, 20))).toBe(0);
  });

  it('accepts a precomputed day ordinal (the calendar grid reuses one)', () => {
    expect(coversDay(s, localDayNumber(local(2026, 8, 21)))).toBe(true);
  });
});

describe('buildScheduleFields', () => {
  it('blanks everything when there is no start date', () => {
    expect(buildScheduleFields({ startDate: '' })).toEqual({
      when: '',
      ends: '',
      until: '',
    });
  });

  it('stores an all-day range as two bare dates, end inclusive', () => {
    expect(
      buildScheduleFields({ startDate: '2026-08-20', endDate: '2026-08-22' }),
    ).toEqual({ when: '2026-08-20', ends: '2026-08-22', until: '' });
  });

  it('drops the end of a single all-day day', () => {
    expect(
      buildScheduleFields({ startDate: '2026-08-20', endDate: '2026-08-20' }),
    ).toEqual({ when: '2026-08-20', ends: '', until: '' });
  });

  it('ignores a clock on an all-day span — dates only', () => {
    expect(
      buildScheduleFields({
        startDate: '2026-08-20',
        endDate: '2026-08-22',
        endTime: '17:00',
      }).ends,
    ).toBe('2026-08-22');
  });

  it('stores a timed range as UTC instants', () => {
    expect(
      buildScheduleFields({
        startDate: '2026-08-20',
        startTime: '09:00',
        endDate: '2026-08-20',
        endTime: '17:00',
      }),
    ).toEqual({
      when: stored(2026, 8, 20, 9, 0),
      ends: stored(2026, 8, 20, 17, 0),
      until: '',
    });
  });

  it('carries the start time over to a later end date left blank', () => {
    expect(
      buildScheduleFields({
        startDate: '2026-08-20',
        startTime: '09:00',
        endDate: '2026-08-22',
      }).ends,
    ).toBe(stored(2026, 8, 22, 9, 0));
  });

  it('defaults the end date to the start date', () => {
    expect(
      buildScheduleFields({
        startDate: '2026-08-20',
        startTime: '09:00',
        endTime: '10:30',
      }).ends,
    ).toBe(stored(2026, 8, 20, 10, 30));
  });

  it('refuses to store an end before the start', () => {
    expect(
      buildScheduleFields({
        startDate: '2026-08-20',
        startTime: '09:00',
        endDate: '2026-08-19',
        endTime: '09:00',
      }).ends,
    ).toBe('');
    expect(
      buildScheduleFields({ startDate: '2026-08-20', endDate: '2026-08-18' })
        .ends,
    ).toBe('');
  });

  it('round-trips through the form fields', () => {
    const fields = {
      startDate: '2026-08-20',
      startTime: '09:00',
      endDate: '2026-08-22',
      endTime: '17:30',
    };
    expect(scheduleToFields(buildScheduleFields(fields))).toEqual(fields);
    const allDay = {
      startDate: '2026-08-20',
      startTime: '',
      endDate: '2026-08-22',
      endTime: '',
    };
    expect(scheduleToFields(buildScheduleFields(allDay))).toEqual(allDay);
  });

  it('reports a single day back with no end fields to edit', () => {
    expect(scheduleToFields({ when: '2026-08-20' })).toEqual({
      startDate: '2026-08-20',
      startTime: '',
      endDate: '',
      endTime: '',
    });
    expect(scheduleToFields({ when: '' })).toEqual({
      startDate: '',
      startTime: '',
      endDate: '',
      endTime: '',
    });
  });
});

describe('shiftSchedule', () => {
  it('moves an all-day span and keeps it all-day, same length', () => {
    expect(
      shiftSchedule({ when: '2026-08-20', ends: '2026-08-22' }, '2026-09-01'),
    ).toEqual({ when: '2026-09-01', ends: '2026-09-03', until: '' });
  });

  it('moves a timed span by the same delta, still as instants', () => {
    expect(
      shiftSchedule(
        {
          when: stored(2026, 8, 20, 9, 0),
          ends: stored(2026, 8, 20, 17, 0),
        },
        stored(2026, 8, 21, 11, 0),
      ),
    ).toEqual({
      when: stored(2026, 8, 21, 11, 0),
      ends: stored(2026, 8, 21, 19, 0),
      until: '',
    });
  });

  it('keeps whole days when an all-day span is dropped on an hour slot', () => {
    // No clock to preserve on the way in — the three days survive, the end
    // lands at the new start time on the third day.
    expect(
      shiftSchedule(
        { when: '2026-08-20', ends: '2026-08-22' },
        stored(2026, 9, 1, 14, 0),
      ),
    ).toEqual({
      when: stored(2026, 9, 1, 14, 0),
      ends: stored(2026, 9, 3, 14, 0),
      until: '',
    });
  });

  it('drops the end of a same-day timed card made all-day', () => {
    expect(
      shiftSchedule(
        { when: stored(2026, 8, 20, 9, 0), ends: stored(2026, 8, 20, 17, 0) },
        '2026-08-25',
      ),
    ).toEqual({ when: '2026-08-25', ends: '', until: '' });
  });

  it('leaves an open-ended quest open-ended', () => {
    expect(shiftSchedule({ when: '2026-08-20' }, '2026-08-25')).toEqual({
      when: '2026-08-25',
      ends: '',
      until: '',
    });
  });
});

describe('isTimedValue', () => {
  it('separates bare dates from instants', () => {
    expect(isTimedValue('2026-08-20')).toBe(false);
    expect(isTimedValue('')).toBe(false);
    expect(isTimedValue(undefined)).toBe(false);
    expect(isTimedValue('2026-08-20T09:00:00.000Z')).toBe(true);
  });
});
