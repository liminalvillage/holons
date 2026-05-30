import { describe, expect, it } from 'vitest';
import { toggleStopper } from './stop.js';
import type { Quest } from './types.js';

function quest(over: Partial<Quest> = {}): Quest {
  return {
    title: 'Fix the roof',
    status: 'ongoing',
    participants: [],
    ...over,
  } as Quest;
}

describe('tasks/stop toggleStopper', () => {
  it('adds a veto and marks the quest stopped', () => {
    const r = toggleStopper(quest(), { id: 1, username: 'a' });
    expect(r.stopped).toBe(true);
    expect(r.task.stoppers).toHaveLength(1);
    expect(r.task.status).toBe('stopped');
  });

  it('revoking the last veto returns the quest to ongoing', () => {
    const stopped = toggleStopper(quest(), { id: 1 }).task;
    const r = toggleStopper(stopped, { id: 1 });
    expect(r.stopped).toBe(false);
    expect(r.task.stoppers).toHaveLength(0);
    expect(r.task.status).toBe('ongoing');
  });

  it('keeps stopped while other vetoes remain', () => {
    let q = toggleStopper(quest(), { id: 1 }).task;
    q = toggleStopper(q, { id: 2 }).task;
    const r = toggleStopper(q, { id: 1 }); // id 1 revokes; id 2 still vetoes
    expect(r.task.stoppers).toHaveLength(1);
    expect(r.task.status).toBe('stopped');
  });

  it('never resurrects a completed quest', () => {
    const r = toggleStopper(quest({ status: 'completed' }), { id: 1 });
    expect(r.task.status).toBe('completed');
  });
});
