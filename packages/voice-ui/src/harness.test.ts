// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  buildSnapshot,
  claimsCompletedAction,
  digestQuests,
  digestUsers,
  fuzzyFindByTitle,
  hasSuccessfulWrite,
  hasWriteAttempt,
  idSpecFor,
  isWriteTool,
  localIso,
  looksLikeActionRequest,
  titleMismatch,
} from './harness.js';

describe('isWriteTool', () => {
  it('classifies writes and reads', () => {
    for (const w of [
      'task_create',
      'task_complete',
      'task_add_participant',
      'lens_delete',
      'lens_put',
      'subtask_add',
      'tasks_save',
      'library_borrow',
      'holon_join',
      'ui_navigate',
    ]) {
      expect(isWriteTool(w), w).toBe(true);
    }
    for (const r of [
      'lens_get',
      'lens_get_all',
      'task_get',
      'users_list',
      'holon_info',
      'library_list',
      'score_breakdown',
    ]) {
      expect(isWriteTool(r), r).toBe(false);
    }
  });
});

describe('hasSuccessfulWrite', () => {
  it('needs an ok write, not just reads or failed writes', () => {
    expect(hasSuccessfulWrite([])).toBe(false);
    expect(hasSuccessfulWrite([{ name: 'lens_get_all', ok: true }])).toBe(false);
    expect(hasSuccessfulWrite([{ name: 'task_complete', ok: false }])).toBe(false);
    expect(
      hasSuccessfulWrite([
        { name: 'lens_get_all', ok: true },
        { name: 'task_complete', ok: true },
      ]),
    ).toBe(true);
  });
});

describe('claimsCompletedAction', () => {
  it('matches claims of performed actions', () => {
    expect(claimsCompletedAction("I've deleted the cleaning task.")).toBe(true);
    expect(claimsCompletedAction('The task has been removed as requested.')).toBe(true);
    expect(claimsCompletedAction('I added you to the roof task.')).toBe(true);
    expect(claimsCompletedAction('It has been successfully saved.')).toBe(true);
    expect(claimsCompletedAction("I've switched you to the calendar.")).toBe(true);
  });

  it('ignores descriptions and questions', () => {
    expect(claimsCompletedAction('You have three open tasks.')).toBe(false);
    expect(claimsCompletedAction('Which task should I delete?')).toBe(false);
    expect(claimsCompletedAction('The task marked as done is "roof".')).toBe(false);
  });
});

describe('looksLikeActionRequest / hasWriteAttempt', () => {
  it('spots action-shaped utterances', () => {
    expect(looksLikeActionRequest('Add me to the roof task at 2pm.')).toBe(true);
    expect(looksLikeActionRequest('delete the cleaning task')).toBe(true);
    expect(looksLikeActionRequest('Move mop the floor to tomorrow.')).toBe(true);
    expect(looksLikeActionRequest('go to the calendar')).toBe(true);
    expect(looksLikeActionRequest('switch to the library tab')).toBe(true);
  });

  it('leaves questions and chat alone', () => {
    expect(looksLikeActionRequest('What tasks do I have?')).toBe(false);
    expect(looksLikeActionRequest('Who is in this holon?')).toBe(false);
  });

  it('write attempt counts failed writes, unlike hasSuccessfulWrite', () => {
    const audit = [
      { name: 'lens_get_all', ok: true },
      { name: 'task_update', ok: false },
    ];
    expect(hasWriteAttempt(audit)).toBe(true);
    expect(hasSuccessfulWrite(audit)).toBe(false);
  });
});

