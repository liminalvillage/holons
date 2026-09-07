// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Drafting a record from a description. Someone says what the thing is in
// their own words — "community kitchen in the old mill, open Thursdays, run
// by the neighbourhood association" — and the fields a form would otherwise
// ask for one by one come back filled in.
//
// Pure and UI-agnostic, like the task breakdown next door: this module owns
// the tool schema the model is forced to call, the prompt, and the validation
// of what comes back. The HTTP call to the provider lives at the edge (an app
// server route, or the browser when the device holds its own key).
//
// The contract with the model is deliberately narrow. It never invents facts —
// no plausible-looking URL, price, or phone number — and it never picks a
// value outside the options a field allows; a field the description doesn't
// speak to comes back empty, and `parseDraft` drops it. A draft is a
// suggestion in a form someone is looking at, so the failure mode that matters
// is a confident invention nobody notices, not a blank left to fill in.

/** What kind of answer a field takes. */
export type DraftFieldKind =
  | 'text'
  | 'long'
  | 'number'
  | 'boolean'
  | 'datetime'
  | 'choice'
  | 'list';

/** One field the caller wants filled in. */
export interface DraftField {
  /** The record's field name — what comes back keyed by. */
  name: string;
  kind: DraftFieldKind;
  /** How the field reads to a person, when that differs from its name. */
  label?: string;
  /** The schema's own prose about the field, when it has any. */
  about?: string;
  /** The only values a 'choice' (or a 'list' of choices) may take. */
  options?: readonly string[];
  /** Whether the record is incomplete without it — a hint, never enforced. */
  required?: boolean;
}

/** A drafted value, per field, in the shape that field takes. */
export type DraftValues = Record<string, string | number | boolean | string[]>;

export interface DraftRequest {
  /** What is being described, in the caller's own word for it ("Project"). */
  kind: string;
  /** What someone wrote. */
  description: string;
  /** The fields to fill.  */
  fields: readonly DraftField[];
  /** Where the thing is, when it has a place — grounds locality and region. */
  place?: { lat: number; lon: number } | null;
  /** Now, so "next Thursday" resolves. Defaults to the current time. */
  now?: number;
}

export const DRAFT_TOOL_NAME = 'fill_record';

/** How long a drafted value may be, per kind. */
const MAX_TEXT = 300;
const MAX_LONG = 2000;
const MAX_LIST = 12;
/** Beyond this a prompt stops being a form and starts being a budget problem. */
export const DRAFT_MAX_FIELDS = 40;
export const DRAFT_MAX_DESCRIPTION_CHARS = 2000;

export class DraftValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DraftValidationError';
  }
}

/** The empty answer for a kind — what "the description doesn't say" looks like. */
function emptyFor(kind: DraftFieldKind): string {
  return kind === 'list' ? 'an empty array' : kind === 'number' || kind === 'boolean' ? 'null' : 'an empty string';
}

/**
 * The forced-call tool: one property per field, every one of them required
 * (structured outputs treat `required` as the whole contract, so "unknown" has
 * to be expressible IN the value — an empty string, an empty array, or null).
 */
export function buildDraftTool(fields: readonly DraftField[]): {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
} {
  const properties: Record<string, unknown> = {};
  for (const f of fields.slice(0, DRAFT_MAX_FIELDS)) {
    const about = [f.label && f.label !== f.name ? f.label : '', f.about ?? '']
      .filter(Boolean)
      .join(' — ');
    const description = `${about || f.name}. ${
      f.required ? 'The record needs this. ' : ''
    }Use ${emptyFor(f.kind)} if the description does not say.`;
    if (f.kind === 'number') {
      properties[f.name] = { type: ['number', 'null'], description };
    } else if (f.kind === 'boolean') {
      properties[f.name] = { type: ['boolean', 'null'], description };
    } else if (f.kind === 'list') {
      properties[f.name] = {
        type: 'array',
        items: f.options?.length
          ? { type: 'string', enum: [...f.options] }
          : { type: 'string' },
        description,
      };
    } else if (f.kind === 'choice' && f.options?.length) {
      // '' is how the model says "the description doesn't say" for a choice.
      properties[f.name] = {
        type: 'string',
        enum: ['', ...f.options],
        description,
      };
    } else if (f.kind === 'datetime') {
      properties[f.name] = {
        type: 'string',
        description: `${description} Format: ISO 8601 (YYYY-MM-DD or YYYY-MM-DDTHH:mm).`,
      };
    } else {
      properties[f.name] = { type: 'string', description };
    }
  }
  return {
    name: DRAFT_TOOL_NAME,
    description:
      'Fill in the fields of a record from a description someone wrote. ' +
      'Every field must be present; leave empty the ones the description ' +
      'does not answer.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: Object.keys(properties),
      properties,
    },
  };
}

