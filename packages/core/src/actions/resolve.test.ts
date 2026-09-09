// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { Quest } from '../tasks/types.js';
import { localFieldsToStored, toLocalDateField, toLocalTimeField } from '../datetime/index.js';
import { resolveAction, resolveSchedule, type ResolveContext } from './resolve.js';

const kitchen: Quest = {
  id: 'k1',
  title: 'Clean the kitchen',
  status: 'ongoing',
  participants: [{ id: '3', first_name: 'Roberto' }],
  when: localFieldsToStored('2026-09-10', '10:00')!,
  ends: localFieldsToStored('2026-09-10', '11:30')!,
};
const van: Quest = { id: 'v1', title: 'Wash the van', status: 'ongoing', participants: [] };
const party: Quest = {
  id: 'p1',
  title: 'Harvest party',
  status: 'ongoing',
  participants: [],
  when: '2026-09-20',
  ends: '2026-09-22',
};

const users = [
  { id: 1, first_name: 'Marco', last_name: 'Rossi', username: 'mrossi' },
  { id: 2, first_name: 'Marco', last_name: 'Bianchi' },
  { id: 3, first_name: 'Roberto', username: 'robertovalenti' },
];

const ctx = (utterance: string, extra: Partial<ResolveContext> = {}): ResolveContext => ({
  holonId: 'h',
  utterance,
  quests: [kitchen, van, party],
  users,
  actor: { id: '3', first_name: 'Roberto', username: 'robertovalenti' },
  now: new Date(2026, 8, 9, 9, 0),
  ...extra,
});

describe('resolveAction — tasks', () => {
  it('uses an exact id', () => {
    const r = resolveAction({ name: 'task_update', input: { taskId: 'v1', title: 'Wash the bus' } }, ctx('rename wash the van to wash the bus'));
    expect(r.kind).toBe('ok');
    expect(r.kind === 'ok' && r.resolved.name === 'task_update' && r.resolved.quest.id).toBe('v1');
  });

  it('swaps a valid id for the task the utterance clearly names', () => {
    const r = resolveAction(
      { name: 'task_update', input: { taskId: 'k1', category: 'chores' } },
      ctx('put the wash the van task in chores'),
    );
    expect(r.kind === 'ok' && r.resolved.name === 'task_update' && r.resolved.quest.id).toBe('v1');
    expect(r.kind === 'ok' && r.warnings[0]).toMatch(/names "Wash the van"/);
  });

  it('resolves by spoken title when there is no id', () => {
    const r = resolveAction(
      { name: 'task_add_participant', input: { taskRef: 'kitchen', user: { name: 'Roberto' } } },
      ctx('add roberto to the kitchen'),
    );
    expect(r.kind === 'ok' && r.resolved.name === 'task_add_participant' && r.resolved.quest.id).toBe('k1');
  });

  it('falls back to the focus for a pronoun-only follow-up, staged target first', () => {
    const r = resolveAction(
      { name: 'task_update', input: { time: '14:00' } },
      ctx('move it to two', { focus: { lastStagedTaskId: 'v1', openTaskId: 'k1' } }),
    );
    expect(r.kind === 'ok' && r.resolved.name === 'task_update' && r.resolved.quest.id).toBe('v1');
    const open = resolveAction(
      { name: 'task_update', input: { time: '14:00' } },
      ctx('move it to two', { focus: { openTaskId: 'k1' } }),
    );
    expect(open.kind === 'ok' && open.resolved.name === 'task_update' && open.resolved.quest.id).toBe('k1');
  });

  it('reports ambiguity and not-found instead of guessing', () => {
    const quests = [...ctx('').quests, { id: 'k2', title: 'Clean the bathroom', status: 'ongoing', participants: [] }];
    const amb = resolveAction({ name: 'task_update', input: { taskRef: 'clean', time: '14:00' } }, ctx('move clean to two', { quests }));
    expect(amb.kind).toBe('ambiguous');
    const nf = resolveAction({ name: 'task_update', input: { taskRef: 'buy groceries', time: '14:00' } }, ctx('move buy groceries to two'));
    expect(nf.kind).toBe('not_found');
    expect(nf.kind === 'not_found' && nf.message).toMatch(/Real tasks/);
  });
});

