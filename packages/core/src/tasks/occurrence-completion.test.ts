// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import { applyOccurrenceCompletion } from './completion.js';
import {
  occurrenceQuestId,
  planOccurrenceCompletion,
  planTaskCompletion,
} from './completion-plan.js';
import type { Quest } from './types.js';
import type { ScoreEquation } from '../scoring/index.js';

const equation = {
  initiated: 2,
  completed: 5,
  sent: 1,
  hours: 3,
} as unknown as ScoreEquation;

const series: Quest = {
  id: 'standup',
  title: 'Weekly standup',
  status: 'ongoing',
  when: '2026-09-01',
  frequency: 'weekly',
  initiator: { id: 'ada' },
  participants: [{ id: 'ada' }, { id: 'bob' }],
  appreciation: [{ id: 'cyd' }],
  timeTracking: { bob: 2 },
  completedOccurrences: ['2026-09-01'],
};

describe('applyOccurrenceCompletion', () => {
  it('ticks the occurrence and leaves the series open', () => {
    const r = applyOccurrenceCompletion(series, '2026-09-08', 'bob');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.task.status).toBe('ongoing');
    expect(r.task.completed_at).toBeUndefined();
    expect(r.task.completedOccurrences).toEqual(['2026-09-01', '2026-09-08']);
    expect(r.occurrence).toBe('2026-09-08');
  });

  it('refuses a ticked-off occurrence, a stopped series, a stranger, a one-off', () => {
    expect(applyOccurrenceCompletion(series, '2026-09-01', 'bob')).toEqual({
      ok: false,
      reason: 'already-completed',
    });
    expect(
      applyOccurrenceCompletion({ ...series, status: 'stopped' }, '2026-09-08', 'bob'),
    ).toEqual({ ok: false, reason: 'stopped' });
    expect(applyOccurrenceCompletion(series, '2026-09-08', 'zed')).toEqual({
      ok: false,
      reason: 'forbidden',
    });
    expect(applyOccurrenceCompletion(series, '2026-09-08', 'zed', { isAdmin: true }).ok).toBe(
      true,
    );
    expect(
      applyOccurrenceCompletion({ ...series, frequency: null }, '2026-09-08', 'bob'),
    ).toEqual({ ok: false, reason: 'not-recurring' });
  });
});

describe('planOccurrenceCompletion', () => {
  it('earns exactly what a one-off quest earns, keyed under the occurrence', () => {
    const plan = planOccurrenceCompletion(series, '2026-09-08', equation, {
      holonId: 'h1',
      now: 1000,
    });
    const asOneOff = planTaskCompletion(
      { ...series, id: occurrenceQuestId('standup', '2026-09-08') },
      equation,
      { holonId: 'h1', now: 1000 },
    );
    expect(plan.actions).toEqual(asOneOff.actions);
    expect(plan.expenses).toEqual(asOneOff.expenses);
    expect(plan.actions.every((a) => a.taskId === 'standup::2026-09-08')).toBe(true);
    expect(plan.expenses[0].id).toBe('standup::2026-09-08_time_bob');
    // Another week, other ids: the credits never collide.
    const next = planOccurrenceCompletion(series, '2026-09-15', equation, { holonId: 'h1' });
    expect(next.actions[0].taskId).toBe('standup::2026-09-15');
  });

  it('saves the series itself, not a quest per occurrence', () => {
    const plan = planOccurrenceCompletion(series, '2026-09-08', equation);
    expect(plan.task).toBe(series);
    expect(plan.releasedHolograms).toEqual([]);
  });

  it('credits the confirmed set without touching the series roster', () => {
    const plan = planOccurrenceCompletion(series, '2026-09-08', equation, {
      credited: [{ id: 'bob' }],
    });
    const completed = plan.actions.filter((a) => a.type === 'questCompleted');
    expect(completed.map((a) => a.user.id)).toEqual(['bob']);
    // Appreciation flows to who was there this time.
    const thanks = plan.actions.filter((a) => a.type === 'appreciationExchange');
    expect(thanks.map((a) => a.receiver?.id)).toEqual(['bob']);
    expect(plan.task.participants).toEqual([{ id: 'ada' }, { id: 'bob' }]);
  });
});
