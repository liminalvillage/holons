// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How an agent-callable action is described — ONCE, in core — so every
// consumer derives its own schema from the same source: the kiosk's voice
// agent turns a spec into the JSON schema an LLM tool definition wants, the
// MCP server turns it into a zod shape. Two surfaces, one contract; a field
// added here appears in both, and a parity test in each consumer keeps them
// honest.
//
// Deliberately zod-free: core carries no schema library, and the spec is
// small enough that a hand-written JSON-schema emitter is all it needs.

export type FieldType = 'string' | 'number' | 'boolean' | 'object';

export interface FieldSpec {
  name: string;
  type: FieldType;
  description: string;
  /** Allowed values, for a string field. */
  enum?: readonly string[];
  required?: boolean;
  /** Nested fields, for an object. */
  fields?: readonly FieldSpec[];
}

export interface ActionSpec {
  /** Tool name — identical in every consumer (`task_update`, …). */
  name: string;
  description: string;
  fields: readonly FieldSpec[];
  /** Whether the action changes records (staged for approval) or only reads. */
  kind: 'write' | 'read';
  /** The lens the action's records live in. */
  lens: string;
}

/** The neutral tool shape LLM loops consume (`AgentTool` in @holons/ai-ui). */
export interface AgentToolShape {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

function fieldSchema(f: FieldSpec): Record<string, unknown> {
  if (f.type === 'object') {
    return {
      type: 'object',
      description: f.description,
      properties: Object.fromEntries((f.fields ?? []).map((n) => [n.name, fieldSchema(n)])),
      ...requiredOf(f.fields ?? []),
    };
  }
  return {
    type: f.type,
    description: f.description,
    ...(f.enum ? { enum: [...f.enum] } : {}),
  };
}

function requiredOf(fields: readonly FieldSpec[]): { required?: string[] } {
  const required = fields.filter((f) => f.required).map((f) => f.name);
  return required.length ? { required } : {};
}

/** JSON schema for the spec's input — the LLM tool definition. */
export function toJsonSchema(spec: ActionSpec): AgentToolShape {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(spec.fields.map((f) => [f.name, fieldSchema(f)])),
      ...requiredOf(spec.fields),
    },
  };
}

/** Field names a spec declares, nested ones dotted (`user.name`). */
export function fieldNames(spec: ActionSpec): string[] {
  const walk = (fields: readonly FieldSpec[], prefix: string): string[] =>
    fields.flatMap((f) => [
      `${prefix}${f.name}`,
      ...(f.fields ? walk(f.fields, `${prefix}${f.name}.`) : []),
    ]);
  return walk(spec.fields, '');
}
