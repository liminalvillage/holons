// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import {
  questKind,
  isTaskQuest,
  isEventQuest,
  isAgendaQuest,
  setQuestKind,
} from './kind.js';
import type { Quest } from './types.js';

const q = (over: Partial<Quest> = {}): Quest =>
  ({ id: 'q', title: 'T', status: 'ongoing', participants: [], ...over }) as Quest;

describe('questKind', () => {
  it('treats an absent type as a task — the historical default', () => {
    expect(questKind(q())).toBe('task');
    expect(questKind(q({ type: undefined }))).toBe('task');
    expect(questKind(q({ type: '' }))).toBe('task');
  });

  it('folds the task spellings together', () => {
    for (const t of ['task', 'quest', 'todo', 'recurring', 'Task', ' TASK '])
      expect(questKind(q({ type: t }))).toBe('task');
  });

  it('folds the event spellings together', () => {
    for (const t of ['event', 'meeting', 'appointment', 'Event'])
      expect(questKind(q({ type: t }))).toBe('event');
  });

  it('keeps marketplace items in their own families', () => {
    expect(questKind(q({ type: 'offer' }))).toBe('offer');
    expect(questKind(q({ type: 'request' }))).toBe('request');
    expect(questKind(q({ type: 'need' }))).toBe('need');
  });

  it('calls an unknown type "other" rather than guessing it is a task', () => {
    expect(questKind(q({ type: 'resource' }))).toBe('other');
    expect(questKind(q({ type: 'shift' }))).toBe('other');
    expect(questKind(null)).toBe('other');
    expect(questKind('nope')).toBe('other');
  });
});

describe('the board predicates', () => {
  it('puts only tasks on the backlog', () => {
    expect(isTaskQuest(q({ type: 'task' }))).toBe(true);
    expect(isTaskQuest(q({ type: 'event' }))).toBe(false);
    expect(isTaskQuest(q({ type: 'offer' }))).toBe(false);
    expect(isTaskQuest(q({ type: 'need' }))).toBe(false);
    expect(isTaskQuest(q({ type: 'resource' }))).toBe(false);
  });

  it('lets tasks and events onto the calendar, and nothing else', () => {
    expect(isAgendaQuest(q({ type: 'task' }))).toBe(true);
    expect(isAgendaQuest(q({ type: 'event' }))).toBe(true);
    expect(isAgendaQuest(q({ type: 'offer' }))).toBe(false);
    expect(isAgendaQuest(q({ type: 'need' }))).toBe(false);
    expect(isAgendaQuest(q({ type: 'other-thing' }))).toBe(false);
  });

  it('names events', () => {
    expect(isEventQuest(q({ type: 'event' }))).toBe(true);
    expect(isEventQuest(q())).toBe(false);
  });
});

describe('setQuestKind', () => {
  it('switches a task into an event and back', () => {
    expect(setQuestKind(q({ type: 'task' }), 'event')).toEqual({ type: 'event' });
    expect(setQuestKind(q({ type: 'event' }), 'task')).toEqual({ type: 'task' });
  });

  it('normalises a legacy spelling on the way through', () => {
    expect(setQuestKind(q({ type: 'quest' }), 'task')).toEqual({ type: 'task' });
    expect(setQuestKind(q({ type: 'meeting' }), 'event')).toEqual({ type: 'event' });
  });

  it('refuses to retype a marketplace item — it has its own lifecycle', () => {
    expect(setQuestKind(q({ type: 'offer' }), 'task')).toEqual({});
    expect(setQuestKind(q({ type: 'need' }), 'event')).toEqual({});
  });
});
