// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import {
  QUEST_FREQUENCIES,
  advanceOccurrence,
  isOccurrenceCompleted,
  isRecurring,
  moveOccurrence,
  nextOpenOccurrence,
  occurrenceWhen,
  questFrequency,
  questOccurrences,
  setQuestFrequency,
  toggleOccurrenceCompleted,
} from './recurrence.js';

// Local wall-clock helpers — a board always has a viewer, and every assertion
// here is about what that viewer sees.
const local = (y: number, mo: number, d: number, h = 0, mi = 0): Date =>
  new Date(y, mo - 1, d, h, mi);
const stored = (...a: Parameters<typeof local>): string =>
  local(...a).toISOString();
const window = { start: local(2026, 9, 1), end: local(2026, 10, 31, 23, 59) };

describe('questFrequency / isRecurring', () => {
  it('reads the vocabulary, tolerating case and padding', () => {
    expect(questFrequency({ frequency: 'weekly' })).toBe('weekly');
    expect(questFrequency({ frequency: ' Monthly ' })).toBe('monthly');
    for (const f of QUEST_FREQUENCIES) expect(questFrequency({ frequency: f })).toBe(f);
  });

  it('rejects anything outside it rather than guessing', () => {
    expect(questFrequency({ frequency: 'fortnightly' })).toBeNull();
    expect(questFrequency({ frequency: null })).toBeNull();
    expect(questFrequency({})).toBeNull();
    expect(questFrequency(undefined)).toBeNull();
  });

  it('needs both a cadence and a start to repeat', () => {
    expect(isRecurring({ frequency: 'daily', when: '2026-09-01' })).toBe(true);
    expect(isRecurring({ frequency: 'daily', when: '' })).toBe(false);
    expect(isRecurring({ when: '2026-09-01' })).toBe(false);
  });
});

describe('advanceOccurrence', () => {
  it('steps by the cadence in local time', () => {
    const from = local(2026, 1, 31, 10, 0);
    expect(advanceOccurrence(from, 'daily')).toEqual(local(2026, 2, 1, 10, 0));
    expect(advanceOccurrence(from, 'weekly')).toEqual(local(2026, 2, 7, 10, 0));
    expect(advanceOccurrence(from, 'biweekly')).toEqual(local(2026, 2, 14, 10, 0));
    expect(advanceOccurrence(from, 'quarterly')).toEqual(local(2026, 5, 1, 10, 0));
    expect(advanceOccurrence(from, 'sixmonths')).toEqual(local(2026, 7, 31, 10, 0));
    expect(advanceOccurrence(from, 'yearly')).toEqual(local(2027, 1, 31, 10, 0));
  });

  it('keeps the wall clock across a DST change', () => {
    // Late March: most European zones spring forward in between. Whatever the
    // test host's zone, the local hour must not drift.
    const from = local(2026, 3, 25, 10, 0);
    const next = advanceOccurrence(from, 'weekly');
    expect([next.getHours(), next.getMinutes()]).toEqual([10, 0]);
    expect(next.getDate()).toBe(1);
    expect(next.getMonth()).toBe(3);
  });
});

describe('occurrenceWhen', () => {
  it('spells the occurrence in the series\' own form', () => {
    expect(occurrenceWhen({ when: '2026-09-01' }, local(2026, 9, 8))).toBe('2026-09-08');
    expect(occurrenceWhen({ when: stored(2026, 9, 1, 9) }, local(2026, 9, 8, 9))).toBe(
      stored(2026, 9, 8, 9),
    );
  });
});

describe('questOccurrences', () => {
  it('yields nothing for a one-off or an undated series', () => {
    expect(questOccurrences({ when: '2026-09-01' }, window)).toEqual([]);
    expect(questOccurrences({ frequency: 'weekly' }, window)).toEqual([]);
  });

  it('expands a weekly all-day series across the window as bare dates', () => {
    const occ = questOccurrences({ when: '2026-09-01', frequency: 'weekly' }, window);
    expect(occ.map((o) => o.when)).toEqual([
      '2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29',
      '2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27',
    ]);
    expect(occ[1].start).toEqual(local(2026, 9, 8));
    expect(occ[1].schedule).toEqual({ when: '2026-09-08', ends: '', until: '' });
  });

  it('expands a timed series as instants and carries the duration', () => {
    const occ = questOccurrences(
      { when: stored(2026, 9, 1, 9), ends: stored(2026, 9, 1, 10, 30), frequency: 'weekly' },
      { start: local(2026, 9, 7), end: local(2026, 9, 20) },
    );
    expect(occ.map((o) => o.when)).toEqual([stored(2026, 9, 8, 9), stored(2026, 9, 15, 9)]);
    expect(occ[0].schedule.ends).toBe(stored(2026, 9, 8, 10, 30));
  });

  it('carries a multi-day span and emits an occurrence that only overlaps the window', () => {
    const occ = questOccurrences(
      { when: '2026-08-30', ends: '2026-09-01', frequency: 'monthly' },
      window,
    );
    // The Aug 30 – Sep 1 span touches the window even though it starts before it.
    expect(occ.map((o) => o.when)).toEqual(['2026-08-30', '2026-09-30', '2026-10-30']);
    expect(occ[1].schedule).toEqual({ when: '2026-09-30', ends: '2026-10-02', until: '' });
  });

  it('skips a series starting after the window, and stops at the limit', () => {
    expect(questOccurrences({ when: '2027-01-01', frequency: 'daily' }, window)).toEqual([]);
    const capped = questOccurrences(
      { when: '2026-09-01', frequency: 'daily' },
      { start: local(2020, 1, 1), end: local(2030, 1, 1) },
      10,
    );
    expect(capped).toHaveLength(10);
  });

  it('flags the ticked-off occurrences, reading the dashboard\'s spelling too', () => {
    const occ = questOccurrences(
      {
        when: '2026-09-01',
        frequency: 'weekly',
        completedOccurrences: ['2026-09-08', '2026-09-15T00:00:00.000Z'],
      },
      window,
    );
    expect(occ.filter((o) => o.completed).map((o) => o.when)).toEqual([
      '2026-09-08',
      '2026-09-15',
    ]);
  });
});

