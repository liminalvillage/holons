// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

// A recurring quest as an ORBIT: one lap is one cadence step, and the
// position on the lap is how far the series is through the step towards its
// next open occurrence. 12 o'clock = due. One rule, so every surface that
// draws orbits puts the same planet at the same angle.
//
// Built entirely on `recurrence.ts`: the cadence vocabulary, the next open
// occurrence, and the local-time step. A one-off quest has no orbit.

import {
  QUEST_FREQUENCIES,
  isRecurring,
  nextOpenOccurrence,
  questFrequency,
  type QuestFrequency,
  type RecurringQuest,
} from './recurrence.js';

/** Where a series is on its current lap. */
export interface OrbitPhase {
  frequency: QuestFrequency;
  /** The start of the lap: one cadence step before {@link next}. */
  previous: Date;
  /** The next occurrence still to do — where the lap ends. */
  next: Date;
  /** `next` in the series' own stored form (what ticking it off records). */
  nextWhen: string;
  /** The real length of this lap (a month is 28–31 days, not 30). */
  periodMs: number;
  /** 0 at the lap's start, 1 at `next`; clamped. */
  progress: number;
  /** `now` has reached `next` — the planet sits at 12 o'clock. */
  due: boolean;
}

/** One cadence step back from `from`, in local time (mirror of the forward step). */
function retreat(from: Date, frequency: QuestFrequency): Date {
  const d = new Date(from.getTime());
  switch (frequency) {
    case 'daily':
      d.setDate(d.getDate() - 1);
      break;
    case 'weekly':
      d.setDate(d.getDate() - 7);
      break;
    case 'biweekly':
      d.setDate(d.getDate() - 14);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() - 1);
      break;
    case 'quarterly':
      d.setMonth(d.getMonth() - 3);
      break;
    case 'sixmonths':
      d.setMonth(d.getMonth() - 6);
      break;
    case 'yearly':
      d.setFullYear(d.getFullYear() - 1);
      break;
  }
  return d;
}

/**
 * The series' place on its lap at `now`, or null for a one-off quest or a
 * series with nothing open ahead.
 */
export function orbitPhase(
  q: RecurringQuest | null | undefined,
  now: Date,
): OrbitPhase | null {
  if (!q || !isRecurring(q)) return null;
  const frequency = questFrequency(q) as QuestFrequency;
  const next = nextOpenOccurrence(q, now);
  if (!next) return null;
  const previous = retreat(next.start, frequency);
  const periodMs = next.start.getTime() - previous.getTime();
  const elapsed = now.getTime() - previous.getTime();
  const progress = periodMs > 0 ? Math.min(1, Math.max(0, elapsed / periodMs)) : 0;
  return {
    frequency,
    previous,
    next: next.start,
    nextWhen: next.when,
    periodMs,
    progress,
    due: now.getTime() >= next.start.getTime(),
  };
}

/** The ring a cadence circles on: 0 nearest the sun, fastest first. */
export function orbitRing(frequency: QuestFrequency): number {
  return QUEST_FREQUENCIES.indexOf(frequency);
}

/** The angle of a phase in radians, 0 at 12 o'clock, clockwise. */
export function orbitAngle(phase: Pick<OrbitPhase, 'progress'>): number {
  return phase.progress * 2 * Math.PI;
}
