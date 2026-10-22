// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

// WHERE a quest shows, given what it is (`kind`) and when it is (`schedule`,
// `recurrence`). Two surfaces, two different questions:
//
//   the calendar   is also a record of what happened. A past event stays on
//                  it, and so does a completed one — drawn as done. Only what
//                  never took place (cancelled) or is gone (deleted) leaves.
//
//   the task wall  is what is still ahead. A settled quest leaves it; a past
//                  event is never on it; an upcoming event may be, and a
//                  recurring series contributes ONE card — its next open
//                  occurrence — never a card per date. A task that slipped
//                  past its due date stays: the work is still to do.
//
// Core owns the rule; every UI filters on it and none re-derives it.

import { isQuestSettled } from './dependencies.js';
import { isAgendaQuest, questKind } from './kind.js';
import { isRecurring, nextOpenOccurrence, type QuestOccurrence } from './recurrence.js';
import { localDayNumber, questSchedule } from './schedule.js';
import type { Quest } from './types.js';

/** Done — as opposed to cancelled or deleted, which also settle a quest. */
export function isQuestCompleted(quest: Quest): boolean {
  if (quest._deleted === true) return false;
  return (
    String(quest.status ?? '').toLowerCase() === 'completed' ||
    quest.completed === true
  );
}

/**
 * Does this quest belong on a calendar? A dated task or event, past or
 * future, open or completed. Draw a completed one as done
 * ({@link isQuestCompleted}).
 */
export function showsOnCalendar(quest: Quest): boolean {
  if (!isAgendaQuest(quest)) return false;
  if (quest._deleted === true) return false;
  if (String(quest.status ?? '').toLowerCase() === 'cancelled') return false;
  return questSchedule(quest).start !== null;
}

/** How a quest sits on the task wall. */
export interface TaskWallPlacement {
  /** The date its card shows: the next open occurrence's for a series. */
  due: Date | null;
  /** The occurrence the card stands for, when the quest recurs. */
  occurrence: QuestOccurrence | null;
}

/**
 * The quest's place on the task wall at `now`, or null when it has none.
 * Days are compared in the viewer's timezone, so an event earlier today is
 * still "today" and stays until the day is over.
 */
export function taskWallPlacement(quest: Quest, now: Date): TaskWallPlacement | null {
  if (isQuestSettled(quest)) return null;
  const kind = questKind(quest);
  if (kind !== 'task' && kind !== 'event') return null;
  const schedule = questSchedule(quest);

  if (isRecurring(quest)) {
    const occurrence = nextOpenOccurrence(quest, now);
    if (occurrence) return { due: occurrence.start, occurrence };
    // A series with nothing open ahead: an event has run its course, a task
    // keeps its card under the day the series began.
    return kind === 'task' ? { due: schedule.start, occurrence: null } : null;
  }

  if (kind === 'task') return { due: schedule.start, occurrence: null };
  if (!schedule.start) return null;
  // `days` is the inclusive span, so the last day is `days - 1` after the first.
  const lastDay = localDayNumber(schedule.start) + schedule.days - 1;
  return lastDay >= localDayNumber(now) ? { due: schedule.start, occurrence: null } : null;
}
