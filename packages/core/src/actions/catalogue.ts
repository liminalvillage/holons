// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The task actions an agent may take, in one place. The names are the MCP
// tool names, so a Claude session over mcp-ui and the kiosk's voice agent
// speak the same vocabulary; the argument forms are the ones a spoken request
// naturally produces — a title as heard, a person's name, a local date and
// time — with exact ids accepted whenever the caller has them. Resolution of
// those loose references to real records is `resolve.ts`'s job, so the model
// never has to.

import type { ActionSpec, FieldSpec } from './spec.js';

const HOLON: FieldSpec = {
  name: 'holon',
  type: 'string',
  description: 'Holon id. Defaults to the holon on screen / in context.',
};

const TASK_ID: FieldSpec = {
  name: 'taskId',
  type: 'string',
  description:
    'EXACT id of the task, copied from the snapshot or a listing. Omit when you only know the title.',
};

const TASK_REF: FieldSpec = {
  name: 'taskRef',
  type: 'string',
  description:
    'The task as the user named it (title words, as spoken), when no exact id is known. ' +
    'Omit both taskId and taskRef for "it" / "this one" — the task in focus is used.',
};

const USER: FieldSpec = {
  name: 'user',
  type: 'object',
  description:
    'The person. Omit for the speaker themself. Give `name` as spoken when you do not know the id.',
  fields: [
    { name: 'id', type: 'string', description: 'Exact user id, when known.' },
    { name: 'username', type: 'string', description: 'Handle, without @.' },
    { name: 'name', type: 'string', description: 'First and/or last name as the user said it.' },
  ],
};

const SCHEDULE: FieldSpec[] = [
  { name: 'date', type: 'string', description: 'Local start date YYYY-MM-DD.' },
  {
    name: 'time',
    type: 'string',
    description:
      'Local start time HH:MM (24h). A time without a date keeps the task on its current day.',
  },
  { name: 'endDate', type: 'string', description: 'Local end date YYYY-MM-DD (optional).' },
  { name: 'endTime', type: 'string', description: 'Local end time HH:MM (optional).' },
];

const TASK_FIELDS: FieldSpec[] = [
  { name: 'title', type: 'string', description: 'Title.' },
  { name: 'description', type: 'string', description: 'Longer details.' },
  { name: 'category', type: 'string', description: 'Category label.' },
];

export const TASK_CREATE: ActionSpec = {
  name: 'task_create',
  kind: 'write',
  lens: 'quests',
  description:
    'Create a new task in the holon. Give date (and time) to put it on the calendar. ' +
    'Add people to it afterwards with task_add_participant using its title.',
  fields: [
    HOLON,
    { ...TASK_FIELDS[0], required: true },
    TASK_FIELDS[1],
    TASK_FIELDS[2],
    ...SCHEDULE,
  ],
};

export const TASK_UPDATE: ActionSpec = {
  name: 'task_update',
  kind: 'write',
  lens: 'quests',
  description:
    'Change an existing task: title, description, category, or schedule (move / reschedule). ' +
    'Pass only the fields to change.',
  fields: [HOLON, TASK_ID, TASK_REF, ...TASK_FIELDS, ...SCHEDULE],
};

export const TASK_ADD_PARTICIPANT: ActionSpec = {
  name: 'task_add_participant',
  kind: 'write',
  lens: 'quests',
  description: 'Add a person to a task as a participant (someone who takes part / is assigned).',
  fields: [HOLON, TASK_ID, TASK_REF, USER],
};

export const TASK_REMOVE_PARTICIPANT: ActionSpec = {
  name: 'task_remove_participant',
  kind: 'write',
  lens: 'quests',
  description: 'Remove a person from a task\'s participants.',
  fields: [HOLON, TASK_ID, TASK_REF, USER],
};

export const TASK_TOGGLE_PARTICIPANT: ActionSpec = {
  name: 'task_toggle_participant',
  kind: 'write',
  lens: 'quests',
  description:
    'Join a person to a task, or leave it if they already take part ("join", "leave", "sign me up").',
  fields: [HOLON, TASK_ID, TASK_REF, USER],
};

export const TASK_COMPLETE: ActionSpec = {
  name: 'task_complete',
  kind: 'write',
  lens: 'quests',
  description:
    'Mark a task completed. Its participants are the ones credited; the speaker is credited when nobody has joined.',
  fields: [
    HOLON,
    TASK_ID,
    TASK_REF,
    {
      name: 'completerId',
      type: 'string',
      description: 'User id of who completes it. Defaults to the speaker.',
    },
  ],
};

/** Every task action, in the order consumers register them. */
export const TASK_ACTIONS: readonly ActionSpec[] = [
  TASK_CREATE,
  TASK_UPDATE,
  TASK_ADD_PARTICIPANT,
  TASK_REMOVE_PARTICIPANT,
  TASK_TOGGLE_PARTICIPANT,
  TASK_COMPLETE,
];

export const TASK_ACTION_NAMES: readonly string[] = TASK_ACTIONS.map((a) => a.name);

export function isTaskAction(name: string): boolean {
  return TASK_ACTION_NAMES.includes(name);
}
