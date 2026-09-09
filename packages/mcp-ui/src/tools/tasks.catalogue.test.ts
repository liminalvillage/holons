// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Parity with the shared catalogue: every task action core defines is an MCP
// tool of the same name whose schema accepts every catalogue argument — and
// a call runs through core's resolve → stage → apply, so an MCP write and a
// kiosk-approved change land the same way.
import { describe, expect, it } from 'vitest';
import { z, type ZodTypeAny } from 'zod';
import { TASK_ACTIONS, type FieldSpec } from '@holons/core/actions';
import { localFieldsToStored, toLocalTimeField } from '@holons/core/datetime';
import type { Quest } from '@holons/core/tasks';
import { registerTasksTools } from './tasks.js';
import type { ToolDeps } from './index.js';

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>;

function capture() {
  const tools = new Map<string, { shape: Record<string, ZodTypeAny>; handler: Handler }>();
  const server = {
    registerTool: (name: string, def: { inputSchema: Record<string, ZodTypeAny> }, handler: Handler) => {
      tools.set(name, { shape: def.inputSchema, handler });
    },
    tool: () => {},
  };
  return { server: server as never, tools };
}

/** A value for every catalogue field, nested ones included. */
function sample(fields: readonly FieldSpec[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((f) => [
      f.name,
      f.type === 'object' ? sample(f.fields ?? []) : f.type === 'number' ? 1 : f.type === 'boolean' ? true : f.enum?.[0] ?? 'x',
    ]),
  );
}

function fakeDeps(db: Record<string, Record<string, Quest | Record<string, unknown>>>): ToolDeps {
  const hs = {
    get: async (holon: string, lens: string, key: string) => db[`${holon}/${lens}`]?.[key] ?? null,
    getAll: async (holon: string, lens: string) => Object.values(db[`${holon}/${lens}`] ?? {}),
    put: async (holon: string, lens: string, rec: { id?: string | number }) => {
      (db[`${holon}/${lens}`] ??= {})[String(rec.id)] = rec as Quest;
      return true;
    },
  };
  return {
    getHoloSphere: async () => hs,
    resolveActor: () => ({ id: '3', first_name: 'Roberto' }),
  };
}

const payload = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text);

describe('task tools ⊇ core catalogue', () => {
  const { server, tools } = capture();
  registerTasksTools(server, fakeDeps({}));

  for (const action of TASK_ACTIONS) {
    it(`${action.name} is registered and accepts every catalogue field`, () => {
      const tool = tools.get(action.name);
      expect(tool, action.name).toBeDefined();
      const parsed = z.object(tool!.shape).safeParse({ ...sample(action.fields), holon: 'h' });
      expect(parsed.success, JSON.stringify(parsed)).toBe(true);
    });
  }
});

describe('task tools run through core', () => {
  const kitchen: Quest = {
    id: 'k1',
    title: 'Clean the kitchen',
    status: 'ongoing',
    participants: [],
    when: localFieldsToStored('2026-09-10', '10:00')!,
    ends: localFieldsToStored('2026-09-10', '11:30')!,
  };
  const db = {
    'h/quests': { k1: kitchen },
    'h/users': { 1: { id: 1, first_name: 'Marco', last_name: 'Rossi' }, 3: { id: 3, first_name: 'Roberto' } },
  };
  const { server, tools } = capture();
  registerTasksTools(server, fakeDeps(db));
  const call = (name: string, args: Record<string, unknown>) => tools.get(name)!.handler(args);

  it('moves a task by bare time, keeping day and duration, and by legacy ISO when', async () => {
    const r = payload(await call('task_update', { holon: 'h', taskRef: 'kitchen', time: '14:00' }));
    expect(r.success).toBe(true);
    expect(toLocalTimeField(r.task.when)).toBe('14:00');
    expect(toLocalTimeField(r.task.ends)).toBe('15:30');
    expect(r.change).toMatch(/^Change "Clean the kitchen": schedule/);
    const legacy = payload(
      await call('task_update', { holon: 'h', taskId: 'k1', when: localFieldsToStored('2026-09-12', '09:00') }),
    );
    expect(toLocalTimeField(legacy.task.when)).toBe('09:00');
    expect(toLocalTimeField(legacy.task.ends)).toBe('10:30');
  });

  it('adds a person by name, removes by legacy userId, toggles the actor', async () => {
    const add = payload(await call('task_add_participant', { holon: 'h', taskId: 'k1', user: { name: 'marco' } }));
    expect(add.task.participants).toEqual([{ id: '1', first_name: 'Marco', last_name: 'Rossi' }]);
    const again = await call('task_add_participant', { holon: 'h', taskId: 'k1', user: { name: 'marco' } });
    expect(again.isError).toBe(true);
    const rm = payload(await call('task_remove_participant', { holon: 'h', taskId: 'k1', userId: 1 }));
    expect(rm.task.participants).toEqual([]);
    const me = payload(await call('task_toggle_participant', { holon: 'h', taskId: 'k1' }));
    expect(me.task.participants).toEqual([{ id: '3', first_name: 'Roberto' }]);
  });

  it('creates with local date/time fields and reports a missing task', async () => {
    const r = payload(await call('task_create', { holon: 'h', title: 'Wash the bus', date: '2026-09-10', time: '14:00', endTime: '15:00' }));
    expect(r.success).toBe(true);
    expect(toLocalTimeField(r.task.when)).toBe('14:00');
    expect(toLocalTimeField(r.task.ends)).toBe('15:00');
    const nf = await call('task_update', { holon: 'h', taskRef: 'buy groceries', title: 'x' });
    expect(nf.isError).toBe(true);
  });
});
