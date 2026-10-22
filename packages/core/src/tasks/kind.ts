// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a record on the `quests` lens actually IS. The lens is a shared bag:
// tasks, calendar events and marketplace items (offers/requests/needs) all
// live there, and other domains (needs, offers, surplus) write into it too.
// Without one rule, every list re-guesses, and a board ends up showing an
// offer as a sticky note or a tentative date as a chore.
//
// Core owns that rule here; UIs filter on it and never re-derive it.

import { classifyMarketItem } from './marketplace.js';
import type { Quest } from './types.js';

/**
 * The families a `quests` record can belong to.
 *
 * - `task` — work someone took on: the backlog wall.
 * - `event` — something that happens at a time: the calendar, and the task
 *   wall only while it is still to come (see `placement.ts`).
 * - `offer` / `request` / `need` — marketplace items, their own boards.
 * - `other` — a type written by a domain we don't know about. Deliberately
 *   NOT a task: an unknown record is shown by whoever wrote it, never by the
 *   backlog. That is what keeps the separation from rotting as domains grow.
 */
export type QuestKind = 'task' | 'event' | 'offer' | 'request' | 'need' | 'other';

/** Spellings that mean "a task". An absent type is a task — the historical default. */
const TASK_TYPES: readonly string[] = ['', 'task', 'quest', 'todo', 'recurring'];

/** Spellings that mean "a calendar event". */
const EVENT_TYPES: readonly string[] = ['event', 'meeting', 'appointment'];

/** The two kinds a person can switch a card between (see {@link setQuestKind}). */
export const SWITCHABLE_KINDS = ['task', 'event'] as const;
export type SwitchableKind = (typeof SWITCHABLE_KINDS)[number];

/** Which family this record belongs to. */
export function questKind(item: unknown): QuestKind {
  if (!item || typeof item !== 'object') return 'other';
  const market = classifyMarketItem(item);
  if (market) return market;
  const type = String((item as { type?: unknown }).type ?? '')
    .trim()
    .toLowerCase();
  if (TASK_TYPES.includes(type)) return 'task';
  if (EVENT_TYPES.includes(type)) return 'event';
  return 'other';
}

/** Does this belong on the backlog? Only real tasks do. */
export function isTaskQuest(item: unknown): boolean {
  return questKind(item) === 'task';
}

/** Is this a calendar-only event? */
export function isEventQuest(item: unknown): boolean {
  return questKind(item) === 'event';
}

/**
 * May this appear on a calendar (once it has a date)? Tasks show there for
 * their due date, events for when they happen. Marketplace items never do —
 * an offer's expiry is not an appointment.
 */
export function isAgendaQuest(item: unknown): boolean {
  const kind = questKind(item);
  return kind === 'task' || kind === 'event';
}

/**
 * Turn a task into an event, or an event back into a task — the card's type
 * switch. Returns the fields to merge into the stored record; everything else
 * (title, schedule, people, appreciation, cadence) rides along untouched, so
 * a date drawn on the calendar survives the trip to the backlog and back.
 *
 * Only tasks and events convert: a marketplace item keeps its own lifecycle
 * (reservations, responses, settlement) and is returned unchanged.
 */
export function setQuestKind(quest: Quest, kind: SwitchableKind): Partial<Quest> {
  if (!isAgendaQuest(quest)) return {};
  return { type: kind };
}
