// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import { advanceReminder, dueReminders, nextOccurrence } from './operations.js';
import type { Reminder } from './types.js';

describe('scheduler/operations', () => {
  it('nextOccurrence advances by cadence', () => {
    const base = new Date('2026-01-01T00:00:00.000Z');
    expect(nextOccurrence('hourly', base).toISOString()).toBe('2026-01-01T01:00:00.000Z');
    expect(nextOccurrence('daily', base).toISOString()).toBe('2026-01-02T00:00:00.000Z');
    expect(nextOccurrence('weekly', base).toISOString()).toBe('2026-01-08T00:00:00.000Z');
    expect(nextOccurrence('biweekly', base).toISOString()).toBe('2026-01-15T00:00:00.000Z');
    expect(nextOccurrence('monthly', base).toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(nextOccurrence('quarterly', base).toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(nextOccurrence('yearly', base).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('dueReminders returns only those at or before now', () => {
    const list: Reminder[] = [
      { id: 'a', holonId: 'H', text: 'past', fireAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', holonId: 'H', text: 'now', fireAt: '2026-01-02T00:00:00.000Z' },
      { id: 'c', holonId: 'H', text: 'future', fireAt: '2026-02-01T00:00:00.000Z' },
    ];
    const due = dueReminders(list, '2026-01-02T00:00:00.000Z');
    expect(due.map(r => r.id)).toEqual(['a', 'b']);
  });

  it('advanceReminder returns null for one-shot reminders', () => {
    const r: Reminder = { id: 'a', holonId: 'H', text: 'x', fireAt: '2026-01-01T00:00:00.000Z' };
    expect(advanceReminder(r, '2026-01-01T00:00:01.000Z')).toBeNull();
  });

  it('advanceReminder skips missed occurrences to the next future fire', () => {
    const r: Reminder = {
      id: 'a',
      holonId: 'H',
      text: 'daily',
      fireAt: '2026-01-01T00:00:00.000Z',
      frequency: 'daily',
    };
    // "now" is 3.5 days later — next daily fire should be Jan 5.
    const next = advanceReminder(r, '2026-01-04T12:00:00.000Z');
    expect(next?.fireAt).toBe('2026-01-05T00:00:00.000Z');
  });
});
