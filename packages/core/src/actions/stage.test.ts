// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { Quest } from '../tasks/types.js';
import { localFieldsToStored } from '../datetime/index.js';
import { resolveAction, type ResolveContext } from './resolve.js';
import {
  describeChange,
  describeChangeset,
  emptyChangeset,
  hasDrifted,
  mergeChange,
  projectQuests,
  removeChange,
  stageAction,
  type Changeset,
  type StagedChange,
} from './stage.js';

const kitchen: Quest = {
  id: 'k1',
  title: 'Clean the kitchen',
  status: 'ongoing',
  participants: [{ id: '3', first_name: 'Roberto' }],
  when: localFieldsToStored('2026-09-10', '10:00')!,
  ends: localFieldsToStored('2026-09-10', '11:30')!,
};
const van: Quest = { id: 'v1', title: 'Wash the van', status: 'ongoing', participants: [] };
const foreign: Quest = {
  id: 'local-f1',
  title: 'Partner picnic',
  status: 'ongoing',
  participants: [],
  _hologram: { isHologram: true, sourceHolon: 'owner', sourceKey: 'f1' },
} as Quest;

const users = [
  { id: 1, first_name: 'Marco', last_name: 'Rossi' },
  { id: 3, first_name: 'Roberto' },
];
const actor = { id: '3', first_name: 'Roberto' };

const ctx = (utterance: string, quests: Quest[] = [kitchen, van, foreign]): ResolveContext => ({
  holonId: 'h',
  utterance,
  quests,
  users,
  actor,
  now: new Date(2026, 8, 9, 9, 0),
});

/** Resolve + stage in one go, throwing on anything but a change. */
function stage(call: { name: string; input: Record<string, unknown> }, c: ResolveContext): StagedChange {
  const r = resolveAction(call, c);
  if (r.kind !== 'ok') throw new Error(`resolve: ${r.kind} ${'message' in r ? r.message : ''}`);
  const s = stageAction(r.resolved, r.warnings);
  if ('error' in s) throw new Error(`stage: ${s.error}`);
  return s.change;
}

const merged = (...changes: StagedChange[]): Changeset =>
  changes.reduce((set, c) => mergeChange(set, c), emptyChangeset());

describe('stageAction', () => {
  it('previews a reschedule as a before/after diff without touching the input', () => {
    const c = stage({ name: 'task_update', input: { taskId: 'k1', time: '14:00' } }, ctx('move the kitchen to two'));
    expect(c.kind).toBe('update');
    expect(c.before).toBe(kitchen);
    expect(c.diff).toEqual([{ field: 'schedule', before: '2026-09-10 10:00–11:30', after: '2026-09-10 14:00–15:30' }]);
    expect(describeChange(c)).toBe('Change "Clean the kitchen": schedule 2026-09-10 10:00–11:30 → 2026-09-10 14:00–15:30');
    expect(kitchen.when).toBe(localFieldsToStored('2026-09-10', '10:00'));
  });

  it('refuses an update that changes nothing, and flags drift only in touched fields', () => {
    const r = resolveAction({ name: 'task_update', input: { taskId: 'k1', time: '10:00' } }, ctx('move it to ten'));
    expect(r.kind === 'ok' && stageAction(r.resolved)).toEqual({ error: '"Clean the kitchen" is already like that — nothing to change.' });
    const c = stage({ name: 'task_update', input: { taskId: 'k1', time: '14:00' } }, ctx('move it to two'));
    expect(hasDrifted(c, { ...kitchen, title: 'Clean the KITCHEN' })).toBe(false);
    expect(hasDrifted(c, { ...kitchen, when: localFieldsToStored('2026-09-11', '10:00')! })).toBe(true);
    expect(hasDrifted(c, null)).toBe(false);
  });

  it('targets the owner holon and key of a hologram', () => {
    const c = stage({ name: 'task_add_participant', input: { taskRef: 'picnic', user: { name: 'Marco' } } }, ctx('add marco to the picnic'));
    expect(c.holon).toBe('owner');
    expect(c.key).toBe('f1');
    expect(c.localId).toBe('local-f1');
  });

  it('normalises toggle to add/remove from the current state', () => {
    const join = stage({ name: 'task_toggle_participant', input: { taskId: 'v1' } }, ctx('join the van'));
    expect(join.op).toEqual({ type: 'participants', ops: [{ mode: 'add', user: actor }] });
    const leave = stage({ name: 'task_toggle_participant', input: { taskId: 'k1' } }, ctx('leave the kitchen'));
    expect(leave.op).toEqual({ type: 'participants', ops: [{ mode: 'remove', user: actor }] });
    expect(describeChange(leave)).toBe('Remove Roberto from "Clean the kitchen"');
  });

  it('refuses no-op participant changes and impossible completions', () => {
    const r = resolveAction({ name: 'task_add_participant', input: { taskId: 'k1', user: { name: 'Roberto' } } }, ctx('add roberto'));
    expect(r.kind === 'ok' && stageAction(r.resolved)).toEqual({ error: 'Roberto already takes part in "Clean the kitchen".' });
    const done = { ...van, status: 'completed' };
    const c = resolveAction({ name: 'task_complete', input: { taskId: 'v1' } }, ctx('van is done', [done]));
    expect(c.kind === 'ok' && stageAction(c.resolved)).toEqual({ error: '"Wash the van" is already completed.' });
  });

  it('credits the completer when nobody has joined', () => {
    const c = stage({ name: 'task_complete', input: { taskId: 'v1' } }, ctx('the van is done'));
    expect(c.after.status).toBe('completed');
    expect(c.after.participants).toEqual([actor]);
    expect(describeChange(c)).toBe('Complete "Wash the van" (credits Roberto)');
    expect(c.diff.map((d) => d.field)).toEqual(['participants', 'status']);
  });
});

