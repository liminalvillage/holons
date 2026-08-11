// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  claimsCompletedAction,
  correctionHistory,
  correctionPrompt,
  hasSuccessfulWrite,
  hasWriteAttempt,
  isWriteTool,
  looksLikeActionRequest,
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
      'navigate',
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
      'list_items',
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

describe('correction pass', () => {
  it('names every call with its outcome in the corrective prompt', () => {
    const p = correctionPrompt(
      [
        { name: 'list_items', ok: true },
        { name: 'task_update', ok: false },
      ],
      'claimed',
    );
    expect(p).toContain('list_items (ok)');
    expect(p).toContain('task_update (FAILED)');
    expect(p).toContain('claimed an action was completed');
    expect(correctionPrompt([], 'no_write')).toContain('no tools at all');
    expect(correctionPrompt([], 'no_write')).toContain(
      'asked for an action to be performed',
    );
  });

  it('appends the rejected exchange to the history for the retry', () => {
    const h = correctionHistory(
      [{ role: 'user', content: 'earlier' }],
      'delete the roof task',
      "I've deleted it.",
    );
    expect(h).toHaveLength(3);
    expect(h[1]).toEqual({ role: 'user', content: 'delete the roof task' });
    expect(h[2]).toEqual({ role: 'assistant', content: "I've deleted it." });
  });
});