describe('id resolution', () => {
  const items = [
    { id: 'mr1', title: 'wash the van' },
    { id: 'mr2', title: 'clean the window' },
    { id: 'mr3', title: 'clean the door' },
  ];

  it('identifies which calls carry a record id', () => {
    expect(idSpecFor('task_update', { taskId: 'x' })).toEqual({
      field: 'taskId',
      lenses: ['quests'],
    });
    expect(idSpecFor('subtask_add', { checklistId: 'x' })).toEqual({
      field: 'checklistId',
      lenses: ['quests', 'checklists'],
    });
    expect(idSpecFor('lens_delete', { lens: 'quests', id: 'x' })).toEqual({
      field: 'id',
      lenses: ['quests'],
    });
    expect(idSpecFor('lens_delete', { lens: 'library', id: 'x' })).toBeNull();
    expect(idSpecFor('task_create', { title: 'x' })).toBeNull();
    expect(idSpecFor('users_list', {})).toBeNull();
  });

  it('resolves an invented id via the utterance', () => {
    const r = fuzzyFindByTitle('100 scheduled the wash the van task to 4pm', items);
    expect(r).toEqual({ id: 'mr1', title: 'wash the van' });
  });

  it('returns candidates when titles are too close to call', () => {
    const r = fuzzyFindByTitle('clean_task complete the clean task', items);
    expect(r && 'candidates' in r ? r.candidates.length : 0).toBeGreaterThan(1);
  });

  it('prefers the fully covered title among close ones', () => {
    const r = fuzzyFindByTitle('complete the clean the window task', items);
    expect(r).toEqual({ id: 'mr2', title: 'clean the window' });
  });

  it('gives up when nothing plausibly matches', () => {
    expect(fuzzyFindByTitle('buy groceries tomorrow', items)).toBeNull();
  });

  it('matches split/joined compound words via the squashed form', () => {
    const quests = [
      { id: 'fc', title: 'Futurecasting' },
      { id: 'ek', title: 'clear out external kitchen' },
    ];
    expect(fuzzyFindByTitle('move the future casting to tomorrow', quests)).toEqual({
      id: 'fc',
      title: 'Futurecasting',
    });
  });
});

describe('titleMismatch', () => {
  // The live failure: a VALID id, but of a completely different task.
  const quests = [
    { id: 'mr9dq', title: 'Future Casting' },
    { id: 'mqv77', title: 'clear out external kitchen' },
    { id: 'mr9fb', title: 'Artizen Call' },
  ];

  it('flags a valid id whose title contradicts the utterance', () => {
    const r = titleMismatch(
      'Move the future casting to tomorrow.',
      { id: 'mqv77', title: 'clear out external kitchen' },
      quests,
    );
    expect(r).toEqual({ id: 'mr9dq', title: 'Future Casting' });
  });

  it('trusts the chosen id when the utterance names it', () => {
    expect(
      titleMismatch(
        'reschedule the artizen call',
        { id: 'mr9fb', title: 'Artizen Call' },
        quests,
      ),
    ).toBeNull();
  });

  it('never triggers on pronoun-only follow-ups', () => {
    expect(
      titleMismatch(
        'move it to 8pm instead',
        { id: 'mqv77', title: 'clear out external kitchen' },
        quests,
      ),
    ).toBeNull();
  });

  it('trusts partial overlap with the chosen title', () => {
    expect(
      titleMismatch(
        'add buy soap to the kitchen task',
        { id: 'mqv77', title: 'clear out external kitchen' },
        quests,
      ),
    ).toBeNull();
  });
});

describe('localIso', () => {
  const moment = new Date('2026-07-03T12:00:00Z');

  it('renders naive local ISO in the requested zone', () => {
    const ny = localIso(moment, 'America/New_York');
    expect(ny.iso).toBe('2026-07-03T08:00:00');
    expect(ny.zone).toContain('America/New_York');
    const tokyo = localIso(moment, 'Asia/Tokyo');
    expect(tokyo.iso).toBe('2026-07-03T21:00:00');
  });

  it('falls back to the server zone on a bogus timezone', () => {
    const r = localIso(moment, 'Not/AZone');
    expect(r.iso).toMatch(/^2026-07-0[34]T\d{2}:\d{2}:\d{2}$/);
  });
});

describe('digests and snapshot', () => {
  it('digests quests and users payloads', () => {
    const q = digestQuests(
      JSON.stringify({ items: [{ id: 'a1', title: 'Roof', status: 'ongoing', noise: 'x' }] }),
    );
    expect(q).toBe('[{"id":"a1","title":"Roof","status":"ongoing"}]');
    const u = digestUsers(JSON.stringify({ users: [{ id: 7, first_name: 'Anna' }] }));
    expect(u).toBe('[{"id":7,"name":"Anna"}]');
    expect(digestQuests('not json')).toBeNull();
    expect(digestUsers('{}')).toBeNull();
  });

  it('builds a snapshot only when there is content', () => {
    expect(buildSnapshot('h1', null, null)).toBe('');
    const s = buildSnapshot('h1', '[t]', '[u]');
    expect(s).toContain('holon h1');
    expect(s).toContain('tasks: [t]');
    expect(s).toContain('members: [u]');
  });
});
