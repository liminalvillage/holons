// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { fieldNames, toJsonSchema, type ActionSpec } from './spec.js';
import { TASK_ACTIONS, TASK_ACTION_NAMES, TASK_UPDATE, isTaskAction } from './catalogue.js';

describe('toJsonSchema', () => {
  const spec: ActionSpec = {
    name: 'x',
    description: 'd',
    kind: 'write',
    lens: 'quests',
    fields: [
      { name: 'a', type: 'string', description: 'A', required: true },
      { name: 'k', type: 'string', description: 'K', enum: ['p', 'q'] },
      {
        name: 'o',
        type: 'object',
        description: 'O',
        fields: [{ name: 'n', type: 'number', description: 'N', required: true }],
      },
    ],
  };

  it('emits a JSON schema with required lists and nested objects', () => {
    const t = toJsonSchema(spec);
    expect(t.name).toBe('x');
    expect(t.inputSchema).toEqual({
      type: 'object',
      properties: {
        a: { type: 'string', description: 'A' },
        k: { type: 'string', description: 'K', enum: ['p', 'q'] },
        o: {
          type: 'object',
          description: 'O',
          properties: { n: { type: 'number', description: 'N' } },
          required: ['n'],
        },
      },
      required: ['a'],
    });
  });

  it('lists nested field names dotted', () => {
    expect(fieldNames(spec)).toEqual(['a', 'k', 'o', 'o.n']);
  });
});

describe('task catalogue', () => {
  it('uses the MCP tool names, all writes on the quests lens', () => {
    expect(TASK_ACTION_NAMES).toEqual([
      'task_create',
      'task_update',
      'task_add_participant',
      'task_remove_participant',
      'task_toggle_participant',
      'task_complete',
    ]);
    for (const a of TASK_ACTIONS) {
      expect(a.kind).toBe('write');
      expect(a.lens).toBe('quests');
      expect(toJsonSchema(a).inputSchema).toHaveProperty('properties');
    }
    expect(isTaskAction('task_update')).toBe(true);
    expect(isTaskAction('navigate')).toBe(false);
  });

  it('lets an update name the task by id or by title and schedule in local fields', () => {
    expect(fieldNames(TASK_UPDATE)).toEqual(
      expect.arrayContaining(['taskId', 'taskRef', 'date', 'time', 'endDate', 'endTime']),
    );
  });
});
