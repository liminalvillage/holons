// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  DRAFT_TOOL_NAME,
  DraftValidationError,
  buildDraftPrompt,
  buildDraftTool,
  parseDraft,
  type DraftField,
} from './draft.js';

const FIELDS: DraftField[] = [
  { name: 'name', kind: 'text', label: 'Name', required: true },
  { name: 'description', kind: 'long' },
  { name: 'locality', kind: 'text', about: 'The town it is in' },
  { name: 'amount', kind: 'number' },
  { name: 'open', kind: 'boolean' },
  { name: 'when', kind: 'datetime' },
  {
    name: 'geographic_scope',
    kind: 'choice',
    options: ['local', 'regional', 'national'],
  },
  { name: 'tags', kind: 'list' },
];

describe('the tool the model must call', () => {
  const tool = buildDraftTool(FIELDS);

  it('asks for every field, since a structured output has no optional half', () => {
    const props = tool.input_schema.properties as Record<string, any>;
    expect(tool.name).toBe(DRAFT_TOOL_NAME);
    expect(tool.input_schema.additionalProperties).toBe(false);
    expect(tool.input_schema.required).toEqual(FIELDS.map((f) => f.name));
    expect(Object.keys(props)).toEqual(FIELDS.map((f) => f.name));
  });

  it('gives every kind a way to say "the description does not say"', () => {
    const props = tool.input_schema.properties as Record<string, any>;
    expect(props.amount.type).toEqual(['number', 'null']);
    expect(props.open.type).toEqual(['boolean', 'null']);
    expect(props.tags).toMatchObject({ type: 'array', items: { type: 'string' } });
    // A choice says it with the empty string, which must therefore be legal.
    expect(props.geographic_scope.enum).toEqual([
      '',
      'local',
      'regional',
      'national',
    ]);
    expect(props.name.type).toBe('string');
  });

  it('tells the model what each field is, in the words the caller uses', () => {
    const props = tool.input_schema.properties as Record<string, any>;
    expect(props.locality.description).toContain('The town it is in');
    expect(props.name.description).toContain('The record needs this');
    expect(props.when.description).toContain('ISO 8601');
  });

  it('never sends more fields than a prompt can carry', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      name: `f${i}`,
      kind: 'text' as const,
    }));
    const props = buildDraftTool(many).input_schema.properties as Record<
      string,
      unknown
    >;
    expect(Object.keys(props)).toHaveLength(40);
  });
});

describe('the prompt', () => {
  const at = Date.UTC(2026, 8, 7);

  it('carries the day, so a relative date resolves', () => {
    const { system } = buildDraftPrompt({
      kind: 'Project',
      description: 'A thing',
      fields: FIELDS,
      now: at,
    });
    expect(system).toContain('2026-09-07');
    expect(system).toContain('Never invent a fact');
  });

  it('offers the place as a hint, and forbids writing coordinates into text', () => {
    const { user } = buildDraftPrompt({
      kind: 'Project',
      description: 'A community kitchen',
      fields: FIELDS,
      place: { lat: 42.851234, lon: 13.578912 },
      now: at,
    });
    expect(user).toContain('42.8512');
    expect(user).toContain('Never write coordinates');
    expect(user).toContain('A community kitchen');
  });

  it('caps a description nobody should be able to send', () => {
    const { user } = buildDraftPrompt({
      kind: 'Project',
      description: 'x'.repeat(9000),
      fields: FIELDS,
      now: at,
    });
    expect(user.length).toBeLessThan(2200);
  });
});

describe('what comes back', () => {
  it('keeps each answer in the shape its field takes', () => {
    expect(
      parseDraft(
        {
          name: '  Community kitchen  ',
          description: 'In the old mill, open Thursdays.',
          amount: 12.5,
          open: true,
          when: '2026-09-12T18:00',
          geographic_scope: 'Local',
          tags: ['food', 'food', ' kitchen '],
        },
        FIELDS
      )
    ).toEqual({
      name: 'Community kitchen',
      description: 'In the old mill, open Thursdays.',
      amount: 12.5,
      open: true,
      when: new Date('2026-09-12T18:00').toISOString(),
      geographic_scope: 'local',
      tags: ['food', 'kitchen'],
    });
  });

  it('drops every field the description did not answer', () => {
    expect(
      parseDraft(
        {
          name: 'Orchard',
          description: '',
          locality: '   ',
          amount: null,
          open: null,
          when: '',
          geographic_scope: '',
          tags: [],
        },
        FIELDS
      )
    ).toEqual({ name: 'Orchard' });
  });

  it('drops an answer the field cannot hold rather than coercing it', () => {
    expect(
      parseDraft(
        {
          name: 'Orchard',
          amount: 'a few hundred',
          when: 'sometime next spring',
          geographic_scope: 'planetary', // not one of the options
          open: 'yes',
          tags: 'food', // not a list
        },
        FIELDS
      )
    ).toEqual({ name: 'Orchard' });
  });

  it('ignores fields nobody asked for', () => {
    expect(
      parseDraft({ name: 'Orchard', secret: 'x', id: 'nope' }, FIELDS)
    ).toEqual({ name: 'Orchard' });
  });

  it('caps a long answer, and a runaway list', () => {
    const drafted = parseDraft(
      {
        name: 'x'.repeat(500),
        description: 'y'.repeat(4000),
        tags: Array.from({ length: 40 }, (_, i) => `t${i}`),
      },
      FIELDS
    );
    expect((drafted.name as string).length).toBe(300);
    expect((drafted.description as string).length).toBe(2000);
    expect(drafted.tags).toHaveLength(12);
  });

  it('refuses anything that is not a set of fields at all', () => {
    expect(() => parseDraft(null, FIELDS)).toThrow(DraftValidationError);
    expect(() => parseDraft('{}', FIELDS)).toThrow(DraftValidationError);
    expect(() => parseDraft([{ name: 'x' }], FIELDS)).toThrow(
      DraftValidationError
    );
  });
});
