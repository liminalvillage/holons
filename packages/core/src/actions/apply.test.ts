// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import type { Quest, QuestParticipant } from '../tasks/types.js';
import { resolveAction, type ResolveContext } from './resolve.js';
import { emptyChangeset, mergeChange, stageAction, type StagedChange } from './stage.js';
import { applyChange, applyChangeset, type ApplyPorts } from './apply.js';

const van: Quest = { id: 'v1', title: 'Wash the van', status: 'ongoing', participants: [] };
const actor: QuestParticipant = { id: '3', first_name: 'Roberto' };
const users = [{ id: 1, first_name: 'Marco' }, { id: 3, first_name: 'Roberto' }];
const ctx = (utterance: string, quests: Quest[] = [van]): ResolveContext => ({
  holonId: 'h',
  utterance,
  quests,
  users,
  actor,
});

function stage(call: { name: string; input: Record<string, unknown> }, c = ctx('')): StagedChange {
  const r = resolveAction(call, c);
  if (r.kind !== 'ok') throw new Error(r.kind);
  const s = stageAction(r.resolved);
  if ('error' in s) throw new Error(s.error);
  return s.change;
}

function fakeStore(initial: Record<string, Quest>) {
  const db = { ...initial };
  const ports: ApplyPorts = {
    get: async (_h, _l, key) => db[key] ?? null,
    put: async (_h, _l, rec) => {
      db[String(rec.id)] = rec;
      return true;
    },
  };
  return { db, ports };
}

describe('applyChange', () => {
  it('re-applies the operation onto the fresh record, not the preview', async () => {
    const change = stage({ name: 'task_add_participant', input: { taskId: 'v1', user: { name: 'Marco' } } });
    // Meanwhile someone renamed the task by touch.
    const { db, ports } = fakeStore({ v1: { ...van, title: 'Wash the van (urgent)' } });
    const out = await applyChange(change, ports);
    expect(out.ok).toBe(true);
    expect(db.v1.title).toBe('Wash the van (urgent)');
    expect(db.v1.participants).toEqual([{ id: '1', first_name: 'Marco' }]);
  });

  it('writes a creation and routes completion through the consumer flow', async () => {
    const create = stage({ name: 'task_create', input: { title: 'New one' } });
    const { db, ports } = fakeStore({});
    expect((await applyChange(create, ports)).ok).toBe(true);
    expect(Object.values(db)[0].title).toBe('New one');

    const complete = stage({ name: 'task_complete', input: { taskId: 'v1' } });
    const done = vi.fn(async () => true);
    const store = fakeStore({ v1: van });
    const out = await applyChange(complete, { ...store.ports, complete: done });
    expect(out.ok).toBe(true);
    expect(done).toHaveBeenCalledWith('h', expect.objectContaining({ participants: [actor] }), actor);
    expect(store.db.v1.status).toBe('ongoing'); // the flow, not a raw put, owns the write
  });

  it('fires the membership hook per person and reports denied or vanished writes', async () => {
    const change = stage({ name: 'task_toggle_participant', input: { taskId: 'v1' } });
    const after = vi.fn(async () => {});
    const { ports } = fakeStore({ v1: van });
    await applyChange(change, { ...ports, afterParticipants: after });
    expect(after).toHaveBeenCalledWith('h', expect.objectContaining({ id: 'v1' }), actor, true);

    const denied = await applyChange(change, { ...ports, put: async () => false });
    expect(denied).toEqual({ id: change.id, ok: false, error: 'The write was denied.' });
    const gone = await applyChange(change, { ...ports, get: async () => ({ ...van, _deleted: true }) });
    expect(gone.error).toMatch(/deleted/);
  });

  it('applies only the selected changes, in order, never stopping on a failure', async () => {
    const add = stage({ name: 'task_add_participant', input: { taskId: 'v1', user: { name: 'Marco' } } });
    const rename = stage({ name: 'task_update', input: { taskId: 'v1', title: 'Bus' } });
    const complete = stage({ name: 'task_complete', input: { taskId: 'v1' } });
    const set = [add, rename, complete].reduce((s, c) => mergeChange(s, c), emptyChangeset());
    const { db, ports } = fakeStore({ v1: van });
    let n = 0;
    const flaky: ApplyPorts = { ...ports, put: async (h, l, r) => (++n === 1 ? false : ports.put(h, l, r)) };
    const outs = await applyChangeset(set, new Set([add.id, complete.id]), flaky);
    expect(outs.map((o) => o.ok)).toEqual([false, true]);
    expect(db.v1.status).toBe('completed');
    expect(db.v1.title).toBe('Wash the van');
    expect(db.v1.participants).toEqual([actor]); // the failed add never landed; completer credited
  });
});
