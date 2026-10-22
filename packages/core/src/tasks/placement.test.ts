// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import { isQuestCompleted, showsOnCalendar, taskWallPlacement } from './placement.js';
import type { Quest } from './types.js';

const local = (y: number, mo: number, d: number, h = 0, mi = 0): Date =>
  new Date(y, mo - 1, d, h, mi);
const stored = (...a: Parameters<typeof local>): string =>
  local(...a).toISOString();
const now = local(2026, 9, 18, 12);

const q = (over: Partial<Quest> = {}): Quest =>
  ({ id: 'q', title: 'T', status: 'ongoing', participants: [], ...over }) as Quest;

describe('isQuestCompleted', () => {
  it('reads both spellings of done', () => {
    expect(isQuestCompleted(q({ status: 'completed' }))).toBe(true);
    expect(isQuestCompleted(q({ completed: true } as Partial<Quest>))).toBe(true);
    expect(isQuestCompleted(q())).toBe(false);
  });

  it('is not what cancelled or deleted means', () => {
    expect(isQuestCompleted(q({ status: 'cancelled' }))).toBe(false);
    expect(
      isQuestCompleted(q({ status: 'completed', _deleted: true } as Partial<Quest>)),
    ).toBe(false);
  });
});

describe('showsOnCalendar', () => {
  it('keeps a past event, and a completed one — the calendar is also a record', () => {
    expect(showsOnCalendar(q({ type: 'event', when: '2026-01-05' }))).toBe(true);
    expect(
      showsOnCalendar(q({ type: 'event', when: '2026-01-05', status: 'completed' })),
    ).toBe(true);
    expect(showsOnCalendar(q({ when: '2026-01-05', status: 'completed' }))).toBe(true);
  });

  it('drops what never happened or is gone', () => {
    expect(
      showsOnCalendar(q({ type: 'event', when: '2026-01-05', status: 'cancelled' })),
    ).toBe(false);
    expect(
      showsOnCalendar(q({ type: 'event', when: '2026-01-05', _deleted: true } as Partial<Quest>)),
    ).toBe(false);
  });

  it('needs a date and an agenda kind', () => {
    expect(showsOnCalendar(q({ type: 'event' }))).toBe(false);
    expect(showsOnCalendar(q({ type: 'offer', when: '2026-10-01' }))).toBe(false);
  });
});

describe('taskWallPlacement', () => {
  it('never shows a settled quest', () => {
    expect(taskWallPlacement(q({ status: 'completed' }), now)).toBeNull();
    expect(
      taskWallPlacement(q({ type: 'event', when: '2026-10-01', status: 'completed' }), now),
    ).toBeNull();
  });

  it('shows a task whether undated, upcoming or overdue', () => {
    expect(taskWallPlacement(q(), now)).toEqual({ due: null, occurrence: null });
    expect(taskWallPlacement(q({ when: '2026-10-01' }), now)?.due).toEqual(
      local(2026, 10, 1),
    );
    // Work that slipped is still work.
    expect(taskWallPlacement(q({ when: '2026-09-01' }), now)?.due).toEqual(
      local(2026, 9, 1),
    );
  });

  it('shows an upcoming event, today included', () => {
    expect(
      taskWallPlacement(q({ type: 'event', when: '2026-09-20' }), now)?.due,
    ).toEqual(local(2026, 9, 20));
    expect(
      taskWallPlacement(q({ type: 'event', when: stored(2026, 9, 18, 9) }), now)?.due,
    ).toEqual(local(2026, 9, 18, 9));
  });

  it('never shows a past event', () => {
    expect(taskWallPlacement(q({ type: 'event', when: '2026-09-17' }), now)).toBeNull();
    expect(
      taskWallPlacement(q({ type: 'event', when: stored(2026, 9, 10, 18) }), now),
    ).toBeNull();
  });

  it('keeps a multi-day event until its last day', () => {
    const fest = q({ type: 'event', when: '2026-09-16', ends: '2026-09-19' });
    expect(taskWallPlacement(fest, now)?.due).toEqual(local(2026, 9, 16));
    expect(taskWallPlacement(fest, local(2026, 9, 20))).toBeNull();
  });

  it('hides an undated event — it has nothing to come', () => {
    expect(taskWallPlacement(q({ type: 'event' }), now)).toBeNull();
  });

  it('shows only the next occurrence of a recurring event', () => {
    const weekly = q({ type: 'event', when: '2026-09-02', frequency: 'weekly' });
    const p = taskWallPlacement(weekly, now);
    expect(p?.due).toEqual(local(2026, 9, 23));
    expect(p?.occurrence?.when).toBe('2026-09-23');
  });

  it('steps past a ticked-off occurrence', () => {
    const weekly = q({
      type: 'event',
      when: '2026-09-02',
      frequency: 'weekly',
      completedOccurrences: ['2026-09-23'],
    } as Partial<Quest>);
    expect(taskWallPlacement(weekly, now)?.occurrence?.when).toBe('2026-09-30');
  });

  it('gives a recurring task its next open occurrence as the due date', () => {
    const chore = q({ when: '2026-09-01', frequency: 'daily' });
    expect(taskWallPlacement(chore, now)?.due).toEqual(local(2026, 9, 18));
  });

  it('keeps marketplace items and unknown types off the wall', () => {
    expect(taskWallPlacement(q({ type: 'offer' }), now)).toBeNull();
    expect(taskWallPlacement(q({ type: 'shift', when: '2026-10-01' }), now)).toBeNull();
  });
});