describe('nextOpenOccurrence', () => {
  const series = {
    when: '2026-09-01',
    frequency: 'weekly',
    completedOccurrences: ['2026-09-15'],
  };

  it('is the first occurrence on or after today that is not ticked off', () => {
    expect(nextOpenOccurrence(series, local(2026, 9, 10, 18))?.when).toBe('2026-09-22');
    // Today itself still counts — a due-today task is due today.
    expect(nextOpenOccurrence(series, local(2026, 9, 8, 23))?.when).toBe('2026-09-08');
  });

  it('is the series start when that is still ahead, and null for a one-off', () => {
    expect(nextOpenOccurrence(series, local(2026, 8, 1))?.when).toBe('2026-09-01');
    expect(nextOpenOccurrence({ when: '2026-09-01' }, local(2026, 8, 1))).toBeNull();
  });
});

describe('isOccurrenceCompleted / toggleOccurrenceCompleted', () => {
  it('ticks an occurrence on and off, clearing both spellings on the way off', () => {
    const q = { when: '2026-09-01', frequency: 'weekly' };
    const on = toggleOccurrenceCompleted(q, '2026-09-08');
    expect(on).toEqual(['2026-09-08']);
    expect(isOccurrenceCompleted({ ...q, completedOccurrences: on }, '2026-09-08')).toBe(true);
    const off = toggleOccurrenceCompleted(
      { ...q, completedOccurrences: ['2026-09-08', '2026-09-08T00:00:00.000Z', 'x'] },
      '2026-09-08',
    );
    expect(off).toEqual(['x']);
  });

  it('keeps a timed occurrence by its instant', () => {
    const when = stored(2026, 9, 8, 9);
    const q = { when: stored(2026, 9, 1, 9), frequency: 'weekly', completedOccurrences: ['a'] };
    expect(toggleOccurrenceCompleted(q, when)).toEqual(['a', when]);
  });

  it('ignores a malformed list', () => {
    expect(isOccurrenceCompleted({ completedOccurrences: 'nope' }, '2026-09-08')).toBe(false);
    expect(toggleOccurrenceCompleted({ completedOccurrences: [3, null] }, '2026-09-08')).toEqual([
      '2026-09-08',
    ]);
  });
});

describe('setQuestFrequency', () => {
  it('sets a cadence without touching the scheduler handle', () => {
    expect(setQuestFrequency({ recurringTaskId: 'r1' }, 'weekly')).toEqual({ frequency: 'weekly' });
  });

  it('clearing the cadence also drops the scheduler handle, only when there was one', () => {
    expect(setQuestFrequency({ recurringTaskId: 'r1' }, null)).toEqual({
      frequency: null,
      recurringTaskId: null,
    });
    expect(setQuestFrequency({}, null)).toEqual({ frequency: null });
  });
});

describe('moveOccurrence', () => {
  it('shifts an all-day series by whole days so the occurrence lands on the target', () => {
    const q = { when: '2026-09-01', ends: '2026-09-02', frequency: 'weekly' };
    // Drag the Sep 15 occurrence to Sep 17: the series starts on Sep 3 now.
    expect(moveOccurrence(q, '2026-09-15', '2026-09-17')).toEqual({
      when: '2026-09-03',
      ends: '2026-09-04',
      until: '',
    });
  });

  it('shifts a timed series by the exact interval, carrying the end', () => {
    const q = {
      when: stored(2026, 9, 1, 9),
      ends: stored(2026, 9, 1, 10),
      frequency: 'weekly',
    };
    const moved = moveOccurrence(q, stored(2026, 9, 15, 9), stored(2026, 9, 16, 14, 30));
    expect(moved).toEqual({
      when: stored(2026, 9, 2, 14, 30),
      ends: stored(2026, 9, 2, 15, 30),
      until: '',
    });
  });

  it('lets an all-day occurrence dropped on an hour turn the series timed', () => {
    const q = { when: '2026-09-01', frequency: 'daily' };
    const moved = moveOccurrence(q, '2026-09-10', stored(2026, 9, 10, 8));
    expect(moved?.when).toBe(stored(2026, 9, 1, 8));
  });

  it('is null when a start cannot be read', () => {
    expect(moveOccurrence({ when: '' }, '2026-09-10', '2026-09-11')).toBeNull();
    expect(moveOccurrence({ when: '2026-09-01' }, 'junk', '2026-09-11')).toBeNull();
  });
});