describe('resolveAction — people', () => {
  it('defaults to the speaker and understands "me"', () => {
    const r = resolveAction({ name: 'task_toggle_participant', input: { taskId: 'v1' } }, ctx('sign me up for the van'));
    expect(r.kind === 'ok' && r.resolved.name === 'task_toggle_participant' && r.resolved.user.id).toBe('3');
    const me = resolveAction({ name: 'task_toggle_participant', input: { taskId: 'v1', user: { name: 'me' } } }, ctx('add me to the van'));
    expect(me.kind === 'ok' && me.resolved.name === 'task_toggle_participant' && me.resolved.user.id).toBe('3');
  });

  it('resolves a name against the roster into a stored participant record', () => {
    const r = resolveAction(
      { name: 'task_add_participant', input: { taskId: 'v1', user: { name: 'marco bianchi' } } },
      ctx('add marco bianchi to the van'),
    );
    expect(r.kind === 'ok' && r.resolved.name === 'task_add_participant' && r.resolved.user).toEqual({
      id: '2',
      first_name: 'Marco',
      last_name: 'Bianchi',
    });
  });

  it('asks which Marco', () => {
    const r = resolveAction({ name: 'task_add_participant', input: { taskId: 'v1', user: { name: 'Marco' } } }, ctx('add marco to the van'));
    expect(r.kind).toBe('ambiguous');
    expect(r.kind === 'ambiguous' && r.field).toBe('user');
  });

  it('honours an unknown id with a warning', () => {
    const r = resolveAction({ name: 'task_add_participant', input: { taskId: 'v1', user: { id: '999' } } }, ctx('add 999'));
    expect(r.kind === 'ok' && r.resolved.name === 'task_add_participant' && r.resolved.user.id).toBe('999');
    expect(r.kind === 'ok' && r.warnings[0]).toMatch(/not in this holon/);
  });
});

describe('resolveSchedule', () => {
  const now = new Date(2026, 8, 9, 9, 0);
  const local = (v: string) => `${toLocalDateField(v)} ${toLocalTimeField(v)}`;

  it('"move it to 2PM" keeps the day and the duration', () => {
    const s = resolveSchedule({ time: '14:00' }, kitchen, now);
    expect(s && !('error' in s) && local(s.when)).toBe('2026-09-10 14:00');
    expect(s && !('error' in s) && local(s.ends)).toBe('2026-09-10 15:30');
  });

  it('a bare date keeps the clock', () => {
    const s = resolveSchedule({ date: '2026-09-12' }, kitchen, now);
    expect(s && !('error' in s) && local(s.when)).toBe('2026-09-12 10:00');
    expect(s && !('error' in s) && local(s.ends)).toBe('2026-09-12 11:30');
  });

  it('a bare time on an unscheduled task lands today', () => {
    const s = resolveSchedule({ time: '15:00' }, van, now);
    expect(s && !('error' in s) && local(s.when)).toBe('2026-09-09 15:00');
  });

  it('keeps an all-day span its length in days', () => {
    const s = resolveSchedule({ date: '2026-10-01' }, party, now);
    expect(s).toEqual({ when: '2026-10-01', ends: '2026-10-03', until: '' });
  });

  it('an explicit end wins over the carried duration', () => {
    const s = resolveSchedule({ time: '14:00', endTime: '14:30' }, kitchen, now);
    expect(s && !('error' in s) && local(s.ends)).toBe('2026-09-10 14:30');
  });

  it('is null without schedule fields and errors on bad ones', () => {
    expect(resolveSchedule({ title: 'x' }, kitchen, now)).toBeNull();
    expect(resolveSchedule({ date: '10/9' }, kitchen, now)).toHaveProperty('error');
  });
});

describe('resolveAction — create and complete', () => {
  it('builds a scheduled task with the speaker as initiator', () => {
    const r = resolveAction(
      { name: 'task_create', input: { title: 'Wash the bus', date: '2026-09-10', time: '14:00' } },
      ctx('create wash the bus tomorrow at two'),
    );
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok' || r.resolved.name !== 'task_create') throw new Error('unexpected');
    expect(r.resolved.task.title).toBe('Wash the bus');
    expect(r.resolved.task.initiator?.id).toBe('3');
    expect(toLocalTimeField(r.resolved.task.when)).toBe('14:00');
    expect(r.resolved.task.id).toBeTruthy();
  });

  it('completes with the speaker unless another completer is named', () => {
    const r = resolveAction({ name: 'task_complete', input: { taskRef: 'van' } }, ctx('the van is done'));
    expect(r.kind === 'ok' && r.resolved.name === 'task_complete' && r.resolved.completer.id).toBe('3');
    const other = resolveAction({ name: 'task_complete', input: { taskRef: 'van', completerId: '1' } }, ctx('marco finished the van'));
    expect(other.kind === 'ok' && other.resolved.name === 'task_complete' && other.resolved.completer).toMatchObject({ id: '1', first_name: 'Marco' });
  });
});