/**
 * The prompt. The fields are described in the tool schema, so the messages
 * carry the rules, the moment (today, and where the thing is) and the text —
 * nothing that the tool already says.
 */
export function buildDraftPrompt(req: DraftRequest): {
  system: string;
  user: string;
} {
  const now = req.now ?? Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const system = [
    `You fill in one "${req.kind}" record from a short description, by calling ${DRAFT_TOOL_NAME}.`,
    'Rules, in order of importance:',
    '1. Use ONLY what the description says, or what plainly follows from it. Never invent a fact — no made-up web address, email, phone number, price, date, or name. If the description does not answer a field, leave that field empty.',
    '2. Write in the same language as the description.',
    '3. Keep the description\'s own words where you can. You are transcribing what someone said into fields, not rewriting it.',
    '4. The headline field is a name, not a sentence: short, and no trailing full stop.',
    "5. A longer field may hold the description's own detail, minus whatever already sits in another field.",
    `Today is ${today}. Resolve any relative date ("next Thursday") against it.`,
  ].join('\n');

  const place = req.place
    ? `The thing is at latitude ${req.place.lat.toFixed(4)}, longitude ${req.place.lon.toFixed(4)}. You may use this to fill a place field (a locality, a region, a country) ONLY if you are sure of the answer; leave it empty if you are not. Never write coordinates into a text field.`
    : '';

  const user = [
    place,
    'The description:',
    req.description.slice(0, DRAFT_MAX_DESCRIPTION_CHARS).trim(),
  ]
    .filter(Boolean)
    .join('\n\n');

  return { system, user };
}

/** Trim, cap, and drop what is empty once trimmed. */
function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

/** The option this value means, matched loosely; null when it means none. */
function matchOption(value: string, options: readonly string[]): string | null {
  const wanted = value.trim().toLowerCase();
  if (!wanted) return null;
  return options.find((o) => o.toLowerCase() === wanted) ?? null;
}

/**
 * What the model returned, as record fields: only the asked-for fields, only
 * in the shapes they take, and nothing at all for a field it left empty or
 * answered with something the field can't hold. A draft that is thin is
 * useful; a draft with a made-up value in it is not, so anything unreadable
 * is dropped rather than coerced.
 */
export function parseDraft(
  input: unknown,
  fields: readonly DraftField[]
): DraftValues {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DraftValidationError('the model returned no fields');
  }
  const raw = input as Record<string, unknown>;
  const out: DraftValues = {};
  for (const f of fields) {
    const value = raw[f.name];
    if (value == null) continue;
    switch (f.kind) {
      case 'number': {
        const n = typeof value === 'number' ? value : Number(cleanText(value, 40));
        if (Number.isFinite(n)) out[f.name] = n;
        break;
      }
      case 'boolean': {
        if (typeof value === 'boolean') out[f.name] = value;
        break;
      }
      case 'datetime': {
        const text = cleanText(value, 40);
        if (!text) break;
        const at = new Date(text);
        if (!Number.isNaN(at.getTime())) out[f.name] = at.toISOString();
        break;
      }
      case 'choice': {
        const text = cleanText(value, MAX_TEXT);
        if (!text) break;
        const picked = f.options?.length ? matchOption(text, f.options) : text;
        if (picked) out[f.name] = picked;
        break;
      }
      case 'list': {
        if (!Array.isArray(value)) break;
        const list: string[] = [];
        for (const entry of value) {
          const text = cleanText(entry, MAX_TEXT);
          if (!text) continue;
          const picked = f.options?.length ? matchOption(text, f.options) : text;
          if (picked && !list.includes(picked)) list.push(picked);
          if (list.length >= MAX_LIST) break;
        }
        if (list.length) out[f.name] = list;
        break;
      }
      default: {
        const text = cleanText(value, f.kind === 'long' ? MAX_LONG : MAX_TEXT);
        if (text) out[f.name] = text;
      }
    }
  }
  return out;
}