describe('mergeChange', () => {
  it('replaces a schedule with the later one ("two… actually three")', () => {
    const two = stage({ name: 'task_update', input: { taskId: 'k1', time: '14:00' } }, ctx('move it to two'));
    const three = stage({ name: 'task_update', input: { taskId: 'k1', time: '15:00' } }, ctx('actually three'));
    const set = merged(two, three);
    expect(set.changes).toHaveLength(1);
    expect(set.changes[0].diff[0].after).toBe('2026-09-10 15:00–16:30');
    expect(set.changes[0].before).toBe(kitchen);
  });

  it('keeps unrelated field patches together and cancels add+remove of one person', () => {
    const title = stage({ name: 'task_update', input: { taskId: 'v1', title: 'Wash the bus' } }, ctx('rename'));
    const cat = stage({ name: 'task_update', input: { taskId: 'v1', category: 'chores' } }, ctx('categorise'));
    const set = merged(title, cat);
    expect(set.changes[0].op).toEqual({ type: 'patch', fields: { title: 'Wash the bus', category: 'chores' } });

    const add = stage({ name: 'task_add_participant', input: { taskId: 'v1', user: { name: 'Marco' } } }, ctx('add marco'));
    const projected = projectQuests([van], merged(add));
    const remove = stage({ name: 'task_remove_participant', input: { taskId: 'v1', user: { name: 'Marco' } } }, ctx('remove marco', projected));
    expect(merged(add, remove).changes).toHaveLength(0);
    expect(merged(add, add).changes[0].op).toEqual(add.op);
  });

  it('folds edits to a task that is still being created into the creation', () => {
    const create = stage({ name: 'task_create', input: { title: 'Wash the bus', date: '2026-09-10', time: '14:00' } }, ctx('create wash the bus tomorrow at two'));
    let set = merged(create);
    const projected = projectQuests([van], set);
    expect(projected.map((q) => q.title)).toEqual(['Wash the van', 'Wash the bus']);
    const add = stage({ name: 'task_add_participant', input: { taskRef: 'bus', user: { name: 'Marco' } } }, ctx('and add marco to it', projected));
    set = mergeChange(set, add);
    expect(set.changes).toHaveLength(1);
    expect(set.changes[0].kind).toBe('create');
    expect(set.changes[0].after.participants).toEqual([{ id: '1', first_name: 'Marco', last_name: 'Rossi' }]);
    expect(describeChange(set.changes[0])).toBe('Create task "Wash the bus" on 2026-09-10 14:00 with Marco Rossi');
    const move = stage({ name: 'task_update', input: { taskRef: 'bus', time: '15:00' } }, ctx('move it to three', projectQuests([van], set)));
    set = mergeChange(set, move);
    expect(set.changes).toHaveLength(1);
    expect(set.changes[0].diff.find((d) => d.field === 'schedule')?.after).toBe('2026-09-10 15:00');
  });

  it('projects several changes onto one task, in order', () => {
    const add = stage({ name: 'task_add_participant', input: { taskId: 'v1', user: { name: 'Marco' } } }, ctx('add marco'));
    const move = stage({ name: 'task_update', input: { taskId: 'v1', date: '2026-09-11', time: '09:00' } }, ctx('move it', projectQuests([van], merged(add))));
    const set = merged(add, move);
    const [q] = projectQuests([van], set);
    expect(q.participants).toHaveLength(1);
    expect(q.when).toBe(localFieldsToStored('2026-09-11', '09:00'));
    expect(describeChangeset(set)).toBe('1. Add Marco Rossi to "Wash the van"\n2. Change "Wash the van": schedule unscheduled → 2026-09-11 09:00');
    expect(removeChange(set, add.id).changes).toEqual([set.changes[1]]);
  });
});
