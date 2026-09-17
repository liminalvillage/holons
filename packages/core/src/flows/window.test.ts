// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  formatLocalDate,
  parseLocalDate,
  resolveWindow,
  windowFromChoice,
  windowSpanDays,
} from './window.js';
import { lunationAt } from './lunation.js';

// Wednesday 2026-09-16 15:30 local — mid-week, mid-month, mid-year.
const NOW = new Date(2026, 8, 16, 15, 30).getTime();
const local = (y: number, m: number, d: number, h = 0, min = 0, s = 0, ms = 0) =>
  new Date(y, m - 1, d, h, min, s, ms).getTime();

describe('resolveWindow', () => {
  it('turns windowDays into now-minus-days, and null into all time', () => {
    expect(resolveWindow({ now: NOW, windowDays: 30 }, 90)).toEqual({ from: NOW - 30 * DAY_MS, to: NOW });
    expect(resolveWindow({ now: NOW, windowDays: null }, 90)).toEqual({ from: 0, to: NOW });
    expect(resolveWindow({ now: NOW }, 90)).toEqual({ from: NOW - 90 * DAY_MS, to: NOW });
  });

  it('lets an explicit window win over windowDays, open ends included', () => {
    expect(resolveWindow({ now: NOW, windowDays: 30, window: { from: 5, to: 9 } }, 90)).toEqual({ from: 5, to: 9 });
    expect(resolveWindow({ now: NOW, window: { from: 5 } }, 90)).toEqual({ from: 5, to: NOW });
    expect(resolveWindow({ now: NOW, window: { to: 9 } }, 90)).toEqual({ from: 0, to: 9 });
    expect(resolveWindow({ now: NOW, window: {} }, 90)).toEqual({ from: 0, to: NOW });
  });

  it('never returns a window that ends before it starts', () => {
    expect(resolveWindow({ now: NOW, window: { from: 9, to: 5 } }, 90)).toEqual({ from: 9, to: 9 });
  });
});

describe('windowFromChoice', () => {
  it('starts the week on Monday and the month and year on their first day', () => {
    expect(windowFromChoice({ preset: 'week' }, NOW)).toEqual({ from: local(2026, 9, 14), to: null });
    expect(windowFromChoice({ preset: 'month' }, NOW)).toEqual({ from: local(2026, 9, 1), to: null });
    expect(windowFromChoice({ preset: 'year' }, NOW)).toEqual({ from: local(2026, 1, 1), to: null });
  });

  it('treats a Sunday as the end of the week, not the start', () => {
    const sunday = local(2026, 9, 20, 10);
    expect(windowFromChoice({ preset: 'week' }, sunday).from).toBe(local(2026, 9, 14));
  });

  it('opens the lunation preset on the new moon that began the current cycle', () => {
    const window = windowFromChoice({ preset: 'lunation' }, NOW);
    expect(window).toEqual({ from: lunationAt(NOW).from, to: null });
    // The cycle we are standing in, not the one about to begin.
    expect(window.from!).toBeLessThanOrEqual(NOW);
    expect(NOW - window.from!).toBeLessThan(30 * DAY_MS);
  });

  it('counts the day presets back from now and leaves all time open', () => {
    expect(windowFromChoice({ preset: '30' }, NOW)).toEqual({ from: NOW - 30 * DAY_MS, to: null });
    expect(windowFromChoice({ preset: '90' }, NOW)).toEqual({ from: NOW - 90 * DAY_MS, to: null });
    expect(windowFromChoice({ preset: 'all' }, NOW)).toEqual({ from: null, to: null });
  });

  it('reads custom bounds as whole local days, either end optional', () => {
    expect(windowFromChoice({ preset: 'custom', from: '2026-06-01', to: '2026-06-30' }, NOW)).toEqual({
      from: local(2026, 6, 1),
      to: local(2026, 6, 30, 23, 59, 59, 999),
    });
    expect(windowFromChoice({ preset: 'custom', from: '2026-06-01' }, NOW)).toEqual({
      from: local(2026, 6, 1),
      to: null,
    });
    expect(windowFromChoice({ preset: 'custom', to: '2026-06-30' }, NOW)).toEqual({
      from: null,
      to: local(2026, 6, 30, 23, 59, 59, 999),
    });
  });

  it('ignores bounds it cannot read and an unknown preset falls back to 90 days', () => {
    expect(windowFromChoice({ preset: 'custom', from: 'soon', to: '' }, NOW)).toEqual({ from: null, to: null });
    expect(windowFromChoice({ preset: 'yesterday' as never }, NOW)).toEqual({ from: NOW - 90 * DAY_MS, to: null });
  });
});

describe('local dates', () => {
  it('round-trips a calendar date', () => {
    expect(formatLocalDate(local(2026, 3, 7, 18))).toBe('2026-03-07');
    expect(parseLocalDate('2026-03-07')).toBe(local(2026, 3, 7));
    expect(parseLocalDate('2026-3-7')).toBeNull();
    expect(parseLocalDate('2026-02-30')).toBeNull();
  });

  it('measures a window in whole days, counting both ends', () => {
    expect(windowSpanDays({ from: local(2026, 6, 1), to: local(2026, 6, 30, 23, 59, 59, 999) }, NOW)).toBe(30);
    expect(windowSpanDays({ from: NOW - 30 * DAY_MS, to: null }, NOW)).toBe(30);
    expect(windowSpanDays({ from: null, to: null }, NOW)).toBeNull();
  });
});
